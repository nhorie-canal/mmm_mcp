// levels移行: users/{uid}/headers/{headerId}/levels/{levelId} の読み書き。
// lib/matryoshka/levels_repository.dart(Dart側)と同じデータ形状を前提にする。
//
//   levels/{levelId}
//     children: [ { id, detail, done }, ... ]
//     schedule: { 子のid: { due?: {at, allDay}, start?: {at, allDay} }, ... }
//               (日付を持つ子だけ。docs/schedule.md §2)
//     links:    { 子のid: [ { uid, headerId }, ... ], ... }
//               (マップ間リンクを持つ子だけ。docs/map-links.md §8)
//
// levelIdはマップ最上位が'root'、それ以外はその要素自身のid。配列の並び順が
// そのまま兄弟順。子を持つ要素だけドキュメントが存在する(無ければ葉)。
//
// 書き込みは levelsOps.ts が行う。ここはデータ形状の解釈と読み取りだけを持つ。

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

/** 期日・着手日の1つ。終日(allDay)なら UTC の0時で持ち、UTC の日付として扱う。 */
export interface ScheduleDate {
  at: Date;
  allDay: boolean;
}

/** 子1件の期日・着手日。付けていない方はキーごと無い。 */
export interface ScheduleEntry {
  due?: ScheduleDate;
  start?: ScheduleDate;
}

function toScheduleDate(raw: unknown): ScheduleDate | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const obj = raw as Record<string, unknown>;
  if (!(obj.at instanceof Date) || typeof obj.allDay !== "boolean") return undefined;
  return { at: obj.at, allDay: obj.allDay };
}

/** levelsドキュメントの schedule を子のid -> 日付にする。形の崩れたもの・空のものは読み飛ばす。 */
export function scheduleOf(data: Record<string, unknown>): Map<string, ScheduleEntry> {
  const result = new Map<string, ScheduleEntry>();
  const raw = data.schedule;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return result;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) continue;
    const obj = value as Record<string, unknown>;
    const entry: ScheduleEntry = {};
    const due = toScheduleDate(obj.due);
    const start = toScheduleDate(obj.start);
    if (due) entry.due = due;
    if (start) entry.start = start;
    if (due || start) result.set(id, entry);
  }
  return result;
}

/** マップ間リンクの行き先。リンク先のマップの持ち主のuidと、そのマップのid。 */
export interface LinkTarget {
  uid: string;
  headerId: string;
}

/** levelsドキュメントの links を子のid -> リンク先にする。形の崩れたもの・空のもの・重複は読み飛ばす。 */
export function linksOf(data: Record<string, unknown>): Map<string, LinkTarget[]> {
  const result = new Map<string, LinkTarget[]>();
  const raw = data.links;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return result;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const targets: LinkTarget[] = [];
    for (const item of value) {
      if (typeof item !== "object" || item === null) continue;
      const obj = item as Record<string, unknown>;
      if (typeof obj.uid !== "string" || typeof obj.headerId !== "string") continue;
      if (targets.some((t) => t.uid === obj.uid && t.headerId === obj.headerId)) continue;
      targets.push({ uid: obj.uid, headerId: obj.headerId });
    }
    if (targets.length > 0) result.set(id, targets);
  }
  return result;
}

export interface ElementNode {
  id: string;
  detail: string;
  done: boolean;
  parentId: string | null;
  children: ElementNode[];
  /** 期日・着手日。日付を持たない要素には無い。 */
  schedule?: ScheduleEntry;
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
  /** 取り込む要素の期日・着手日(Markdownの 📅・🛫)。 */
  schedule?: ScheduleEntry;
}
