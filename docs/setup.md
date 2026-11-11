# Setup

[Back to README](https://github.com/nhorie-canal/mmm_mcp/blob/main/README.md)

## Remote version (recommended, nothing to install)

Register a URL with your AI and sign in in the browser. No terminal and no Node.js needed.

### What you need

- A Matryoshka Mind Map account. **Anonymous-only accounts cannot be used.** Link Google, Apple, or an email address first (in the app: My Page → "Link account").
- An AI that supports remote MCP connectors (tested with Claude on the web, desktop, mobile, and Claude Code). Claude's Free plan allows one custom connector.

### Claude (web, desktop, mobile)

1. Open Claude and go to **Settings → Customize → Connectors**
2. Choose **+ Add → Add custom connector**
3. Enter `mmm` as the name and paste this URL:

   ```
   https://mmm.spheres.jp/mcp
   ```

4. Leave Authentication ("Sign in now") and OAuth client ("Register automatically") as detected, and press **Add**
5. A browser window opens: sign in with the same account as the app (Google, Apple, or email)
6. Back in Claude, confirm to finish connecting. It is now connected, and the same connection also appears in the Claude mobile app

The same URL (with a copy button) and steps are in the app under My Page → "Connect to AI".

### Claude Code

```bash
claude mcp add --transport http mmm https://mmm.spheres.jp/mcp
```

Inside Claude Code, open `/mcp`, choose mmm, and sign in in the browser.

### Try it out

- "Show me my mmm maps."
- "Add a task called [task] to the [map name] map."
- "I finished [task] in the [map name] map."
- "I'll paste some notes in Markdown; import them into the [map name] map."

Only the first time a map's contents (the text of its elements) are read, the AI asks for your permission. The same map is remembered for a while (up to 24 hours). There is no way for the server to verify that the AI actually asked you, so this is best-effort and depends on the AI you use.

### Free-plan limits and call count

The same limits as the app apply to writes from AI (free: 20 maps, 300 elements per map, 3 documents per map; the paid plan has no limits). When a limit is reached, the AI writes nothing and tells you why and how to continue. You can subscribe from My Page in the app (first month free). Connect the AI with the same account you subscribed with; connecting with a different account is treated as free.

As a safeguard against abuse, each person can call the tools up to 1,000 times per day (resets at 00:00 UTC).

### Disconnecting

Remove mmm in Claude under **Settings → Customize → Connectors**. Deleting your account in the app removes every connection grant.

## Old local version (npx / .mcpb)

The local version has been stopped. Remove the local mmm from your AI app's settings and add the remote version with the steps above (in Claude Code, run `claude mcp remove mmm` first, then register it as above). Your account data stays the same.
