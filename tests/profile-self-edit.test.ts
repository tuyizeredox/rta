import { describe, expect, it } from "vitest";
import {
  updateOwnAccountSchema,
  updateOwnProfileSchema,
} from "@/lib/validation/profile";

/**
 * Self-service profile editing.
 *
 * What these tests protect is the boundary, not the happy path. The whole
 * point of a separate schema from the administrator's is that a person editing
 * their own record reaches fewer fields than an administrator editing it for
 * them — and a field that quietly leaks across that line is invisible until
 * somebody uses it.
 *
 * The service-level rules that need a database — a verified national ID being
 * refused, contact details losing their verification when changed, the audit
 * diff — live in lib/services/profile.ts and are not covered here.
 */

/** The four fields every signed-in person has. */
const contact = {
  firstName: "Jean",
  lastName: "Uwimana",
  phone: "0788123456",
  email: "jean@example.com",
};

describe("what a person may change about themselves", () => {
  it("accepts name and contact from someone with no member record", () => {
    const parsed = updateOwnAccountSchema.parse(contact);

    expect(parsed.firstName).toBe("Jean");
    // Normalised to E.164 on the way in, exactly as the admin form does it,
    // so the two never write the same number in two shapes.
    expect(parsed.phone).toBe("+250788123456");
    expect(parsed.email).toBe("jean@example.com");
  });

  it("refuses to record membership status, however it is sent", () => {
    // Suspension is lifted by an administrator with a permission and a stated
    // reason. A profile edit that could carry `status` would route around all
    // of that, so the field must not survive the parse.
    const parsed = updateOwnProfileSchema.parse({
      ...contact,
      status: "ACTIVE",
      kycStatus: "VERIFIED",
    });

    expect(parsed).not.toHaveProperty("status");
    expect(parsed).not.toHaveProperty("kycStatus");
  });

  it("refuses to record the identifiers payments are matched by", () => {
    // Both are printed on every payment instruction the member has been given.
    // Editing a payment reference orphans the payments already matched by it.
    const parsed = updateOwnProfileSchema.parse({
      ...contact,
      memberNumber: "RTA-000999",
      paymentReference: "RTA-000999",
    });

    expect(parsed).not.toHaveProperty("memberNumber");
    expect(parsed).not.toHaveProperty("paymentReference");
  });

  it("takes no audit note from the person making the change", () => {
    const parsed = updateOwnProfileSchema.parse({
      ...contact,
      note: "Because I say so",
    });

    expect(parsed).not.toHaveProperty("note");
  });

  it("gives a member no member fields when they have no member record", () => {
    // The route picks this schema on exactly that condition. A member field
    // sent by a staff account with no member row has nowhere to be written.
    const parsed = updateOwnAccountSchema.parse({
      ...contact,
      mobileMoneyNumber: "0788999888",
      occupation: "Tailor",
    });

    expect(parsed).not.toHaveProperty("mobileMoneyNumber");
    expect(parsed).not.toHaveProperty("occupation");
  });
});

describe("the member file a member may edit", () => {
  it("normalises the numbers that decide where money goes", () => {
    const parsed = updateOwnProfileSchema.parse({
      ...contact,
      mobileMoneyNumber: "0788999888",
      bankAccountNumber: "4001 2345-6789",
    });

    expect(parsed.mobileMoneyNumber).toBe("+250788999888");
    // Spaces and dashes stripped, so the statement importer's account number
    // and the stored one compare equal.
    expect(parsed.bankAccountNumber).toBe("400123456789");
  });

  it("stores a district by its one canonical spelling", () => {
    const parsed = updateOwnProfileSchema.parse({
      ...contact,
      province: "kigali city",
      district: "kicukiro district",
    });

    expect(parsed.province).toBe("Kigali City");
    expect(parsed.district).toBe("Kicukiro");
  });

  it("rejects a district that does not sit in the chosen province", () => {
    // The form cannot produce this pairing — its district list is filtered by
    // the province — but a direct API call can, and the record it would write
    // is one no district report can place.
    const result = updateOwnProfileSchema.safeParse({
      ...contact,
      province: "Northern Province",
      district: "Kicukiro",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path[0] === "district")).toBe(
      true
    );
  });

  it("rejects a national ID that is not sixteen digits", () => {
    const result = updateOwnProfileSchema.safeParse({
      ...contact,
      nationalId: "12345",
    });

    expect(result.success).toBe(false);
  });

  it("treats an untouched optional field as unset rather than empty", () => {
    // Every field on this form arrives as a string, and an untouched one
    // arrives as "". Storing that would turn "not recorded" into a value.
    const parsed = updateOwnProfileSchema.parse({
      ...contact,
      email: "",
      nationalId: "",
      occupation: "",
      mobileMoneyNumber: "",
      district: "",
      province: "",
    });

    expect(parsed.email).toBeUndefined();
    expect(parsed.nationalId).toBeUndefined();
    expect(parsed.occupation).toBeUndefined();
    expect(parsed.mobileMoneyNumber).toBeUndefined();
    expect(parsed.district).toBeUndefined();
  });
});

describe("the messages a person reads about their own record", () => {
  it("addresses the reader, not an administrator filing for them", () => {
    const result = updateOwnProfileSchema.safeParse({ ...contact, firstName: "" });

    expect(result.success).toBe(false);
    const message = result.error?.issues.find(
      (issue) => issue.path[0] === "firstName"
    )?.message;

    // The admin schema says "the member's first name" — correct at a desk,
    // wrong on the screen of the person it is about.
    expect(message).toBe("Enter your first name");
  });

  it("rejects a phone number that is not a Rwandan mobile", () => {
    const result = updateOwnProfileSchema.safeParse({ ...contact, phone: "12345" });

    expect(result.success).toBe(false);
  });
});
