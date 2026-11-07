/**
 * ローカル版を止めるスイッチ。`config/app.localMcpEnabled` が明示的に `false` のときだけ、
 * ローカル版の全ツールは何も読み書きせず、リモート版への案内だけを返す。
 * フィールドが無い・読めない・false 以外の値のときは、止めない（読めないだけで使えなくしない）。
 */

export const REMOTE_MCP_URL = "https://mmm.spheres.jp/mcp";

export function isLocalMcpDisabled(configData: Record<string, unknown> | null | undefined): boolean {
  return configData?.localMcpEnabled === false;
}

export function localMcpDisabledMessage(): string {
  return (
    "このローカル版の MCP サーバー（npx / .mcpb）は停止されました。何も読み書きしていません。" +
    `リモート版に移行してください。Claude の「設定 → コネクタ → カスタムコネクタを追加」に ${REMOTE_MCP_URL} を貼り、` +
    "ブラウザでサインインすると使えます（アプリのアカウントがメール・Google・Apple に連携済みであること）。" +
    "手順: https://github.com/nhorie-canal/mmm_mcp/blob/main/docs/setup.ja.md"
  );
}

/** 確認結果を覚えておく時間。止めたあとは最大この時間で全員に効く。 */
export const SWITCH_CACHE_MS = 5 * 60 * 1000;

/**
 * `fetchConfig` は config/app のフィールドを返す（失敗したら投げる）。
 * 結果は一定時間だけ覚える。失敗したときは前回の値のまま（初回の失敗は止めない）で、その分も一定時間は読み直さない。
 */
export class LocalSwitch {
  private disabled = false;
  private checkedAt: number | null = null;

  constructor(
    private readonly fetchConfig: () => Promise<Record<string, unknown> | null>,
    private readonly now: () => number = Date.now
  ) {}

  async isDisabled(): Promise<boolean> {
    const t = this.now();
    if (this.checkedAt !== null && t - this.checkedAt < SWITCH_CACHE_MS) return this.disabled;
    try {
      this.disabled = isLocalMcpDisabled(await this.fetchConfig());
    } catch {
      // 読めなかったときは前回の値を残す（止めたあとの瞬断で動き出さない。初回の失敗は止めない）
    }
    this.checkedAt = t;
    return this.disabled;
  }
}
