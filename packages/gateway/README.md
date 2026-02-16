# @agentim/gateway

CLI gateway for connecting AI coding agents to [AgentIM](https://github.com/NoPKT/AgentIM).

## Installation

```bash
npm install -g @agentim/gateway
```

## Quick Start

```bash
# Login to your AgentIM server
aim login -s http://localhost:3000 -u admin -p YourPassword

# Start a single Claude Code agent
aim claude /path/to/project

# Start multiple agents in daemon mode
aim daemon \
  --agent frontend:claude-code:/frontend \
  --agent backend:claude-code:/backend
```

## Supported Agents

| Type | Description |
|------|-------------|
| `claude-code` | Anthropic Claude Code CLI |
| `codex` | OpenAI Codex CLI |
| `gemini` | Google Gemini CLI |
| `cursor` | Cursor Editor Agent |
| `generic` | Any CLI tool (custom commands) |

## Commands

- `aim login` -- Authenticate with an AgentIM server
- `aim logout` -- Clear saved credentials
- `aim claude [path]` -- Start a Claude Code agent
- `aim codex [path]` -- Start a Codex agent
- `aim gemini [path]` -- Start a Gemini CLI agent
- `aim daemon` -- Start multiple agents in daemon mode
- `aim status` -- Show configuration status

## License

AGPL-3.0 -- see [LICENSE](../../LICENSE)
