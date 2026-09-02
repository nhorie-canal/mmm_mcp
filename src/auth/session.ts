import { refreshIdToken } from "./firebaseAuthRest.js";
import { loadCredentials, saveCredentials, type StoredCredentials } from "./tokenStore.js";

const EXPIRY_MARGIN_MS = 60_000;

/**
 * サインイン済みユーザーの有効なIDトークンを保証するセッション。
 * refresh_tokenは使うたびに新しい値へローテーションされるため、
 * 更新のたびにディスクへ書き戻す。
 */
export class AuthSession {
  private idToken: string | null = null;
  private expiresAt = 0;
  // 複数のツール呼び出しがほぼ同時にトークン切れを検知したとき、
  // refresh_tokenを二重に消費すると(Firebaseはローテーションするため)
  // 片方が古いトークンで上書きしてしまう。進行中の更新を使い回して防ぐ。
  private refreshing: Promise<string> | null = null;

  constructor(private credentials: StoredCredentials) {}

  get uid(): string {
    return this.credentials.uid;
  }

  get email(): string | null {
    return this.credentials.email;
  }

  async getValidIdToken(): Promise<string> {
    if (this.idToken && Date.now() < this.expiresAt - EXPIRY_MARGIN_MS) {
      return this.idToken;
    }
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async doRefresh(): Promise<string> {
    const refreshed = await refreshIdToken(this.credentials.refreshToken);
    this.idToken = refreshed.idToken;
    this.expiresAt = Date.now() + refreshed.expiresInSec * 1000;
    this.credentials = { ...this.credentials, refreshToken: refreshed.refreshToken };
    saveCredentials(this.credentials);
    return this.idToken;
  }
}

export class NotSignedInError extends Error {
  constructor() {
    super(
      "サインインしていません。ターミナルで `npm run login` (mcp-server ディレクトリ内) を実行してください。"
    );
    this.name = "NotSignedInError";
  }
}

export function loadSession(): AuthSession {
  const credentials = loadCredentials();
  if (!credentials) {
    throw new NotSignedInError();
  }
  return new AuthSession(credentials);
}
