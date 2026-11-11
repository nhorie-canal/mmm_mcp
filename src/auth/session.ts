/** ツールとFirestoreクライアントが使う、1人の利用者の認証の最小限の形（呼び出しごとに /mcp の入口が用意する）。 */
export interface UserSession {
  readonly uid: string;
  readonly email: string | null;
  getValidIdToken(): Promise<string>;
}
