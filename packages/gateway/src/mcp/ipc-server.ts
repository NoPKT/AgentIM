/**
 * IPC Server — localhost HTTP server for communication between
 * stdio MCP server processes and the gateway process.
 *
 * The stdio MCP server (spawned by OpenCode/Codex) sends HTTP requests
 * to this IPC server, which bridges them to the McpContext.
 */

import http from 'node:http'
import type { McpContext } from './mcp-context.js'
import { createLogger } from '../lib/logger.js'

const log = createLogger('IpcServer')

export class IpcServer {
  private server: http.Server
  private port = 0

  constructor(private contexts: Map<string, McpContext>) {
    this.server = http.createServer((req, res) => this.handleRequest(req, res))
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address()
        if (!addr || typeof addr === 'string') {
          reject(new Error('Failed to get IPC server address'))
          return
        }
        this.port = addr.port
        log.info(`IPC server listening on 127.0.0.1:${this.port}`)
        resolve(this.port)
      })
      this.server.on('error', reject)
    })
  }

  getPort(): number {
    return this.port
  }

  stop() {
    this.server.close()
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    // Only accept requests from localhost
    const remoteAddr = req.socket.remoteAddress
    if (remoteAddr !== '127.0.0.1' && remoteAddr !== '::1' && remoteAddr !== '::ffff:127.0.0.1') {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }

    const body = await readBody(req)
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(body)
    } catch {
      res.writeHead(400)
      res.end(JSON.stringify({ error: 'Invalid JSON' }))
      return
    }

    const agentId = parsed.agentId as string
    if (!agentId) {
      res.writeHead(400)
      res.end(JSON.stringify({ error: 'Missing agentId' }))
      return
    }

    const ctx = this.contexts.get(agentId)
    if (!ctx) {
      res.writeHead(404)
      res.end(JSON.stringify({ error: `No context for agent ${agentId}` }))
      return
    }

    const url = req.url
    try {
      let result: unknown

      if (url === '/send-message') {
        result = await ctx.sendMessage(parsed.targetAgent as string, parsed.content as string)
      } else if (url === '/request-reply') {
        result = await ctx.requestReply(
          parsed.targetAgent as string,
          parsed.content as string,
          parsed.timeoutSeconds as number | undefined,
        )
      } else if (url === '/messages') {
        result = await ctx.getRoomMessages(parsed.limit as number | undefined)
      } else if (url === '/members') {
        result = await ctx.listRoomMembers()
      } else {
        res.writeHead(404)
        res.end(JSON.stringify({ error: 'Not found' }))
        return
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result))
    } catch (err) {
      log.error(`IPC handler error: ${(err as Error).message}`)
      res.writeHead(500)
      res.end(JSON.stringify({ error: (err as Error).message }))
    }
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString()))
    req.on('error', reject)
  })
}
