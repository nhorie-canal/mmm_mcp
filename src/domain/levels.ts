// levels移行: users/{uid}/headers/{headerId}/levels/{levelId} の読み書き。
// lib/matryoshka/levels_repository.dart(Dart側)と同じデータ形状を前提にする。
//
//   levels/{levelId}
//     children: [ { id, detail, done }, ... ]
//
// levelIdはマップ最上位が'root'、それ以外はその要素自身のid。配列の並び順が
// そのまま兄弟順。子を持つ要素だけドキュメントが存在する(無ければ葉)。
//
// MCPは「新形式のみ対応」(移行ロジックはDart側だけに持たせる)。levels/root
// が無いマップに対する操作は、アプリで一度開いてもらうよう案内して止める。

import type { FirestoreRestClient, FirestoreWrite } from "../firestore/restClient.js";

export interface LevelChildEntry {
  id: string;
  detail: string;
  done: boolean;
}

export class LevelsNotInitializedError extends Error {
  constructor(title: string) {
    super(
      `「${title}」はまだ新形式(levels)のデータがありません。` +
        "お手数ですが、アプリでこのマップを一度開いてから、もう一度お試しください。"
    );
    this.name = "LevelsNotInitializedError";
  }
}

function toEntry(raw: unknown): LevelChildEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== "string") return null;
  return {
    id: obj.id,
    detail: String(obj.detail ?? ""),
    done: Boolean(obj.done ?? false),
  };
}

function childrenOf(data: Record<string, unknown>): LevelChildEntry[] {
  const raw = data.children;
  if (!Array.isArray(raw)) return [];
  const result: LevelChildEntry[] = [];
  for (const entry of raw) {
    const parsed = toEntry(entry);
    if (parsed) result.push(parsed);
  }
  return result;
}

/** levels配下の全ドキュメントを読み、levelId -> children[] のMapにする。 */
export async function readAllLevelDocs(
  client: FirestoreRestClient,
  levelsPath: string
): Promise<Map<string, LevelChildEntry[]>> {
  const docs = await client.listDocuments(levelsPath);
  const result = new Map<string, LevelChildEntry[]>();
  for (const doc of docs) {
    result.set(doc.id, childrenOf(doc.data));
  }
  return result;
}

/** levels/rootが無ければ、アプリで開いてもらうよう案内して止める。 */
export function assertLevelsInitialized(
  levelsById: Map<string, LevelChildEntry[]>,
  mapTitle: string
): void {
  if (!levelsById.has("root")) {
    throw new LevelsNotInitializedError(mapTitle);
  }
}

/**
 * [levelId]のlevelsドキュメントが存在するかだけを軽く確認する。
 * 「levels/rootが無ければ止める」ような存在チェックのためだけに
 * readAllLevelDocs(コレクション全体のページング読み取り)を使うのは、
 * 子を多く持つ大きなマップほど無駄が大きい。1件のgetDocumentで足りる
 * 場面(list_elementsのようにツリー全体が実際に必要な場合を除く)は
 * こちらを使うこと。
 */
export async function levelsDocExists(
  client: FirestoreRestClient,
  levelsPath: string,
  levelId: string
): Promise<boolean> {
  return (await client.getDocument(`${levelsPath}/${levelId}`)) !== null;
}

/** [levelsDocExists]の結果を見て、levels/rootが無ければ止める。 */
export function assertLevelsRootExists(rootExists: boolean, mapTitle: string): void {
  if (!rootExists) {
    throw new LevelsNotInitializedError(mapTitle);
  }
}

export interface ElementNode {
  id: string;
  detail: string;
  done: boolean;
  parentId: string | null;
  children: ElementNode[];
}

/**
 * 'root'から再帰的にlevelsを展開してツリーを組み立てる(bodies版buildTreeの
 * levels版)。levelsは配列そのものが順序を表すため、連結リストの再構築や
 * 分断の復元は不要。循環参照だけは防御的に検出して打ち切る。
 */
export function buildTreeFromLevels(levelsById: Map<string, LevelChildEntry[]>): ElementNode[] {
  function walk(levelId: string, parentId: string | null, ancestry: Set<string>): ElementNode[] {
    const children = levelsById.get(levelId) ?? [];
    const nextAncestry = new Set(ancestry);
    nextAncestry.add(levelId);
    return children.map((entry) => {
      const hasOwnChildren = levelsById.has(entry.id) && !ancestry.has(entry.id);
      return {
        id: entry.id,
        detail: entry.detail,
        done: entry.done,
        parentId,
        children: hasOwnChildren ? walk(entry.id, entry.id, nextAncestry) : [],
      };
    });
  }
  return walk("root", null, new Set());
}

/** auto_structure_thought / import_markdown_context が渡すforestの共通形状。 */
export interface AppendableNode {
  id: string;
  detail: string;
  done: boolean;
  parentId: string | null;
}

/**
 * forest(bodies用のbuildAppendWritesと同じ入力)から、levels側の書き込み
 * 一覧を組み立てる。forest内で子を持つノードごとに levels/{id} を新規作成し、
 * forestの最上位(ルート)群は挿入先(targetParentId ?? 'root')の既存配列へ
 * 追記する。[targetHasExistingChildren]は、bodies側でlastChildOfが返した
 * 値がnullでなかったか(＝挿入先が既に子を持っていたか)をそのまま渡すこと。
 */
export function buildAppendLevelWrites(
  levelsPath: string,
  forest: AppendableNode[],
  targetParentId: string | null,
  targetHasExistingChildren: boolean,
  isTodo: boolean
): FirestoreWrite[] {
  const writes: FirestoreWrite[] = [];
  const byParent = new Map<string | null, AppendableNode[]>();
  for (const node of forest) {
    const list = byParent.get(node.parentId) ?? [];
    list.push(node);
    byParent.set(node.parentId, list);
  }

  const entryOf = (node: AppendableNode) => ({
    id: node.id,
    detail: node.detail,
    done: isTodo ? node.done : false,
  });

  // forest内で子を持つノードは全て新規作成なので、既存のlevels/{id}と
  // 衝突することはない(既存ドキュメントは無いはず)。
  for (const [parentId, children] of byParent) {
    if (parentId === null) continue; // ルート群は下で挿入先へ追記する
    writes.push({
      path: `${levelsPath}/${parentId}`,
      fields: { children: children.map(entryOf) },
    });
  }

  const roots = byParent.get(null) ?? [];
  if (roots.length > 0) {
    const targetLevelId = targetParentId ?? "root";
    if (targetHasExistingChildren) {
      writes.push({
        path: `${levelsPath}/${targetLevelId}`,
        arrayUnion: { field: "children", values: roots.map(entryOf) },
      });
    } else {
      writes.push({
        path: `${levelsPath}/${targetLevelId}`,
        fields: { children: roots.map(entryOf) },
      });
    }
  }

  return writes;
}

/**
 * update_task_status用。[updates]を親ごとにグループ化し、levelsドキュメントを
 * 親ごとに1回だけ読んで該当エントリを書き換えた配列を書き戻すFirestoreWrite[]
 * を組み立てる(Dart版LevelsRepository.updateChildと同じ「読んで置換」方式)。
 * 該当ドキュメントや該当エントリが見つからない場合は、その分だけ静かに
 * スキップする(levelsはbest-effortの書き込みで、失敗しても実害は無いため)。
 */
export async function buildUpdateEntryWrites(
  client: FirestoreRestClient,
  levelsPath: string,
  updates: Array<{ parentId: string | null; elementId: string; patch: Partial<LevelChildEntry> }>
): Promise<FirestoreWrite[]> {
  const byLevelId = new Map<string, Array<{ elementId: string; patch: Partial<LevelChildEntry> }>>();
  for (const update of updates) {
    const levelId = update.parentId ?? "root";
    const list = byLevelId.get(levelId) ?? [];
    list.push({ elementId: update.elementId, patch: update.patch });
    byLevelId.set(levelId, list);
  }

  const writes: FirestoreWrite[] = [];
  for (const [levelId, group] of byLevelId) {
    const doc = await client.getDocument(`${levelsPath}/${levelId}`);
    if (!doc) continue;
    const children = childrenOf(doc.data);
    for (const { elementId, patch } of group) {
      const index = children.findIndex((c) => c.id === elementId);
      if (index === -1) continue;
      children[index] = { ...children[index], ...patch };
    }
    writes.push({ path: `${levelsPath}/${levelId}`, fields: { children } });
  }
  return writes;
}
