import { newDocId } from "./idGen.js";

// lib/markdown/markdown_import_parser.dart のTypeScript移植。
// アプリ本体のインポートと解析ロジックを一致させるため、構造・コメントも揃えている。

export interface MarkdownNode {
  id: string;
  detail: string;
  rawIndent: number;
  done: boolean;
  parentId: string | null;
  prevId: string | null;
  nextId: string | null;
  childId: string | null;
}

export interface ParsedMarkdown {
  nodes: MarkdownNode[];
  headingTitle: string | null;
  hasCheckbox: boolean;
}

const LIST_PATTERN = /^(\s*)(?:[-*+]|\d+\.)\s+(.+)$/;
const CHECKBOX_PATTERN = /^\[([ xX])\]\s*(.*)$/;
const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;

/**
 * Markdownテキストを解析して取り込める形の[MarkdownNode]の並びにする。
 *
 * `headingsAsNodes`は、見出しを1つの要素として取り込むか
 * (import_markdown_contextツールでは常にtrue相当、Claudeが組み立てた
 * 構造をそのまま反映するため)を切り替える。
 *
 * 署名行(`---`)より後は読み捨てる。エクスポートしたものを再度取り込んでも
 * 署名が要素として入らないようにするため。
 */
export function parseMarkdownForImport(
  markdownText: string,
  { headingsAsNodes }: { headingsAsNodes: boolean }
): ParsedMarkdown {
  const rawLines = markdownText.split(/\n?\n/);
  const lines: string[] = [];
  for (const line of rawLines) {
    if (line.trim() === "---") break;
    lines.push(line);
  }

  let headingTitle: string | null = null;
  for (const line of lines) {
    const trimLine = line.trim();
    if (trimLine.startsWith("# ")) {
      headingTitle = trimLine.substring(2).trim();
      break;
    } else if (trimLine.startsWith("## ")) {
      headingTitle = trimLine.substring(3).trim();
      break;
    }
  }

  const nodes: MarkdownNode[] = [];
  let currentNode: MarkdownNode | null = null;
  let hasCheckbox = false;

  for (const line of lines) {
    const match = LIST_PATTERN.exec(line);
    if (match) {
      const indentStr = match[1] ?? "";
      let detail = match[2] ?? "";
      const indent = indentStr.replace(/\t/g, "    ").length;

      let done = false;
      const checkboxMatch = CHECKBOX_PATTERN.exec(detail);
      if (checkboxMatch) {
        hasCheckbox = true;
        done = checkboxMatch[1].toLowerCase() === "x";
        detail = checkboxMatch[2] ?? "";
      }

      currentNode = {
        id: newDocId(),
        detail,
        rawIndent: indent,
        done,
        parentId: null,
        prevId: null,
        nextId: null,
        childId: null,
      };
      nodes.push(currentNode);
      continue;
    }

    const trimmed = line.trim();

    if (headingsAsNodes) {
      const headingMatch = HEADING_PATTERN.exec(trimmed);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const text = headingMatch[2].trim();
        if (text === "") continue;
        currentNode = {
          id: newDocId(),
          detail: text,
          rawIndent: level - 7,
          done: false,
          parentId: null,
          prevId: null,
          nextId: null,
          childId: null,
        };
        nodes.push(currentNode);
        continue;
      }
    }

    if (trimmed === "" || trimmed.startsWith("#")) continue;
    if (currentNode) {
      currentNode.detail += `\n${trimmed}`;
    }
  }

  buildRelations(nodes);

  return { nodes, headingTitle, hasCheckbox };
}

function buildRelations(nodes: MarkdownNode[]): void {
  if (nodes.length === 0) return;

  const uniqueIndents = [...new Set(nodes.map((n) => n.rawIndent))].sort((a, b) => a - b);
  const indentToDepth = new Map<number, number>();
  uniqueIndents.forEach((indent, i) => indentToDepth.set(indent, i));

  const lastNodeAtDepth = new Map<number, string>();
  const byId = new Map(nodes.map((n) => [n.id, n]));

  for (const node of nodes) {
    const depth = indentToDepth.get(node.rawIndent) ?? 0;

    if (depth > 0) {
      node.parentId = lastNodeAtDepth.get(depth - 1) ?? null;
    }

    const prevId = lastNodeAtDepth.get(depth);
    if (prevId !== undefined) {
      node.prevId = prevId;
      byId.get(prevId)!.nextId = node.id;
    } else if (node.parentId !== null) {
      byId.get(node.parentId)!.childId = node.id;
    }

    lastNodeAtDepth.set(depth, node.id);
    for (const key of [...lastNodeAtDepth.keys()]) {
      if (key > depth) lastNodeAtDepth.delete(key);
    }
  }
}
