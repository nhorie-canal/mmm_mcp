import open from "open";
import { signInWithIdp, signInWithPassword, lookupAccountEmail } from "./firebaseAuthRest.js";
import { saveCredentials } from "./tokenStore.js";
import { signInWithGoogleLoopback } from "./googleLoopback.js";
import { signInWithAppleLoopback } from "./appleLoopback.js";
import { exchangeAppleAuthorizationCode } from "./appleTokenExchange.js";
import { fetchAppleClientSecret } from "./appleClientSecretRemote.js";
import { startEmailSignInPage } from "./emailLoopback.js";

export type BrowserSignInMethod = "google" | "apple" | "email";

/** ブラウザでGoogleにサインインし、認証情報を保存する。サインインしたメールアドレスを返す。 */
export async function signInWithGoogle(log: (message: string) => void): Promise<string | null> {
  const idToken = await signInWithGoogleLoopback(log);
  const result = await signInWithIdp("google.com", idToken);
  const email = result.email ?? (await lookupAccountEmail(result.idToken));
  saveCredentials({
    uid: result.localId,
    email,
    refreshToken: result.refreshToken,
    provider: "google.com",
  });
  return email ?? result.localId;
}

/** ブラウザでAppleにサインインし、認証情報を保存する。サインインしたメールアドレスを返す。 */
export async function signInWithApple(log: (message: string) => void): Promise<string | null> {
  // Cloud Functionの疎通確認を先に済ませ、失敗するならブラウザでの
  // サインイン操作をさせる前に気付けるようにする。client_secretは
  // 短命(5分)なので、ブラウザでの操作に時間がかかった場合に備えて
  // 実際のトークン交換の直前にもう一度取り直す。
  await fetchAppleClientSecret();
  const code = await signInWithAppleLoopback(log);
  const clientSecret = await fetchAppleClientSecret();
  const appleIdToken = await exchangeAppleAuthorizationCode(code, clientSecret);
  const result = await signInWithIdp("apple.com", appleIdToken);
  const email = result.email ?? (await lookupAccountEmail(result.idToken));
  saveCredentials({
    uid: result.localId,
    email,
    refreshToken: result.refreshToken,
    provider: "apple.com",
  });
  return email ?? result.localId;
}

/** ブラウザの入力ページでメール+パスワードを受け取ってサインインし、認証情報を保存する。 */
export async function signInWithEmail(log: (message: string) => void): Promise<string | null> {
  const page = await startEmailSignInPage({ signIn: signInWithPassword });
  log("ブラウザでメールアドレスとパスワードの入力ページを開きます…");
  open(page.url).catch(() => {
    log(`自動で開けなかった場合は次のURLを開いてください:\n${page.url}`);
  });
  const result = await page.result;
  saveCredentials({
    uid: result.localId,
    email: result.email,
    refreshToken: result.refreshToken,
    provider: "password",
  });
  return result.email ?? result.localId;
}

export type SignInOutcome =
  | { status: "signed_in"; account: string | null }
  | { status: "pending"; method: BrowserSignInMethod }
  | { status: "failed"; message: string };

interface Pending {
  method: BrowserSignInMethod;
  promise: Promise<string | null>;
}

/**
 * MCPのツール呼び出しには応答の時間切れがあるため、ブラウザでの承認を最後まで待たない。
 * 承認を始めて `waitMs` だけ待ち、終わらなければ "pending" を返して承認は裏で続ける。
 * 承認中に呼ばれたら新しく始めず同じ承認を待つ(Appleは固定ポートを使うため、
 * 二重に始めると後の方が EADDRINUSE で失敗する)。
 */
export class BrowserSignIn {
  private pending: Pending | null = null;

  constructor(
    private readonly start: (method: BrowserSignInMethod) => Promise<string | null>,
    private readonly onSignedIn: () => void
  ) {}

  async run(method: BrowserSignInMethod, waitMs: number): Promise<SignInOutcome> {
    if (!this.pending) {
      const promise = this.start(method);
      const pending: Pending = { method, promise };
      this.pending = pending;
      promise.then(
        () => this.onSignedIn(),
        () => {}
      ).finally(() => {
        if (this.pending === pending) this.pending = null;
      });
    }
    const { promise, method: pendingMethod } = this.pending;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), waitMs);
    });
    try {
      const result = await Promise.race([promise, timeout]);
      if (result === "timeout") return { status: "pending", method: pendingMethod };
      return { status: "signed_in", account: result };
    } catch (err) {
      return { status: "failed", message: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
  }
}
