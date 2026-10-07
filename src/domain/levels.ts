// levels移行: users/{uid}/headers/{headerId}/levels/{levelId} の読み書き。
// lib/matryoshka/levels_repository.dart(Dart側)と同じデータ形状を前提にする。
//
//   levels/{levelId}
//     children: [ { id, detail, done }, ... ]
//
// levelIdはマップ最上位が'root'、それ以外はその要素自身のid。配列の並び順が
// そのまま兄弟順。子を持つ要素だけドキュメントが存在する(無ければ葉)。
//
// 書き込みは levelsOps.ts が行う。ここはデータ形状の解釈と読み取りだけを持つ。

import type { FirestoreRestClient } from "../firestore/restClient.js";

export interface LevelChildEntry {
  id: string;
  detail: string;
  done: boolean;
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

export function childrenOf(data: Record<string, unknown>): LevelChildEntry[] {
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

export interface ElementNode {
  id: string;
  detail: string;
  done: boolean;
  parentId: string | null;
  children: ElementNode[];
}

/**
 * 'root'から再帰的にlevelsを展開してツリーを組み立てる。levelsは配列そのものが
 * 順序を表すため、並び順の再構築は不要。循環参照だけは防御的に検出して打ち切る。
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
