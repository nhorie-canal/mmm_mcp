// マップ間リンク(levels の links フィールド)を、木の操作が正しく付け替えるか。
// 決めごとは docs/map-links.md §8。
import { test } from "node:test";
import assert from "node:assert/strict";
import type { FirestoreWrite } from "../firestore/restClient.js";
import {
  levelsSnapshotFromDocs,
  buildLevelsPatchWrites,
  buildLevelsMoveWrites,
  buildLevelsDeleteWrites,
  buildLevelsAppendWrites,
  linkCountsOfSnapshot,
  withLinkSummary,
} from "./levelsOps.js";
import { linksOf, type LinkTarget } from "./levels.js";

const LEVELS_PATH = "users/u/headers/h/levels";
const HEADER_PATH = "users/u/headers/h";

const T1: LinkTarget = { uid: "u1", headerId: "h1" };
const T2: LinkTarget = { uid: "u1", headerId: "h2" };
const T3: LinkTarget = { uid: "u2", headerId: "h3" };

/** levelId -> 子のid一覧。[links]は levelId -> 子のid -> リンク先。 */
function snapshot(levels: Record<string, string[]>, links: Record<string, Record<string, LinkTarget[]>> = {}) {
  return levelsSnapshotFromDocs(
    Object.entries(levels).map(([id, ids]) => ({
      id,
      data: {
        children: ids.map((c) => ({ id: c, detail: c.toUpperCase(), done: false })),
        ...(links[id] ? { links: links[id] } : {}),
      },
      updateTime: `t-${id}`,
    }))
  );
}

function byPath(writes: FirestoreWrite[]): Map<string, FirestoreWrite> {
  assert.equal(new Set(writes.map((w) => w.path)).size, writes.length, "同じpathの書き込みが重複している");
  return new Map(writes.map((w) => [w.path.startsWith(LEVELS_PATH) ? w.path.slice(LEVELS_PATH.length + 1) : w.path, w]));
}

function linkIds(write: FirestoreWrite | undefined): string[] {
  const links = write?.fields?.links as Record<string, unknown> | undefined;
  assert.ok(links, "links を書いていない");
  return Object.keys(links).sort();
}

// root: a(a1, a2) - b - c
const BASE = { root: ["a", "b", "c"], a: ["a1", "a2"] };

test("linksOf: 形の崩れたもの・空のもの・同じ行き先の重複は読み飛ばす", () => {
  const links = linksOf({
    links: {
      ok: [T1, T2],
      dup: [T1, { ...T1 }],
      broken: [{ uid: 1, headerId: "h" }, "x", null],
      empty: [],
      notList: "x",
    },
  });
  assert.deepEqual([...links.keys()].sort(), ["dup", "ok"]);
  assert.deepEqual(links.get("ok"), [T1, T2]);
  assert.deepEqual(links.get("dup"), [T1]);
  assert.equal(linksOf({}).size, 0);
  assert.equal(linksOf({ links: [1] }).size, 0);
});

test("削除: リンク付きの要素を消すと、親の links から外れる", () => {
  const snap = snapshot(BASE, { root: { b: [T1], c: [T2] } });
  const writes = byPath(buildLevelsDeleteWrites(LEVELS_PATH, snap, ["b"]).writes);
  assert.deepEqual(linkIds(writes.get("root")), ["c"]);
});

test("削除: 隣り合うリンク付きの要素を同時に消しても、両方外れ、親は1件の書き込みになる", () => {
  const snap = snapshot(BASE, { root: { a: [T1], b: [T2], c: [T3] } });
  const writes = byPath(buildLevelsDeleteWrites(LEVELS_PATH, snap, ["a", "b"]).writes);
  assert.deepEqual(linkIds(writes.get("root")), ["c"]);
});

test("削除: リンク付きの要素を配下ごと消すと、配下の子一覧が消え、親の links からも外れる", () => {
  const snap = snapshot(BASE, { root: { a: [T1] }, a: { a1: [T2] } });
  const writes = byPath(buildLevelsDeleteWrites(LEVELS_PATH, snap, ["a"]).writes);
  assert.equal(writes.get("a")?.delete, true);
  assert.deepEqual(linkIds(writes.get("root")), []);
});

test("移動: 別の親へ移すと、元の親から外れて移動先の親に入る。どちらも1件の書き込み", () => {
  const snap = snapshot(BASE, { root: { b: [T1, T2] } });
  const writes = byPath(buildLevelsMoveWrites(LEVELS_PATH, snap, "b", "a", "a2"));
  assert.deepEqual(linkIds(writes.get("root")), []);
  assert.deepEqual(linkIds(writes.get("a")), ["b"]);
  assert.deepEqual((writes.get("a")!.fields!.links as Record<string, LinkTarget[]>).b, [T1, T2]);
});

test("移動: 子の無い要素の下へ移すと、新しい子一覧にリンクごと入る", () => {
  const snap = snapshot(BASE, { root: { c: [T3] } });
  const writes = byPath(buildLevelsMoveWrites(LEVELS_PATH, snap, "c", "b", null));
  assert.equal(writes.get("b")?.requireMissing, true);
  assert.deepEqual(linkIds(writes.get("b")), ["c"]);
  assert.deepEqual(linkIds(writes.get("root")), []);
});

test("移動: 同じ親の中の並べ替えでは、リンクが残る", () => {
  const snap = snapshot(BASE, { root: { b: [T1] } });
  const writes = byPath(buildLevelsMoveWrites(LEVELS_PATH, snap, "b", null, null));
  assert.deepEqual(linkIds(writes.get("root")), ["b"]);
});

test("移動: 日付とリンクの両方を持つ要素は、両方が運ばれる", () => {
  const due = { due: { at: new Date("2026-10-15T00:00:00Z"), allDay: true } };
  const snap = levelsSnapshotFromDocs([
    {
      id: "root",
      data: {
        children: [
          { id: "a", detail: "A", done: false },
          { id: "b", detail: "B", done: false },
        ],
        schedule: { b: due },
        links: { b: [T1] },
      },
      updateTime: "t",
    },
  ]);
  const writes = byPath(buildLevelsMoveWrites(LEVELS_PATH, snap, "b", "a", null));
  assert.deepEqual(Object.keys(writes.get("a")!.fields!).sort(), ["children", "links", "schedule"]);
});

test("本文・チェックの書き換えでは、リンクに触れない", () => {
  const snap = snapshot(BASE, { root: { b: [T1] } });
  const { writes } = buildLevelsPatchWrites(LEVELS_PATH, snap, [{ elementId: "b", patch: { detail: "x" } }]);
  const root = byPath(writes).get("root");
  assert.deepEqual((root!.fields!.links as Record<string, LinkTarget[]>).b, [T1]);
});

test("children に無い id が links にあれば、その親を書くときに取り除く", () => {
  // 古い版の削除・移動で取り残されたリンク
  const snap = snapshot(BASE, { root: { b: [T1], ghost: [T2] } });
  const { writes } = buildLevelsPatchWrites(LEVELS_PATH, snap, [{ elementId: "c", patch: { done: true } }]);
  assert.deepEqual(linkIds(byPath(writes).get("root")), ["b"]);
});

test("リンクの無いマップでは links を書かない(今までと同じ書き込みのまま)", () => {
  const snap = snapshot(BASE);
  const writes = byPath(buildLevelsDeleteWrites(LEVELS_PATH, snap, ["b"]).writes);
  assert.deepEqual(Object.keys(writes.get("root")!.fields!), ["children"]);
});

test("最後のリンクが外れたら、空の links を書いて消し込む", () => {
  const snap = snapshot(BASE, { root: { b: [T1] } });
  const writes = byPath(buildLevelsDeleteWrites(LEVELS_PATH, snap, ["b"]).writes);
  assert.deepEqual(writes.get("root")!.fields!.links, {});
});

test("追加: 要素を足しても、その親の既存のリンクが残る", () => {
  const snap = snapshot(BASE, { root: { b: [T1] } });
  const writes = byPath(
    buildLevelsAppendWrites(LEVELS_PATH, snap, [{ id: "n", detail: "N", done: false, parentId: null }], null, false)
  );
  assert.deepEqual(linkIds(writes.get("root")), ["b"]);
});

test("linkCountsOfSnapshot: リンク先ごとに、リンクしている要素の数を数える(同じ要素の重複は1つ)", () => {
  const snap = snapshot(BASE, { root: { a: [T1, T2], b: [T1] }, a: { a1: [T1] } });
  assert.deepEqual(linkCountsOfSnapshot(snap), { "u1:h1": 3, "u1:h2": 1 });
});

test("linkCountsOfSnapshot: children に無い id のリンクは数えない", () => {
  const snap = snapshot(BASE, { root: { b: [T1], ghost: [T1] } });
  assert.deepEqual(linkCountsOfSnapshot(snap), { "u1:h1": 1 });
});

test("要約: リンク付きの要素を消すと、header の linkCounts を同じコミットで書き直す", () => {
  const snap = snapshot(BASE, { root: { b: [T1], c: [T1, T2] } });
  const { writes } = buildLevelsDeleteWrites(LEVELS_PATH, snap, ["b"]);
  const all = withLinkSummary(HEADER_PATH, LEVELS_PATH, snap, writes);
  const header = all.find((w) => w.path === HEADER_PATH);
  assert.ok(header, "header を書いていない");
  assert.deepEqual(header!.fields, { linkCounts: { "u1:h1": 1, "u1:h2": 1 } });
  // levels の書き込みはそのまま(同じ path を2件書かない)
  byPath(all);
});

test("要約: header の書き込みは「存在すること」が前提(消えたマップに header の抜け殻を作らない)", () => {
  const snap = snapshot(BASE, { root: { b: [T1] } });
  const { writes } = buildLevelsDeleteWrites(LEVELS_PATH, snap, ["b"]);
  const header = withLinkSummary(HEADER_PATH, LEVELS_PATH, snap, writes).find((w) => w.path === HEADER_PATH);
  assert.equal(header!.requireExists, true);
});

test("要約: 最後のリンクを消したら、空の linkCounts を書く", () => {
  const snap = snapshot(BASE, { root: { b: [T1] } });
  const { writes } = buildLevelsDeleteWrites(LEVELS_PATH, snap, ["b"]);
  const header = withLinkSummary(HEADER_PATH, LEVELS_PATH, snap, writes).find((w) => w.path === HEADER_PATH);
  assert.deepEqual(header!.fields, { linkCounts: {} });
});

test("要約: 配下ごと消してもリンクの数が正しく減る", () => {
  const snap = snapshot(BASE, { root: { a: [T1] }, a: { a1: [T1], a2: [T2] }, });
  const { writes } = buildLevelsDeleteWrites(LEVELS_PATH, snap, ["a"]);
  const header = withLinkSummary(HEADER_PATH, LEVELS_PATH, snap, writes).find((w) => w.path === HEADER_PATH);
  assert.deepEqual(header!.fields, { linkCounts: {} });
});

test("要約: 別の親へ移すだけなら件数は変わらず、header を書かない", () => {
  const snap = snapshot(BASE, { root: { b: [T1] } });
  const writes = buildLevelsMoveWrites(LEVELS_PATH, snap, "b", "a", null);
  const all = withLinkSummary(HEADER_PATH, LEVELS_PATH, snap, writes);
  assert.equal(all.some((w) => w.path === HEADER_PATH), false);
  assert.equal(all.length, writes.length);
});

test("要約: リンクの無いマップでは、何を消しても header を書かない", () => {
  const snap = snapshot(BASE);
  const { writes } = buildLevelsDeleteWrites(LEVELS_PATH, snap, ["b"]);
  const all = withLinkSummary(HEADER_PATH, LEVELS_PATH, snap, writes);
  assert.equal(all.length, writes.length);
});

test("要約: 無関係な要素を消しても、リンクの件数は変わらず header を書かない", () => {
  const snap = snapshot(BASE, { root: { b: [T1] } });
  const { writes } = buildLevelsDeleteWrites(LEVELS_PATH, snap, ["c"]);
  const all = withLinkSummary(HEADER_PATH, LEVELS_PATH, snap, writes);
  assert.equal(all.some((w) => w.path === HEADER_PATH), false);
});

test("要約: 古い版が取り残したリンク(children に無い id)が消えると、要約が実際に合う", () => {
  // ghost は数えない。b を消すと T1 は 0 になる
  const snap = snapshot(BASE, { root: { b: [T1], ghost: [T1] } });
  const { writes } = buildLevelsDeleteWrites(LEVELS_PATH, snap, ["b"]);
  const header = withLinkSummary(HEADER_PATH, LEVELS_PATH, snap, writes).find((w) => w.path === HEADER_PATH);
  assert.deepEqual(header!.fields, { linkCounts: {} });
});
