// Claude とやり取りする期日・着手日の文字列(docs/schedule.md §3 MCP)。
//   終日:   "2026-10-15"        UTC の0時として持ち、UTC の日付として書く
//   時刻付き: "2026-10-15 09:00"  MCP が動く PC の現地時刻
import type { ScheduleDate } from "./levels.js";

const PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/;

const pad = (n: number) => String(n).padStart(2, "0");

export function formatScheduleDate(date: ScheduleDate): string {
  const d = date.at;
  if (date.allDay) {
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

export function parseScheduleDate(text: string): ScheduleDate {
  const m = PATTERN.exec(text.trim());
  const invalid = () =>
    new Error(`日付「${text}」を読めません。終日なら "YYYY-MM-DD"、時刻付きなら "YYYY-MM-DD HH:mm" で指定してください。`);
  if (!m) throw invalid();
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const hasTime = m[4] !== undefined;
  const [h, mi] = hasTime ? [Number(m[4]), Number(m[5])] : [0, 0];
  if (h > 23 || mi > 59) throw invalid();
  const at = hasTime ? new Date(y, mo - 1, d, h, mi) : new Date(Date.UTC(y, mo - 1, d));
  // 2/30 のような存在しない日付は、Date が翌月へ繰り越すので突き合わせて弾く
  const [cy, cm, cd] = hasTime
    ? [at.getFullYear(), at.getMonth() + 1, at.getDate()]
    : [at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate()];
  if (cy !== y || cm !== mo || cd !== d) throw invalid();
  return { at, allDay: !hasTime };
}
