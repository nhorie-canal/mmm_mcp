/** マップ単位のAI読み取り許可。lib/domain/header.dartのAiReadPermissionと同じ3値。 */
export type AiReadPermission = "ask" | "allow" | "deny";

function aiReadPermissionFromFirestore(value: unknown): AiReadPermission {
  return value === "allow" || value === "deny" ? value : "ask";
}

// lib/domain/header.dart のHeaderと同じ構造。
export interface HeaderDoc {
  id: string;
  /** このheaderドキュメントを実際に所有しているユーザーのuid。 */
  ownerUid: string;
  title: string;
  order: number;
  isTodo: boolean;
  /** 中身を編集できる共有先のメールアドレス。 */
  editors: string[];
  /** 閲覧のみできる共有先のメールアドレス。 */
  viewers: string[];
  /**
   * マップ単位のAI読み取り許可。**MCPサーバーはこのフィールドを絶対に
   * 書き込まない**(AIが自分自身に許可を与えられると確認の仕組みが
   * 意味を失う。アプリのマップ編集画面からのみ変更できる想定)。
   */
  aiReadPermission: AiReadPermission;
}

/**
 * Firestoreのheaderドキュメントから組み立てる。
 * 旧`shares`フィールド(役割の区別が無い、常に編集者扱い)しか無い
 * 既存ドキュメントとの後方互換はHeader.fromFirestore(Dart側)と同じ。
 */
export function headerFromFirestore(
  id: string,
  ownerUid: string,
  data: Record<string, unknown>
): HeaderDoc {
  const editors = (data.editors as string[] | undefined) ?? (data.shares as string[] | undefined) ?? [];
  return {
    id,
    ownerUid,
    title: String(data.title ?? ""),
    order: Number(data.order ?? 0),
    isTodo: Boolean(data.isTodo ?? false),
    editors,
    viewers: (data.viewers as string[] | undefined) ?? [],
    aiReadPermission: aiReadPermissionFromFirestore(data.aiReadPermission),
  };
}

/** 自分がこのマップを編集できるか(所有者か、editorsに含まれる共有先か)。Header.canEdit(Dart側)と同じ。 */
export function canEditHeader(header: HeaderDoc, uid: string, email: string | null): boolean {
  if (uid === header.ownerUid) return true;
  return email !== null && header.editors.includes(email);
}
