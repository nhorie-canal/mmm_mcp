import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeWritesByPath, type FirestoreWrite } from "./restClient.js";

test("mergeWritesByPath", async (t) => {
  await t.test("同じpathへの書き込みは1件に畳まれ、fieldsはマージされる", () => {
    const writes: FirestoreWrite[] = [
      { path: "p", fields: { a: 1 } },
      { path: "p", fields: { b: 2 } },
    ];
    const result = mergeWritesByPath(writes);
    assert.equal(result.length, 1);
    assert.equal(result[0].path, "p");
    assert.deepEqual(result[0].fields, { a: 1, b: 2 });
  });

  await t.test("delete と通常の書き込みが混ざるとdeleteが勝つ(delete→update)", () => {
    const writes: FirestoreWrite[] = [
      { path: "p", delete: true },
      { path: "p", fields: { a: 1 } },
    ];
    const result = mergeWritesByPath(writes);
    assert.equal(result.length, 1);
    assert.equal(result[0].delete, true);
    assert.equal(result[0].fields, undefined);
  });

  await t.test("delete と通常の書き込みが混ざるとdeleteが勝つ(update→delete)", () => {
    const writes: FirestoreWrite[] = [
      { path: "p", fields: { a: 1 } },
      { path: "p", delete: true },
    ];
    const result = mergeWritesByPath(writes);
    assert.equal(result.length, 1);
    assert.equal(result[0].delete, true);
    assert.equal(result[0].fields, undefined);
  });

  await t.test("最初に登場したpathの順序を保つ", () => {
    const writes: FirestoreWrite[] = [
      { path: "b", fields: { x: 1 } },
      { path: "a", fields: { y: 1 } },
      { path: "b", fields: { z: 1 } },
    ];
    const result = mergeWritesByPath(writes);
    assert.deepEqual(
      result.map((w) => w.path),
      ["b", "a"]
    );
    assert.deepEqual(result[0].fields, { x: 1, z: 1 });
  });

  await t.test("requireUpdateTimeは最初に読み取った値を残す", () => {
    const writes: FirestoreWrite[] = [
      { path: "p", fields: { a: 1 }, requireUpdateTime: "t1" },
      { path: "p", fields: { b: 2 }, requireUpdateTime: "t2" },
    ];
    const result = mergeWritesByPath(writes);
    assert.equal(result[0].requireUpdateTime, "t1");
  });

  await t.test("arrayUnionと通常の更新が混ざったら後から積んだ方を採る", () => {
    const writes: FirestoreWrite[] = [
      { path: "p", fields: { a: 1 } },
      { path: "p", arrayUnion: { field: "children", values: [1] } },
    ];
    const result = mergeWritesByPath(writes);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].arrayUnion, { field: "children", values: [1] });
    assert.equal(result[0].fields, undefined);
  });

  await t.test("入力が空なら空配列を返す", () => {
    assert.deepEqual(mergeWritesByPath([]), []);
  });
});
