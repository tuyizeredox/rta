import type { Locale } from "@/types";

/**
 * Enum values as a person reads them.
 *
 * These are the words on every status pill in the platform, and they were the
 * last English left on an otherwise translated screen: a member could read the
 * whole of their savings page in Kinyarwanda and still be told their loan was
 * "OVERDUE" in a language they may not have.
 *
 * Keyed by the database enum rather than by screen, because the same value
 * appears in a member's loan list, an administrator's portfolio table and a
 * report, and all three must say the same word. StatusBadge is the only reader.
 *
 * ON AGREEMENT: Kinyarwanda inflects a verb to the class of its subject, and a
 * single badge is used for members, loans, payments and jobs alike, so no one
 * agreement can be correct everywhere. These use the impersonal class 8 "bi-"
 * form throughout — "Byemejwe", not "Yemejwe" — which is what the rest of the
 * dictionary already does for statuses shared across subjects, and which reads
 * as a statement about the record rather than about the person.
 */
export interface StatusCopy {
  // Generic lifecycle
  ACTIVE: string;
  INACTIVE: string;
  PENDING: string;
  PENDING_APPROVAL: string;
  PENDING_VERIFICATION: string;
  SUSPENDED: string;
  DISABLED: string;
  LOCKED: string;
  EXITED: string;
  REJECTED: string;
  CANCELLED: string;
  ARCHIVED: string;

  // KYC
  UNVERIFIED: string;
  VERIFIED: string;

  // Transactions
  COMPLETED: string;
  FAILED: string;
  REVERSED: string;

  // Transaction types
  DEPOSIT: string;
  WITHDRAWAL: string;
  LOAN_DISBURSEMENT: string;
  LOAN_REPAYMENT: string;
  PENALTY: string;
  INTEREST: string;
  FEE: string;
  ADJUSTMENT: string;
  REVERSAL: string;
  OTHER: string;

  // Payments
  RECEIVED: string;
  UNMATCHED: string;
  MATCHED: string;
  PROCESSED: string;
  DUPLICATE: string;

  // Withdrawals
  UNDER_REVIEW: string;
  APPROVED: string;
  PROCESSING: string;

  // Loan applications
  DRAFT: string;
  SUBMITTED: string;
  MORE_INFORMATION_REQUIRED: string;

  // Loans
  PENDING_DISBURSEMENT: string;
  DISBURSED: string;
  OVERDUE: string;
  DEFAULTED: string;
  WRITTEN_OFF: string;
  RESTRUCTURED: string;

  // Instalments
  UPCOMING: string;
  DUE: string;
  PARTIALLY_PAID: string;
  PAID: string;
  WAIVED: string;

  // Payment channels
  MOBILE_MONEY: string;
  BANK_TRANSFER: string;
  CASH: string;
  CHEQUE: string;
  INTERNAL: string;

  // Jobs
  RUNNING: string;
  SUCCESS: string;
  PARTIAL: string;
  SKIPPED: string;

  // Roles
  MEMBER: string;
  ADMIN: string;
  SUPER_ADMIN: string;
}

export const status: Record<Locale, StatusCopy> = {
  en: {
    ACTIVE: "Active",
    INACTIVE: "Inactive",
    PENDING: "Pending",
    PENDING_APPROVAL: "Pending approval",
    PENDING_VERIFICATION: "Pending verification",
    SUSPENDED: "Suspended",
    DISABLED: "Disabled",
    LOCKED: "Locked",
    EXITED: "Exited",
    REJECTED: "Rejected",
    CANCELLED: "Cancelled",
    ARCHIVED: "Archived",

    UNVERIFIED: "Unverified",
    VERIFIED: "Verified",

    COMPLETED: "Completed",
    FAILED: "Failed",
    REVERSED: "Reversed",

    DEPOSIT: "Deposit",
    WITHDRAWAL: "Withdrawal",
    LOAN_DISBURSEMENT: "Loan disbursement",
    LOAN_REPAYMENT: "Loan repayment",
    PENALTY: "Penalty",
    INTEREST: "Interest",
    FEE: "Fee",
    ADJUSTMENT: "Adjustment",
    REVERSAL: "Reversal",
    OTHER: "Other",

    RECEIVED: "Received",
    UNMATCHED: "Unmatched",
    MATCHED: "Matched",
    PROCESSED: "Processed",
    DUPLICATE: "Duplicate",

    UNDER_REVIEW: "Under review",
    APPROVED: "Approved",
    PROCESSING: "Processing",

    DRAFT: "Draft",
    SUBMITTED: "Submitted",
    MORE_INFORMATION_REQUIRED: "More info needed",

    PENDING_DISBURSEMENT: "Awaiting disbursement",
    DISBURSED: "Disbursed",
    OVERDUE: "Overdue",
    DEFAULTED: "Defaulted",
    WRITTEN_OFF: "Written off",
    RESTRUCTURED: "Restructured",

    UPCOMING: "Upcoming",
    DUE: "Due",
    PARTIALLY_PAID: "Partially paid",
    PAID: "Paid",
    WAIVED: "Waived",

    MOBILE_MONEY: "Mobile money",
    BANK_TRANSFER: "Bank transfer",
    CASH: "Cash",
    CHEQUE: "Cheque",
    INTERNAL: "Internal",

    RUNNING: "Running",
    SUCCESS: "Success",
    PARTIAL: "Partial",
    SKIPPED: "Skipped",

    MEMBER: "Member",
    ADMIN: "Admin",
    SUPER_ADMIN: "Super admin",
  },

  rw: {
    ACTIVE: "Birakora",
    INACTIVE: "Ntibikora",
    PENDING: "Bitegereje",
    PENDING_APPROVAL: "Bitegereje kwemezwa",
    PENDING_VERIFICATION: "Bitegereje kugenzurwa",
    SUSPENDED: "Byahagaritswe",
    DISABLED: "Ntibikoreshwa",
    LOCKED: "Byafunzwe",
    EXITED: "Byavuyemo",
    REJECTED: "Byanzwe",
    CANCELLED: "Byakuweho",
    ARCHIVED: "Byabitswe",

    UNVERIFIED: "Ntibyagenzuwe",
    VERIFIED: "Byagenzuwe",

    COMPLETED: "Byarangiye",
    FAILED: "Byananiranye",
    REVERSED: "Byasubijwe",

    DEPOSIT: "Kubitsa",
    WITHDRAWAL: "Kubikuza",
    LOAN_DISBURSEMENT: "Gutanga inguzanyo",
    LOAN_REPAYMENT: "Kwishyura inguzanyo",
    PENALTY: "Ihazabu",
    INTEREST: "Inyungu",
    FEE: "Ikiguzi",
    ADJUSTMENT: "Ikosora",
    REVERSAL: "Gusubiza inyuma",
    OTHER: "Ibindi",

    RECEIVED: "Byakiriwe",
    UNMATCHED: "Ntibyahujwe",
    MATCHED: "Byahujwe",
    PROCESSED: "Byatunganyijwe",
    DUPLICATE: "Bisubiramo",

    UNDER_REVIEW: "Birimo gusuzumwa",
    APPROVED: "Byemejwe",
    PROCESSING: "Birimo gutunganywa",

    DRAFT: "Bigitegurwa",
    SUBMITTED: "Byoherejwe",
    MORE_INFORMATION_REQUIRED: "Hakenewe andi makuru",

    PENDING_DISBURSEMENT: "Bitegereje gutangwa",
    DISBURSED: "Byatanzwe",
    OVERDUE: "Byarengeje igihe",
    DEFAULTED: "Ntibyishyuwe",
    WRITTEN_OFF: "Byahanaguwe",
    RESTRUCTURED: "Byavuguruwe",

    UPCOMING: "Bitaragera",
    DUE: "Bigeze igihe",
    PARTIALLY_PAID: "Byishyuwe igice",
    PAID: "Byishyuwe",
    WAIVED: "Byababariwe",

    MOBILE_MONEY: "Mobile money",
    BANK_TRANSFER: "Kohereza kuri banki",
    CASH: "Amafaranga mu ntoki",
    CHEQUE: "Sheki",
    INTERNAL: "Imbere mu ihuriro",

    RUNNING: "Birimo gukora",
    SUCCESS: "Byagenze neza",
    PARTIAL: "Byagenze igice",
    SKIPPED: "Byasimbutswe",

    MEMBER: "Umunyamuryango",
    ADMIN: "Umuyobozi",
    SUPER_ADMIN: "Umuyobozi mukuru",
  },
};

/** Formats an unmapped enum value into something readable. */
function humanise(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((word, i) =>
      i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word
    )
    .join(" ");
}

/**
 * The label for a status in one language.
 *
 * Lives here rather than beside StatusBadge because server components call it
 * directly — a table that renders a channel name without a pill still needs
 * the translated word, and a "use client" module cannot supply one.
 */
export function statusLabel(value: string, copy: StatusCopy): string {
  return copy[value as keyof StatusCopy] ?? humanise(value);
}
