# agentim

CLI tool for connecting AI coding agents to [AgentIM](https://github.com/NoPKT/AgentIM).

## Installation

```bash
npm install -g agentim
```

## Quick Start

```bash
# Login to your AgentIM server
agentim login -s http://localhost:3000 -u admin -p YourPassword

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
| `gemini`      | Google Gemini CLI              |
| `cursor`      | Cursor Editor Agent            |
| `generic`     | Any CLI tool (custom commands) |

## Commands

- `agentim login` -- Authenticate with an AgentIM server
- `agentim logout` -- Clear saved credentials
- `agentim claude [path]` -- Start a Claude Code agent
- `agentim codex [path]` -- Start a Codex agent
- `agentim gemini [path]` -- Start a Gemini CLI agent
- `agentim daemon` -- Start daemon mode (server-managed agents)
- `agentim status` -- Show configuration status

## License

AGPL-3.0 -- see [LICENSE](../../LICENSE)
