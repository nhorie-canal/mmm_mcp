import type { AuthSession } from "../auth/session.js";
import type { FirestoreRestClient } from "../firestore/restClient.js";
import { canEditHeader, headerFromFirestore, type HeaderDoc } from "./header.js";

export interface ResolvedMap {
  headerId: string;
  ownerUid: string;
  header: HeaderDoc;
}

export class MapNotFoundError extends Error {
  constructor(mapId: string) {
    super(`マップが見つかりません(id: ${mapId})。list_mapsで存在するIDを確認してください。`);
    this.name = "MapNotFoundError";
  }
}

/**
 * mapId(headerId)から、自分の所有マップか共有されたマップかを判定し、
 * 実際にドキュメントを持っているユーザーのuidを特定する。
 * 自分の所有物を先に見に行き、無ければ自分のrefs(共有されて見えているマップ)
 * から探す(header_list_model.dartの一覧結合と同じ考え方)。
 */
export async function resolveMap(
  client: FirestoreRestClient,
  session: AuthSession,
  mapId: string
): Promise<ResolvedMap> {
  const own = await client.getDocument(`users/${session.uid}/headers/${mapId}`);
  if (own) {
    return { headerId: mapId, ownerUid: session.uid, header: headerFromFirestore(mapId, session.uid, own.data) };
  }

  const refs = await client.listDocuments(`users/${session.uid}/refs`);
  for (const ref of refs) {
    if (ref.data.headerId !== mapId) continue;
    const ownerUid = ref.data.userId;
    if (typeof ownerUid !== "string" || ownerUid === "") continue; // 壊れたrefsは無視する
    const doc = await client.getDocument(`users/${ownerUid}/headers/${mapId}`);
    if (doc) {
      return { headerId: mapId, ownerUid, header: headerFromFirestore(mapId, ownerUid, doc.data) };
    }
  }

  throw new MapNotFoundError(mapId);
}

export function bodiesPathOf(map: ResolvedMap): string {
  return `users/${map.ownerUid}/headers/${map.headerId}/bodies`;
}

/** levels移行: bodiesPathOfと対になる、階層ごとの子一覧を配列で持つ新形式コレクション。 */
export function levelsPathOf(map: ResolvedMap): string {
  return `users/${map.ownerUid}/headers/${map.headerId}/levels`;
}

/**
 * 書き込み系ツールの入口で呼ぶ。閲覧のみで共有されているマップに対する
 * 書き込みを、Firestoreルールに委ねる前にわかりやすいメッセージで止める。
 */
export function assertCanEditMap(map: ResolvedMap, session: AuthSession): void {
  if (!canEditHeader(map.header, session.uid, session.email)) {
    throw new Error(
      `「${map.header.title}」は閲覧のみで共有されているため編集できません。`
    );
  }
}

/** マップ名から要素までの祖先チェーンを「＞」区切りの1本の文字列にする。 */
export function formatPath(mapTitle: string, ancestorDetails: string[]): string {
  return [mapTitle, ...ancestorDetails].join("＞");
}
