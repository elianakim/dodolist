# todos

A minimal, local-first todo manager. No cloud, no accounts, no dependencies — just Node.js and a browser.

## Features

- **P0–P3 priority tabs** (Urgent & Important → Someday)
- **Today panel** — pin tasks, track daily progress
- **Celebration** — custom GIFs and messages when you complete a task
- **Archive** with a GitHub-style activity heatmap
- **Sidebar** — activity calendar, cheer squad stats, recent completions
- **Keyboard-first** — navigate, check, pin, and delete without touching the mouse
- **Drag to reorder** tasks within a priority
- **Subtasks, due dates, recurring tasks, notes**
- **Customizable colors** via Settings

## Requirements

- [Node.js](https://nodejs.org) v18 or later
- macOS (for the auto-start setup script; the server itself runs anywhere)

## Quick start

```bash
git clone <repo-url>
cd todos
bash setup.sh        # installs as a background service, auto-starts on login
```

Then open **http://localhost:3000**.

The setup script:
- Finds your `node` installation automatically
- Installs a macOS Launch Agent so the server starts on every login
- Restarts the server automatically if it crashes

### Run manually (no auto-start)

```bash
node server.js
```

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `/` | Focus quick-add input |
| `↑ ↓` | Navigate tasks |
| `Enter` | Expand / collapse task |
| `x` | Check / uncheck task |
| `t` | Pin to Today |
| `d` | Delete task |
| `1–4` | Switch tab (P0–P3) |
| `⌘K` | Search |
| `Esc` | Deselect / close |

Hover a task card and press `x`, `t`, or `d` to act on it without keyboard-navigating to it first.

## Managing the background service

```bash
# Stop
launchctl unload ~/Library/LaunchAgents/todos.plist

# Start
launchctl load ~/Library/LaunchAgents/todos.plist

# Check status
launchctl list | grep todos

# View logs
tail -f logs/server.log
tail -f logs/server-error.log

# Remove entirely (won't auto-start anymore)
launchctl unload ~/Library/LaunchAgents/todos.plist
rm ~/Library/LaunchAgents/todos.plist
```

## Data

All data lives in `data/` and is never sent anywhere:

| File | Contents |
|------|----------|
| `data/todos.json` | Tasks and archive |
| `data/settings.json` | Colors, GIFs, celebration messages |
| `data/gifs/` | Uploaded GIF files |

Both JSON files are auto-created with defaults on first run.

## GIF sources

Favorite source: [slackemojis.com](https://slackemojis.com/)

 `data/todos.json` and `data/settings.json` are gitignored — your data stays local. Only `data/gifs/twerking_pikachu.gif` (the bundled default) is tracked.
