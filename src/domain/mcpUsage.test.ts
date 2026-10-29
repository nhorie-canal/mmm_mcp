import assert from "node:assert/strict";
import { test } from "node:test";
import { localDayKey, mcpUsagePath, planMcpUsageWrite } from "./mcpUsage.js";

test("localDayKey: 現地の日付をYYYY-MM-DDにする(月日は0埋め)", () => {
  assert.equal(localDayKey(new Date(2026, 2, 5, 23, 59)), "2026-03-05");
  assert.equal(localDayKey(new Date(2026, 11, 31, 0, 0)), "2026-12-31");
});

test("印がまだ無ければ、1日目として「まだ無い」前提で作る", () => {
  const w = planMcpUsageWrite("u1", null, "2026-10-29");
  assert.deepEqual(w, {
    path: "users/u1/private/usage",
    fields: { mcpLastWriteDay: "2026-10-29", mcpWriteDays: 1 },
    requireMissing: true,
  });
  assert.equal(w?.path, mcpUsagePath("u1"));
});

test("今日すでに印があれば書かない(その日の初回だけ)", () => {
  const existing = { data: { mcpLastWriteDay: "2026-10-29", mcpWriteDays: 3 }, updateTime: "t" };
  assert.equal(planMcpUsageWrite("u1", existing, "2026-10-29"), null);
});

test("前の日に書いていれば、今日にして日数を1増やし、読んだ時点の更新時刻を前提にする", () => {
  const existing = { data: { mcpLastWriteDay: "2026-10-28", mcpWriteDays: 3 }, updateTime: "2026-10-28T01:00:00Z" };
  const w = planMcpUsageWrite("u1", existing, "2026-10-29");
  assert.deepEqual(w?.fields, { mcpLastWriteDay: "2026-10-29", mcpWriteDays: 4 });
  assert.equal(w?.requireUpdateTime, "2026-10-28T01:00:00Z");
  assert.equal(w?.requireMissing, undefined);
});

test("日数が壊れていても(無い・負・小数・文字列)0から数え直して投げない", () => {
  for (const bad of [undefined, -2, 1.5, "3", null]) {
    const existing = { data: { mcpLastWriteDay: "2026-10-01", mcpWriteDays: bad }, updateTime: "t" };
    assert.equal(planMcpUsageWrite("u1", existing, "2026-10-29")?.fields?.mcpWriteDays, 1);
  }
});

test("更新時刻が取れていなければ、存在することを前提にする(消えたドキュメントを作らない)", () => {
  const w = planMcpUsageWrite("u1", { data: { mcpLastWriteDay: "2026-10-01", mcpWriteDays: 1 } }, "2026-10-29");
  assert.equal(w?.requireExists, true);
  assert.equal(w?.requireUpdateTime, undefined);
});
