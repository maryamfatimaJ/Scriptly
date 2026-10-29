import { describe, expect, it } from "vitest";
import { suggestScheduleFromFrequency } from "@/utils/frequencyParser";

describe("suggestScheduleFromFrequency", () => {
  it("recognizes the exact phrasing MockExtractionProvider uses ('3x daily')", () => {
    // Regression test: an earlier version of the matching regexes assumed
    // "daily" was "day" + "ly" (it isn't — "daily" is d-a-i-l-y), so
    // "3x daily" silently fell through to requiresManualTiming instead of
    // suggesting 3 slots. This is exactly the string the mock provider
    // extracts for Amoxicillin, so a regression here would have gone
    // unnoticed by every other test that uses that fixture.
    const result = suggestScheduleFromFrequency("3x daily");
    expect(result.suggestedSlotCount).toBe(3);
    expect(result.requiresManualTiming).toBe(false);
    expect(result.suggestedLabels).toHaveLength(3);
  });

  it("recognizes common day/daily phrasing variants", () => {
    expect(suggestScheduleFromFrequency("once daily").suggestedSlotCount).toBe(1);
    expect(suggestScheduleFromFrequency("once a day").suggestedSlotCount).toBe(1);
    expect(suggestScheduleFromFrequency("twice daily").suggestedSlotCount).toBe(2);
    expect(suggestScheduleFromFrequency("2x a day").suggestedSlotCount).toBe(2);
    expect(suggestScheduleFromFrequency("three times daily").suggestedSlotCount).toBe(3);
    expect(suggestScheduleFromFrequency("four times a day").suggestedSlotCount).toBe(4);
  });

  it("derives an evenly-spaced count from 'every N hours'", () => {
    const everyEight = suggestScheduleFromFrequency("every 8 hours");
    expect(everyEight.suggestedSlotCount).toBe(3);
    const everyTwelve = suggestScheduleFromFrequency("every 12 hours");
    expect(everyTwelve.suggestedSlotCount).toBe(2);
  });

  it("never invents a schedule for an as-needed (PRN) instruction", () => {
    const result = suggestScheduleFromFrequency("as needed for pain");
    expect(result.suggestedSlotCount).toBeNull();
    expect(result.requiresManualTiming).toBe(true);
    expect(result.note.toLowerCase()).toContain("as needed");
  });

  it("refuses to guess for unrecognized phrasing rather than defaulting to something", () => {
    const result = suggestScheduleFromFrequency("whenever the moon is full");
    expect(result.suggestedSlotCount).toBeNull();
    expect(result.requiresManualTiming).toBe(true);
  });

  it("handles a missing/empty frequency without throwing", () => {
    const result = suggestScheduleFromFrequency(null);
    expect(result.suggestedSlotCount).toBeNull();
    expect(result.requiresManualTiming).toBe(true);
  });
});
