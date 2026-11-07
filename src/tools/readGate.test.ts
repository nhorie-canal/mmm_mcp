import { test } from "node:test";
import assert from "node:assert/strict";
import { checkReadAllowed, setConfirmationTtlMs } from "./readGate.js";
import type { ResolvedMap } from "../domain/mapResolver.js";

function mapWith(permission: string | undefined, title = "旅行計画"): ResolvedMap {
  return {
    headerId: "h1",
    ownerUid: "u1",
    header: { title, aiReadPermission: permission } as unknown as ResolvedMap["header"],
  };
}

test("checkReadAllowed", async (t) => {
  await t.test("常に許可のマップは確認なしで読める", () => {
    assert.equal(checkReadAllowed(mapWith("allow"), "m-allow", undefined), null);
  });
  await t.test("常に拒否のマップは投げる", () => {
    assert.throws(() => checkReadAllowed(mapWith("deny"), "m-deny", true), /常に拒否/);
  });
  await t.test("未確認なら確認の文面を返し、confirmed: true で通る。以後は同じマップで確認不要", () => {
    const map = mapWith("ask");
    assert.match(checkReadAllowed(map, "m-ask", undefined) ?? "", /ユーザー本人に直接/);
    assert.equal(checkReadAllowed(map, "m-ask", true), null);
    assert.equal(checkReadAllowed(map, "m-ask", undefined), null);
  });
  await t.test("別のマップの確認は引き継がない", () => {
    assert.notEqual(checkReadAllowed(mapWith("ask"), "m-other", undefined), null);
  });
});

test("確認済みの印は利用者ごと。ほかの利用者には引き継がない", () => {
  const map = mapWith("ask");
  assert.equal(checkReadAllowed(map, "m-shared", true, { viewerUid: "alice" }), null);
  assert.equal(checkReadAllowed(map, "m-shared", undefined, { viewerUid: "alice" }), null);
  assert.notEqual(checkReadAllowed(map, "m-shared", undefined, { viewerUid: "bob" }), null);
});

test("覚える時間を設定すると、過ぎたら改めて確認する（既定はプロセスの間ずっと）", () => {
  const map = mapWith("ask");
  assert.equal(checkReadAllowed(map, "m-ttl0", true, { viewerUid: "a", now: 0 }), null);
  assert.equal(checkReadAllowed(map, "m-ttl0", undefined, { viewerUid: "a", now: 10 * 3600_000 }), null);
  setConfirmationTtlMs(3600_000);
  try {
    assert.equal(checkReadAllowed(map, "m-ttl1", true, { viewerUid: "a", now: 0 }), null);
    assert.equal(checkReadAllowed(map, "m-ttl1", undefined, { viewerUid: "a", now: 3599_000 }), null);
    assert.notEqual(checkReadAllowed(map, "m-ttl1", undefined, { viewerUid: "a", now: 3601_000 }), null);
  } finally {
    setConfirmationTtlMs(Number.POSITIVE_INFINITY);
  }
});
