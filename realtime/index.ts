import { readFileSync } from 'node:fs'
import { logger } from '@/lib/axiom/logger'
import {
  REALTIME_PORT,
  REDIS_TLS_CA_PATH,
  REDIS_TLS_ENABLED,
  REDIS_URL
} from '@/lib/env/_server'
import { Server } from '@hocuspocus/server'
import { Redis } from '@hocuspocus/extension-redis'
import { WikiPageRepository } from '@/src/repositories/wiki-page.repository'
import { auth } from '@/src/lib/auth'
import {
  assertWikiMember,
  isWikiPageReadOnlyFor
} from '@/src/services/_wiki-access'
import { getQueueConnection } from '@/src/lib/queue/connection'
import {
  parseWikiLockMessage,
  WIKI_LOCK_CHANNEL,
  wikiLockStatelessPayload
} from '@/src/lib/wiki-lock-channel'
import * as Y from 'yjs'
import {
  CANVAS_FLUSH,
  CANVAS_FLUSHED,
  isCanvasDocumentName,
  parseCanvasStateless,
} from '@/src/lib/canvas-collab/names'
import { createCanvasCollabRuntime } from '@/src/services/canvas-collab.service'

const redisUrl = new URL(REDIS_URL)

/** Canvas documents (site pages/globals, e-mail templates v2) share this
 * server with the Wiki; their rooms are `canvas.<kind>.<id>`. */
const canvas = createCanvasCollabRuntime()

const server = new Server({
  port: REALTIME_PORT,

  extensions: [
    new Redis({
      host: redisUrl.hostname,
      port: Number(redisUrl.port) || 6379,
      options: {
        password: redisUrl.password || undefined,
        // `rediss://host:port/13` — keeps a worktree's logical DB, as the app does.
        db: Number(redisUrl.pathname.slice(1)) || 0,
        ...(REDIS_TLS_ENABLED && {
          tls: REDIS_TLS_CA_PATH
            ? { ca: readFileSync(REDIS_TLS_CA_PATH) }
            : {}
        })
      }
    })
  ],

  async onAuthenticate({ documentName, requestHeaders, connectionConfig }) {
    const cookie = requestHeaders.cookie
    if (!cookie) {
      logger.warn('realtime.authenticate.failed', {
        component: 'Realtime',
        documentName,
        reason: 'missing_cookie'
      })
      throw new Error('Missing session cookie')
    }

    const session = await auth.api.getSession({
      headers: new Headers({ cookie })
    })
    if (!session) {
      logger.warn('realtime.authenticate.failed', {
        component: 'Realtime',
        documentName,
        reason: 'no_session'
      })
      throw new Error('Not authenticated')
    }

    if (isCanvasDocumentName(documentName)) {
      const access = await canvas.authenticate(session.user.id, documentName)
      if (!access.ok) {
        logger.warn('realtime.authenticate.failed', {
          component: 'Realtime',
          documentName,
          userId: session.user.id,
          reason: access.error.code
        })
        throw new Error('Forbidden')
      }
      // View-only users join read-only, like the Wiki's edit lock.
      connectionConfig.readOnly = access.value.readOnly
      // Someone saved this document outside the room (REST autosave of an
      // editor that had no realtime, version restore): merge it in before
      // the new editor syncs.
      const loaded = server.hocuspocus.documents.get(documentName)
      if (loaded) await canvas.reconcile(documentName, loaded)
      logger.info('realtime.authenticate.success', {
        component: 'Realtime',
        documentName,
        userId: session.user.id,
        readOnly: access.value.readOnly
      })
      return { userId: session.user.id }
    }

    const page = await WikiPageRepository.findById(documentName)
    if (!page.ok) {
      logger.warn('realtime.authenticate.failed', {
        component: 'Realtime',
        documentName,
        userId: session.user.id,
        reason: 'page_not_found'
      })
      throw new Error('Wiki page not found')
    }

    const membership = await assertWikiMember(
      session.user.id,
      page.value.workspaceId
    )
    if (!membership.ok) {
      logger.warn('realtime.authenticate.failed', {
        component: 'Realtime',
        documentName,
        userId: session.user.id,
        reason: 'forbidden'
      })
      throw new Error('Forbidden')
    }

    // Edit lock: whoever can't manage it joins read-only — Hocuspocus drops
    // their document updates and tells the provider (`authorizedScope`).
    const readOnly = isWikiPageReadOnlyFor(
      page.value,
      session.user.id,
      membership.value.isPrivileged
    )
    connectionConfig.readOnly = readOnly

    logger.info('realtime.authenticate.success', {
      component: 'Realtime',
      documentName,
      userId: session.user.id,
      readOnly
    })

    return { userId: session.user.id }
  },

  async onConnect({ documentName }) {
    logger.info('realtime.connect', { component: 'Realtime', documentName })
  },

  async onDisconnect({ documentName }) {
    logger.info('realtime.disconnect', { component: 'Realtime', documentName })
  },

  async onLoadDocument({ documentName, document }) {
    if (isCanvasDocumentName(documentName)) {
      const loaded = await canvas.load(documentName, document)
      if (!loaded.ok) {
        logger.error('realtime.load_document.failed', {
          component: 'Realtime',
          documentName,
          reason: loaded.error.code
        })
        throw new Error('Canvas document not available')
      }
      return document
    }
    const page = await WikiPageRepository.findById(documentName)
    if (!page.ok) {
      logger.error('realtime.load_document.failed', {
        component: 'Realtime',
        documentName,
        reason: page.error.code
      })
      return document
    }
    if (page.value.yjsState) {
      Y.applyUpdate(document, page.value.yjsState)
    }
    return document
  },

  // The canvas editor asks for an immediate save before it records a
  // version, publishes or switches pages (`canvas.flush`); the debounced
  // store would come too late for those.
  async onStateless({ connection, documentName, document, payload }) {
    if (!isCanvasDocumentName(documentName)) return
    const message = parseCanvasStateless(payload)
    if (message?.type !== CANVAS_FLUSH) return
    const userId = (connection.context as { userId?: string }).userId
    const ok =
      !connection.readOnly && !!userId
        ? await storeCanvas(documentName, document, userId)
        : false
    connection.sendStateless(
      JSON.stringify({ type: CANVAS_FLUSHED, requestId: message.requestId, ok })
    )
  },

  async afterUnloadDocument({ documentName }) {
    if (isCanvasDocumentName(documentName)) canvas.unload(documentName)
  },

  async onStoreDocument({ documentName, document, context }) {
    if (isCanvasDocumentName(documentName)) {
      await storeCanvas(documentName, document, (context as { userId: string }).userId)
      return
    }
    const update = Y.encodeStateAsUpdate(document)
    const result = await WikiPageRepository.updateYjsState(documentName, {
      yjsState: update,
      updatedById: (context as { userId: string }).userId
    })
    if (!result.ok) {
      logger.error('realtime.store_document.failed', {
        component: 'Realtime',
        documentName,
        reason: result.error.code
      })
    }
  }
})

async function storeCanvas(
  documentName: string,
  document: Y.Doc,
  userId: string
): Promise<boolean> {
  const stored = await canvas.store(documentName, document, userId)
  if (!stored.ok) {
    logger.error('realtime.store_document.failed', {
      component: 'Realtime',
      documentName,
      userId,
      reason: stored.error.code
    })
    return false
  }
  if (stored.value !== 'unchanged') {
    logger.info('realtime.store_document.canvas', {
      component: 'Realtime',
      documentName,
      userId,
      outcome: stored.value
    })
  }
  return stored.value !== 'reverted'
}

server.listen()

// Edit-lock changes published by the app (`publishWikiLockChange`): tell the
// page's open editors (stateless message, so the UI refetches the page) and
// close their sockets — the provider reconnects about a second later and
// `onAuthenticate` hands each one the new permission. The raw socket is
// closed on purpose: `closeConnections()` only sends a per-document close
// message over the (multiplexed) socket, and the provider never
// re-authenticates after it.
const lockSubscriber = getQueueConnection().duplicate()
lockSubscriber.subscribe(WIKI_LOCK_CHANNEL).catch((error: Error) => {
  logger.error('realtime.lock.subscribe_failed', {
    component: 'Realtime',
    message: error.message
  })
})
lockSubscriber.on('message', (channel: string, payload: string) => {
  if (channel !== WIKI_LOCK_CHANNEL) return
  const message = parseWikiLockMessage(payload)
  if (!message) return
  const document = server.hocuspocus.documents.get(message.wikiPageId)
  if (!document) return
  document.broadcastStateless(wikiLockStatelessPayload(message))
  for (const socket of document.connections.keys()) {
    // 4205 = Hocuspocus "Reset Connection": the provider retries.
    socket.close(4205, 'Wiki page lock changed')
  }
  logger.info('realtime.lock.applied', {
    component: 'Realtime',
    documentName: message.wikiPageId,
    locked: message.lockedAt !== null
  })
})

logger.info('realtime.server.started', {
  component: 'Realtime',
  port: REALTIME_PORT
})

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  logger.info('realtime.server.shutdown_start', {
    component: 'Realtime',
    signal
  })

  try {
    await lockSubscriber.quit().catch(() => undefined)
    await server.destroy()
    await logger.flush()
  } catch (err) {
    const e = err as Error
    logger.error('realtime.server.shutdown_error', {
      component: 'Realtime',
      message: e.message,
      stack: e.stack
    })
  }

  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
