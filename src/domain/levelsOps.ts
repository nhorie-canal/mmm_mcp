// levelsコレクションの読み取り結果から、要素を探して書き換える書き込みを組み立てる。
//
// どの操作も「levels全件の読み取り結果(LevelsSnapshot)」を受け取る純粋関数で、
// 触った子一覧を作業用に複製して編集し、最後に元の状態との差分から
// 書き込みを組み立てる。1つのドキュメントへの書き込みは必ず1件になる
// (同じpathへ2件積むと後勝ちになり、要素の重複や復活が起きる)。
//
// 子を持たなくなった要素の子一覧ドキュメントは消す(アプリのprojectLevelsと
// 同じ扱い)。rootだけは空配列で残す。
//
// 期日・着手日(schedule)は children と同じドキュメントにあり、同じ1件の書き込みで
// 丸ごと書き直す。子を別の親へ移すときは日付も移し、消すときは外す。書くときは
// children に無いidを取り除く(古い版が取り残した分の掃除。docs/schedule.md §4)。
//
// マップ間リンク(links)も同じドキュメントにあり、日付と同じ扱いにする
// (docs/map-links.md §8)。ただしリンクを足す・外すツールは無い。移すときに運び、消すときに外す。
// header の linkCounts(リンク先ごとの件数の要約)は別ドキュメントなので、
// [withLinkSummary]で、変わるときだけ同じコミットへ足す。

import type { FirestoreDoc, FirestoreRestClient, FirestoreWrite } from "../firestore/restClient.js";
import {
  buildTreeFromLevels,
  childrenOf,
  linksOf,
  scheduleOf,
  type AppendableNode,
  type ElementNode,
  type LevelChildEntry,
  type LinkTarget,
  type ScheduleDate,
  type ScheduleEntry,
} from "./levels.js";

export interface LevelDocState {
  children: LevelChildEntry[];
  /** 子のid -> 期日・着手日。日付を持つ子だけ。 */
  schedule: Map<string, ScheduleEntry>;
  /** 子のid -> マップ間リンクの行き先。リンクを持つ子だけ。 */
  links: Map<string, LinkTarget[]>;
  updateTime?: string;
}

/** levelId('root'またはその要素のid) -> 子一覧。 */
export type LevelsSnapshot = Map<string, LevelDocState>;

export function levelsSnapshotFromDocs(docs: FirestoreDoc[]): LevelsSnapshot {
  return new Map(
    docs.map((d) => [
      d.id,
      { children: childrenOf(d.data), schedule: scheduleOf(d.data), links: linksOf(d.data), updateTime: d.updateTime },
    ])
  );
}

/**
 * levels全件を読む。levels/rootが無いマップは空のマップとして扱う
 * (rootへの最初の書き込みは、存在しないことを前提条件にした新規作成になる)。
 * アプリで開いてもrootは作られないので、無いときに止めると中身の無い古い
 * マップへ永久に書き込めなくなる。
 */
export async function readLevelsSnapshot(
  client: FirestoreRestClient,
  levelsPath: string
): Promise<LevelsSnapshot> {
  return levelsSnapshotFromDocs(await client.listDocuments(levelsPath));
}

export interface LevelsLocation {
  /** 親要素のid。マップ最上位ならnull。 */
  parentId: string | null;
  /** 親の子一覧ドキュメントのid('root'または親のid)。 */
  levelId: string;
  index: number;
}

/**
 * rootから辿れる要素だけを対象に、要素id -> 場所 の索引を作る。
 * どこからも辿れない子一覧ドキュメント(過去の不整合の残骸)の中身は数えない。
 */
function indexOf(snapshot: LevelsSnapshot): Map<string, LevelsLocation> {
  const index = new Map<string, LevelsLocation>();
  const walk = (levelId: string) => {
    const children = snapshot.get(levelId)?.children ?? [];
    children.forEach((entry, i) => {
      if (index.has(entry.id)) return; // 循環・重複は最初の位置を採る
      index.set(entry.id, { parentId: levelId === "root" ? null : levelId, levelId, index: i });
      walk(entry.id);
    });
  };
  walk("root");
  return index;
}

export function locateInLevels(snapshot: LevelsSnapshot, elementId: string): LevelsLocation | null {
  return indexOf(snapshot).get(elementId) ?? null;
}

/** ルートから[elementId]までの祖先(自分自身を含む)のdetailを、根から順に並べる。 */
export function ancestorDetailsInLevels(snapshot: LevelsSnapshot, elementId: string | null): string[] {
  const index = indexOf(snapshot);
  const chain: string[] = [];
  let current = elementId;
  const seen = new Set<string>();
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    const loc = index.get(current);
    if (!loc) break;
    chain.push(snapshot.get(loc.levelId)!.children[loc.index].detail);
    current = loc.parentId;
  }
  return chain.reverse();
}

/** [rootId]自身とその配下(子孫)全てのidを集める。 */
export function subtreeIdsInLevels(snapshot: LevelsSnapshot, rootId: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    result.push(id);
    for (const child of snapshot.get(id)?.children ?? []) walk(child.id);
  };
  walk(rootId);
  return result;
}

/** list_elements 用。rootから辿れる要素の木に、各要素の期日・着手日を添える。 */
export function elementTreeOf(snapshot: LevelsSnapshot): ElementNode[] {
  const tree = buildTreeFromLevels(new Map([...snapshot].map(([id, level]) => [id, level.children])));
  const attach = (nodes: ElementNode[]) => {
    for (const node of nodes) {
      const schedule = snapshot.get(node.parentId ?? "root")?.schedule.get(node.id);
      if (schedule) node.schedule = schedule;
      attach(node.children);
    }
  };
  attach(tree);
  return tree;
}

/** 編集中の子一覧。触ったものだけを複製して持ち、最後に差分を書き込みにする。 */
class LevelsDraft {
  private readonly edited = new Map<string, LevelChildEntry[]>();
  private readonly editedSchedule = new Map<string, Map<string, ScheduleEntry>>();
  private readonly editedLinks = new Map<string, Map<string, LinkTarget[]>>();
  private readonly removed = new Set<string>();

  constructor(
    private readonly levelsPath: string,
    private readonly snapshot: LevelsSnapshot
  ) {}

  children(levelId: string): LevelChildEntry[] {
    let list = this.edited.get(levelId);
    if (!list) {
      list = (this.snapshot.get(levelId)?.children ?? []).map((c) => ({ ...c }));
      this.edited.set(levelId, list);
      this.editedSchedule.set(levelId, new Map(this.snapshot.get(levelId)?.schedule));
      this.editedLinks.set(levelId, new Map(this.snapshot.get(levelId)?.links));
      this.removed.delete(levelId);
    }
    return list;
  }

  /** [levelId]の子の日付。触ると、その子一覧も書き込みの対象になる。 */
  schedule(levelId: string): Map<string, ScheduleEntry> {
    this.children(levelId);
    return this.editedSchedule.get(levelId)!;
  }

  /** [levelId]の子のマップ間リンク。触ると、その子一覧も書き込みの対象になる。 */
  links(levelId: string): Map<string, LinkTarget[]> {
    this.children(levelId);
    return this.editedLinks.get(levelId)!;
  }

  /** 子一覧ドキュメントごと消す(配下ごと削除される要素の分)。 */
  remove(levelId: string): void {
    this.edited.delete(levelId);
    this.editedSchedule.delete(levelId);
    this.editedLinks.delete(levelId);
    this.removed.add(levelId);
  }

  /**
   * 書き込む schedule。children に無いidは除く。元も今も日付が無ければ
   * undefined を返し、schedule のフィールドに触れない(日付を使わないマップの
   * 書き込みを今までと同じに保つ)。
   */
  private scheduleToWrite(levelId: string, children: LevelChildEntry[]): Record<string, ScheduleEntry> | undefined {
    const ids = new Set(children.map((c) => c.id));
    const result: Record<string, ScheduleEntry> = {};
    for (const [id, entry] of this.editedSchedule.get(levelId) ?? []) {
      if (ids.has(id)) result[id] = entry;
    }
    const hadSchedule = (this.snapshot.get(levelId)?.schedule.size ?? 0) > 0;
    return hadSchedule || Object.keys(result).length > 0 ? result : undefined;
  }

  /**
   * 書き込む links。children に無いidは除く。元も今もリンクが無ければ undefined を返し、
   * links のフィールドに触れない(リンクを使わないマップの書き込みを今までと同じに保つ)。
   */
  private linksToWrite(levelId: string, children: LevelChildEntry[]): Record<string, LinkTarget[]> | undefined {
    const ids = new Set(children.map((c) => c.id));
    const result: Record<string, LinkTarget[]> = {};
    for (const [id, targets] of this.editedLinks.get(levelId) ?? []) {
      if (ids.has(id)) result[id] = targets;
    }
    const hadLinks = (this.snapshot.get(levelId)?.links.size ?? 0) > 0;
    return hadLinks || Object.keys(result).length > 0 ? result : undefined;
  }

  toWrites(): FirestoreWrite[] {
    const writes: FirestoreWrite[] = [];
    const pathOf = (levelId: string) => `${this.levelsPath}/${levelId}`;
    for (const levelId of this.removed) {
      const original = this.snapshot.get(levelId);
      if (!original) continue; // 元から無いものは消す必要が無い
      writes.push({ path: pathOf(levelId), delete: true, requireUpdateTime: original.updateTime });
    }
    for (const [levelId, children] of this.edited) {
      const original = this.snapshot.get(levelId);
      if (children.length === 0 && levelId !== "root") {
        if (original) {
          writes.push({ path: pathOf(levelId), delete: true, requireUpdateTime: original.updateTime });
        }
        continue;
      }
      const schedule = this.scheduleToWrite(levelId, children);
      const links = this.linksToWrite(levelId, children);
      const fields = {
        children,
        ...(schedule ? { schedule } : {}),
        ...(links ? { links } : {}),
      };
      writes.push(
        original
          ? { path: pathOf(levelId), fields, requireUpdateTime: original.updateTime }
          : { path: pathOf(levelId), fields, requireMissing: true }
      );
    }
    return writes;
  }
}

/** edit_element / update_task_status 用。見つからなかったidはfoundに入らない。 */
export function buildLevelsPatchWrites(
  levelsPath: string,
  snapshot: LevelsSnapshot,
  updates: Array<{ elementId: string; patch: Partial<Pick<LevelChildEntry, "detail" | "done">> }>
): { writes: FirestoreWrite[]; found: Set<string> } {
  const index = indexOf(snapshot);
  const draft = new LevelsDraft(levelsPath, snapshot);
  const found = new Set<string>();
  for (const { elementId, patch } of updates) {
    const loc = index.get(elementId);
    if (!loc) continue;
    const list = draft.children(loc.levelId);
    list[loc.index] = { ...list[loc.index], ...patch };
    found.add(elementId);
  }
  return { writes: draft.toWrites(), found };
}

/** set_schedule の1件。undefinedならその日付に触れず、nullなら外す。 */
export interface ScheduleUpdate {
  elementId: string;
  due?: ScheduleDate | null;
  start?: ScheduleDate | null;
}

/** set_schedule 用。見つからなかったidはfoundに入らない。同じ要素への指定は後が勝つ。 */
export function buildLevelsScheduleWrites(
  levelsPath: string,
  snapshot: LevelsSnapshot,
  updates: ScheduleUpdate[]
): { writes: FirestoreWrite[]; found: Set<string> } {
  const index = indexOf(snapshot);
  const draft = new LevelsDraft(levelsPath, snapshot);
  const found = new Set<string>();
  for (const { elementId, due, start } of updates) {
    const loc = index.get(elementId);
    if (!loc) continue;
    const schedule = draft.schedule(loc.levelId);
    const next: ScheduleEntry = { ...schedule.get(elementId) };
    if (due === null) delete next.due;
    else if (due !== undefined) next.due = due;
    if (start === null) delete next.start;
    else if (start !== undefined) next.start = start;
    if (next.due || next.start) schedule.set(elementId, next);
    else schedule.delete(elementId);
    found.add(elementId);
  }
  return { writes: draft.toWrites(), found };
}

/**
 * auto_structure_thought / import_markdown_context 用。[forest]の最上位を
 * [targetParentId](nullなら最上位)の子の末尾へ足し、forest内で子を持つ
 * 要素の子一覧を新規作成する。挿入先の存在確認は呼び出し側で済ませること。
 */
export function buildLevelsAppendWrites(
  levelsPath: string,
  snapshot: LevelsSnapshot,
  forest: AppendableNode[],
  targetParentId: string | null,
  isTodo: boolean
): FirestoreWrite[] {
  const draft = new LevelsDraft(levelsPath, snapshot);
  const entryOf = (node: AppendableNode): LevelChildEntry => ({
    id: node.id,
    detail: node.detail,
    done: isTodo ? node.done : false,
  });
  for (const node of forest) {
    const levelId = node.parentId ?? targetParentId ?? "root";
    draft.children(levelId).push(entryOf(node));
    if (node.schedule) draft.schedule(levelId).set(node.id, node.schedule);
  }
  return draft.toWrites();
}

/**
 * move_element 用。[elementId](配下ごと)を[newParentId]の子の、[afterId]の
 * 直後(nullなら先頭)へ移す。[afterId]が移動先の子でなければ末尾へ置く。
 * 配下の子一覧ドキュメントはidが変わらないので触らない。
 */
export function buildLevelsMoveWrites(
  levelsPath: string,
  snapshot: LevelsSnapshot,
  elementId: string,
  newParentId: string | null,
  afterId: string | null
): FirestoreWrite[] {
  const index = indexOf(snapshot);
  const loc = index.get(elementId);
  if (!loc) {
    throw new Error(`elementId(${elementId})がこのマップに見つかりません。list_elementsで確認してください。`);
  }
  if (newParentId !== null && !index.has(newParentId)) {
    throw new Error(`newParentElementId(${newParentId})がこのマップに見つかりません。`);
  }
  if (newParentId !== null && subtreeIdsInLevels(snapshot, elementId).includes(newParentId)) {
    throw new Error("要素を自分自身の配下(子孫)の中へ移動することはできません。");
  }

  const draft = new LevelsDraft(levelsPath, snapshot);
  const from = draft.children(loc.levelId);
  const [entry] = from.splice(from.findIndex((c) => c.id === elementId), 1);
  // 日付も一緒に移す(同じ親の中の並べ替えなら、外して同じ所へ戻すだけ)
  const fromSchedule = draft.schedule(loc.levelId);
  const dates = fromSchedule.get(elementId);
  fromSchedule.delete(elementId);
  // リンクも一緒に移す
  const fromLinks = draft.links(loc.levelId);
  const linkTargets = fromLinks.get(elementId);
  fromLinks.delete(elementId);

  const toLevelId = newParentId ?? "root";
  const to = draft.children(toLevelId);
  if (dates) draft.schedule(toLevelId).set(elementId, dates);
  if (linkTargets) draft.links(toLevelId).set(elementId, linkTargets);
  const insertAt =
    afterId === null
      ? 0
      : (() => {
          const found = to.findIndex((c) => c.id === afterId);
          return found === -1 ? to.length : found + 1;
        })();
  to.splice(insertAt, 0, entry);
  return draft.toWrites();
}

/** delete_elements 用。[elementIds]を配下ごと消す。既に無いidは無視する。 */
export function buildLevelsDeleteWrites(
  levelsPath: string,
  snapshot: LevelsSnapshot,
  elementIds: string[]
): { writes: FirestoreWrite[]; deletedIds: Set<string> } {
  const index = indexOf(snapshot);
  const deletedIds = new Set<string>();
  for (const id of elementIds) {
    if (!index.has(id)) continue;
    for (const sub of subtreeIdsInLevels(snapshot, id)) deletedIds.add(sub);
  }

  const draft = new LevelsDraft(levelsPath, snapshot);
  for (const id of deletedIds) {
    const loc = index.get(id)!;
    // 親も消えるなら、親の子一覧ドキュメントごと消えるので書き換えない。
    if (loc.parentId !== null && deletedIds.has(loc.parentId)) continue;
    const list = draft.children(loc.levelId);
    list.splice(list.findIndex((c) => c.id === id), 1);
    draft.schedule(loc.levelId).delete(id);
    draft.links(loc.levelId).delete(id);
  }
  for (const id of deletedIds) draft.remove(id);
  return { writes: draft.toWrites(), deletedIds };
}

/**
 * header の linkCounts に書く要約: リンク先のキー(`uid:headerId`)-> そのマップへリンクして
 * いる要素の数。いま子一覧にある要素のリンクだけを数え、1つの要素が同じマップへ
 * 複数張っていても1つと数える(アプリの linkCountsOf と同じ)。
 */
export function linkCountsOfSnapshot(snapshot: LevelsSnapshot): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const level of snapshot.values()) {
    const ids = new Set(level.children.map((c) => c.id));
    for (const [id, targets] of level.links) {
      if (!ids.has(id)) continue;
      for (const key of new Set(targets.map((t) => `${t.uid}:${t.headerId}`))) {
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }
  }
  return counts;
}

/** [writes]を[snapshot]へ適用した後の状態(書き込みを組み立て直さず、要約の比較に使う)。 */
function applyWritesToSnapshot(levelsPath: string, snapshot: LevelsSnapshot, writes: FirestoreWrite[]): LevelsSnapshot {
  const after: LevelsSnapshot = new Map(snapshot);
  const prefix = `${levelsPath}/`;
  for (const write of writes) {
    if (!write.path.startsWith(prefix)) continue;
    const levelId = write.path.slice(prefix.length);
    if (write.delete) {
      after.delete(levelId);
      continue;
    }
    if (!write.fields) continue;
    const before = after.get(levelId);
    after.set(levelId, {
      children: write.fields.children !== undefined ? childrenOf(write.fields) : (before?.children ?? []),
      schedule: before?.schedule ?? new Map(),
      // links を書いていなければ、書き込み前のまま残る
      links: write.fields.links !== undefined ? linksOf(write.fields) : (before?.links ?? new Map()),
      updateTime: before?.updateTime,
    });
  }
  return after;
}

/**
 * [writes]でリンクの要約(linkCounts)が変わるときだけ、header への書き込みを足して返す
 * (変わらなければ[writes]のまま)。levels と同じコミットで書く。header は別ドキュメントなので、
 * levels の「同じドキュメントへ2件書かない」には触れない。
 */
export function withLinkSummary(
  headerPath: string,
  levelsPath: string,
  snapshot: LevelsSnapshot,
  writes: FirestoreWrite[]
): FirestoreWrite[] {
  const before = linkCountsOfSnapshot(snapshot);
  const after = linkCountsOfSnapshot(applyWritesToSnapshot(levelsPath, snapshot, writes));
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed = [...keys].some((k) => before[k] !== after[k]);
  // header は存在するときだけ書く(別の端末で消えたマップに、title も order も無い抜け殻を作らない)
  return changed ? [...writes, { path: headerPath, fields: { linkCounts: after }, requireExists: true }] : writes;
}
