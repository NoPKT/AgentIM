# Gateway Adapter Developer Guide

This guide explains how to add support for a new AI CLI agent in the AgentIM Gateway.

## Architecture Overview

The Gateway spawns CLI processes and bridges them with the AgentIM server via WebSocket. Each agent type has an **adapter** that knows how to:

1. Launch the CLI tool with the right arguments
2. Parse stdout/stderr into structured chunks (text, thinking, tool_use, etc.)
3. Accumulate the full response and signal completion
4. Stop/kill the process on demand

```
Server ←→ WebSocket ←→ Gateway AgentManager ←→ Adapter ←→ CLI Process
```

## Quick Start

### 1. Create the Adapter File

Create `packages/gateway/src/adapters/my-agent.ts`:

```typescript
import { spawn, type ChildProcess } from 'node:child_process'
import {
  BaseAgentAdapter,
  type AdapterOptions,
  type ChunkCallback,
  type CompleteCallback,
  type ErrorCallback,
  type MessageContext,
} from './base.js'

export class MyAgentAdapter extends BaseAgentAdapter {
  private process: ChildProcess | null = null

  constructor(opts: AdapterOptions) {
    super(opts)
  }

  get type() {
    return 'my-agent' as const
  }

  sendMessage(
    content: string,
    onChunk: ChunkCallback,
    onComplete: CompleteCallback,
    onError: ErrorCallback,
    context?: MessageContext,
  ) {
    if (this.isRunning) {
      onError('Agent is already processing a message')
      return
    }

    this.isRunning = true
    let fullContent = ''

    // Use buildPrompt() to inject room context and sender info
    const prompt = this.buildPrompt(content, context)

    // Launch the CLI — adapt arguments to your tool
    const proc = spawn('my-agent-cli', ['--prompt', prompt], {
      cwd: this.workingDirectory,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    this.process = proc

    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString()
      fullContent += text
      onChunk({ type: 'text', content: text })
    })

    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim()
      if (text) onChunk({ type: 'error', content: text })
    })

    proc.on('close', (code) => {
      this.isRunning = false
      this.process = null
      if (code === 0 || code === null) {
        onComplete(fullContent)
      } else {
        onError(`Process exited with code ${code}`)
      }
    })

    proc.on('error', (err) => {
      this.isRunning = false
      this.process = null
      onError(err.message)
    })
  }

  stop() {
    this.process?.kill('SIGTERM')
  }

  dispose() {
    this.stop()
  }
}
```

### 2. Register the Adapter

Edit `packages/gateway/src/adapters/index.ts`:

```typescript
// Add import
import { MyAgentAdapter } from './my-agent.js'

// Add export
export { MyAgentAdapter } from './my-agent.js'

// Add case in createAdapter()
case 'my-agent':
  return new MyAgentAdapter(opts)
```

### 3. Add the Agent Type to Shared Constants

Edit `packages/shared/src/constants.ts`:

```typescript
export const AGENT_TYPES = [
  'claude-code',
  'codex',
  'gemini',
  'cursor',
  'generic',
  'my-agent',
] as const
```

### 4. Add i18n Labels

In each locale file (`packages/shared/src/i18n/locales/{en,zh-CN,ja,ko}.ts`), add an entry under `agent`:

```typescript
agent: {
  // ...existing entries
  myAgent: 'My Agent',
}
```

## Base Class API

### `BaseAgentAdapter`

| Property / Method                                              | Description                                               |
| -------------------------------------------------------------- | --------------------------------------------------------- |
| `agentId: string`                                              | Unique agent ID assigned by the server                    |
| `agentName: string`                                            | Human-readable agent name                                 |
| `workingDirectory?: string`                                    | CWD for spawned processes                                 |
| `isRunning: boolean`                                           | Whether a message is being processed                      |
| `buildPrompt(content, context?)`                               | Prepends `[System: ...]` and `[From: ...]` to the message |
| `sendMessage(content, onChunk, onComplete, onError, context?)` | Abstract — implement this                                 |
| `stop()`                                                       | Abstract — kill the running process                       |
| `dispose()`                                                    | Abstract — cleanup resources                              |

### Chunk Types

The `onChunk` callback accepts a `ParsedChunk`:

```typescript
interface ParsedChunk {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'error'
  content: string
  metadata?: Record<string, unknown>
}
```

- **`text`** — Main response content (displayed as markdown)
- **`thinking`** — Internal reasoning / chain of thought (collapsible in UI)
- **`tool_use`** — Tool invocation (displayed with tool name badge)
- **`tool_result`** — Tool output (displayed as code block)
- **`error`** — Error text from stderr

### MessageContext

```typescript
interface MessageContext {
  roomId: string
  senderName: string
  routingMode?: 'broadcast' | 'direct'
  conversationId?: string
  depth?: number
  roomContext?: {
    systemPrompt?: string
    members?: Array<{ name: string; type: string; role: string }>
  }
}
```

## Advanced: Structured Output Parsing

For CLI tools that output structured JSON (like Claude Code's `--output-format stream-json`), parse each line in the stdout handler:

```typescript
proc.stdout?.on('data', (data: Buffer) => {
  this.buffer += data.toString()
  const lines = this.buffer.split('\n')
  this.buffer = lines.pop() ?? ''

  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line)
      const chunk = this.parseEvent(event) // your parsing logic
      if (chunk) {
        if (chunk.type === 'text') fullContent += chunk.content
        onChunk(chunk)
      }
    } catch {
      // Plain text fallback
      fullContent += line
      onChunk({ type: 'text', content: line })
    }
  }
})
```

## Testing

Add tests in `packages/gateway/test/gateway.test.ts`:

```typescript
describe('MyAgentAdapter', () => {
  it('creates adapter with correct type', () => {
    const adapter = createAdapter('my-agent', {
      agentId: 'test-id',
      agentName: 'test-agent',
    })
    assert.strictEqual(adapter.type, 'my-agent')
  })
})
```

Run tests:

```bash
pnpm --filter agentim test
```

## Existing Adapters Reference

| Adapter       | CLI          | Args Pattern                                        | Structured Output                      |
| ------------- | ------------ | --------------------------------------------------- | -------------------------------------- |
| `claude-code` | `claude`     | `-p <prompt> --output-format stream-json --verbose` | JSON events (thinking, tool_use, text) |
| `codex`       | `codex`      | `-q <prompt>`                                       | Plain text                             |
| `gemini`      | `gemini`     | `-p <prompt>`                                       | Plain text                             |
| `cursor`      | `cursor`     | `--message <prompt>`                                | Plain text                             |
| `generic`     | configurable | `<...args> <prompt>`                                | Plain text                             |
