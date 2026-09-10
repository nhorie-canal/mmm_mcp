// users/{uid}/headers/{headerId}/bodies/{bodyId} の1要素。
// prev/next/parent/childで連結リストを組む(lib/domain/matryoshka.dartと同じ構造)。
export interface BodyDoc {
  id: string;
  detail: string;
  prev: string | null;
  next: string | null;
  parent: string | null;
  child: string | null;
  /** 生の値をそのまま返す。祖先チェックの解釈はツールの説明文を通じて呼び出し側に委ねる。 */
  done: boolean;
  /**
   * 読み取り時点のFirestoreのupdateTime。連結リスト(prev/next/child)を
   * 書き換えるときの楽観的ロック(FirestoreWrite.requireUpdateTime)に使う。
   */
  updateTime?: string;
}

export function bodyFromFirestore(
  id: string,
  data: Record<string, unknown>,
  updateTime?: string
): BodyDoc {
  return {
    id,
    detail: String(data.detail ?? ""),
    prev: (data.prev as string | null | undefined) ?? null,
    next: (data.next as string | null | undefined) ?? null,
    parent: (data.parent as string | null | undefined) ?? null,
    child: (data.child as string | null | undefined) ?? null,
    done: Boolean(data.done ?? false),
    updateTime,
  };
}

/** 親(parentId)の子から辿れる順序どおりの配列に組み立てる。深さ優先。 */
export interface ElementNode {
  id: string;
  detail: string;
  done: boolean;
  parentId: string | null;
  children: ElementNode[];
}

/**
 * 壊れている(prev/nextが循環・欠落している)データでも、要素を1件も
 * 落とさずに返す。壊れ方の修復はアプリ本体(MatryoshkaModel.repair)の
 * 役目であり、ここでは読み取り専用なので直さず、可能な範囲で順序を
 * 復元しつつ全件を出す。
 */
export function buildTree(bodies: BodyDoc[]): ElementNode[] {
  const globalVisited = new Set<string>();

  function orderedChildrenOf(parentId: string | null): BodyDoc[] {
    const siblings = bodies.filter((b) => b.parent === parentId);
    if (siblings.length === 0) return [];
    const bySelfId = new Map(siblings.map((b) => [b.id, b]));
    const head = siblings.find((b) => b.prev === null || !bySelfId.has(b.prev!));

    const ordered: BodyDoc[] = [];
    const seen = new Set<string>();
    let current = head?.id ?? null;
    while (current !== null && !seen.has(current)) {
      const node = bySelfId.get(current);
      if (!node) break;
      seen.add(current);
      ordered.push(node);
      current = node.next;
    }
    // next/prevの循環や分断で辿れなかった残りも、無くさず末尾に足す。
    for (const s of siblings) {
      if (!seen.has(s.id)) ordered.push(s);
    }
    return ordered;
  }

  function walk(parentId: string | null): ElementNode[] {
    const result: ElementNode[] = [];
    for (const node of orderedChildrenOf(parentId)) {
      if (globalVisited.has(node.id)) continue; // 循環参照からの二重取り込みを防ぐ
      globalVisited.add(node.id);
      result.push({
        id: node.id,
        detail: node.detail,
        done: node.done,
        parentId: node.parent,
        children: walk(node.id),
      });
    }
    return result;
  }

  const tree = walk(null);
  // parentが存在しない要素を指している等で上のwalkから漏れた要素も、
  // 最上位に足しておく(取りこぼしが無いことを優先する)。
  for (const b of bodies) {
    if (!globalVisited.has(b.id)) {
      globalVisited.add(b.id);
      tree.push({ id: b.id, detail: b.detail, done: b.done, parentId: b.parent, children: [] });
    }
  }
  return tree;
}

/** ルートから[elementId]までの祖先(自分自身を含む)のdetailを、根から順に並べる。 */
export function ancestorDetails(bodies: BodyDoc[], elementId: string | null): string[] {
  if (elementId === null) return [];
  const byId = new Map(bodies.map((b) => [b.id, b]));
  const chain: string[] = [];
  let current: string | null = elementId;
  const seen = new Set<string>();
  while (current !== null && byId.has(current) && !seen.has(current)) {
    seen.add(current);
    const node: BodyDoc = byId.get(current)!;
    chain.push(node.detail);
    current = node.parent;
  }
  return chain.reverse();
}

/** [parentId]の子の連結リストの末尾のIDを求める。子が無ければnull。 */
export function lastChildOf(bodies: BodyDoc[], parentId: string | null): string | null {
  const siblings = bodies.filter((b) => b.parent === parentId);
  if (siblings.length === 0) return null;
  const byId = new Map(siblings.map((b) => [b.id, b]));
  let current = siblings.find((b) => b.prev === null || !byId.has(b.prev!)) ?? siblings[0];
  const seen = new Set<string>([current.id]);
  while (current.next !== null && byId.has(current.next) && !seen.has(current.next)) {
    current = byId.get(current.next)!;
    seen.add(current.id);
  }
  return current.id;
}

/**
 * [rootId]自身とその配下(子孫)全ての id を集める。move/deleteのように
 * 「要素ごと配下を丸ごと動かす・消す」操作の対象範囲を求めるために使う。
 * 循環参照があっても無限ループしない。
 */
export function collectSubtreeIds(bodies: BodyDoc[], rootId: string): string[] {
  const byParent = new Map<string | null, BodyDoc[]>();
  for (const b of bodies) {
    const list = byParent.get(b.parent) ?? [];
    list.push(b);
    byParent.set(b.parent, list);
  }
  const result: string[] = [];
  const seen = new Set<string>();
  function walk(id: string): void {
    if (seen.has(id)) return;
    seen.add(id);
    result.push(id);
    for (const child of byParent.get(id) ?? []) {
      walk(child.id);
    }
  }
  walk(rootId);
  return result;
}
