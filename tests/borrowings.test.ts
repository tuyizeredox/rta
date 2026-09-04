import { describe, expect, it } from "vitest";
import {
  BorrowingError,
  allocateRepayment,
  resolveCost,
} from "@/lib/services/borrowings";
import { borrowingAgainstSavings } from "@/lib/services/association-finances";
import { add, toMoneyString } from "@/lib/money";

/**
 * The association's own borrowing.
 *
 * These are the pure parts of the module — no database — and they are the
 * parts worth proving, because both feed the surplus figure shown on the
 * members' page. A repayment split wrongly does not just misreport one
 * facility: interest wrongly booked as principal understates the cost of
 * borrowing, which overstates the surplus, which overstates the share every
 * member believes is theirs.
 */

const split = (result: ReturnType<typeof allocateRepayment>) => ({
  principal: toMoneyString(result.principal),
  interest: toMoneyString(result.interest),
  fees: toMoneyString(result.fees),
});

describe("allocating a repayment to a facility", () => {
  it("clears interest before principal", () => {
    const result = allocateRepayment({
      amount: "100000",
      interestOutstanding: "30000",
      principalOutstanding: "500000",
    });

    expect(split(result)).toEqual({
      principal: "70000.00",
      interest: "30000.00",
      fees: "0.00",
    });
  });

  it("puts everything to interest when the payment does not cover it", () => {
    const result = allocateRepayment({
      amount: "20000",
      interestOutstanding: "30000",
      principalOutstanding: "500000",
    });

    expect(split(result)).toEqual({
      principal: "0.00",
      interest: "20000.00",
      fees: "0.00",
    });
  });

  it("honours the split stated on the lender's advice note", () => {
    // The lender says only 12,000 of this payment was interest, even though
    // 30,000 is outstanding. Their figure governs.
    const result = allocateRepayment({
      amount: "100000",
      interestOutstanding: "30000",
      principalOutstanding: "500000",
      statedInterest: "12000",
    });

    expect(split(result)).toEqual({
      principal: "88000.00",
      interest: "12000.00",
      fees: "0.00",
    });
  });

  it("caps a stated interest figure at what is actually outstanding", () => {
    // A mistyped advice note claiming 90,000 of interest against 30,000
    // outstanding must not drive the interest balance below zero — the excess
    // becomes principal, which is the only bucket that can absorb it.
    const result = allocateRepayment({
      amount: "100000",
      interestOutstanding: "30000",
      principalOutstanding: "500000",
      statedInterest: "90000",
    });

    expect(split(result)).toEqual({
      principal: "70000.00",
      interest: "30000.00",
      fees: "0.00",
    });
  });

  it("takes fees off the top, before interest", () => {
    const result = allocateRepayment({
      amount: "100000",
      interestOutstanding: "30000",
      principalOutstanding: "500000",
      statedFees: "5000",
    });

    expect(split(result)).toEqual({
      principal: "65000.00",
      interest: "30000.00",
      fees: "5000.00",
    });
  });

  it("refuses a payment whose principal share exceeds what is owed", () => {
    expect(() =>
      allocateRepayment({
        amount: "600000",
        interestOutstanding: "0",
        principalOutstanding: "500000",
      })
    ).toThrow(BorrowingError);
  });

  it("always splits the payment exactly — no francs created or lost", () => {
    const amount = "33333.33";
    const result = allocateRepayment({
      amount,
      interestOutstanding: "10000.01",
      principalOutstanding: "500000",
      statedFees: "1000.01",
    });

    const total = add(result.principal, result.interest, result.fees);

    expect(toMoneyString(total)).toBe("33333.33");
  });
});

describe("the contracted cost of a facility", () => {
  const base = {
    associationId: "a",
    actorId: "u",
    lenderName: "Bank of Kigali",
    lenderType: "BANK" as const,
    purpose: "Backing member savings so we can lend more",
    principal: "10000000",
    interestRate: "16",
    interestMethod: "REDUCING_BALANCE" as const,
    termMonths: 24,
  };

  it("takes the lender's own figure when the offer letter states one", () => {
    const cost = resolveCost({ ...base, totalInterest: "1750000", totalFees: "50000" });

    expect(cost.totalInterest).toBe("1750000.00");
    expect(cost.totalFees).toBe("50000.00");
    expect(cost.totalPayable).toBe("11800000.00");
  });

  it("estimates the interest only when none was given", () => {
    const cost = resolveCost(base);

    // The exact figure is the amortisation module's business; what matters
    // here is that a facility with a rate and a term does not open with a
    // cost of nothing, which would report the loan as free to members.
    expect(Number(cost.totalInterest)).toBeGreaterThan(0);
    expect(cost.totalPayable).toBe(toMoneyString(add(base.principal, cost.totalInterest)));
  });

  it("treats a stated zero as a genuine interest-free facility", () => {
    // A government or NGO facility at 0% is real, and must not be silently
    // replaced by a computed estimate just because the figure is falsy.
    const cost = resolveCost({ ...base, interestRate: "0", totalInterest: "0" });

    expect(cost.totalInterest).toBe("0.00");
    expect(cost.totalPayable).toBe("10000000.00");
  });
});

describe("borrowing measured against members' savings", () => {
  it("reports the share of savings the association has borrowed against", () => {
    expect(borrowingAgainstSavings("5000000", "20000000")).toBe(25);
  });

  it("rounds to one decimal place", () => {
    expect(borrowingAgainstSavings("1000000", "3000000")).toBe(33.3);
  });

  it("returns null when there is no borrowing, so the page omits the line", () => {
    expect(borrowingAgainstSavings("0", "20000000")).toBeNull();
  });

  it("returns null rather than dividing by an empty savings pool", () => {
    expect(borrowingAgainstSavings("5000000", "0")).toBeNull();
  });
});
