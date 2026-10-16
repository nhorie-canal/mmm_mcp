import type { FirestoreDoc, FirestoreWrite } from "../firestore/restClient.js";

/** 自分のマップ1つ分の、一覧の並びに関わる値。 */
export interface HeaderOrderEntry {
  id: string;
  order: number;
}

/**
 * 新しいマップを一覧の先頭に置くとき、既存の自分のマップの`order`を
 * どう書き換えるかを計算する(Firestoreに触れない)。
 * lib/header_list/header_order.dart の prependedHeaderOrders と同じ考え方。
 *
 * 新しいマップを1にし、既存はアプリの一覧と同じ並び(orderの昇順、
 * 同値はドキュメントidの順)のまま2..n+1に振り直す。値が変わるものだけを返す。
 * 欠番と重複もこの1回で解消する。
 */
export function prependedHeaderOrders(entries: HeaderOrderEntry[]): HeaderOrderEntry[] {
  const sorted = [...entries].sort((a, b) =>
    a.order !== b.order ? a.order - b.order : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  );
  const updates: HeaderOrderEntry[] = [];
  sorted.forEach((entry, position) => {
    if (entry.order !== position + 2) updates.push({ id: entry.id, order: position + 2 });
  });
  return updates;
}

/**
 * create_map の書き込み一式。既存の自分のマップを2..n+1に振り直し、新しいマップを
 * order 1 で作る。order を持たないマップは一覧に出ないので触らない。
 * 振り直しは読んだ時点の updateTime を前提条件にする(読んだ後に別の端末で消された
 * マップを、order だけのドキュメントとして作り直さないため)。
 */
export function buildCreateMapWrites(
  headersPath: string,
  existing: FirestoreDoc[],
  headerId: string,
  title: string,
  isTodo: boolean
): FirestoreWrite[] {
  const updateTimes = new Map(existing.map((doc) => [doc.id, doc.updateTime]));
  const shifts = prependedHeaderOrders(
    existing
      .filter((doc) => typeof doc.data.order === "number")
      .map((doc) => ({ id: doc.id, order: doc.data.order as number }))
  );
  const headerPath = `${headersPath}/${headerId}`;
  return [
    ...shifts.map((s) => ({
      path: `${headersPath}/${s.id}`,
      fields: { order: s.order },
      requireUpdateTime: updateTimes.get(s.id),
    })),
    { path: headerPath, fields: { title, order: 1, isTodo, editors: [], viewers: [] } },
    { path: `${headerPath}/levels/root`, fields: { children: [] } },
  ];
}
