import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resetContext } from "../mcpContext.js";
import { BrowserSignIn, signInWithApple, signInWithEmail, signInWithGoogle } from "../auth/signIn.js";

// ツール呼び出しの時間切れより短く待ち、超えたら「承認待ち」として返す。
const WAIT_MS = 45_000;

// stdout は MCP の通信に使っているので、サインイン中の案内は stderr へ書く。
const log = (message: string) => console.error(message);

const browserSignIn = new BrowserSignIn(
  (method) =>
    method === "google" ? signInWithGoogle(log) : method === "apple" ? signInWithApple(log) : signInWithEmail(log),
  resetContext
);

export function registerSignIn(server: McpServer): void {
  server.tool(
    "sign_in",
    "Matryoshka Mind Mapにサインインする。ほかのツールが「サインインしていません」と" +
      "返したときに使う。ユーザーのパソコンでブラウザが開き、ユーザーがそこで承認・入力すると" +
      "サインインが終わる。アプリでのサインイン方法(Google・Apple・メールアドレス+パスワード)を" +
      "先にユーザーに聞いてから呼ぶこと。'email' はブラウザに入力ページを開くだけなので、" +
      "メールアドレスやパスワードを会話で尋ねたり受け取ったりしてはならない。" +
      "statusが'pending'なら、ブラウザでの承認・入力を済ませるようユーザーに伝え、済んだと言われたら" +
      "同じmethodでもう一度呼んで結果を確かめる。",
    {
      method: z
        .enum(["google", "apple", "email"])
        .describe("アプリでのサインイン方法。'google'・'apple'・'email'(メールアドレス+パスワード)"),
    },
    async ({ method }) => {
      const outcome = await browserSignIn.run(method, WAIT_MS);
      return {
        content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }],
        isError: outcome.status === "failed",
      };
    }
  );
}
