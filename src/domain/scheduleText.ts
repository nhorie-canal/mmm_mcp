// Claude とやり取りする期日・着手日の文字列(docs/schedule.md §3 MCP)。
//   終日:   "2026-10-15"        UTC の0時として持ち、UTC の日付として書く
//   時刻付き: "2026-10-15 09:00"  アプリで設定しているタイムゾーン（users/{uid}/private/profile の timeZone）の時刻。
//                                 タイムゾーンが分からないときはサーバーの時刻
import type { ScheduleDate } from "./levels.js";

const PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/;

const pad = (n: number) => String(n).padStart(2, "0");

/** IANA のタイムゾーン名として使えるか。使えない・未指定は undefined（サーバーの時刻）にする。 */
export function validTimeZone(name: string | null | undefined): string | undefined {
  if (!name) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return name;
  } catch {
    return undefined;
  }
}

interface Parts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
}

/** [date] をそのタイムゾーンの壁時計に直す。未指定はサーバーの時刻。 */
export function zonedParts(date: Date, timeZone?: string): Parts {
  if (!timeZone) {
    return { y: date.getFullYear(), mo: date.getMonth() + 1, d: date.getDate(), h: date.getHours(), mi: date.getMinutes() };
  }
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  });
  const get = (type: string) => Number(f.formatToParts(date).find((p) => p.type === type)!.value);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour"), mi: get("minute") };
}

/** そのタイムゾーンの壁時計 [y-mo-d h:mi] の瞬間。存在しない時刻（夏時間の隙間）は後ろへずらす。 */
function zonedTimeToDate(y: number, mo: number, d: number, h: number, mi: number, timeZone?: string): Date {
  if (!timeZone) return new Date(y, mo - 1, d, h, mi);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  const offsetAt = (t: number) => {
    const p = zonedParts(new Date(t), timeZone);
    return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - t;
  };
  // 時差は夏時間の切り替わりで変わるので、2回で収束させる
  let guess = asUtc - offsetAt(asUtc);
  guess = asUtc - offsetAt(guess);
  return new Date(guess);
}

export function formatScheduleDate(date: ScheduleDate, timeZone?: string): string {
  const d = date.at;
  if (date.allDay) {
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const p = zonedParts(d, timeZone);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}`;
}

export function parseScheduleDate(text: string, timeZone?: string): ScheduleDate {
  const m = PATTERN.exec(text.trim());
  const invalid = () =>
    new Error(`日付「${text}」を読めません。終日なら "YYYY-MM-DD"、時刻付きなら "YYYY-MM-DD HH:mm" で指定してください。`);
  if (!m) throw invalid();
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const hasTime = m[4] !== undefined;
  const [h, mi] = hasTime ? [Number(m[4]), Number(m[5])] : [0, 0];
  if (h > 23 || mi > 59) throw invalid();
  // 2/30 のような存在しない日付は、Date が翌月へ繰り越すので突き合わせて弾く
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() + 1 !== mo || check.getUTCDate() !== d) throw invalid();
  const at = hasTime ? zonedTimeToDate(y, mo, d, h, mi, timeZone) : check;
  return { at, allDay: !hasTime };
}
