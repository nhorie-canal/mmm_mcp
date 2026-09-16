import type { BodyDoc } from "./body.js";
import { buildInsertChildWrite, buildReorderChildWrite, buildRemoveChildrenWrite } from "./levels.js";
import type { FirestoreRestClient, FirestoreWrite } from "../firestore/restClient.js";
import { mergeWritesByPath } from "../firestore/restClient.js";

/**
 * 要素1件(配下ごと)を新しい場所へ移動するための書き込みを組み立てる。
 * tools/moveElement.tsから切り出した純粋寄りの関数(client.getDocumentだけ呼ぶ)。
 * 呼び出し側で自己参照・循環などのバリデーションを済ませ、[elementId]が
 * [existingBodies]に存在することを保証しておくこと。
 */
export async function buildMoveElementWrites(
  client: FirestoreRestClient,
  bodiesPath: string,
  levelsPath: string,
  existingBodies: BodyDoc[],
  elementId: string,
  newParentElementId: string | null,
  afterElementId: string | null
): Promise<FirestoreWrite[]> {
  const byId = new Map(existingBodies.map((b) => [b.id, b]));
  const body = byId.get(elementId);
  if (!body) {
    throw new Error(`elementId(${elementId})がこのマップに見つかりません。`);
  }

  const writes: FirestoreWrite[] = [];

  // 1) 元の場所の連結リストを繋ぎ直す
  if (body.prev !== null) {
    writes.push({
      path: `${bodiesPath}/${body.prev}`,
      fields: { next: body.next },
      requireUpdateTime: byId.get(body.prev)?.updateTime,
    });
  } else if (body.parent !== null) {
    writes.push({
      path: `${bodiesPath}/${body.parent}`,
      fields: { child: body.next },
      requireUpdateTime: byId.get(body.parent)?.updateTime,
    });
  }
  if (body.next !== null) {
    writes.push({
      path: `${bodiesPath}/${body.next}`,
      fields: { prev: body.prev },
      requireUpdateTime: byId.get(body.next)?.updateTime,
    });
  }

  // 2) 新しい場所へ挿入する位置を求める(afterElementIdが実際にnewParentElementId
  //    の子でなければ、見つからない扱い=末尾として無視する)。
  const newSiblingsExcludingSelf = existingBodies.filter(
    (b) => b.parent === newParentElementId && b.id !== elementId
  );
  const afterBody =
    afterElementId !== null
      ? newSiblingsExcludingSelf.find((b) => b.id === afterElementId) ?? null
      : null;
  const newPrevId = afterElementId === null ? null : afterBody?.id ?? null;
  const newNextId =
    newPrevId === null
      ? newSiblingsExcludingSelf.find((b) => b.prev === null)?.id ?? null
      : newSiblingsExcludingSelf.find((b) => b.prev === newPrevId)?.id ?? null;

  writes.push({
    path: `${bodiesPath}/${elementId}`,
    fields: { parent: newParentElementId, prev: newPrevId, next: newNextId },
    requireUpdateTime: body.updateTime,
  });
  if (newPrevId !== null) {
    writes.push({
      path: `${bodiesPath}/${newPrevId}`,
      fields: { next: elementId },
      requireUpdateTime: byId.get(newPrevId)?.updateTime,
    });
  } else if (newParentElementId !== null) {
    writes.push({
      path: `${bodiesPath}/${newParentElementId}`,
      fields: { child: elementId },
      requireUpdateTime: byId.get(newParentElementId)?.updateTime,
    });
  }
  if (newNextId !== null) {
    writes.push({
      path: `${bodiesPath}/${newNextId}`,
      fields: { prev: elementId },
      requireUpdateTime: byId.get(newNextId)?.updateTime,
    });
  }

  // 3) levels側: 元の親から取り除き、新しい親へ挿入する
  const oldLevelId = body.parent ?? "root";
  const newLevelId = newParentElementId ?? "root";
  const entry = { id: elementId, detail: body.detail, done: body.done };
  if (oldLevelId === newLevelId) {
    // **同じ親の中での並べ替えは1つの書き込みにまとめること。**
    // remove用とinsert用を別々に作ると、どちらも「元のchildren」を
    // 読んでから組み立てるため、同じドキュメントへの書き込みが2つでき、
    // 後勝ちのinsert側だけが残る。insert側は対象がまだ入ったままの配列に
    // もう1つ足したものなので、要素が重複する(実データで踏んだ)。
    writes.push(await buildReorderChildWrite(client, levelsPath, oldLevelId, entry, newPrevId));
  } else {
    const removeWrite = await buildRemoveChildrenWrite(client, levelsPath, oldLevelId, [elementId]);
    if (removeWrite) writes.push(removeWrite);
    writes.push(await buildInsertChildWrite(client, levelsPath, newLevelId, entry, newPrevId));
  }

  return mergeWritesByPath(writes);
}
