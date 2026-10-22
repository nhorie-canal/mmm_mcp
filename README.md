# Matryoshka Mind Map MCP Server

English | [日本語](https://github.com/nhorie-canal/mmm_mcp/blob/main/README.ja.md)

Talk to your AI agent, and it reads and writes your nested mind maps and TODOs in [Matryoshka Mind Map](https://matryoshkamap.web.app).

![Asking an AI agent to plan a trip fills a Matryoshka map, and "I booked the hotel" checks it off](https://raw.githubusercontent.com/nhorie-canal/mmm_mcp/main/docs/demo.gif)

**Get the app (free to start)**: [Web app](https://matryoshkamap.web.app) · [App Store](https://apps.apple.com/app/id1613648306) · [Google Play](https://play.google.com/store/apps/details?id=jp.spheres.mm)

## What you can do

- "Show me my maps" — lists your maps
- Turn ideas from the conversation into a nested mind map
- "I finished task X" — checks it off your TODO list
- Paste long notes or Markdown and import them into a map

## Get started

You need Node.js 18+ and a Matryoshka account linked to Google, Apple, or an email address (anonymous-only accounts cannot be used). New to the terminal? Follow the [step-by-step setup guide](https://github.com/nhorie-canal/mmm_mcp/blob/main/docs/setup.md).

**1. Log in** with the method you use in the app (`google`, `apple`, or `email`):

```bash
npx -y -p mmm-mcp-server@latest mmm-login login --method google
```

**2. Register it with your AI agent.**

Claude Code:

```bash
claude mcp add mmm -- npx -y mmm-mcp-server@latest
```

Claude Desktop (`claude_desktop_config.json`, then restart the app):

```json
{
  "mcpServers": {
    "mmm": { "command": "npx", "args": ["-y", "mmm-mcp-server@latest"] }
  }
}
```

Other MCP clients: register `npx -y mmm-mcp-server@latest` as the server command.

**3. Talk to it.**

- "Show me my Matryoshka maps."
- "Add a task called [task] to the [map name] map."
- "Import these notes into the [map name] map."

The first time a map's contents are read, the agent asks for your permission.

## Privacy

- Runs only on your computer, only while you talk to your agent. No always-on server.
- Your login is stored only on your computer, and your maps are read and written directly in your own account. The developer cannot see your data.

## More

[Tips and advanced use](https://github.com/nhorie-canal/mmm_mcp/blob/main/docs/guide.md) — keeping maps tidy, recording tasks per folder, updating, troubleshooting.
