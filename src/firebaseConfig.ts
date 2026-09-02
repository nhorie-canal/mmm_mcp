// lib/main.dartのFirebaseOptions(Web版)と同じ値。
// Web用のAPIキーだが、Identity Toolkit REST APIの呼び出しには
// プラットフォームを問わず同じキーを使える。
export const FIREBASE_API_KEY = "AIzaSyCp1EMDbIcYHJXtkZiUYJH0yo_4U366WqQ";
export const FIREBASE_PROJECT_ID = "matryoshkamap";
export const FIREBASE_AUTH_DOMAIN = "matryoshkamap.firebaseapp.com";

// Googleログイン(ローカルループバック方式)用の共有OAuthクライアント
// (種類:デスクトップアプリ)。インストール型アプリのクライアントシークレットは
// Google自身がconfidentialとして扱わない設計のため(gcloud CLI等と同じ)、
// 全ユーザーのCLIで共有してよい。ユーザーごとにGoogle Cloud Consoleで
// 作り直す必要は無い。
export const GOOGLE_OAUTH_CLIENT_ID =
  "1020142389980-s55ds6qtude3v5e5piqpmuh24u5ktf4u.apps.googleusercontent.com";
export const GOOGLE_OAUTH_CLIENT_SECRET = "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";

// Sign in with AppleのServices ID(Web/Android用、Bundle IDと別)。
// アプリ本体が使っているものと同じServices IDを、MCPのCLIも再利用する
// (Return URLに中継ページのURLを追加登録するだけでよい)。
export const APPLE_SERVICES_ID = "jp.spheres.mm.signin";

// client_secret(JWT)発行用のCloud Function(functions/src/index.ts)。
// Sign in with Appleの秘密鍵(.p8)はアプリを識別するためのものであり、
// ユーザーごとに異なるものではないため、鍵自体を各ユーザーに配る代わりに、
// 署名専用のこのエンドポイントを全ユーザーのCLIから共有で呼び出す。
export const APPLE_CLIENT_SECRET_FUNCTION_URL =
  "https://asia-northeast1-matryoshkamap.cloudfunctions.net/appleClientSecret";

// Apple中継ページの本番URL。web/mcp-apple-relay.html をビルド・デプロイした先。
// このURLをApple Developer PortalのServices ID設定のReturn URLに
// 追加登録する必要がある。
//
// ドメインは.web.appではなく.firebaseappを使うこと。Appleの
// Return URL登録は「Domains and Subdomains」への事前登録も必要で、
// アプリ本体のApple連携(Return URL:
// https://matryoshkamap.firebaseapp.com/__/auth/handler)により
// matryoshkamap.firebaseappは既に登録済みのため、新規のドメイン登録なしで
// Return URLの追加だけで済む。.web.appは別ドメイン扱いになり
// invalid_request(Invalid web redirect url)になることを実機で確認済み。
export const APPLE_RELAY_URL = "https://matryoshkamap.firebaseapp.com/mcp-apple-relay.html";

// web/mcp-apple-relay.html のLOOPBACK_PORTと必ず一致させること。
export const APPLE_LOOPBACK_PORT = 51004;
