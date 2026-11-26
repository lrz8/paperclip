import { afterEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import { formatDate, formatDateTime, relativeTime } from "./utils";

describe("formatDateTime", () => {
  // Local construction avoids assuming the test runner's timezone.
  const timestamp = new Date(2026, 8, 7, 13, 2, 54);

  it("preserves minute precision for existing callers", () => {
    expect(formatDateTime(timestamp)).toBe("Sep 7, 2026, 1:02 PM");
  });

  it("distinguishes activity in the same minute when seconds are requested", () => {
    expect(formatDateTime(timestamp, { includeSeconds: true })).toBe(
      "Sep 7, 2026, 1:02:54 PM",
    );
    expect(
      formatDateTime(new Date(2026, 8, 7, 13, 2, 55), { includeSeconds: true }),
    ).toBe("Sep 7, 2026, 1:02:55 PM");
  });

  it("formats serialized server timestamps identically to Date values", () => {
    expect(
      formatDateTime(timestamp.toISOString(), { includeSeconds: true }),
    ).toBe(formatDateTime(timestamp, { includeSeconds: true }));
  });
});


describe("localized display dates", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
    vi.useRealTimers();
  });

  it("follows the selected Chinese locale and preserves the English compact format", async () => {
    const timestamp = new Date(2026, 8, 7, 13, 2);
    vi.useFakeTimers();
    vi.setSystemTime(timestamp.getTime() + 3 * 60_000);
    await i18n.changeLanguage("zh-CN");
    expect(formatDate(timestamp)).toMatch(/2026年9月7日/);
    expect(relativeTime(timestamp)).toBe("3分钟前");
    expect(relativeTime(new Date())).toBe("刚刚");
    await i18n.changeLanguage("en");
    expect(formatDate(timestamp)).toBe("Sep 7, 2026");
    expect(relativeTime(timestamp)).toBe("3m ago");
  });
});
