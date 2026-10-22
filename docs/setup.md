# Step-by-Step Setup

[Back to README](https://github.com/nhorie-canal/mmm_mcp/blob/main/README.md)

This guide starts from how to open the terminal (the window where you type commands). It should work on both macOS and Windows, but it has only been tested on real machines running macOS.

## 1. Prerequisites

- A Matryoshka Mind Map account (**anonymous-only accounts cannot be used.** Make sure you can log in with Google, Apple, or an email address. You can also link one later with the "Link email address" feature in the app).
- An MCP-compatible AI agent (tested with Claude Desktop / Claude Code; other MCP-compatible clients should generally work too).
- Node.js (the runtime that runs the tool; you will install it in Step 3).

## 2. Open the Terminal

### On macOS

1. Press `Command` + `Space` on your keyboard (opens Spotlight search).
2. Type "Terminal".
3. Click "Terminal" in the results, or press Enter.

### On Windows

1. Press the `Windows` key on your keyboard (opens Start menu search).
2. Type "PowerShell".
3. Click "Windows PowerShell" in the results, or press Enter.

Once a dark (or light) window opens, you are ready. For the rest of the steps, paste the commands into this window one line at a time and press Enter (the commands themselves are the same on macOS and Windows).

## 3. Install Node.js

Check whether Node.js is already installed with this command:

```bash
node --version
```

If a version number of `v18` or higher is displayed (e.g., `v20.11.0`), it is already installed. If you see an error like "command not found", download the installer from:

https://nodejs.org/

The site shows two large buttons. Click the one labeled **"LTS"** to download (the `.pkg` installer for macOS or the `.msi` installer for Windows is chosen automatically for your OS). Double-click the downloaded file and follow the on-screen instructions (on macOS: "Continue" → "Agree" → "Install"; on Windows: "Next" → "I accept..." → "Install").

When the installation is finished, go back to the terminal and check again:

```bash
node --version
```

## 4. Log In

Choose one of the following three options based on how you usually log in to the Matryoshka Mind Map app. **None of these methods require any setup on your part beforehand.** The first run downloads the tool, so it may take a moment.

### If you log in with Google

```bash
npx -y -p mmm-mcp-server@latest mmm-login login --method google
```

Your browser opens automatically; log in with the Google account you usually use.

### If you log in with Apple

```bash
npx -y -p mmm-mcp-server@latest mmm-login login --method apple
```

Your browser opens automatically; log in with your Apple ID.

### If you log in with an email address and password

```bash
npx -y -p mmm-mcp-server@latest mmm-login login --method email
```

You will be asked for your email address and password (the password is not shown on screen).

> **If you get a "wrong password" error**, it does not necessarily mean you mistyped your password. If your account signs in to the app with Google or Apple and has no email/password credentials at all, you get the same error. If that may be the case, try the "Google" or "Apple" steps above.

Once you have logged in, you do not need to log in again each time (your credentials are stored only on your computer, in a form that only you can read).

```bash
npx -y -p mmm-mcp-server@latest mmm-login status
```

shows your login status. To log out:

```bash
npx -y -p mmm-mcp-server@latest mmm-login logout
```

## 5. Register It with Your AI Agent

Below are the instructions for Claude Desktop and Claude Code, which have been tested. If you use another MCP-compatible client (e.g., Codex), in most cases you only need to register the server launch command (`npx -y mmm-mcp-server@latest`) in that client's MCP server settings. See your client's documentation for the exact steps.

### Claude Code

```bash
claude mcp add mmm -- npx -y mmm-mcp-server@latest
```

### Claude Desktop

Open the Claude Desktop configuration file (`claude_desktop_config.json`) and add the following under `mcpServers`:

```json
{
  "mcpServers": {
    "mmm": {
      "command": "npx",
      "args": ["-y", "mmm-mcp-server@latest"]
    }
  }
}
```

Save the file and restart Claude Desktop.

## 6. Try It Out

Try talking to your AI agent like this:

- "Show me my Matryoshka maps."
- "Add a task called [task] to the [map name] map."
- "I finished the [task] task in the [map name] map."
- "I'll paste my notes in Markdown; import them into the [map name] map."

**Only the first time the contents of a map (the element text) are read**, the tool asks for your permission before returning the actual contents. This is out of consideration for personal information that the contents may contain.

Instead of the contents, the tool returns only an instruction: "confirm directly with the user, then call again with `confirmed: true`." This is best-effort: the server has no way to verify whether the agent actually asked you, so whether the confirmation happens properly depends on the AI agent you use. Once confirmed, the same map is not confirmed again while that server is running (roughly one conversation).
