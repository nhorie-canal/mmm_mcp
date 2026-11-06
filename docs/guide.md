# Tips and Advanced Use

[Back to README](https://github.com/nhorie-canal/mmm_mcp/blob/main/README.md)

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

## Managing Development Work

An example instruction for keeping the tasks and notes of AI-assisted development in Matryoshka. Paste it, together with "Keeping Your Maps Tidy" above, into the instructions your AI agent loads every time:

| Client | Where to paste |
|---|---|
| Claude Code | `CLAUDE.md` at the project root, or `~/.claude/CLAUDE.md` |
| Claude Desktop / claude.ai | Settings → Profile → personal preferences (applies to all chats), or a project's instructions (that project only) |

````markdown
## Task management (mmm)

Record the tasks and notes that come up in this working folder with the Matryoshka Mind Map (mmm) MCP server.

- **Keep "things to do later" only in mmm.** Do not leave them in plan checkboxes, this file,
  or only in the conversation. Tasks that come out of a design doc, and remaining work or
  unverified points you mention in a report, go into mmm as items right away.
- Use the working folder's name as the map title. Look for a map with that name with
  `list_maps`; if there is none, you may create one with `create_map` (as a TODO map).
- Make each task a one-line element. Put reasons, steps, and paths of related docs as child elements.
- Create a parent element per version or milestone and list its tasks under it
  (for example, the tasks shipping in 1.2.0 go under "1.2.0").
- **Check off a task as soon as it is done**, so that unchecked always means work that is really left.
  "Lower priority" or "on hold" is not done: do not check it; move it under an "On hold" parent.
- Do not write due or start dates in the text; set them with `set_schedule`.
- **Keep notes such as research, comparisons, and design memos as Markdown documents
  (`create_document`) under the related item.** Draw diagrams in ```mermaid blocks
  (the app renders them as diagrams). Documents cannot be edited, so to revise one,
  create a new document and delete the old one.
- When asked about progress, do not answer from memory: re-read with `list_elements` first
  (items checked directly in the app are not visible until you re-read).
- Before moving, closing, or deleting items, re-read their current state. Never uncheck items a person has checked.
````

The reasons:

| Rule | Why |
|---|---|
| Keep "things to do later" only in mmm | When tasks are scattered, both the next AI session and you miss what is left |
| List tasks under a parent per version | Drilling down shows what is left for each version at a glance |
| Check off right away | The number of unchecked items is exactly the remaining work |
| Keep notes as Markdown documents under the task | The task and its rationale sit together, one tap away, and they survive closing the chat |
| Draw diagrams in Mermaid | The app renders them as diagrams, and an AI reading them later still understands the content |
| Re-read when asked | The MCP server does not learn about changes made in the app on its own |

- Creating Markdown documents requires MCP server 0.4.0 or later and app 5.3.0 or later.
- On the free plan, each map can hold up to 3 documents.

## Updating to the Latest Version

### Claude Desktop extension (.mcpb)

Download the latest [mmm-mcp-server.mcpb](https://github.com/nhorie-canal/mmm_mcp/releases/latest/download/mmm-mcp-server.mcpb). In Claude Desktop, uninstall the Matryoshka Mind Map extension, then double-click the new file and install it. You stay signed in.

### Registered with `npx`

If your registration in Step 5 of the [setup guide](https://github.com/nhorie-canal/mmm_mcp/blob/main/docs/setup.md) uses `mmm-mcp-server@latest`, the latest version is used every time your AI agent starts, so there is nothing to do.

If you registered with `npx -y mmm-mcp-server` (without `@latest`), you may still be running the old version that was downloaded the first time. Update the registration as follows (you do not need to log in again).

#### Claude Code

Remove the registration, then register it again.

```bash
claude mcp remove mmm
```

```bash
claude mcp add mmm -- npx -y mmm-mcp-server@latest
```

If you registered with `--scope user`, add `--scope user` to both commands.

```bash
claude mcp remove mmm --scope user
```

```bash
claude mcp add mmm --scope user -- npx -y mmm-mcp-server@latest
```

#### Claude Desktop

Change `"args"` in `claude_desktop_config.json` to `["-y", "mmm-mcp-server@latest"]`, save it, and restart Claude Desktop.

## Troubleshooting

| Symptom | Cause / Solution |
|---|---|
| `node --version` says "command not found" | Node.js from Step 3 of the [setup guide](https://github.com/nhorie-canal/mmm_mcp/blob/main/docs/setup.md) is not installed yet. After installing, close the terminal and open it again. |
| "Wrong password" when logging in | See the note in Step 4 of the [setup guide](https://github.com/nhorie-canal/mmm_mcp/blob/main/docs/setup.md). Try logging in with Google or Apple instead. |
| The agent does not operate on your maps when asked | Check that the registration in Step 5 of the [setup guide](https://github.com/nhorie-canal/mmm_mcp/blob/main/docs/setup.md) is correct. Claude Desktop needs a restart after registration. |
| The agent will not show map contents / stops at the confirmation | Check that you answered "yes" when asked for permission to read. |
| The AI cannot load a large map | With several hundred elements or more, the `list_elements` response gets large and may not fit in one go. Some AI agents handle this by saving it to a file and reading only the parts they need. If it happens often, split the map (swiping left on a top-level element turns it and everything under it into a separate map). |

## Advanced Example: Recording Tasks per Folder Automatically

What follows is **just one example of how it can be used**. It is not a standard workflow recommended for everyone, but shows what becomes possible with this kind of setup. Feel free to ignore it if it does not suit you.

**Goal**: Pair each folder (project) you work on in Claude Code with a map of the same name, and have the AI agent record and update tasks that come up during work in that map in real time, without asking.

> Setting (2) below uses Claude Code's "global CLAUDE.md", an instruction file that is always loaded. If your AI agent has a similar feature for instructions loaded every time, the same idea should apply.

### Setup

**(1) Re-register the mmm server so it is available in every folder**

When registering with Claude Code, the `mmm` tool is only available in the current folder by default. To use it no matter which folder you start `claude` in, register it with `--scope user`:

```bash
claude mcp add mmm --scope user -- npx -y mmm-mcp-server@latest
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
- Only `list_elements` and `read_document`, which read map contents, have confirmation enforced on the server side out of consideration for confidential information (see "Try It Out" in the [setup guide](https://github.com/nhorie-canal/mmm_mcp/blob/main/docs/setup.md)). This does not change with the per-folder workflow: confirmation happens once, the first time a map is read in that process.

### Caveats

- Maps are created automatically for every folder, so work-log style maps will mix in with your carefully curated mind maps. Some people may find this cluttered. Adjust it to suit you, for example by using a separate account or limiting it to certain folders.
- Skipping confirmation for `create_map` applies only when you spell out this workflow in your own CLAUDE.md. Without any setup, the agent confirms in the conversation before creating a map, as usual.

## About This Tool

- Your login credentials (refresh token) are stored only on your computer (macOS: `~/.config/mmm-mcp/credentials.json`, Windows: `C:\Users\<username>\.config\mmm-mcp\credentials.json`) and are never sent anywhere else.
- Your map contents are read from and written to your Firebase account directly, without going through any third-party server, including the developer's (only when logging in with Apple, the last step of login goes through a signing-only relay server, but your map contents never pass through it).
- There is no always-running process; it runs only while you are in a conversation with your AI agent.
