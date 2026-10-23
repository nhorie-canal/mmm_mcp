import { newDocId } from "./idGen.js";
import type { ScheduleEntry } from "./levels.js";
import { parseScheduleDate } from "./scheduleText.js";

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
  /** 1行目の 📅(期日)・🛫(着手日)から読んだ日付。無ければundefined。 */
  schedule?: ScheduleEntry;
}

export interface ParsedMarkdown {
  nodes: MarkdownNode[];
  headingTitle: string | null;
  hasCheckbox: boolean;
}

const LIST_PATTERN = /^(\s*)(?:[-*+]|\d+\.)\s+(.+)$/;
const CHECKBOX_PATTERN = /^\[([ xX])\]\s*(.*)$/;
const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;
// Obsidian Tasks の書き方(docs/schedule.md §7)。時刻付きは日付のあとに続ける。
const SCHEDULE_PATTERN = /\s*(📅|🛫)\s*(\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?)/gu;

/** 要素の1行目から 📅・🛫 の日付を取り出す。読めない日付は本文に残す。 */
function extractSchedule(detail: string): { detail: string; schedule?: ScheduleEntry } {
  const schedule: ScheduleEntry = {};
  const rest = detail.replace(SCHEDULE_PATTERN, (whole, mark: string, text: string) => {
    try {
      schedule[mark === "📅" ? "due" : "start"] = parseScheduleDate(text);
      return "";
    } catch {
      return whole;
    }
  });
  return schedule.due || schedule.start ? { detail: rest.trim(), schedule } : { detail };
}

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
  // Windows(CRLF)・古い Mac(CR)の改行は LF にそろえる。`\r`が行末に残ると、
  // 行の終わりを`$`で見る箇条書き・見出しの判定に1行も合わず、何も取り込めない。
  const rawLines = markdownText.replace(/\r\n?/g, "\n").split(/\n?\n/);
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

      const extracted = extractSchedule(detail);
      currentNode = {
        id: newDocId(),
        detail: extracted.detail,
        rawIndent: indent,
        done,
        parentId: null,
        prevId: null,
        nextId: null,
        childId: null,
        ...(extracted.schedule ? { schedule: extracted.schedule } : {}),
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
