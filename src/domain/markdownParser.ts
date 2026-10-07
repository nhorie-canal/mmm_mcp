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
  // 親は「自分より字下げが浅い直近の要素」とする。字下げの幅(2・4・タブ)は
  // 浅い深いの比較にしか使わないので、刻み幅が混ざっても同じ結果になる。
  // 段を飛ばした字下げ(`#`の直下の`-`、字下げのばらつき)でも必ず
  // どこかへ繋がり、親も前の兄弟も無い要素ができない。

  // 祖先の並び。末尾が直前の要素で、字下げは末尾ほど深い。
  const ancestors: MarkdownNode[] = [];
  // 親のID(最上位はnull)ごとの、いちばん後ろの子。
  const lastChildOf = new Map<string | null, MarkdownNode>();

  for (const node of nodes) {
    while (ancestors.length > 0 && ancestors[ancestors.length - 1].rawIndent >= node.rawIndent) {
      ancestors.pop();
    }
    const parent = ancestors.length > 0 ? ancestors[ancestors.length - 1] : null;
    node.parentId = parent?.id ?? null;

    const prev = lastChildOf.get(node.parentId);
    if (prev !== undefined) {
      node.prevId = prev.id;
      prev.nextId = node.id;
    } else if (parent !== null) {
      parent.childId = node.id;
    }

    lastChildOf.set(node.parentId, node);
    ancestors.push(node);
  }
}
