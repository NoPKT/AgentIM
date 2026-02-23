# agentim

CLI tool for connecting AI coding agents to [AgentIM](https://github.com/NoPKT/AgentIM).

## Installation

```bash
npm install -g agentim
```

Both `agentim` and `aim` are available as CLI commands.

## Quick Start

```bash
# Login to your AgentIM server
AGENTIM_PASSWORD=YourPassword aim login -s http://localhost:3000 -u admin

# Configure agent credentials (interactive wizard)
aim setup claude-code

# Start a Claude Code agent in the current directory (interactive mode)
aim claude

# Start with bypass permissions (auto-approve all tool calls)
aim claude /path/to/project -y

# Start the daemon (server can remotely launch agents)
aim daemon
```

## Supported Agents

| Type          | Description                    |
| ------------- | ------------------------------ |
| `claude-code` | Anthropic Claude Code CLI      |
| `codex`       | OpenAI Codex CLI               |
| `gemini`      | Google Gemini CLI *(coming soon)* |
| `generic`     | Any CLI tool (custom commands) |
| Custom        | User-defined via `~/.agentim/adapters.json` |

## Commands

- `aim login` -- Authenticate with an AgentIM server
- `aim logout` -- Clear saved credentials
- `aim setup [agent-type]` -- Interactive setup wizard for agent credentials
- `aim claude [path]` -- Start a Claude Code agent (default: current directory)
- `aim codex [path]` -- Start a Codex agent
- `aim gemini [path]` -- Start a Gemini CLI agent
- `aim daemon` -- Start daemon mode (server-managed agents)
- `aim list` -- List running agent daemons
- `aim stop <name>` -- Gracefully stop a running agent daemon
- `aim rm <name>` -- Stop and clean up an agent daemon
- `aim adapters` -- List all available adapter types (built-in + custom)
- `aim status` -- Show configuration status

### Permission Modes

Agent commands (`claude`, `codex`, `gemini`, `daemon`) support a `-y, --yes` flag to control permission behavior:

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

The built-in daemon mode (`aim claude .`) spawns a detached background process but does not automatically restart on crashes. For long-running production use, wrap the command with a process manager:

```bash
# PM2
pm2 start "aim claude /path/to/project --foreground" --name my-agent

# systemd (create a unit file)
# ExecStart=/usr/bin/aim claude /path/to/project --foreground
```

Use `--foreground` when managed by an external supervisor so the process stays in the foreground.

## License

AGPL-3.0 -- see [LICENSE](../../LICENSE)
