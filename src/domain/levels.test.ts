import { test } from "node:test";
import assert from "node:assert/strict";
import type { FirestoreDoc, FirestoreRestClient } from "../firestore/restClient.js";
import {
  buildTreeFromLevels,
  buildAppendLevelWrites,
  buildRemoveChildrenWrite,
  buildReorderChildWrite,
  buildInsertChildWrite,
  buildUpdateEntryWrites,
  type LevelChildEntry,
} from "./levels.js";

/** getDocumentだけを持つ手書きの偽クライアント。CLAUDE.mdの「テスト」節の方針どおり、モックのライブラリは使わない。 */
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

function entry(id: string, detail = id, done = false): LevelChildEntry {
  return { id, detail, done };
}

function doc(children: LevelChildEntry[], updateTime = "t1"): FirestoreDoc {
  return { id: "x", data: { children }, updateTime };
}

test("buildTreeFromLevels", async (t) => {
  await t.test("親子をchildren配列の順序どおりに展開する", () => {
    const levelsById = new Map([
      ["root", [entry("a"), entry("b")]],
      ["a", [entry("a1"), entry("a2")]],
    ]);
    const tree = buildTreeFromLevels(levelsById);
    assert.equal(tree.length, 2);
    assert.equal(tree[0].id, "a");
    assert.equal(tree[0].parentId, null);
    assert.equal(tree[0].children.length, 2);
    assert.equal(tree[0].children[0].id, "a1");
    assert.equal(tree[0].children[0].parentId, "a");
    assert.equal(tree[1].id, "b");
    assert.deepEqual(tree[1].children, []);
  });

  await t.test("循環参照があっても打ち切って無限ループにならない", () => {
    // a の子に b、b の子に a という不正なデータ(本来Firestore側では起きないが防御対象)。
    const levelsById = new Map([
      ["root", [entry("a")]],
      ["a", [entry("b")]],
      ["b", [entry("a")]],
    ]);
    const tree = buildTreeFromLevels(levelsById);
    assert.equal(tree.length, 1);
    assert.equal(tree[0].id, "a");
    assert.equal(tree[0].children[0].id, "b");
    // 2周目のaは祖先集合に引っかかり、それ以上展開しない(葉として打ち切り)。
    assert.equal(tree[0].children[0].children[0].id, "a");
    assert.deepEqual(tree[0].children[0].children[0].children, []);
  });
});

test("buildAppendLevelWrites", async (t) => {
  await t.test("既存の子が無い挿入先には fields で新規作成する", () => {
    const writes = buildAppendLevelWrites(
      "levels",
      [
        { id: "a", detail: "A", done: true, parentId: null },
        { id: "b", detail: "B", done: false, parentId: null },
      ],
      null,
      false,
      true
    );
    assert.equal(writes.length, 1);
    assert.equal(writes[0].path, "levels/root");
    assert.deepEqual(writes[0].fields, {
      children: [
        { id: "a", detail: "A", done: true },
        { id: "b", detail: "B", done: false },
      ],
    });
    assert.equal(writes[0].arrayUnion, undefined);
  });

  await t.test("既存の子がある挿入先には arrayUnion で追記する", () => {
    const writes = buildAppendLevelWrites(
      "levels",
      [{ id: "a", detail: "A", done: false, parentId: null }],
      "target",
      true,
      true
    );
    assert.equal(writes.length, 1);
    assert.equal(writes[0].path, "levels/target");
    assert.deepEqual(writes[0].arrayUnion, {
      field: "children",
      values: [{ id: "a", detail: "A", done: false }],
    });
    assert.equal(writes[0].fields, undefined);
  });

  await t.test("forest内で子を持つノードは levels/{id} を新規作成する", () => {
    const writes = buildAppendLevelWrites(
      "levels",
      [
        { id: "a", detail: "A", done: false, parentId: null },
        { id: "a1", detail: "A1", done: false, parentId: "a" },
      ],
      null,
      false,
      true
    );
    assert.equal(writes.length, 2);
    const forA = writes.find((w) => w.path === "levels/a");
    const forRoot = writes.find((w) => w.path === "levels/root");
    assert.deepEqual(forA?.fields, { children: [{ id: "a1", detail: "A1", done: false }] });
    assert.deepEqual(forRoot?.fields, { children: [{ id: "a", detail: "A", done: false }] });
  });

  await t.test("isTodoがfalseなら done は常にfalseにする", () => {
    const writes = buildAppendLevelWrites(
      "levels",
      [{ id: "a", detail: "A", done: true, parentId: null }],
      null,
      false,
      false
    );
    assert.deepEqual(writes[0].fields, { children: [{ id: "a", detail: "A", done: false }] });
  });
});

test("buildReorderChildWrite", async (t) => {
  await t.test("同じ親の中で末尾へ動かしても要素が重複しない", async () => {
    const client = fakeClient({
      "levels/root": doc([entry("a"), entry("b"), entry("c")]),
    });
    const write = await buildReorderChildWrite(client, "levels", "root", entry("a"), "c");
    const ids = (write.fields!.children as LevelChildEntry[]).map((c) => c.id);
    assert.deepEqual(ids, ["b", "c", "a"]);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(write.requireUpdateTime, "t1");
  });

  await t.test("afterIdがnullなら先頭へ動かす", async () => {
    const client = fakeClient({
      "levels/root": doc([entry("a"), entry("b"), entry("c")]),
    });
    const write = await buildReorderChildWrite(client, "levels", "root", entry("c"), null);
    const ids = (write.fields!.children as LevelChildEntry[]).map((c) => c.id);
    assert.deepEqual(ids, ["c", "a", "b"]);
  });

  await t.test("afterIdが見つからなければ末尾へ動かす", async () => {
    const client = fakeClient({
      "levels/root": doc([entry("a"), entry("b"), entry("c")]),
    });
    const write = await buildReorderChildWrite(client, "levels", "root", entry("a"), "存在しないid");
    const ids = (write.fields!.children as LevelChildEntry[]).map((c) => c.id);
    assert.deepEqual(ids, ["b", "c", "a"]);
  });

  await t.test("ドキュメントが無ければ空配列から組み立てる", async () => {
    const client = fakeClient({});
    const write = await buildReorderChildWrite(client, "levels", "root", entry("a"), null);
    assert.deepEqual(write.fields!.children, [entry("a")]);
    assert.equal(write.requireUpdateTime, undefined);
  });
});

test("buildRemoveChildrenWrite", async (t) => {
  await t.test("ドキュメントが無ければnullを返す", async () => {
    const client = fakeClient({});
    const write = await buildRemoveChildrenWrite(client, "levels", "missing", ["a"]);
    assert.equal(write, null);
  });

  await t.test("指定したidだけをchildrenから取り除く", async () => {
    const client = fakeClient({
      "levels/root": doc([entry("a"), entry("b"), entry("c")]),
    });
    const write = await buildRemoveChildrenWrite(client, "levels", "root", ["b"]);
    assert.deepEqual(write!.fields!.children, [entry("a"), entry("c")]);
    assert.equal(write!.requireUpdateTime, "t1");
  });
});

test("buildInsertChildWrite", async (t) => {
  await t.test("ドキュメントが無ければ新規作成しrequireUpdateTimeを付けない", async () => {
    const client = fakeClient({});
    const write = await buildInsertChildWrite(client, "levels", "root", entry("a"), null);
    assert.deepEqual(write.fields!.children, [entry("a")]);
    assert.equal(write.requireUpdateTime, undefined);
  });

  await t.test("afterIdの直後に挿入する", async () => {
    const client = fakeClient({
      "levels/root": doc([entry("a"), entry("b")]),
    });
    const write = await buildInsertChildWrite(client, "levels", "root", entry("new"), "a");
    const ids = (write.fields!.children as LevelChildEntry[]).map((c) => c.id);
    assert.deepEqual(ids, ["a", "new", "b"]);
  });

  await t.test("afterIdが見つからなければ末尾に足す", async () => {
    const client = fakeClient({
      "levels/root": doc([entry("a"), entry("b")]),
    });
    const write = await buildInsertChildWrite(client, "levels", "root", entry("new"), "存在しないid");
    const ids = (write.fields!.children as LevelChildEntry[]).map((c) => c.id);
    assert.deepEqual(ids, ["a", "b", "new"]);
  });
});

test("buildUpdateEntryWrites", async (t) => {
  await t.test("ドキュメントが無い親はスキップする", async () => {
    const client = fakeClient({});
    const writes = await buildUpdateEntryWrites(client, "levels", [
      { parentId: null, elementId: "a", patch: { done: true } },
    ]);
    assert.deepEqual(writes, []);
  });

  await t.test("該当エントリが無ければそのエントリだけスキップする", async () => {
    const client = fakeClient({
      "levels/root": doc([entry("a")]),
    });
    const writes = await buildUpdateEntryWrites(client, "levels", [
      { parentId: null, elementId: "不存在", patch: { done: true } },
    ]);
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].fields!.children, [entry("a")]);
  });

  await t.test("patchをマージして書き戻し、同じ親のドキュメントは1回だけ読む", async () => {
    let readCount = 0;
    const client = fakeClient(
      {
        "levels/root": doc([entry("a", "A", false), entry("b", "B", false)]),
      },
      () => readCount++
    );
    const writes = await buildUpdateEntryWrites(client, "levels", [
      { parentId: null, elementId: "a", patch: { done: true } },
      { parentId: null, elementId: "b", patch: { detail: "B変更後" } },
    ]);
    assert.equal(readCount, 1);
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].fields!.children, [
      { id: "a", detail: "A", done: true },
      { id: "b", detail: "B変更後", done: false },
    ]);
    assert.equal(writes[0].requireUpdateTime, "t1");
  });

  await t.test("parentIdが異なれば別々のlevelsドキュメントへ書く", async () => {
    const client = fakeClient({
      "levels/root": doc([entry("a")]),
      "levels/p": doc([entry("b")], "t2"),
    });
    const writes = await buildUpdateEntryWrites(client, "levels", [
      { parentId: null, elementId: "a", patch: { done: true } },
      { parentId: "p", elementId: "b", patch: { done: true } },
    ]);
    assert.equal(writes.length, 2);
    const rootWrite = writes.find((w) => w.path === "levels/root");
    const pWrite = writes.find((w) => w.path === "levels/p");
    assert.deepEqual(rootWrite?.fields!.children, [{ id: "a", detail: "a", done: true }]);
    assert.deepEqual(pWrite?.fields!.children, [{ id: "b", detail: "b", done: true }]);
  });
});
