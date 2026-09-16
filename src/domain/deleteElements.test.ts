import { test } from "node:test";
import assert from "node:assert/strict";
import type { FirestoreDoc, FirestoreRestClient, FirestoreWrite } from "../firestore/restClient.js";
import type { BodyDoc } from "./body.js";
import { buildDeleteElementWrites } from "./deleteElements.js";

const BODIES_PATH = "users/u/headers/h/bodies";
const LEVELS_PATH = "users/u/headers/h/levels";

/** getDocumentだけを持つ手書きの偽クライアント。モックのライブラリは使わない。 */
function fakeClient(
  docs: Record<string, FirestoreDoc | null>,
  onGetDocument?: (path: string) => void
): FirestoreRestClient {
  return {
    async getDocument(path: string): Promise<FirestoreDoc | null> {
      onGetDocument?.(path);
      return path in docs ? docs[path] : null;
    },
  } as unknown as FirestoreRestClient;
}

function body(
  id: string,
  overrides: Partial<Omit<BodyDoc, "id" | "detail">> = {}
): BodyDoc {
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

function writeFor(writes: FirestoreWrite[], path: string): FirestoreWrite | undefined {
  return writes.find((w) => w.path === path);
}

// a-b-c-d-e という一列の兄弟(最上位、parent=null)。
const CHAIN: BodyDoc[] = [
  body("a", { next: "b" }),
  body("b", { prev: "a", next: "c" }),
  body("c", { prev: "b", next: "d" }),
  body("d", { prev: "c", next: "e" }),
  body("e", { prev: "d" }),
];

function levelsRootDoc(ids: string[]): FirestoreDoc {
  return {
    id: "root",
    data: { children: ids.map((id) => ({ id, detail: id, done: false })) },
    updateTime: "lt1",
  };
}

test("buildDeleteElementWrites", async (t) => {
  await t.test("隣接する2要素を同時に削除すると、両側の生存要素が互いを指す", async () => {
    const client = fakeClient({ [`${LEVELS_PATH}/root`]: levelsRootDoc(["a", "b", "c", "d", "e"]) });
    const { writes, deletedIds } = await buildDeleteElementWrites(
      client,
      BODIES_PATH,
      LEVELS_PATH,
      CHAIN,
      ["b", "c"]
    );
    assert.deepEqual([...deletedIds].sort(), ["b", "c"]);
    assert.equal(writeFor(writes, `${BODIES_PATH}/a`)?.fields?.next, "d");
    assert.equal(writeFor(writes, `${BODIES_PATH}/d`)?.fields?.prev, "a");
    assert.equal(writeFor(writes, `${BODIES_PATH}/b`)?.delete, true);
    assert.equal(writeFor(writes, `${BODIES_PATH}/c`)?.delete, true);
  });

  await t.test("連続する3要素以上を削除しても、削除済みidを飛ばして生存要素に辿り着く", async () => {
    const client = fakeClient({ [`${LEVELS_PATH}/root`]: levelsRootDoc(["a", "b", "c", "d", "e"]) });
    const { writes, deletedIds } = await buildDeleteElementWrites(
      client,
      BODIES_PATH,
      LEVELS_PATH,
      CHAIN,
      ["b", "c", "d"]
    );
    assert.deepEqual([...deletedIds].sort(), ["b", "c", "d"]);
    assert.equal(writeFor(writes, `${BODIES_PATH}/a`)?.fields?.next, "e");
    assert.equal(writeFor(writes, `${BODIES_PATH}/e`)?.fields?.prev, "a");
    // b・c・dそれぞれの繋ぎ直しがa/eへ重複して積まれても、mergeWritesByPathで1件に畳まれる。
    assert.equal(writes.filter((w) => w.path === `${BODIES_PATH}/a`).length, 1);
    assert.equal(writes.filter((w) => w.path === `${BODIES_PATH}/e`).length, 1);
  });

  await t.test("先頭要素と末尾要素を削除すると、生存側のprev/nextがnullになる", async () => {
    const client = fakeClient({ [`${LEVELS_PATH}/root`]: levelsRootDoc(["a", "b", "c", "d", "e"]) });
    const { writes } = await buildDeleteElementWrites(client, BODIES_PATH, LEVELS_PATH, CHAIN, [
      "a",
      "e",
    ]);
    assert.equal(writeFor(writes, `${BODIES_PATH}/b`)?.fields?.prev, null);
    assert.equal(writeFor(writes, `${BODIES_PATH}/d`)?.fields?.next, null);
  });

  await t.test("削除対象の親自身も同時に削除されるとき、その親のlevelsドキュメントを読み直して書き戻さない", async () => {
    // root -> p -> (x, y)。pとxをまとめて削除する(pの配下としてyも道連れで消える)。
    const tree: BodyDoc[] = [
      body("p"),
      body("x", { parent: "p", next: "y" }),
      body("y", { parent: "p", prev: "x" }),
    ];
    const getDocumentCalls: string[] = [];
    const client = fakeClient(
      {
        [`${LEVELS_PATH}/root`]: levelsRootDoc(["p"]),
        [`${LEVELS_PATH}/p`]: {
          id: "p",
          data: { children: [{ id: "x", detail: "x", done: false }, { id: "y", detail: "y", done: false }] },
          updateTime: "lt2",
        },
      },
      (path) => getDocumentCalls.push(path)
    );

    const { writes, deletedIds } = await buildDeleteElementWrites(
      client,
      BODIES_PATH,
      LEVELS_PATH,
      tree,
      ["p", "x"]
    );

    assert.deepEqual([...deletedIds].sort(), ["p", "x", "y"]);
    // levels/p自体はdeleteで消える対象なので、buildRemoveChildrenWrite用の読み取りをしてはいけない
    // (読んで書き戻すと、削除したはずのドキュメントが中身入りで復活する)。
    assert.ok(!getDocumentCalls.includes(`${LEVELS_PATH}/p`));
    assert.equal(writeFor(writes, `${LEVELS_PATH}/p`)?.delete, true);
    // 親であるlevels/rootからはpが取り除かれる。
    assert.deepEqual(writeFor(writes, `${LEVELS_PATH}/root`)?.fields?.children, []);
  });

  await t.test("既に削除済み(存在しない)elementIdは静かにスキップする", async () => {
    const client = fakeClient({ [`${LEVELS_PATH}/root`]: levelsRootDoc(["a", "b"]) });
    const { writes, deletedIds } = await buildDeleteElementWrites(
      client,
      BODIES_PATH,
      LEVELS_PATH,
      [body("a", { next: "b" }), body("b", { prev: "a" })],
      ["不存在", "a"]
    );
    assert.deepEqual([...deletedIds], ["a"]);
    assert.equal(writeFor(writes, `${BODIES_PATH}/a`)?.delete, true);
  });
});
