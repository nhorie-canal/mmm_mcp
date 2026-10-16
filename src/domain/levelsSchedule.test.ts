// 期日・着手日(levels の schedule フィールド)を、木の操作が正しく付け替えるか。
// 決めごとは docs/schedule.md §2〜§5。
import { test } from "node:test";
import assert from "node:assert/strict";
import type { FirestoreWrite } from "../firestore/restClient.js";
import {
  levelsSnapshotFromDocs,
  buildLevelsPatchWrites,
  buildLevelsMoveWrites,
  buildLevelsDeleteWrites,
  buildLevelsScheduleWrites,
  buildLevelsAppendWrites,
  elementTreeOf,
} from "./levelsOps.js";
import { scheduleOf, type ScheduleEntry } from "./levels.js";
import { decodeValue, encodeValue } from "../firestore/valueCodec.js";

const LEVELS_PATH = "users/u/headers/h/levels";

const DUE: ScheduleEntry = { due: { at: new Date("2026-10-15T00:00:00Z"), allDay: true } };
const START: ScheduleEntry = { start: { at: new Date("2026-10-12T00:00:00Z"), allDay: false } };

/** levelId -> 子のid一覧。[schedules]は levelId -> 子のid -> 日付。 */
function snapshot(
  levels: Record<string, string[]>,
  schedules: Record<string, Record<string, ScheduleEntry>> = {}
) {
  return levelsSnapshotFromDocs(
    Object.entries(levels).map(([id, ids]) => ({
      id,
      data: {
        children: ids.map((c) => ({ id: c, detail: c.toUpperCase(), done: false })),
        ...(schedules[id] ? { schedule: schedules[id] } : {}),
      },
      updateTime: `t-${id}`,
    }))
  );
}

function byPath(writes: FirestoreWrite[]): Map<string, FirestoreWrite> {
  assert.equal(new Set(writes.map((w) => w.path)).size, writes.length, "同じpathの書き込みが重複している");
  return new Map(writes.map((w) => [w.path.slice(LEVELS_PATH.length + 1), w]));
}

function scheduleIds(write: FirestoreWrite | undefined): string[] {
  const schedule = write?.fields?.schedule as Record<string, unknown> | undefined;
  assert.ok(schedule, "scheduleを書いていない");
  return Object.keys(schedule).sort();
}

// root: a(a1, a2) - b - c
const BASE = { root: ["a", "b", "c"], a: ["a1", "a2"] };

test("削除: 日付付きの要素を消すと、親の schedule から外れる", () => {
  const snap = snapshot(BASE, { root: { b: DUE, c: START } });
  const writes = byPath(buildLevelsDeleteWrites(LEVELS_PATH, snap, ["b"]).writes);
  assert.deepEqual(scheduleIds(writes.get("root")), ["c"]);
});

test("削除: 隣り合う日付付きの要素を同時に消しても、両方外れ、親は1件の書き込みになる", () => {
  const snap = snapshot(BASE, { root: { a: DUE, b: DUE, c: START } });
  const writes = byPath(buildLevelsDeleteWrites(LEVELS_PATH, snap, ["a", "b"]).writes);
  assert.deepEqual(scheduleIds(writes.get("root")), ["c"]);
});

test("削除: 日付付きの要素を配下ごと消すと、配下の子一覧が消え、親の schedule からも外れる", () => {
  const snap = snapshot(BASE, { root: { a: DUE }, a: { a1: START } });
  const writes = byPath(buildLevelsDeleteWrites(LEVELS_PATH, snap, ["a"]).writes);
  assert.equal(writes.get("a")?.delete, true);
  assert.deepEqual(scheduleIds(writes.get("root")), []);
});

test("移動: 別の親へ移すと、元の親から外れて移動先の親に入る。どちらも1件の書き込み", () => {
  const snap = snapshot(BASE, { root: { b: DUE } });
  const writes = byPath(buildLevelsMoveWrites(LEVELS_PATH, snap, "b", "a", "a2"));
  assert.deepEqual(scheduleIds(writes.get("root")), []);
  assert.deepEqual(scheduleIds(writes.get("a")), ["b"]);
  assert.deepEqual((writes.get("a")!.fields!.schedule as Record<string, ScheduleEntry>).b, DUE);
});

test("移動: 子の無い要素の下へ移すと、新しい子一覧に日付ごと入る", () => {
  const snap = snapshot(BASE, { root: { c: START } });
  const writes = byPath(buildLevelsMoveWrites(LEVELS_PATH, snap, "c", "b", null));
  assert.equal(writes.get("b")?.requireMissing, true);
  assert.deepEqual(scheduleIds(writes.get("b")), ["c"]);
  assert.deepEqual(scheduleIds(writes.get("root")), []);
});

test("移動: 同じ親の中の並べ替えでは、日付が残る", () => {
  const snap = snapshot(BASE, { root: { b: DUE } });
  const writes = byPath(buildLevelsMoveWrites(LEVELS_PATH, snap, "b", null, null));
  assert.deepEqual(scheduleIds(writes.get("root")), ["b"]);
});

test("本文・チェックの書き換えでは、日付に触れない", () => {
  const snap = snapshot(BASE, { root: { b: DUE } });
  const { writes } = buildLevelsPatchWrites(LEVELS_PATH, snap, [{ elementId: "b", patch: { detail: "x" } }]);
  const root = byPath(writes).get("root");
  assert.deepEqual((root!.fields!.schedule as Record<string, ScheduleEntry>).b, DUE);
});

test("children に無い id が schedule にあれば、その親を書くときに取り除く", () => {
  // 古い版の削除・移動で取り残された日付
  const snap = snapshot(BASE, { root: { b: DUE, ghost: DUE } });
  const { writes } = buildLevelsPatchWrites(LEVELS_PATH, snap, [{ elementId: "c", patch: { done: true } }]);
  assert.deepEqual(scheduleIds(byPath(writes).get("root")), ["b"]);
});

test("日付の無いマップでは schedule を書かない(今までと同じ書き込みのまま)", () => {
  const snap = snapshot(BASE);
  const writes = byPath(buildLevelsDeleteWrites(LEVELS_PATH, snap, ["b"]).writes);
  assert.deepEqual(Object.keys(writes.get("root")!.fields!), ["children"]);
});

test("最後の日付が外れたら、空の schedule を書いて消し込む", () => {
  const snap = snapshot(BASE, { root: { b: DUE } });
  const writes = byPath(buildLevelsDeleteWrites(LEVELS_PATH, snap, ["b"]).writes);
  assert.deepEqual(writes.get("root")!.fields!.schedule, {});
});

test("scheduleOf: 形の崩れたものは読み飛ばす", () => {
  const schedule = scheduleOf({
    schedule: {
      ok: DUE,
      both: { ...DUE, ...START },
      noAt: { due: { allDay: true } },
      notDate: { due: { at: "2026-10-15", allDay: true } },
      empty: {},
      nul: null,
    },
  });
  assert.deepEqual([...schedule.keys()].sort(), ["both", "ok"]);
  assert.deepEqual(schedule.get("both"), { ...DUE, ...START });
});

test("valueCodec: Date は Firestore の timestampValue と行き来する", () => {
  const at = new Date("2026-10-15T09:30:00.000Z");
  const encoded = encodeValue(at);
  assert.deepEqual(encoded, { timestampValue: "2026-10-15T09:30:00.000Z" });
  assert.deepEqual(decodeValue(encoded), at);
  // REST はナノ秒まで返すことがある
  assert.deepEqual(decodeValue({ timestampValue: "2026-10-15T09:30:00.123456Z" }), new Date("2026-10-15T09:30:00.123Z"));
});

test("elementTreeOf: 各要素に、親の schedule にある日付を添える", () => {
  const snap = snapshot(BASE, { root: { b: DUE }, a: { a2: START } });
  const tree = elementTreeOf(snap);
  assert.deepEqual(tree.find((n) => n.id === "b")?.schedule, DUE);
  assert.deepEqual(tree[0].children.find((n) => n.id === "a2")?.schedule, START);
  assert.equal(tree[0].schedule, undefined);
});

test("buildLevelsScheduleWrites: 付け外しを親ごとに1件の書き込みにまとめる", () => {
  const snap = snapshot(BASE, { root: { b: DUE } });
  const { writes, found } = buildLevelsScheduleWrites(LEVELS_PATH, snap, [
    { elementId: "c", due: DUE.due },
    { elementId: "b", due: null },
    { elementId: "a1", start: START.start },
    { elementId: "none", due: DUE.due },
  ]);
  assert.deepEqual([...found].sort(), ["a1", "b", "c"]);
  const byLevel = byPath(writes);
  assert.deepEqual(byLevel.get("root")!.fields!.schedule, { c: DUE });
  assert.deepEqual(byLevel.get("a")!.fields!.schedule, { a1: START });
});

test("buildLevelsScheduleWrites: 指定しなかった方の日付は残し、両方外れたらキーごと外す", () => {
  const both = { ...DUE, ...START };
  const snap = snapshot(BASE, { root: { b: both, c: DUE } });
  const { writes } = buildLevelsScheduleWrites(LEVELS_PATH, snap, [
    { elementId: "b", start: null },
    { elementId: "c", due: null },
  ]);
  assert.deepEqual(byPath(writes).get("root")!.fields!.schedule, { b: DUE });
});

test("buildLevelsScheduleWrites: 同じ要素を2回指定したら、後の指定が勝つ", () => {
  const snap = snapshot(BASE);
  const { writes } = buildLevelsScheduleWrites(LEVELS_PATH, snap, [
    { elementId: "b", due: DUE.due },
    { elementId: "b", due: null, start: START.start },
  ]);
  assert.deepEqual(byPath(writes).get("root")!.fields!.schedule, { b: START });
});

test("buildLevelsAppendWrites: 取り込む要素の日付を、入る親の schedule に入れる", () => {
  const snap = snapshot(BASE, { root: { b: DUE } });
  const writes = byPath(
    buildLevelsAppendWrites(
      LEVELS_PATH,
      snap,
      [
        { id: "n", detail: "N", done: false, parentId: null, schedule: START },
        { id: "n1", detail: "N1", done: false, parentId: "n", schedule: DUE },
      ],
      null,
      true
    )
  );
  assert.deepEqual(writes.get("root")!.fields!.schedule, { b: DUE, n: START });
  assert.deepEqual(writes.get("n")!.fields!.schedule, { n1: DUE });
});
