import { newDocId } from "./idGen.js";
import { lastChildOf, type BodyDoc } from "./body.js";
import type { FirestoreWrite } from "../firestore/restClient.js";

/** Claudeが渡す任意深さのツリー入力(auto_structure_thoughtツール)。 */
export interface TreeInputNode {
  detail: string;
  done?: boolean;
  children?: TreeInputNode[];
}

export interface FlatNode {
  id: string;
  detail: string;
  done: boolean;
  parentId: string | null;
  prevId: string | null;
  nextId: string | null;
  childId: string | null;
}

/** ネストしたツリー入力を、ID採番済み・prev/next/parent/child関係を組んだ配列に変換する。 */
export function buildForestFromTree(roots: TreeInputNode[]): FlatNode[] {
  const all: FlatNode[] = [];

  function build(inputNodes: TreeInputNode[], parentId: string | null): FlatNode[] {
    const level: FlatNode[] = [];
    for (const input of inputNodes) {
      const node: FlatNode = {
        id: newDocId(),
        detail: input.detail,
        done: input.done ?? false,
        parentId,
        prevId: null,
        nextId: null,
        childId: null,
      };
      all.push(node);
      level.push(node);
      if (input.children && input.children.length > 0) {
        const childLevel = build(input.children, node.id);
        node.childId = childLevel[0].id;
      }
    }
    for (let i = 1; i < level.length; i++) {
      level[i].prevId = level[i - 1].id;
      level[i - 1].nextId = level[i].id;
    }
    return level;
  }

  build(roots, null);
  return all;
}

/**
 * 組み立てたforest(森)を、既存の要素の[targetParentId]配下の末尾に連結する
 * ためのFirestore書き込み一覧を作る。auto_structure_thought /
 * import_markdown_context の両方から共通で使う。
 *
 * `isTodo`がfalseのマップでは、doneは常にfalseとして書き込む
 * (MatryoshkaModel.importMarkdownと同じ挙動)。
 */
export function buildAppendWrites(
  bodiesPath: string,
  existingBodies: BodyDoc[],
  forest: FlatNode[],
  targetParentId: string | null,
  isTodo: boolean
): { writes: FirestoreWrite[]; createdIds: string[] } {
  const roots = forest.filter((n) => n.parentId === null);
  const last = lastChildOf(existingBodies, targetParentId);

  if (roots.length > 0) {
    roots[0].prevId = last;
  }

  const writes: FirestoreWrite[] = forest.map((node) => ({
    path: `${bodiesPath}/${node.id}`,
    fields: {
      detail: node.detail,
      parent: node.parentId ?? targetParentId,
      prev: node.prevId,
      next: node.nextId,
      child: node.childId,
      done: isTodo ? node.done : false,
    },
  }));

  if (roots.length > 0) {
    if (last !== null) {
      // 末尾要素のnextを書き換える。読み取り後に他の操作(並行するappendや
      // アプリ操作)がこの要素を書き換えていた場合、requireUpdateTimeにより
      // FAILED_PRECONDITIONで失敗する(呼び出し側はrunOptimisticで読み取り
      // からやり直す)。
      const lastBody = existingBodies.find((b) => b.id === last);
      writes.push({
        path: `${bodiesPath}/${last}`,
        fields: { next: roots[0].id },
        requireUpdateTime: lastBody?.updateTime,
      });
    } else if (targetParentId !== null) {
      const parentBody = existingBodies.find((b) => b.id === targetParentId);
      writes.push({
        path: `${bodiesPath}/${targetParentId}`,
        fields: { child: roots[0].id },
        requireUpdateTime: parentBody?.updateTime,
      });
    }
  }

  return { writes, createdIds: forest.map((n) => n.id) };
}
