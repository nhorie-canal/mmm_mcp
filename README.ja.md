# Matryoshka Mind Map MCP Server

[English](https://github.com/nhorie-canal/mmm_mcp/blob/main/README.md) | 日本語

AIエージェントに話しかけるだけで、[マトリョシカ マインドマップ](https://matryoshkamap.web.app)の入れ子のマインドマップとTODOを読み書きできます。

![AIエージェントに旅行の計画を頼むとマップが埋まり、「ホテルを予約した」でチェックが付く](https://raw.githubusercontent.com/nhorie-canal/mmm_mcp/main/docs/demo.gif)

**アプリ本体（基本無料）**: [Web版](https://matryoshkamap.web.app)・[App Store](https://apps.apple.com/app/id1613648306)・[Google Play](https://play.google.com/store/apps/details?id=jp.spheres.mm)

## できること

- 「マップ一覧を見せて」— マップの一覧を教えてくれる
- 会話の中で考えた内容を、そのまま入れ子のマップにする
- 「〇〇のタスク終わったよ」— TODOにチェックが付く
- 長いメモやMarkdownを貼って、マップに取り込む

## はじめる

Google・Apple・メールアドレスのいずれかを連携したアカウントが必要です（匿名のままのアカウントは使えません。アプリの「メールアドレスを連携」で後から連携できます）。

### Claude Desktop（ターミナル不要）

1. **[mmm-mcp-server.mcpb](https://github.com/nhorie-canal/mmm_mcp/releases/latest/download/mmm-mcp-server.mcpb)** をダウンロードしてダブルクリックし、Claude Desktop で「インストール」を押す
2. 「Matryoshka にログインして」と話しかける。ブラウザが開くので、Google か Apple で承認するか、メールアドレスとパスワードを入力ページに入れる（入力ページはあなたのパソコンの中だけで開き、パスワードは AI に渡りません）
3. 話しかける
   - 「Matryoshkaのマップ一覧を見せて」
   - 「〇〇マップに、××というタスクを追加して」
   - 「このメモを〇〇マップに取り込んで」

マップの中身を初めて読むときは、Claude があなたに許可を求めます。

### Claude Code・ほかの MCP 対応クライアント

Node.js 18 以上が必要です。ターミナルに慣れていない方は[詳しい手順](https://github.com/nhorie-canal/mmm_mcp/blob/main/docs/setup.ja.md)へ。

Claude Code:

```bash
claude mcp add mmm -- npx -y mmm-mcp-server@latest
```

ほかのMCP対応クライアント: `npx -y mmm-mcp-server@latest` をサーバーのコマンドとして登録します。

登録したら、AIエージェントに「Matryoshka にログインして」と頼むか、ターミナルでアプリと同じ方法（`google`・`apple`・`email`）でログインします。

```bash
npx -y -p mmm-mcp-server@latest mmm-login login --method google
```

## プライバシー

- あなたのパソコンの中だけで、AIエージェントとの会話中だけ動きます。常時起動しているサーバーはありません
- ログイン情報はあなたのパソコンにだけ保存し、マップはあなた自身のアカウントへ直接読み書きします。開発者はあなたのデータを見られません

## もっと使う

[使い方のコツと応用](https://github.com/nhorie-canal/mmm_mcp/blob/main/docs/guide.ja.md) — 書き方を安定させる・フォルダ単位でタスクを記録する・最新版にする・よくあるトラブル
