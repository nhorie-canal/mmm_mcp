# Matryoshka Mind Map MCP Server

[English](https://github.com/nhorie-canal/mmm_mcp/blob/main/README.md) | 日本語

**AIとのやりとりを、文字から図へ。** Claude などのいつもの AI が、[マトリョシカ マインドマップ](https://matryoshkamap.web.app)に入れ子の TODO や Mermaid の図を書き込みます。あなたはアプリで見て、直して、チェック。その結果を AI も読み返します。

![AIエージェントに旅行の計画を頼むとマップが埋まり、「ホテルを予約した」でチェックが付く](https://raw.githubusercontent.com/nhorie-canal/mmm_mcp/main/docs/demo.gif)

**アプリ本体（基本無料）**: [Web版](https://matryoshkamap.web.app)・[App Store](https://apps.apple.com/app/id1613648306)・[Google Play](https://play.google.com/store/apps/details?id=jp.spheres.mm)

## しくみ

```mermaid
sequenceDiagram
  actor あなた
  participant M as mmm のマップ
  participant AI as いつもの AI
  Note over あなた,AI: 文字の往復の代わりに、マップを介してやりとりする
  あなた-)AI: ひとこと頼む「打ち合わせを TODO にして」
  AI->>M: 入れ子の TODO・図を書き込む
  M->>あなた: 図でひと目で見せる
  あなた->>M: 直す・チェックする
  M->>AI: あなたの直し・チェックを読み返す
  AI->>M: 次の作業・図を書き足す
```

> [!IMPORTANT]
> ### はじめ方 → [使い方ガイド](https://github.com/nhorie-canal/mmm_mcp/blob/main/docs/guide.ja.md)
>
> アプリの準備から、AI とつなぐ手順、推奨の指示文、毎日の使い方まで、順番にまとめています。

## プライバシー

- AI が依頼したときだけ、あなたのアカウントとしてマップを読み書きします。アプリと同じアクセス制御です
- マップの中身はサーバーに保存せず、ログにも出しません。保存するのは接続の許可（ハッシュ）と1日の呼び出し回数（3日で削除）だけです
- 書き込んだ日（日付と日数だけ）と端末のタイムゾーンを、本人だけが読めるアカウントの領域に保存します。前者は利用者数の集計にだけ使います
- マップの中身を初めて読むときは、AI があなたに許可を求めます
- 接続は AI の設定から外せます。アカウントを削除すると許可の記録も消えます。AI に渡った内容は、その提供元の規約に従います

詳しくは[プライバシーについて](https://info.spheres.jp/apps/matryoshka-mind-map/#privacy)をご覧ください。
