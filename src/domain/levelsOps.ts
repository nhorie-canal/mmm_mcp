// levelsコレクションの読み取り結果から、要素を探して書き換える書き込みを組み立てる。
//
// どの操作も「levels全件の読み取り結果(LevelsSnapshot)」を受け取る純粋関数で、
// 触った子一覧を作業用に複製して編集し、最後に元の状態との差分から
// 書き込みを組み立てる。1つのドキュメントへの書き込みは必ず1件になる
// (同じpathへ2件積むと後勝ちになり、要素の重複や復活が起きる)。
//
// 子を持たなくなった要素の子一覧ドキュメントは消す(アプリのprojectLevelsと
// 同じ扱い)。rootだけは空配列で残す。

import type { FirestoreDoc, FirestoreRestClient, FirestoreWrite } from "../firestore/restClient.js";
import { childrenOf, type AppendableNode, type LevelChildEntry } from "./levels.js";

export interface LevelDocState {
  children: LevelChildEntry[];
  updateTime?: string;
}

/** levelId('root'またはその要素のid) -> 子一覧。 */
export type LevelsSnapshot = Map<string, LevelDocState>;

export function levelsSnapshotFromDocs(docs: FirestoreDoc[]): LevelsSnapshot {
  return new Map(docs.map((d) => [d.id, { children: childrenOf(d.data), updateTime: d.updateTime }]));
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

/** 編集中の子一覧。触ったものだけを複製して持ち、最後に差分を書き込みにする。 */
class LevelsDraft {
  private readonly edited = new Map<string, LevelChildEntry[]>();
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
      this.removed.delete(levelId);
    }
    return list;
  }

  /** 子一覧ドキュメントごと消す(配下ごと削除される要素の分)。 */
  remove(levelId: string): void {
    this.edited.delete(levelId);
    this.removed.add(levelId);
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
      writes.push(
        original
          ? { path: pathOf(levelId), fields: { children }, requireUpdateTime: original.updateTime }
          : { path: pathOf(levelId), fields: { children }, requireMissing: true }
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
    draft.children(node.parentId ?? targetParentId ?? "root").push(entryOf(node));
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

  const to = draft.children(newParentId ?? "root");
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
  }
  for (const id of deletedIds) draft.remove(id);
  return { writes: draft.toWrites(), deletedIds };
}
