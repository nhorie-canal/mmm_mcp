import { test } from "node:test";
import assert from "node:assert/strict";
import { formatScheduleDate, parseScheduleDate } from "./scheduleText.js";

// 時刻付きの値は MCP が動く PC の現地時刻で読み書きする。テストは東京で固定する。
process.env.TZ = "Asia/Tokyo";

test("scheduleText", async (t) => {
  await t.test("終日は日付だけ。UTC の0時として持つ", () => {
    const d = parseScheduleDate("2026-10-15");
    assert.deepEqual(d, { at: new Date("2026-10-15T00:00:00Z"), allDay: true });
    assert.equal(formatScheduleDate(d), "2026-10-15");
  });

  await t.test("時刻付きは PC の現地時刻として読み、同じ形で書く", () => {
    const d = parseScheduleDate("2026-10-15 09:00");
    assert.deepEqual(d, { at: new Date("2026-10-15T00:00:00Z"), allDay: false });
    assert.equal(formatScheduleDate(d), "2026-10-15 09:00");
  });

  await t.test("終日の日付は、現地の時差で前日・翌日にずれない", () => {
    process.env.TZ = "America/Los_Angeles";
    try {
      assert.equal(formatScheduleDate(parseScheduleDate("2026-10-15")), "2026-10-15");
    } finally {
      process.env.TZ = "Asia/Tokyo";
    }
  });

  await t.test("形の違う文字列・存在しない日付は受け付けない", () => {
    for (const bad of ["2026/10/15", "2026-10-15T09:00", "2026-13-01", "2026-02-30", "2026-10-15 25:00", "明日"]) {
      assert.throws(() => parseScheduleDate(bad), /YYYY-MM-DD/, bad);
    }
  });
});
