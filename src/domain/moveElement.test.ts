import { test } from "node:test";
import assert from "node:assert/strict";
import type { FirestoreDoc, FirestoreRestClient, FirestoreWrite } from "../firestore/restClient.js";
import type { BodyDoc } from "./body.js";
import { buildMoveElementWrites } from "./moveElement.js";

const BODIES_PATH = "users/u/headers/h/bodies";
const LEVELS_PATH = "users/u/headers/h/levels";

/** getDocumentだけを持つ手書きの偽クライアント。モックのライブラリは使わない。 */
function fakeClient(docs: Record<string, FirestoreDoc | null>): FirestoreRestClient {
  return {
    async getDocument(path: string): Promise<FirestoreDoc | null> {
      return path in docs ? docs[path] : null;
    },
  } as unknown as FirestoreRestClient;
}

function body(id: string, overrides: Partial<Omit<BodyDoc, "id" | "detail">> = {}): BodyDoc {
  return {
    id,
    detail: id,
    prev: null,
    next: null,
    parent: null,
    child: null,
    done: false,
    updateTime: "t1",
    ...overrides,
  };
}

function levelsDoc(ids: string[], updateTime = "lt1"): FirestoreDoc {
  return {
    id: "x",
    data: { children: ids.map((id) => ({ id, detail: id, done: false })) },
    updateTime,
  };
}

function writeFor(writes: FirestoreWrite[], path: string): FirestoreWrite | undefined {
  return writes.find((w) => w.path === path);
}

function childIds(write: FirestoreWrite | undefined): string[] {
  return ((write?.fields?.children as Array<{ id: string }>) ?? []).map((c) => c.id);
}

test("buildMoveElementWrites", async (t) => {
  await t.test("同じ親の中での移動は、levelsへの書き込みが1件(buildReorderChildWrite)になる", async () => {
    // 最上位(parent=null)のa-b-cという並び。aをcの直後へ動かす。
    const bodies: BodyDoc[] = [
      body("a", { next: "b" }),
      body("b", { prev: "a", next: "c" }),
      body("c", { prev: "b" }),
    ];
    const client = fakeClient({ [`${LEVELS_PATH}/root`]: levelsDoc(["a", "b", "c"]) });

    const writes = await buildMoveElementWrites(client, BODIES_PATH, LEVELS_PATH, bodies, "a", null, "c");

    const levelWrites = writes.filter((w) => w.path === `${LEVELS_PATH}/root`);
    assert.equal(levelWrites.length, 1, "levels/rootへの書き込みはremove+insertに分かれず1件のはず");
    assert.deepEqual(childIds(levelWrites[0]), ["b", "c", "a"]);

    assert.deepEqual(writeFor(writes, `${BODIES_PATH}/a`)?.fields, { parent: null, prev: "c", next: null });
    assert.equal(writeFor(writes, `${BODIES_PATH}/c`)?.fields?.next, "a");
    assert.equal(writeFor(writes, `${BODIES_PATH}/b`)?.fields?.prev, null);
  });

  await t.test("親をまたぐ移動では、移動元と移動先の2つのlevelsドキュメントに書かれる", async () => {
    // root -> p1 -> x (唯一の子)
    // root -> p2 -> y (唯一の子)
    // xをp2の子(yの直後)へ移動する。
    const bodies: BodyDoc[] = [
      body("p1"),
      body("p2"),
      body("x", { parent: "p1" }),
      body("y", { parent: "p2" }),
    ];
    const client = fakeClient({
      [`${LEVELS_PATH}/p1`]: levelsDoc(["x"], "lt-p1"),
      [`${LEVELS_PATH}/p2`]: levelsDoc(["y"], "lt-p2"),
    });

    const writes = await buildMoveElementWrites(client, BODIES_PATH, LEVELS_PATH, bodies, "x", "p2", "y");

    const p1Write = writeFor(writes, `${LEVELS_PATH}/p1`);
    const p2Write = writeFor(writes, `${LEVELS_PATH}/p2`);
    assert.deepEqual(childIds(p1Write), []);
    assert.deepEqual(childIds(p2Write), ["y", "x"]);

    assert.deepEqual(writeFor(writes, `${BODIES_PATH}/x`)?.fields, { parent: "p2", prev: "y", next: null });
    assert.equal(writeFor(writes, `${BODIES_PATH}/y`)?.fields?.next, "x");
    // xが親p1の唯一の子だったので、p1のchildポインタはnullに戻る。
    assert.equal(writeFor(writes, `${BODIES_PATH}/p1`)?.fields?.child, null);
  });

  await t.test("afterElementId=nullで同じ親の先頭へ動かす", async () => {
    const bodies: BodyDoc[] = [
      body("a", { next: "b" }),
      body("b", { prev: "a", next: "c" }),
      body("c", { prev: "b" }),
    ];
    const client = fakeClient({ [`${LEVELS_PATH}/root`]: levelsDoc(["a", "b", "c"]) });

    // cを先頭(afterElementId=null)へ動かす。
    const writes = await buildMoveElementWrites(client, BODIES_PATH, LEVELS_PATH, bodies, "c", null, null);

    assert.deepEqual(writeFor(writes, `${BODIES_PATH}/c`)?.fields, { parent: null, prev: null, next: "a" });
    assert.equal(writeFor(writes, `${BODIES_PATH}/a`)?.fields?.prev, "c");
    assert.deepEqual(childIds(writeFor(writes, `${LEVELS_PATH}/root`)), ["c", "a", "b"]);
  });

  await t.test("elementIdが存在しなければエラーを投げる", async () => {
    const client = fakeClient({});
    await assert.rejects(() =>
      buildMoveElementWrites(client, BODIES_PATH, LEVELS_PATH, [], "不存在", null, null)
    );
  });
});
