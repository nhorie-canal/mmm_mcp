# Matryoshka Mind Map MCP Server

English | [日本語](https://github.com/nhorie-canal/mmm_mcp/blob/main/README.ja.md)

**Work with your AI in maps, not text.** Your usual AI, such as Claude, writes nested to-dos and Mermaid diagrams into [Matryoshka Mind Map](https://matryoshkamap.web.app). You look, edit and check things off in the app, and the AI reads your changes back.

![Asking an AI agent to plan a trip fills a Matryoshka map, and "I booked the hotel" checks it off](https://raw.githubusercontent.com/nhorie-canal/mmm_mcp/main/docs/demo.gif)

**The app (free to start)**: [Web](https://matryoshkamap.web.app) · [App Store](https://apps.apple.com/app/id1613648306) · [Google Play](https://play.google.com/store/apps/details?id=jp.spheres.mm)

## How it works

```mermaid
sequenceDiagram
  actor You
  participant M as Your mmm map
  participant AI as Your AI
  Note over You,AI: Instead of long text back and forth, you work through the map
  You-)AI: A short request: "Turn the meeting into to-dos"
  AI->>M: Writes nested to-dos and diagrams
  M->>You: Shows it at a glance as a diagram
  You->>M: Edit and check off
  M->>AI: The AI reads your edits and checks
  AI->>M: Adds the next tasks and diagrams
```

> [!IMPORTANT]
> ### Get started → [User guide](https://github.com/nhorie-canal/mmm_mcp/blob/main/docs/guide.md)
>
> From preparing the app to connecting your AI, the recommended instructions and everyday use, in order.

## Privacy

- It reads and writes your maps as you, only when your AI asks. The same access control as the app applies
- Map contents are not stored on the server or written to logs. The server keeps only connection grants (hashed) and daily call counts (deleted after 3 days)
- The days you wrote (dates and a count only) and your device's time zone are kept in a part of your account only you can read. The former is used only to count users
- The first time a map's contents are read, the AI asks for your permission
- You can disconnect from your AI's settings. Deleting your account removes the grants. Content passed to your AI is subject to its provider's terms

See [Privacy](https://info.spheres.jp/en/apps/matryoshka-mind-map/#privacy) for details.
