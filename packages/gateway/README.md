# agentim

CLI tool for connecting AI coding agents to [AgentIM](https://github.com/NoPKT/AgentIM).

## Installation

```bash
npm install -g agentim
```

## Quick Start

```bash
# Login to your AgentIM server
AGENTIM_PASSWORD=YourPassword agentim login -s http://localhost:3000 -u admin

# Configure agent credentials (interactive wizard)
agentim setup claude-code

# Start a single Claude Code agent
agentim claude /path/to/project

# Start the daemon (server can remotely launch agents)
agentim daemon
```

## Supported Agents

| Type          | Description                    |
| ------------- | ------------------------------ |
| `claude-code` | Anthropic Claude Code CLI      |
| `codex`       | OpenAI Codex CLI               |
| `gemini`      | Google Gemini CLI (SDK pending)|
| `generic`     | Any CLI tool (custom commands) |

## Commands

- `agentim login` -- Authenticate with an AgentIM server
- `agentim logout` -- Clear saved credentials
- `agentim setup [agent-type]` -- Interactive setup wizard for agent credentials
- `agentim claude [path]` -- Start a Claude Code agent
- `agentim codex [path]` -- Start a Codex agent
- `agentim gemini [path]` -- Start a Gemini CLI agent
- `agentim daemon` -- Start daemon mode (server-managed agents)
- `agentim list` -- List running agent daemons
- `agentim stop <name>` -- Gracefully stop a running agent daemon
- `agentim rm <name>` -- Stop and clean up an agent daemon
- `agentim status` -- Show configuration status

## Running as a Service

The built-in daemon mode (`agentim claude .`) spawns a detached background process but does not automatically restart on crashes. For long-running production use, wrap the command with a process manager:

```bash
# PM2
pm2 start "agentim claude /path/to/project --foreground" --name my-agent

# systemd (create a unit file)
# ExecStart=/usr/bin/agentim claude /path/to/project --foreground
```

Use `--foreground` when managed by an external supervisor so the process stays in the foreground.

## License

AGPL-3.0 -- see [LICENSE](../../LICENSE)
