# Matryoshka Mind Map MCP Server

English | [日本語](https://github.com/nhorie-canal/mmm_mcp/blob/main/README.ja.md)

**Work with your AI in maps, not text.** Instead of scrolling back through a long chat, your AI agent (such as Claude) writes nested to-dos and Mermaid diagrams into [Matryoshka Mind Map](https://matryoshkamap.web.app). You see them at a glance in the app, edit, and check them off, and your AI reads your changes back.

![Asking an AI agent to plan a trip fills a Matryoshka map, and "I booked the hotel" checks it off](https://raw.githubusercontent.com/nhorie-canal/mmm_mcp/main/docs/demo.gif)

**Get the app (free to start)**: [Web app](https://matryoshkamap.web.app) · [App Store](https://apps.apple.com/app/id1613648306) · [Google Play](https://play.google.com/store/apps/details?id=jp.spheres.mm)

## What you can do

- "Show me my maps" — lists your maps
- Turn ideas from the conversation into a nested mind map
- "I finished task X" — checks it off your TODO list
- Paste long notes or Markdown and import them into a map
- Save notes from the conversation as a Markdown document inside a map, then read it back or rewrite it later

## Get started

You need a Matryoshka account linked to Google, Apple, or an email address (anonymous-only accounts cannot be used; you can link one later from the app).

### Claude (web, desktop, mobile) — nothing to install

1. In Claude, open **Settings → Customize → Connectors**, then choose **+ Add → Add custom connector**. Enter `mmm` as the name and paste this URL:
   ```
   https://mmm.spheres.jp/mcp
   ```
2. Leave Authentication ("Sign in now") and OAuth client ("Register automatically") as detected, and press **Add**.
3. A browser window opens: sign in with the same account as the app. Back in Claude, confirm to finish connecting.
4. Talk to it:
   - "Show me my mmm maps."
   - "Add a task called [task] to the [map name] map."
   - "Import these notes into the [map name] map."

Claude asks you for permission the first time it reads a map's contents. The connection also appears in the Claude mobile app. Claude's Free plan allows one custom connector.

The same URL and steps are shown in the app under My Page → "Connect to AI".

### Claude Code and other MCP clients

Register the URL. Claude Code:

```bash
claude mcp add --transport http mmm https://mmm.spheres.jp/mcp
```

Then open `/mcp` inside Claude Code, choose mmm, and sign in in the browser. For other clients, register the URL above as a Streamable HTTP MCP server (it needs OAuth support; clients other than Claude have not been tested).

### Using the old local version (npx / .mcpb)?

The local version is being phased out. Please move to the remote version; the steps to switch, and the old local steps, are in the [setup guide](https://github.com/nhorie-canal/mmm_mcp/blob/main/docs/setup.md).

## Privacy

- This is an MCP server operated by us (Google Cloud Run, Tokyo). A connection is made only when you add it in your AI app, sign in in the browser with the same account as the app, and press "Allow" (anonymous accounts cannot connect).
- It reads and writes your maps (Firebase) as you, only when your AI asks it to, under the same access control as the app.
- Map contents are not stored on the server or written to logs. The developer does not see them.
- The server stores only two things: the record of your connection grant (tokens are stored as hashes) and the daily call count (deleted after 3 days).
- The record of the days you wrote (only the last date and the number of days) and your device's time zone are stored in an area of your account that only you can read. The former is used by the developer only to count users.
- You can disconnect from your AI app's settings. Deleting your account also deletes the grant record and call counts.
- Content passed to the AI is subject to the terms of its provider (such as Anthropic, PBC).
- For details, see "Privacy" in the [app's page](https://info.spheres.jp/en/apps/matryoshka-mind-map/#privacy).

## More

[Tips and advanced use](https://github.com/nhorie-canal/mmm_mcp/blob/main/docs/guide.md) — keeping maps tidy, recording tasks per folder, updating, troubleshooting.
