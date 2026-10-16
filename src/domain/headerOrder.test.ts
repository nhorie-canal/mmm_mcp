import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCreateMapWrites, prependedHeaderOrders, type HeaderOrderEntry } from "./headerOrder.js";

/** 書き換えを当て、新しいマップ"new"を order 1 で加えた一覧の並びを返す。同値なら"new"を後ろに置く。 */
function prepended(entries: HeaderOrderEntry[]): string[] {
  const updated = new Map(entries.map((e) => [e.id, e.order]));
  for (const u of prependedHeaderOrders(entries)) updated.set(u.id, u.order);
  const all = [...updated.entries()].map(([id, order]) => ({ id, order, isNew: false }));
  all.push({ id: "new", order: 1, isNew: true });
  all.sort((a, b) =>
    a.order !== b.order ? a.order - b.order : a.isNew !== b.isNew ? (a.isNew ? 1 : -1) : a.id < b.id ? -1 : 1
  );
  return all.map((e) => e.id);
}

test("prependedHeaderOrders", async (t) => {
  await t.test("連番なら、既存は今の順のまま新しいマップの後ろに並ぶ", () => {
    const entries = [
      { id: "a", order: 1 },
      { id: "b", order: 2 },
      { id: "c", order: 3 },
    ];
    assert.deepEqual(prepended(entries), ["new", "a", "b", "c"]);
  });

  await t.test("マップが1つも無ければ何も書かない", () => {
    assert.deepEqual(prependedHeaderOrders([]), []);
  });

  await t.test("読み取り順に関わらず、orderの昇順で振り直す", () => {
    const entries = [
      { id: "c", order: 7 },
      { id: "a", order: 1 },
      { id: "b", order: 3 },
    ];
    assert.deepEqual(prepended(entries), ["new", "a", "b", "c"]);
  });

  await t.test("同値はドキュメントidの順に並べる(アプリの一覧と同じ)", () => {
    const entries = [
      { id: "y", order: 2 },
      { id: "x", order: 2 },
      { id: "a", order: 1 },
    ];
    assert.deepEqual(prependedHeaderOrders(entries), [
      { id: "a", order: 2 },
      { id: "x", order: 3 },
      { id: "y", order: 4 },
    ]);
  });

  await t.test("値が変わらないマップは書き換えない", () => {
    const entries = [
      { id: "a", order: 2 },
      { id: "b", order: 3 },
      { id: "c", order: 9 },
    ];
    assert.deepEqual(prependedHeaderOrders(entries), [{ id: "c", order: 4 }]);
  });
});

test("buildCreateMapWrites: 既存を振り直し、新しいマップを order 1 で作る1回分の書き込み", () => {
  const writes = buildCreateMapWrites(
    "users/u/headers",
    [
      { id: "a", data: { order: 1 }, updateTime: "t-a" },
      { id: "b", data: { order: 5 }, updateTime: "t-b" },
      { id: "noorder", data: {}, updateTime: "t-n" }, // 一覧に出ないので触らない
    ],
    "new",
    "題",
    true
  );
  assert.deepEqual(writes, [
    { path: "users/u/headers/a", fields: { order: 2 }, requireUpdateTime: "t-a" },
    { path: "users/u/headers/b", fields: { order: 3 }, requireUpdateTime: "t-b" },
    { path: "users/u/headers/new", fields: { title: "題", order: 1, isTodo: true, editors: [], viewers: [] } },
    { path: "users/u/headers/new/levels/root", fields: { children: [] } },
  ]);
});
