import { test } from "node:test";
import assert from "node:assert/strict";
import { formatScheduleDate, parseScheduleDate, validTimeZone } from "./scheduleText.js";

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

// タイムゾーンを指定したときは、PC の現地時刻（TZ）ではなくそのタイムゾーンで読み書きする
test("scheduleText: タイムゾーン指定", async (t) => {
  await t.test("時刻付きは指定のタイムゾーンの壁時計として読み、同じ形で書く（PC が東京でも）", () => {
    const d = parseScheduleDate("2026-10-15 09:00", "America/Los_Angeles");
    assert.deepEqual(d, { at: new Date("2026-10-15T16:00:00Z"), allDay: false });
    assert.equal(formatScheduleDate(d, "America/Los_Angeles"), "2026-10-15 09:00");
    assert.equal(formatScheduleDate(d, "Asia/Tokyo"), "2026-10-16 01:00");
  });

  await t.test("夏時間の前後でも時差が合う", () => {
    assert.deepEqual(parseScheduleDate("2026-01-15 09:00", "America/New_York").at, new Date("2026-01-15T14:00:00Z"));
    assert.deepEqual(parseScheduleDate("2026-07-15 09:00", "America/New_York").at, new Date("2026-07-15T13:00:00Z"));
    assert.equal(formatScheduleDate(parseScheduleDate("2026-03-08 03:30", "America/New_York"), "America/New_York"), "2026-03-08 03:30");
  });

  await t.test("30分刻みの時差（インド）と日付をまたぐ時刻", () => {
    const d = parseScheduleDate("2026-10-15 00:30", "Asia/Kolkata");
    assert.deepEqual(d.at, new Date("2026-10-14T19:00:00Z"));
    assert.equal(formatScheduleDate(d, "Asia/Kolkata"), "2026-10-15 00:30");
  });

  await t.test("終日はタイムゾーンに左右されない。存在しない日付は弾く", () => {
    assert.equal(formatScheduleDate(parseScheduleDate("2026-10-15", "Pacific/Auckland"), "Pacific/Auckland"), "2026-10-15");
    assert.throws(() => parseScheduleDate("2026-02-30 09:00", "Asia/Tokyo"), /YYYY-MM-DD/);
  });

  await t.test("validTimeZone: 使える名前だけを通す", () => {
    assert.equal(validTimeZone("Asia/Tokyo"), "Asia/Tokyo");
    assert.equal(validTimeZone("Etc/GMT-9"), "Etc/GMT-9");
    assert.equal(validTimeZone("Not/AZone"), undefined);
    assert.equal(validTimeZone(""), undefined);
    assert.equal(validTimeZone(undefined), undefined);
  });
});
