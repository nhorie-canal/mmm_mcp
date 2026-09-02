#!/usr/bin/env node
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  signInWithPassword,
  signInWithIdp,
  lookupAccountEmail,
} from "../src/auth/firebaseAuthRest.js";
import {
  saveCredentials,
  clearCredentials,
  loadCredentials,
  credentialsPath,
} from "../src/auth/tokenStore.js";
import { signInWithGoogleLoopback } from "../src/auth/googleLoopback.js";
import { signInWithAppleLoopback } from "../src/auth/appleLoopback.js";
import { exchangeAppleAuthorizationCode } from "../src/auth/appleTokenExchange.js";
import { fetchAppleClientSecret } from "../src/auth/appleClientSecretRemote.js";

// readlineに非表示入力(パスワード用)の機能が無いため、入力中だけ
// stdoutへの書き込みを差し替えてエコーバックを抑える。
function promptHidden(rl: readline.Interface, promptText: string): Promise<string> {
  const write = stdout.write.bind(stdout);
  let hide = false;
  (stdout as unknown as { write: typeof stdout.write }).write = ((chunk: unknown, ...args: unknown[]) => {
    if (hide && typeof chunk === "string" && chunk !== promptText && !chunk.includes("\n")) {
      return true;
    }
    // @ts-expect-error - Node標準のwriteシグネチャをそのまま委譲する
    return write(chunk, ...args);
  }) as typeof stdout.write;

  hide = true;
  return rl.question(promptText).finally(() => {
    hide = false;
    stdout.write = write;
    stdout.write("\n");
  });
}

async function promptEmailPassword(): Promise<{ email: string; password: string }> {
  const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true });
  const email = await rl.question("メールアドレス: ");
  const password = await promptHidden(rl, "パスワード(入力は表示されません): ");
  rl.close();
  return { email: email.trim(), password };
}

function printUsage(): void {
  console.log("使い方:");
  console.log("  mmm-login login --method email   (メールアドレス+パスワードでサインイン)");
  console.log("  mmm-login login --method google  (Googleアカウントでサインイン)");
  console.log("  mmm-login login --method apple   (Appleアカウントでサインイン)");
  console.log("  mmm-login logout                 (サインアウトしてローカルの認証情報を消す)");
  console.log("  mmm-login status                 (サインイン状態を確認する)");
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;

  if (command === "logout") {
    clearCredentials();
    console.log("サインアウトしました。");
    return;
  }

  if (command === "status") {
    const creds = loadCredentials();
    if (!creds) {
      console.log("サインインしていません。");
    } else {
      console.log(`サインイン中: ${creds.email ?? "(メールアドレス不明)"} (${creds.provider})`);
      console.log(`保存先: ${credentialsPath()}`);
    }
    return;
  }

  if (command !== "login") {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const methodIndex = rest.indexOf("--method");
  const method = methodIndex >= 0 ? rest[methodIndex + 1] : undefined;

  if (method === "email") {
    const { email, password } = await promptEmailPassword();
    const result = await signInWithPassword(email, password);
    saveCredentials({
      uid: result.localId,
      email: result.email,
      refreshToken: result.refreshToken,
      provider: "password",
    });
    console.log(`サインインしました: ${result.email ?? result.localId}`);
  } else if (method === "google") {
    const idToken = await signInWithGoogleLoopback();
    const result = await signInWithIdp("google.com", idToken);
    const email = result.email ?? (await lookupAccountEmail(result.idToken));
    saveCredentials({
      uid: result.localId,
      email,
      refreshToken: result.refreshToken,
      provider: "google.com",
    });
    console.log(`サインインしました: ${email ?? result.localId}`);
  } else if (method === "apple") {
    // Cloud Functionの疎通確認を先に済ませ、失敗するならブラウザでの
    // サインイン操作をさせる前に気付けるようにする。client_secretは
    // 短命(5分)なので、ブラウザでの操作に時間がかかった場合に備えて
    // 実際のトークン交換の直前にもう一度取り直す。
    await fetchAppleClientSecret();
    const code = await signInWithAppleLoopback();
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
    console.log(`サインインしました: ${email ?? result.localId}`);
  } else {
    printUsage();
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`エラー: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
