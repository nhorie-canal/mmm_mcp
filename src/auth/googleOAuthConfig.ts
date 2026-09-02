import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET } from "../firebaseConfig.js";

const CONFIG_PATH = join(homedir(), ".config", "mmm-mcp", "google-oauth-client.json");

export interface GoogleOAuthClientConfig {
  client_id: string;
  client_secret: string;
}

/**
 * GoogleログインのループバックOAuthに使うクライアント情報。
 * 通常は全ユーザー共有のデフォルト(firebaseConfig.ts参照)をそのまま使う。
 * 自分専用のOAuthクライアントを使いたい場合だけ、Google Cloud Consoleで
 * 作成した「デスクトップアプリ」タイプのクライアントのJSON(`installed`の
 * 中身)をこのパスに保存すれば、そちらが優先される。
 */
export function loadGoogleOAuthClientConfig(): GoogleOAuthClientConfig {
  if (existsSync(CONFIG_PATH)) {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    const installed = raw.installed ?? raw;
    if (!installed.client_id || !installed.client_secret) {
      throw new Error(`${CONFIG_PATH} の内容が不正です(client_id/client_secretが必要)。`);
    }
    return { client_id: installed.client_id, client_secret: installed.client_secret };
  }
  return { client_id: GOOGLE_OAUTH_CLIENT_ID, client_secret: GOOGLE_OAUTH_CLIENT_SECRET };
}

export function googleOAuthConfigPath(): string {
  return CONFIG_PATH;
}
