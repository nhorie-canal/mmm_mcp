# mmm-mcp-server

[日本語](README.md) | English

A tool that lets you read and write your own maps in Matryoshka Mind Map (a mind map / TODO app) directly from conversations with AI agents. Because it is built on the Model Context Protocol (MCP) open standard, it works with any MCP-compatible AI agent, not just Claude Desktop and Claude Code (**tested on Claude Desktop and Claude Code**; for other clients, see their documentation on how to register an MCP server).

- Say "Show me my current maps" and it lists your maps.
- Turn ideas from your conversation directly into a hierarchical mind map.
- Just say "I finished task X" to check it off your TODO list.
- Import long notes or Markdown straight into a map.

This tool runs entirely on your computer, with no always-on server. It starts only when needed and accesses your own maps with your own login credentials (the developer cannot see your data).

> **For users who installed via `git clone` before September 30, 2026**: Due to a data format migration in the app, older versions will fail when writing to maps. Please replace the registration in Step 5 below with `npx -y mmm-mcp-server` (you do not need to log in again). If you want to keep using your cloned copy, run `git pull && npm install && npm run build` in the `mmm_mcp` folder and restart your AI agent.

> This guide walks you through every step, starting with how to open the terminal (the window where you type commands), so that you can follow along even if you are not used to working with a computer.
>
> **Supported OS**: It should work on both macOS and Windows. It runs purely on Node.js and does not depend on OS-specific features. However, **it has only been tested on real machines running macOS.** If you notice anything while trying it on Windows, please let us know via an Issue in this repository. Steps that differ by OS (opening the terminal and installing Node.js) are described separately for macOS and Windows. All other commands are the same on both.

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
npx -y -p mmm-mcp-server mmm-login login --method google
```

Your browser opens automatically; log in with the Google account you usually use.

### If you log in with Apple

```bash
npx -y -p mmm-mcp-server mmm-login login --method apple
```

Your browser opens automatically; log in with your Apple ID.

### If you log in with an email address and password

```bash
npx -y -p mmm-mcp-server mmm-login login --method email
```

You will be asked for your email address and password (the password is not shown on screen).

> **If you get a "wrong password" error**, it does not necessarily mean you mistyped your password. If your account signs in to the app with Google or Apple and has no email/password credentials at all, you get the same error. If that may be the case, try the "Google" or "Apple" steps above.

Once you have logged in, you do not need to log in again each time (your credentials are stored only on your computer, in a form that only you can read).

```bash
npx -y -p mmm-mcp-server mmm-login status
```

shows your login status. To log out:

```bash
npx -y -p mmm-mcp-server mmm-login logout
```

## 5. Register It with Your AI Agent

Below are the instructions for Claude Desktop and Claude Code, which have been tested. If you use another MCP-compatible client (e.g., Codex), in most cases you only need to register the server launch command (`npx -y mmm-mcp-server`) in that client's MCP server settings. See your client's documentation for the exact steps.

### Claude Code

```bash
claude mcp add mmm -- npx -y mmm-mcp-server
```

### Claude Desktop

Open the Claude Desktop configuration file (`claude_desktop_config.json`) and add the following under `mcpServers`:

```json
{
  "mcpServers": {
    "mmm": {
      "command": "npx",
      "args": ["-y", "mmm-mcp-server"]
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

(Previously, MCP's standard confirmation dialog, "elicitation", was also used to enforce this. However, some clients advertised support without actually showing a dialog, so contents became unreadable without the user ever seeing a confirmation screen. It was removed on 2026-09-03 in favor of the approach above.)

## Keeping Your Maps Tidy

Letting an AI agent write your maps is convenient, but left alone the maps tend to become hard to read. Paste the following into the instruction file your AI agent loads every time (for Claude Code, `~/.claude/CLAUDE.md`) to keep the writing style consistent:

```markdown
## How to write in mmm

- Keep each element short enough to read in one line. Do not pack in explanations.
  If you want to keep reasons or notes, put them one level down as child elements.
- Put a URL in its own element. Do not mix it with text like "Docs here: https://...".
  Create an element named "Docs" and put only the URL as its child.
- Order reminder items chronologically. Name them by when to do them, such as
  "Right after release", "In 2 weeks", or "When X happens".
```

The reasons:

- **One line per element**: Matryoshka shows elements nested inside each other, so long elements hurt readability and lose the benefit of drilling down through the hierarchy.
- **Do not mix URLs with text**: A URL in the same element as other text is not treated as a link in the app, so tapping it does nothing.
- **Chronological order**: Compared with ordering by task name, checking items off in order makes it easier to notice anything you missed.

## Troubleshooting

| Symptom | Cause / Solution |
|---|---|
| `node --version` says "command not found" | Node.js from Step 3 is not installed yet. After installing, close the terminal and open it again. |
| "Wrong password" when logging in | See the note in Step 4. Try logging in with Google or Apple instead. |
| The agent does not operate on your maps when asked | Check that the registration in Step 5 is correct. Claude Desktop needs a restart after registration. |
| The agent will not show map contents / stops at the confirmation | Check that you answered "yes" when asked for permission to read. |
| The AI cannot load a large map | With several hundred elements or more, the `list_elements` response gets large and may not fit in one go. Some AI agents handle this by saving it to a file and reading only the parts they need. If it happens often, split the map (swiping left on a top-level element turns it and everything under it into a separate map). |

## Advanced Example: Recording Tasks per Folder Automatically

What follows is **just one example of how it can be used**. It is not a standard workflow recommended for everyone, but shows what becomes possible with this kind of setup. Feel free to ignore it if it does not suit you.

**Goal**: Pair each folder (project) you work on in Claude Code with a map of the same name, and have the AI agent record and update tasks that come up during work in that map in real time, without asking.

> Setting (2) below uses Claude Code's "global CLAUDE.md", an instruction file that is always loaded. If your AI agent has a similar feature for instructions loaded every time, the same idea should apply.

### Setup

**(1) Re-register the mmm server so it is available in every folder**

When registering with Claude Code in Step 5, the `mmm` tool is only available in the current folder by default. To use it no matter which folder you start `claude` in, register it with `--scope user`:

```bash
claude mcp add mmm --scope user -- npx -y mmm-mcp-server
```

**(2) Write the workflow rules in your global CLAUDE.md (`~/.claude/CLAUDE.md`)**

For example, add something like this:

```markdown
## Task management with mmm

Record tasks that come up in the working folder in mmm (the Matryoshka Mind Map
integration) and manage them in real time.

- Use the working folder name as the map title.
- Check with list_maps whether a map with the same name exists. If not, create it
  right away with create_map(title=folder name, isTodo=true) without confirming
  the title (confirmation is not required for this workflow only).
- Calling list_elements to see existing tasks asks for confirmation only the first
  time the map is read in that process. After that, add and update tasks in real
  time with auto_structure_thought / update_task_status.
```

### Why this works

- `create_map` takes the title directly as an argument; "confirm in the conversation before calling" is only a recommended behavior for AI agents written in the tool description. A more specific instruction in CLAUDE.md takes priority, so maps can be created automatically without confirmation.
- Only `list_elements`, which reads map contents, has confirmation enforced on the server side out of consideration for confidential information (see "Try It Out" above). This does not change with the per-folder workflow: confirmation happens once, the first time a map is read in that process.

### Caveats

- Maps are created automatically for every folder, so work-log style maps will mix in with your carefully curated mind maps. Some people may find this cluttered. Adjust it to suit you, for example by using a separate account or limiting it to certain folders.
- Skipping confirmation for `create_map` applies only when you spell out this workflow in your own CLAUDE.md. Without any setup, the agent confirms in the conversation before creating a map, as usual.

## About This Tool

- Your login credentials (refresh token) are stored only on your computer (macOS: `~/.config/mmm-mcp/credentials.json`, Windows: `C:\Users\<username>\.config\mmm-mcp\credentials.json`) and are never sent anywhere else.
- Your map contents are read from and written to your Firebase account directly, without going through any third-party server, including the developer's (only when logging in with Apple, the last step of login goes through a signing-only relay server, but your map contents never pass through it).
- There is no always-running process; it runs only while you are in a conversation with your AI agent.
