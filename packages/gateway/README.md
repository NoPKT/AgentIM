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

# Start a Claude Code agent
aim start --agent my-claude:claude-code:/path/to/project

# Start multiple agents
aim start \
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
- `aim start` -- Start one or more agents and connect to the server
- `aim logout` -- Clear saved credentials

## License

AGPL-3.0 -- see [LICENSE](../../LICENSE)
