# agentim

CLI tool for connecting AI coding agents to [AgentIM](https://github.com/NoPKT/AgentIM).

Running `aim` with no arguments launches an **interactive TUI management panel** (built with Ink/React) where you can view, control, and monitor all your agents from the terminal.

## Installation

```bash
npm install -g agentim
```

Both `agentim` and `aim` are available as CLI commands.

## Quick Start

```bash
# Login to your AgentIM server
AGENTIM_PASSWORD=YourPassword aim login -s http://localhost:3000 -u admin

# Launch the interactive TUI management panel
aim

# Manage credentials (list, add, rename, delete, set default)
aim claude token

# Start a Claude Code agent in the current directory
aim claude

# Start with a specific credential (-c shorthand)
aim claude -c work-api /path/to/project

# Start with bypass permissions (auto-approve all tool calls)
aim claude /path/to/project -y

# Run the gateway in foreground mode
aim gateway

# Run the gateway as a background daemon
aim gateway -d
```

## Supported Agents

| Type          | Description                    |
| ------------- | ------------------------------ |
| `claude-code` | Anthropic Claude Code CLI      |
| `codex`       | OpenAI Codex CLI               |
| `gemini`      | Google Gemini CLI                 |
| `generic`     | Any CLI tool (custom commands) |
| Custom        | User-defined via `~/.agentim/adapters.json` |

## Commands

- `aim` -- Launch the interactive TUI management panel (login screen → dashboard with agent list, details, log viewer, and hotkey action bar)
- `aim gateway` -- Run the gateway in foreground mode (server can remotely launch agents)
- `aim gateway -d` -- Run the gateway as a background daemon
- `aim login` -- Authenticate with an AgentIM server (scripting)
- `aim logout` -- Clear saved credentials (scripting)
- `aim claude [path]` -- Start a Claude Code agent (default: current directory)
- `aim claude token` -- Manage Claude Code credentials (list, add, rename, delete, set default)
- `aim codex [path]` -- Start a Codex agent
- `aim codex token` -- Manage Codex credentials
- `aim gemini [path]` -- Start a Gemini CLI agent
- `aim gemini token` -- Manage Gemini credentials
- `aim list` -- List running agent daemons
- `aim stop <name>` -- Gracefully stop a running agent daemon
- `aim rm <name>` -- Stop and clean up an agent daemon
- `aim adapters` -- List all available adapter types (built-in + custom)
- `aim status` -- Show configuration status

### TUI Hotkeys

When the TUI panel is open, the following keys are available:

| Key          | Action                          |
| ------------ | ------------------------------- |
| Arrow keys   | Navigate the agent list         |
| `G`          | Toggle gateway on/off           |
| `R`          | Rename the selected agent       |
| `S`          | Stop the selected agent         |
| `D`          | Delete the selected agent       |
| `L`          | View logs for the selected agent|
| `C`          | Manage credentials              |
| `O`          | Log out                         |
| `Q`          | Quit the TUI                    |

### Credential Management

Each agent type supports multiple named credentials. When starting an agent:

- **0 credentials**: You are prompted to add one interactively
- **1 credential**: Used automatically
- **N credentials**: Default credential is used, or you are prompted to select

Use `-c, --credential <name>` to specify a credential by name or ID prefix:

```bash
aim claude -c work-api /path/to/project
```

### Permission Modes

Agent commands (`claude`, `codex`, `gemini`) and the gateway subcommand support a `-y, --yes` flag to control permission behavior:

| Flag | Mode | Description |
|------|------|-------------|
| *(default)* | `interactive` | Tool calls require human approval via the Web UI |
| `-y` / `--yes` | `bypass` | All tool calls are auto-approved without confirmation |

In interactive mode, when an agent wants to use a tool (e.g., Bash, Write, Edit), a permission card appears in the chat UI with Allow/Deny buttons. If not responded to within 5 minutes, the request is automatically denied.

## Custom Adapters

You can define custom adapter types without modifying source code by creating `~/.agentim/adapters.json`:

```json
{
  "my-copilot": {
    "command": "copilot-cli",
    "args": ["--mode", "chat"],
    "promptVia": "stdin",
    "env": { "MODEL": "gpt-4" },
    "description": "My custom copilot adapter"
  }
}
```

Custom adapters use the `GenericAdapter` under the hood. List all available adapters with `aim adapters`.

## Running as a Service

The built-in daemon mode (`aim gateway -d` or `aim claude .`) spawns a detached background process but does not automatically restart on crashes. For long-running production use, wrap the command with a process manager:

```bash
# PM2 — gateway mode
pm2 start "aim gateway" --name agentim-gateway

# PM2 — single agent mode
pm2 start "aim claude /path/to/project --foreground" --name my-agent

# systemd (create a unit file)
# ExecStart=/usr/bin/aim gateway
```

When managed by an external supervisor, use `aim gateway` to run the gateway in foreground mode without the TUI. Use `--foreground` for agent subcommands (`aim claude --foreground`).

## License

AGPL-3.0 -- see [LICENSE](../../LICENSE)
