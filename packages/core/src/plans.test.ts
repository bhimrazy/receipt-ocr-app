import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLANS,
  EARLY_ACCESS,
  earlyAccessOffer,
  earlyAccessUntil,
  personalPolicy,
} from "./plans";

const before = new Date(EARLY_ACCESS.joinedBefore.getTime() - 1);
const during = new Date(EARLY_ACCESS.endsAt.getTime() - 86_400_000);

describe("early access", () => {
  it("ends at a month start, after the cutoff, and raises Free above its default", () => {
    expect(EARLY_ACCESS.endsAt.getUTCDate()).toBe(1);
    expect(EARLY_ACCESS.endsAt.getTime()).toBeGreaterThan(EARLY_ACCESS.joinedBefore.getTime());
    expect(EARLY_ACCESS.receiptsPerMonth).toBeGreaterThan(DEFAULT_PLANS.free.receiptsPerMonth!);
  });

  it("applies to accounts created before the cutoff, until it ends", () => {
    expect(earlyAccessUntil(before, during)).toEqual(EARLY_ACCESS.endsAt);
    expect(earlyAccessUntil(before.toISOString(), during)).toEqual(EARLY_ACCESS.endsAt);
    expect(earlyAccessUntil(EARLY_ACCESS.joinedBefore, during)).toBeNull();
    expect(earlyAccessUntil(before, EARLY_ACCESS.endsAt)).toBeNull();
    expect(earlyAccessUntil(null, during)).toBeNull();
    expect(earlyAccessUntil("not a date", during)).toBeNull();
  });

  it("raises only a person's Free month, and only while it lasts", () => {
    const early = personalPolicy("free", DEFAULT_PLANS.free, before, during);
    expect(early.policy).toEqual({
      ...DEFAULT_PLANS.free,
      receiptsPerMonth: EARLY_ACCESS.receiptsPerMonth,
    });
    expect(early.earlyAccessUntil).toEqual(EARLY_ACCESS.endsAt);

    const after = personalPolicy("free", DEFAULT_PLANS.free, before, EARLY_ACCESS.endsAt);
    expect(after).toEqual({ policy: DEFAULT_PLANS.free, earlyAccessUntil: null });
    const newcomer = personalPolicy("free", DEFAULT_PLANS.free, EARLY_ACCESS.joinedBefore, during);
    expect(newcomer.policy).toBe(DEFAULT_PLANS.free);
    expect(personalPolicy("pro", DEFAULT_PLANS.pro, before, during).policy).toBe(DEFAULT_PLANS.pro);
  });

  it("never lowers a Free month an admin set higher, or adds one where there is none", () => {
    const generous = { ...DEFAULT_PLANS.free, receiptsPerMonth: 200 };
    expect(personalPolicy("free", generous, before, during).policy).toBe(generous);
    const daily = { ...DEFAULT_PLANS.free, receiptsPerMonth: null };
    expect(personalPolicy("free", daily, before, during).policy).toBe(daily);
  });

  it("offers nothing to state once it has ended or when Free already gives as much", () => {
    expect(earlyAccessOffer(DEFAULT_PLANS.free, during)).toMatchObject({
      receiptsPerMonth: EARLY_ACCESS.receiptsPerMonth,
      thenPerMonth: DEFAULT_PLANS.free.receiptsPerMonth,
    });
    expect(earlyAccessOffer(DEFAULT_PLANS.free, EARLY_ACCESS.endsAt)).toBeNull();
    const saved = { ...DEFAULT_PLANS.free, receiptsPerMonth: EARLY_ACCESS.receiptsPerMonth };
    expect(earlyAccessOffer(saved, during)).toBeNull();
    expect(personalPolicy("free", saved, before, during).earlyAccessUntil).toBeNull();
  });
});
