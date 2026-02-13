import { createNodeWebSocket } from '@hono/node-ws'
import type { Hono } from 'hono'
import { handleClientMessage, handleClientDisconnect } from './clientHandler.js'
import { handleGatewayMessage, handleGatewayDisconnect } from './gatewayHandler.js'

export function createWsHandler() {
  return { upgradeClient, upgradeGateway }
}

function upgradeClient(injectWebSocket: ReturnType<typeof createNodeWebSocket>['injectWebSocket']) {
  return {
    onOpen() {},
    onMessage(evt: { data: unknown }, ws: any) {
      const raw = typeof evt.data === 'string' ? evt.data : evt.data?.toString()
      if (raw) handleClientMessage(ws, raw)
    },
    onClose(_: unknown, ws: any) {
      handleClientDisconnect(ws)
    },
  }
}

function upgradeGateway(
  injectWebSocket: ReturnType<typeof createNodeWebSocket>['injectWebSocket'],
) {
  return {
    onOpen() {},
    onMessage(evt: { data: unknown }, ws: any) {
      const raw = typeof evt.data === 'string' ? evt.data : evt.data?.toString()
      if (raw) handleGatewayMessage(ws, raw)
    },
    onClose(_: unknown, ws: any) {
      handleGatewayDisconnect(ws)
    },
  }
}
