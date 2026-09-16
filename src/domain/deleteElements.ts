import type { BodyDoc } from "./body.js";
import { collectSubtreeIds } from "./body.js";
import { buildRemoveChildrenWrite } from "./levels.js";
import type { FirestoreRestClient, FirestoreWrite } from "../firestore/restClient.js";
import { mergeWritesByPath } from "../firestore/restClient.js";

export interface DeleteElementWritesResult {
  writes: FirestoreWrite[];
  /** 実際に消える全要素のid(指定した要素+配下)。 */
  deletedIds: Set<string>;
}

/**
 * [elementIds](配下ごと)を削除するための書き込みを組み立てる。tools/deleteElements.tsから
 * 切り出した純粋寄りの関数(client.getDocumentだけ呼ぶ)。
 *
 * 1周目で消える要素を全て確定させてから2周目で繋ぎ直すのは、隣り合う要素を
 * 同時に消すとき、1件ずつその場で繋ぎ直すと消える予定の相手を指すポインタを
 * 書いてしまい、存在しないIDを指したまま残る不具合(実データで発生)を防ぐため。
 */
export async function buildDeleteElementWrites(
  client: FirestoreRestClient,
  bodiesPath: string,
  levelsPath: string,
  currentBodies: BodyDoc[],
  elementIds: string[]
): Promise<DeleteElementWritesResult> {
  const currentById = new Map(currentBodies.map((b) => [b.id, b]));
  const writes: FirestoreWrite[] = [];
  const levelRemovals = new Map<string, string[]>();
  const allIds = new Set<string>();

  // 1周目: 消える要素を全て確定させる。繋ぎ直しは2周目で行う。
  for (const elementId of elementIds) {
    const body = currentById.get(elementId);
    if (!body) continue; // 既に削除済み(リトライ時など)
    const subtree = collectSubtreeIds(currentBodies, elementId);
    for (const id of subtree) allIds.add(id);
  }

  /** [startId]から[key]方向へ、消えない要素に当たるまで辿る。 */
  const survivingNeighbor = (startId: string | null, key: "prev" | "next"): string | null => {
    let cursor = startId;
    const seen = new Set<string>();
    while (cursor !== null && allIds.has(cursor) && !seen.has(cursor)) {
      seen.add(cursor);
      cursor = currentById.get(cursor)?.[key] ?? null;
    }
    return cursor;
  };

  // 2周目: 生き残る要素どうしを繋ぎ直す。
  for (const elementId of elementIds) {
    const body = currentById.get(elementId);
    if (!body) continue;
    const newPrev = survivingNeighbor(body.prev, "prev");
    const newNext = survivingNeighbor(body.next, "next");
    if (newPrev !== null) {
      writes.push({
        path: `${bodiesPath}/${newPrev}`,
        fields: { next: newNext },
        requireUpdateTime: currentById.get(newPrev)?.updateTime,
      });
    } else if (body.parent !== null && !allIds.has(body.parent)) {
      writes.push({
        path: `${bodiesPath}/${body.parent}`,
        fields: { child: newNext },
        requireUpdateTime: currentById.get(body.parent)?.updateTime,
      });
    }
    if (newNext !== null) {
      writes.push({
        path: `${bodiesPath}/${newNext}`,
        fields: { prev: newPrev },
        requireUpdateTime: currentById.get(newNext)?.updateTime,
      });
    }
    const levelId = body.parent ?? "root";
    const list = levelRemovals.get(levelId) ?? [];
    list.push(elementId);
    levelRemovals.set(levelId, list);
  }

  for (const id of allIds) {
    writes.push({ path: `${bodiesPath}/${id}`, delete: true });
    // 配下の要素が子を持っていた場合、そのlevelsドキュメント自体も消す。
    // 存在しないドキュメントへのdeleteはFirestoreでは無害。
    writes.push({ path: `${levelsPath}/${id}`, delete: true });
  }
  for (const [levelId, removeIds] of levelRemovals) {
    // 親自身も消えるなら、levels/{親} は上のdeleteで消える。
    // ここで書き戻すと、消したドキュメントが中身入りで復活する。
    if (allIds.has(levelId)) continue;
    const write = await buildRemoveChildrenWrite(client, levelsPath, levelId, removeIds);
    if (write) writes.push(write);
  }

  return { writes: mergeWritesByPath(writes), deletedIds: allIds };
}
