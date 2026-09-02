import "server-only";
import { prisma } from "@/lib/db/prisma";
import { recordAudit, diffFields, AUDIT_ACTIONS } from "@/lib/audit";
import type {
  UpdateOwnAccountInput,
  UpdateOwnProfileInput,
} from "@/lib/validation/profile";

/**
 * Self-service profile editing.
 *
 * Separate from `updateMember` in lib/services/members.ts on purpose, even
 * though the two write mostly the same columns. They are not the same
 * operation:
 *
 *   • The actor is the subject. There is no member id parameter and none is
 *     accepted — the session decides whose record is written, so this cannot
 *     be pointed at a colleague and cannot reach another tenant. That is the
 *     whole of its authorisation, and it is structural rather than checked.
 *
 *   • It works for someone with no member record. An administrator who does
 *     not save with the association still has a name and a phone number, and
 *     both live on the user row. `updateMember` has nothing to write for them.
 *
 *   • Changing your own contact details un-verifies them. An administrator
 *     transcribing a paper form is copying a number somebody else confirmed;
 *     a person typing a new one into a web page has confirmed nothing, and a
 *     record that still claims the old confirmation is a lie.
 *
 *   • A verified national ID is refused rather than re-queued. KYC verified a
 *     specific document against a specific person; letting that person quietly
 *     replace the number afterwards would make the verification meaningless.
 *
 * The audit entry carries a before/after diff and names the actor as the
 * subject — see AUDIT_ACTIONS.USER_PROFILE_UPDATED.
 */

/** The user-row fields, in the shape the audit diff records them. */
const ACCOUNT_FIELDS = ["firstName", "lastName", "phone", "email"] as const;

/** The member-file fields on top of those. */
const MEMBER_FIELDS = [
  "nationalId",
  "dateOfBirth",
  "gender",
  "occupation",
  "businessName",
  "addressLine1",
  "city",
  "district",
  "province",
  "mobileMoneyNumber",
  "bankAccountNumber",
  "nextOfKinName",
  "nextOfKinPhone",
  "nextOfKinRelation",
] as const;

const ALL_FIELDS = [...ACCOUNT_FIELDS, ...MEMBER_FIELDS] as const;

type Snapshot = Record<(typeof ALL_FIELDS)[number], unknown>;

/**
 * Fields whose value decides where money goes. A change to one of these is
 * worth more than a routine edit when somebody scans the log later, which is
 * the same rule `updateMember` applies to an administrator's edit.
 *
 * `mobileMoneyNumber` and `bankAccountNumber` score above the auto-credit
 * threshold in lib/services/payment-matching.ts — a payment arriving from
 * either is attributed without a human looking at it — so a self-edit of one
 * is exactly the event an investigator needs to be able to find.
 */
const MATCHING_KEYS = new Set(["phone", "mobileMoneyNumber", "bankAccountNumber"]);

export type UpdateOwnProfileResult =
  | { ok: true; changed: boolean }
  | { ok: false; field: string; message: string };

export async function updateOwnProfile(params: {
  userId: string;
  input: UpdateOwnProfileInput | UpdateOwnAccountInput;
}): Promise<UpdateOwnProfileResult> {
  const { userId, input } = params;

  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      associationId: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      member: {
        select: {
          id: true,
          associationId: true,
          kycStatus: true,
          nationalId: true,
          dateOfBirth: true,
          gender: true,
          occupation: true,
          businessName: true,
          addressLine1: true,
          city: true,
          district: true,
          province: true,
          mobileMoneyNumber: true,
          bankAccountNumber: true,
          nextOfKinName: true,
          nextOfKinPhone: true,
          nextOfKinRelation: true,
        },
      },
    },
  });

  if (!existing) {
    return { ok: false, field: "_", message: "Account not found" };
  }

  const member = existing.member;

  // A caller with no member record cannot have sent member fields past the
  // route, which picks its schema on exactly this condition. Narrowing here
  // saves the rest of the function from asking the same question twice.
  const memberInput = member ? (input as UpdateOwnProfileInput) : null;

  // Both are unique across every user. Checked here so the failure is a named
  // field with a usable message rather than a database constraint violation,
  // and enforced again by the constraint itself.
  const [phoneOwner, emailOwner] = await Promise.all([
    prisma.user.findFirst({
      where: { phone: input.phone, id: { not: userId } },
      select: { id: true },
    }),
    input.email
      ? prisma.user.findFirst({
          where: { email: input.email, id: { not: userId } },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);

  if (phoneOwner) {
    return {
      ok: false,
      field: "phone",
      message: "Another account already uses this phone number",
    };
  }
  if (emailOwner) {
    return {
      ok: false,
      field: "email",
      message: "Another account already uses this email address",
    };
  }

  const nationalIdChanged = Boolean(
    member && (memberInput?.nationalId ?? null) !== (member.nationalId ?? null)
  );

  if (member && nationalIdChanged && member.kycStatus === "VERIFIED") {
    return {
      ok: false,
      field: "nationalId",
      message:
        "Your identity has already been verified against this national ID. Ask an administrator to change it.",
    };
  }

  if (member && memberInput?.nationalId && nationalIdChanged) {
    const duplicate = await prisma.member.findFirst({
      where: {
        associationId: member.associationId,
        nationalId: memberInput.nationalId,
        id: { not: member.id },
      },
      select: { id: true },
    });
    if (duplicate) {
      // Deliberately does not name the other member. An administrator who hits
      // this collision is told which file it clashes with, because resolving it
      // is their job; a member typing a number into a form is not handed
      // somebody else's identity.
      return {
        ok: false,
        field: "nationalId",
        message: "This national ID is already recorded against another member",
      };
    }
  }

  const before: Partial<Snapshot> = {
    firstName: existing.firstName,
    lastName: existing.lastName,
    phone: existing.phone,
    email: existing.email,
    ...(member
      ? {
          nationalId: member.nationalId,
          dateOfBirth: member.dateOfBirth?.toISOString().slice(0, 10) ?? null,
          gender: member.gender,
          occupation: member.occupation,
          businessName: member.businessName,
          addressLine1: member.addressLine1,
          city: member.city,
          district: member.district,
          province: member.province,
          mobileMoneyNumber: member.mobileMoneyNumber,
          bankAccountNumber: member.bankAccountNumber,
          nextOfKinName: member.nextOfKinName,
          nextOfKinPhone: member.nextOfKinPhone,
          nextOfKinRelation: member.nextOfKinRelation,
        }
      : {}),
  };

  const after: Partial<Snapshot> = {
    firstName: input.firstName,
    lastName: input.lastName,
    phone: input.phone,
    email: input.email ?? null,
    ...(memberInput
      ? {
          nationalId: memberInput.nationalId ?? null,
          dateOfBirth: memberInput.dateOfBirth?.toISOString().slice(0, 10) ?? null,
          gender: memberInput.gender ?? null,
          occupation: memberInput.occupation ?? null,
          businessName: memberInput.businessName ?? null,
          addressLine1: memberInput.addressLine1 ?? null,
          city: memberInput.city ?? null,
          district: memberInput.district ?? null,
          province: memberInput.province ?? null,
          mobileMoneyNumber: memberInput.mobileMoneyNumber ?? null,
          bankAccountNumber: memberInput.bankAccountNumber ?? null,
          nextOfKinName: memberInput.nextOfKinName ?? null,
          nextOfKinPhone: memberInput.nextOfKinPhone ?? null,
          nextOfKinRelation: memberInput.nextOfKinRelation ?? null,
        }
      : {}),
  };

  const { oldValue, newValue } = diffFields(before as Snapshot, after, [
    ...(member ? ALL_FIELDS : ACCOUNT_FIELDS),
  ]);

  // Opening the form and pressing save without typing anything is not an
  // event. An audit row saying so is noise in a log people have to read, and
  // the caller is told nothing changed so the page can say the same.
  if (Object.keys(newValue).length === 0) return { ok: true, changed: false };

  // A new address or number has been confirmed by nobody. Keeping the old
  // timestamp would leave the record claiming a verification that was never
  // performed against the value it now holds.
  const emailChanged = "email" in newValue;
  const phoneChanged = "phone" in newValue;

  // Recording a national ID where there was none, or replacing an unverified
  // one, puts identity back in the queue to be checked. It has not been
  // verified merely by being typed in — least of all by its owner.
  const kycStatus =
    member && nationalIdChanged && memberInput?.nationalId
      ? ("PENDING" as const)
      : member?.kycStatus;

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        email: input.email ?? null,
        ...(emailChanged ? { emailVerifiedAt: null } : {}),
        ...(phoneChanged ? { phoneVerifiedAt: null } : {}),
      },
    });

    if (member && memberInput) {
      await tx.member.update({
        where: { id: member.id },
        data: {
          nationalId: memberInput.nationalId ?? null,
          dateOfBirth: memberInput.dateOfBirth ?? null,
          gender: memberInput.gender ?? null,
          occupation: memberInput.occupation ?? null,
          businessName: memberInput.businessName ?? null,
          addressLine1: memberInput.addressLine1 ?? null,
          city: memberInput.city ?? null,
          district: memberInput.district ?? null,
          province: memberInput.province ?? null,
          mobileMoneyNumber: memberInput.mobileMoneyNumber ?? null,
          bankAccountNumber: memberInput.bankAccountNumber ?? null,
          nextOfKinName: memberInput.nextOfKinName ?? null,
          nextOfKinPhone: memberInput.nextOfKinPhone ?? null,
          nextOfKinRelation: memberInput.nextOfKinRelation ?? null,
          kycStatus,
        },
      });
    }

    await recordAudit(
      {
        action: AUDIT_ACTIONS.USER_PROFILE_UPDATED,
        // Filed against the member record where there is one, so the change
        // appears on the member's own file alongside the administrator's edits
        // of it. A staff account with no membership has only the user row.
        entityType: member ? "Member" : "User",
        entityId: member ? member.id : userId,
        associationId: existing.associationId,
        oldValue,
        newValue,
        severity: Object.keys(newValue).some((field) => MATCHING_KEYS.has(field))
          ? "WARNING"
          : "INFO",
      },
      { id: userId },
      tx
    );
  });

  return { ok: true, changed: true };
}

/**
 * The caller's own details, in the shape the edit form wants them: strings
 * throughout, empty rather than null, and the date as YYYY-MM-DD for a date
 * input. Returns null when the user no longer exists.
 */
export async function getOwnProfileForEdit(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      member: {
        select: {
          kycStatus: true,
          nationalId: true,
          dateOfBirth: true,
          gender: true,
          occupation: true,
          businessName: true,
          addressLine1: true,
          city: true,
          district: true,
          province: true,
          mobileMoneyNumber: true,
          bankAccountNumber: true,
          nextOfKinName: true,
          nextOfKinPhone: true,
          nextOfKinRelation: true,
        },
      },
    },
  });

  if (!user) return null;

  const member = user.member;

  return {
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone ?? "",
    email: user.email ?? "",
    /// Decides which half of the form renders, and which schema the route
    /// validates against. Staff with no savings of their own see the contact
    /// section and nothing else, because they have nothing else.
    hasMemberRecord: Boolean(member),
    /// A verified ID is shown but not editable — see updateOwnProfile.
    nationalIdLocked: member?.kycStatus === "VERIFIED",
    nationalId: member?.nationalId ?? "",
    dateOfBirth: member?.dateOfBirth?.toISOString().slice(0, 10) ?? "",
    gender: member?.gender ?? "",
    occupation: member?.occupation ?? "",
    businessName: member?.businessName ?? "",
    addressLine1: member?.addressLine1 ?? "",
    city: member?.city ?? "",
    district: member?.district ?? "",
    province: member?.province ?? "",
    mobileMoneyNumber: member?.mobileMoneyNumber ?? "",
    bankAccountNumber: member?.bankAccountNumber ?? "",
    nextOfKinName: member?.nextOfKinName ?? "",
    nextOfKinPhone: member?.nextOfKinPhone ?? "",
    nextOfKinRelation: member?.nextOfKinRelation ?? "",
  };
}

export type OwnProfileForEdit = NonNullable<
  Awaited<ReturnType<typeof getOwnProfileForEdit>>
>;
