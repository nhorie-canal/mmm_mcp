import { newDocId } from "./idGen.js";

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
