import { test } from "node:test";
import assert from "node:assert/strict";
import { checkReadAllowed } from "./readGate.js";
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
