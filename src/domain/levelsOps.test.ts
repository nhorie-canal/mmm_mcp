import { test } from "node:test";
import assert from "node:assert/strict";
import type { FirestoreDoc, FirestoreRestClient, FirestoreWrite } from "../firestore/restClient.js";
import {
  levelsSnapshotFromDocs,
  locateInLevels,
  ancestorDetailsInLevels,
  subtreeIdsInLevels,
  buildLevelsPatchWrites,
  buildLevelsAppendWrites,
  buildLevelsMoveWrites,
  buildLevelsDeleteWrites,
  readLevelsSnapshot,
} from "./levelsOps.js";

const LEVELS_PATH = "users/u/headers/h/levels";

/** levelId -> 子のid一覧(detailはidを大文字にしたもの)。 */
function snapshot(levels: Record<string, string[]>, done: string[] = []) {
  return levelsSnapshotFromDocs(
    Object.entries(levels).map(([id, ids]) => ({
      id,
      data: {
        children: ids.map((c) => ({ id: c, detail: c.toUpperCase(), done: done.includes(c) })),
      },
      updateTime: `t-${id}`,
    }))
  );
}

function byPath(writes: FirestoreWrite[]): Map<string, FirestoreWrite> {
  assert.equal(new Set(writes.map((w) => w.path)).size, writes.length, "同じpathの書き込みが重複している");
  return new Map(writes.map((w) => [w.path.slice(LEVELS_PATH.length + 1), w]));
}

function childIds(write: FirestoreWrite | undefined): string[] {
  const children = write?.fields?.children as Array<{ id: string }> | undefined;
  assert.ok(children, "childrenを書いていない");
  return children.map((c) => c.id);
}

// root: a(a1, a2) - b
const BASE = { root: ["a", "b"], a: ["a1", "a2"] };

test("locateInLevels: 親と位置を返し、どこからも辿れない要素は見つからない扱いにする", () => {
  const snap = snapshot({ ...BASE, orphan: ["x"] });
  assert.deepEqual(locateInLevels(snap, "a2"), { parentId: "a", levelId: "a", index: 1 });
  assert.deepEqual(locateInLevels(snap, "b"), { parentId: null, levelId: "root", index: 1 });
  assert.equal(locateInLevels(snap, "x"), null);
  assert.equal(locateInLevels(snap, "none"), null);
});

test("ancestorDetailsInLevels: 自分自身を含む祖先のdetailを根から順に返す", () => {
  const snap = snapshot(BASE);
  assert.deepEqual(ancestorDetailsInLevels(snap, "a1"), ["A", "A1"]);
  assert.deepEqual(ancestorDetailsInLevels(snap, null), []);
});

test("subtreeIdsInLevels: 自分と配下のidを集める", () => {
  const snap = snapshot({ ...BASE, a1: ["a1x"] });
  assert.deepEqual(new Set(subtreeIdsInLevels(snap, "a")), new Set(["a", "a1", "a2", "a1x"]));
});

test("buildLevelsPatchWrites: 親ごとに1件の書き込みにまとめ、読み取り時のupdateTimeで楽観的ロックする", () => {
  const snap = snapshot(BASE);
  const { writes, found } = buildLevelsPatchWrites(LEVELS_PATH, snap, [
    { elementId: "a1", patch: { done: true } },
    { elementId: "a2", patch: { detail: "新" } },
    { elementId: "none", patch: { done: true } },
  ]);
  assert.deepEqual(found, new Set(["a1", "a2"]));
  const w = byPath(writes).get("a")!;
  assert.equal(w.requireUpdateTime, "t-a");
  assert.deepEqual(w.fields!.children, [
    { id: "a1", detail: "A1", done: true },
    { id: "a2", detail: "新", done: false },
  ]);
  assert.equal(writes.length, 1);
});

test("buildLevelsAppendWrites: 既存の子一覧の末尾へ足し、forest内の親は新規作成する", () => {
  const snap = snapshot(BASE);
  const writes = byPath(
    buildLevelsAppendWrites(
      LEVELS_PATH,
      snap,
      [
        { id: "n1", detail: "N1", done: true, parentId: null },
        { id: "n1a", detail: "N1A", done: false, parentId: "n1" },
      ],
      "a",
      true
    )
  );
  assert.deepEqual(childIds(writes.get("a")), ["a1", "a2", "n1"]);
  assert.equal(writes.get("a")!.requireUpdateTime, "t-a");
  assert.deepEqual(childIds(writes.get("n1")), ["n1a"]);
  assert.equal(writes.get("n1")!.requireMissing, true);
});

test("buildLevelsAppendWrites: 子を持たない要素へ足すと、その子一覧を新規作成する", () => {
  const snap = snapshot(BASE);
  const writes = byPath(
    buildLevelsAppendWrites(LEVELS_PATH, snap, [{ id: "n", detail: "N", done: false, parentId: null }], "b", false)
  );
  assert.deepEqual(childIds(writes.get("b")), ["n"]);
  assert.equal(writes.get("b")!.requireMissing, true);
});

test("buildLevelsAppendWrites: TODOでないマップでは、チェックを持ち込まない", () => {
  const snap = snapshot(BASE);
  const writes = byPath(
    buildLevelsAppendWrites(LEVELS_PATH, snap, [{ id: "n", detail: "N", done: true, parentId: null }], null, false)
  );
  const children = writes.get("root")!.fields!.children as Array<{ id: string; done: boolean }>;
  assert.equal(children.at(-1)!.done, false);
});

test("buildLevelsMoveWrites: 同じ親の中の並べ替えは1件の書き込みにまとめ、要素が重複しない", () => {
  const snap = snapshot({ root: ["a", "b", "c"] });
  const writes = byPath(buildLevelsMoveWrites(LEVELS_PATH, snap, "a", null, "c"));
  assert.deepEqual(childIds(writes.get("root")), ["b", "c", "a"]);
  assert.equal(writes.size, 1);
});

test("buildLevelsMoveWrites: afterがnullなら先頭へ置く", () => {
  const snap = snapshot({ root: ["a", "b", "c"] });
  const writes = byPath(buildLevelsMoveWrites(LEVELS_PATH, snap, "c", null, null));
  assert.deepEqual(childIds(writes.get("root")), ["c", "a", "b"]);
});

test("buildLevelsMoveWrites: 別の親へ移すと、元から取り除き移動先へ入れる。配下の子一覧は動かさない", () => {
  const snap = snapshot({ ...BASE, a1: ["a1x"] });
  const writes = byPath(buildLevelsMoveWrites(LEVELS_PATH, snap, "a1", "b", null));
  assert.deepEqual(childIds(writes.get("a")), ["a2"]);
  assert.deepEqual(childIds(writes.get("b")), ["a1"]);
  assert.equal(writes.get("b")!.requireMissing, true);
  assert.equal(writes.has("a1"), false);
});

test("buildLevelsMoveWrites: 元の親の子が0件になったら、その子一覧ドキュメントを消す", () => {
  const snap = snapshot({ root: ["a", "b"], a: ["a1"] });
  const writes = byPath(buildLevelsMoveWrites(LEVELS_PATH, snap, "a1", null, "b"));
  assert.equal(writes.get("a")!.delete, true);
  assert.equal(writes.get("a")!.requireUpdateTime, "t-a");
  assert.deepEqual(childIds(writes.get("root")), ["a", "b", "a1"]);
});

test("buildLevelsMoveWrites: 自分の配下へは移せない", () => {
  const snap = snapshot(BASE);
  assert.throws(() => buildLevelsMoveWrites(LEVELS_PATH, snap, "a", "a1", null), /配下/);
});

test("buildLevelsMoveWrites: afterが移動先の子でなければ末尾へ置く", () => {
  const snap = snapshot(BASE);
  const writes = byPath(buildLevelsMoveWrites(LEVELS_PATH, snap, "b", "a", "zzz"));
  assert.deepEqual(childIds(writes.get("a")), ["a1", "a2", "b"]);
});

test("buildLevelsDeleteWrites: 配下の子一覧ドキュメントを消し、親の子一覧から取り除く", () => {
  const snap = snapshot({ ...BASE, a1: ["a1x"] });
  const { writes, deletedIds } = buildLevelsDeleteWrites(LEVELS_PATH, snap, ["a"]);
  const w = byPath(writes);
  assert.deepEqual(deletedIds, new Set(["a", "a1", "a2", "a1x"]));
  assert.equal(w.get("a")!.delete, true);
  assert.equal(w.get("a1")!.delete, true);
  assert.deepEqual(childIds(w.get("root")), ["b"]);
});

test("buildLevelsDeleteWrites: 隣り合う要素を同時に消しても、親の子一覧は1件の書き込みになる", () => {
  const snap = snapshot({ root: ["a", "b", "c", "d"] });
  const w = byPath(buildLevelsDeleteWrites(LEVELS_PATH, snap, ["b", "c"]).writes);
  assert.deepEqual(childIds(w.get("root")), ["a", "d"]);
});

test("buildLevelsDeleteWrites: 親と子を同時に指定しても、消した親の子一覧を書き戻して復活させない", () => {
  const snap = snapshot(BASE);
  const w = byPath(buildLevelsDeleteWrites(LEVELS_PATH, snap, ["a1", "a"]).writes);
  assert.equal(w.get("a")!.delete, true);
  assert.deepEqual(childIds(w.get("root")), ["b"]);
});

test("buildLevelsDeleteWrites: 子が0件になった親の子一覧は消す。rootは空配列で残す", () => {
  const snap = snapshot({ root: ["a"], a: ["a1"] });
  const inner = byPath(buildLevelsDeleteWrites(LEVELS_PATH, snap, ["a1"]).writes);
  assert.equal(inner.get("a")!.delete, true);
  const top = byPath(buildLevelsDeleteWrites(LEVELS_PATH, snap, ["a"]).writes);
  assert.deepEqual(childIds(top.get("root")), []);
});

/** listDocumentsだけを持つ手書きの偽クライアント。levelsコレクションの中身を返す。 */
function fakeLevelsClient(docs: FirestoreDoc[]): FirestoreRestClient {
  return {
    async listDocuments(): Promise<FirestoreDoc[]> {
      return docs;
    },
  } as unknown as FirestoreRestClient;
}

test("readLevelsSnapshot: levels/rootが無いマップは空のマップとして読む", async () => {
  // 切替後はアプリで開いてもrootが作られないため、「アプリで開いて」と止めると
  // 中身の無い古いマップへ永久に書き込めなくなる。
  const snapshot = await readLevelsSnapshot(fakeLevelsClient([]), "users/u/headers/h/levels");
  assert.equal(snapshot.size, 0);
});

test("readLevelsSnapshot: rootが無いマップへの追加は、rootを新規作成する書き込みになる", async () => {
  const levelsPath = "users/u/headers/h/levels";
  const snapshot = await readLevelsSnapshot(fakeLevelsClient([]), levelsPath);
  const writes = buildLevelsAppendWrites(
    levelsPath,
    snapshot,
    [{ id: "a", detail: "最初の要素", done: false, parentId: null }],
    null,
    false
  );
  assert.deepEqual(writes, [
    {
      path: `${levelsPath}/root`,
      fields: { children: [{ id: "a", detail: "最初の要素", done: false }] },
      requireMissing: true,
    },
  ]);
});
