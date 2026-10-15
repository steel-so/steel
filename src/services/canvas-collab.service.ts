import { createHash } from 'node:crypto'
import * as Y from 'yjs'
import { logger } from '@/lib/axiom/logger'
import { appError } from '@/src/errors/app-error'
import { isRecord } from '@/src/lib/canvas/rules'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import {
  type CanvasCollabTarget,
  parseCanvasDocumentName,
} from '@/src/lib/canvas-collab/names'
import { readCanvas } from '@/src/lib/canvas-collab/project'
import {
  headerOf,
  mergeExternal,
  nodesOf,
  seedYDoc,
} from '@/src/lib/canvas-collab/ydoc'
import {
  isEmailCanvasDocument,
  openEmailDocument,
} from '@/src/lib/canvas-email/convert-v1'
import { err, ok, type Result } from '@/src/lib/result'
import {
  CanvasCollabRepository,
  type CanvasCollabScope,
} from '@/src/repositories/canvas-collab.repository'
import type { EmailCanvasDocument } from '@/src/schemas/crm-email-builder.schema'
import { assertModuleMember } from './authz'
import { CrmEmailTemplateService } from './crm-email-template.service'
import { assertSitesPermission, authorizeSite } from './site-access'
import { SiteGlobalService } from './site-global.service'
import { SitePageService } from './site-page.service'

/** Origin of the realtime server's own writes into a Y document. */
export const SERVER_ORIGIN = 'canvas-collab:server'

const notFound = () =>
  appError('CANVAS_COLLAB_NOT_FOUND', 'Documento não encontrado')

/** JSON with sorted keys: the same document hashes the same however its
 * keys were ordered (Postgres `jsonb` reorders them). */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item ?? null)).join(',')}]`
  }
  if (isRecord(value)) {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function documentHash(doc: CanvasDocument): string {
  return createHash('sha256')
    .update(stableStringify({ ...doc, nodes: doc.nodes }))
    .digest('hex')
}

function lookupScope(
  target: CanvasCollabTarget,
): Promise<Result<CanvasCollabScope>> {
  switch (target.kind) {
    case 'site-page':
      return CanvasCollabRepository.findSitePage(target.id)
    case 'site-global':
      return CanvasCollabRepository.findSiteGlobal(target.id)
    case 'email-template':
      return CanvasCollabRepository.findEmailTemplate(target.id)
  }
}

/** The stored document as a canvas document (e-mail v1 is converted, as
 * the editor does when it opens it). */
function canvasOf(
  target: CanvasCollabTarget,
  stored: unknown,
): CanvasDocument | null {
  if (target.kind === 'email-template') return openEmailDocument(stored)
  const doc = stored as CanvasDocument | null
  return isRecord(doc) && isRecord(doc.nodes) && typeof doc.rootId === 'string'
    ? doc
    : null
}

async function resolve(documentName: string): Promise<
  Result<{
    target: CanvasCollabTarget
    scope: CanvasCollabScope
    document: CanvasDocument
    /** A v1 e-mail document converted on the fly (fresh ids each time). */
    converted: boolean
  }>
> {
  const target = parseCanvasDocumentName(documentName)
  if (!target) return err(notFound())
  const scope = await lookupScope(target)
  if (!scope.ok) return scope
  const document = canvasOf(target, scope.value.document)
  if (!document) return err(notFound())
  const converted =
    target.kind === 'email-template' &&
    !isEmailCanvasDocument(scope.value.document)
  return ok({ target, scope: scope.value, document, converted })
}

export interface CanvasCollabAccess {
  workspaceId: string
  /** Can view but not edit: the realtime server drops their updates. */
  readOnly: boolean
}

/** Same gates as the REST routes of each document. */
async function authorizeTarget(
  actorId: string,
  target: CanvasCollabTarget,
  scope: CanvasCollabScope,
): Promise<Result<CanvasCollabAccess>> {
  const { workspaceId } = scope
  if (target.kind === 'email-template') {
    const view = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'VIEW',
    })
    if (!view.ok) return view
    const edit = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'EDIT',
    })
    return ok({ workspaceId, readOnly: !edit.ok })
  }
  const site = await authorizeSite(
    actorId,
    workspaceId,
    scope.siteId as string,
    'VIEW',
  )
  if (!site.ok) return site
  const edit = await assertSitesPermission(actorId, workspaceId, 'EDIT')
  return ok({ workspaceId, readOnly: !edit.ok })
}

/** Writes through the owning service: same validation, permissions and
 * audit as a REST save. Resolves the document as stored. */
async function persistThroughService(
  actorId: string,
  target: CanvasCollabTarget,
  scope: CanvasCollabScope,
  doc: CanvasDocument,
): Promise<Result<unknown>> {
  switch (target.kind) {
    case 'site-page': {
      const saved = await SitePageService.update(
        actorId,
        scope.workspaceId,
        scope.siteId as string,
        target.id,
        { document: doc as never },
      )
      return saved.ok ? ok(saved.value.document) : saved
    }
    case 'site-global': {
      const saved = await SiteGlobalService.update(
        actorId,
        scope.workspaceId,
        scope.siteId as string,
        target.id,
        { document: doc as never },
      )
      return saved.ok ? ok(saved.value.document) : saved
    }
    case 'email-template': {
      const saved = await CrmEmailTemplateService.update(
        actorId,
        scope.workspaceId,
        target.id,
        { builderDocument: doc as unknown as EmailCanvasDocument },
      )
      return saved.ok ? ok(saved.value.builderDocument) : saved
    }
  }
}

/** Server-side memory of one loaded room: the last stored document. */
interface RoomBase {
  workspaceId: string
  doc: CanvasDocument
  hash: string
  /** The Yjs state row matches `hash`. */
  stateSaved: boolean
}

export type CanvasStoreOutcome = 'saved' | 'unchanged' | 'reverted'

function clearYDoc(ydoc: Y.Doc): void {
  ydoc.transact(() => {
    const header = headerOf(ydoc)
    for (const key of [...header.keys()]) header.delete(key)
    const nodes = nodesOf(ydoc)
    for (const key of [...nodes.keys()]) nodes.delete(key)
  }, SERVER_ORIGIN)
}

/**
 * Real-time co-editing of canvas documents on the realtime server
 * (`realtime/index.ts`). Rooms are `canvas.<kind>.<id>` (see names.ts).
 *
 * - `authenticate`: workspace membership + module permission, like REST;
 *   view-only users join read-only.
 * - `load`: the stored Yjs state, merged with any change made to the JSON
 *   document since (REST autosave of an editor that was offline, version
 *   restore, AI generator), or a fresh seed of the JSON document.
 * - `reconcile`: the same merge for a room already in memory, when someone
 *   joins (a version was restored while others had the page open).
 * - `store` (debounced by Hocuspocus, and on demand via the flush message):
 *   the projected document goes through the owning service — validation,
 *   permissions, audit — so REST reads, versions and publishing see it. A
 *   refused document (invalid or not allowed for that user) is reverted in
 *   the shared state to the last stored one.
 */
export function createCanvasCollabRuntime() {
  const rooms = new Map<string, RoomBase>()

  return {
    rooms,

    async authenticate(
      actorId: string,
      documentName: string,
    ): Promise<Result<CanvasCollabAccess>> {
      const resolved = await resolve(documentName)
      if (!resolved.ok) return resolved
      return authorizeTarget(
        actorId,
        resolved.value.target,
        resolved.value.scope,
      )
    },

    async load(documentName: string, ydoc: Y.Doc): Promise<Result<true>> {
      const resolved = await resolve(documentName)
      if (!resolved.ok) return resolved
      const { scope, document, converted } = resolved.value
      // A converted v1 template is saved as v2 on the first store, so the
      // ids it got now stay (a later conversion would make new ones).
      const hash = converted ? '' : documentHash(document)
      const row = await CanvasCollabRepository.findState(documentName)
      if (!row.ok) return row

      let stateSaved = false
      if (row.value) {
        Y.applyUpdate(ydoc, row.value.state, SERVER_ORIGIN)
        const stored = readCanvas(ydoc)
        if (!stored) {
          clearYDoc(ydoc)
          seedYDoc(ydoc, document, SERVER_ORIGIN)
        } else if (row.value.documentHash !== hash) {
          mergeExternal(ydoc, stored.doc, document, SERVER_ORIGIN)
          logger.info('canvas_collab.load.merged_external', {
            component: 'Realtime',
            documentName,
          })
        } else {
          stateSaved = true
        }
      } else {
        seedYDoc(ydoc, document, SERVER_ORIGIN)
      }
      rooms.set(documentName, {
        workspaceId: scope.workspaceId,
        doc: document,
        hash,
        stateSaved,
      })
      return ok(true)
    },

    async reconcile(
      documentName: string,
      ydoc: Y.Doc,
    ): Promise<Result<boolean>> {
      const room = rooms.get(documentName)
      if (!room) return ok(false)
      const resolved = await resolve(documentName)
      if (!resolved.ok) return resolved
      const { document, converted } = resolved.value
      if (converted) return ok(false)
      const hash = documentHash(document)
      if (hash === room.hash) return ok(false)
      mergeExternal(ydoc, room.doc, document, SERVER_ORIGIN)
      rooms.set(documentName, {
        ...room,
        doc: document,
        hash,
        stateSaved: false,
      })
      logger.info('canvas_collab.reconcile.merged_external', {
        component: 'Realtime',
        documentName,
      })
      return ok(true)
    },

    async store(
      documentName: string,
      ydoc: Y.Doc,
      actorId: string,
    ): Promise<Result<CanvasStoreOutcome>> {
      const room = rooms.get(documentName)
      const target = parseCanvasDocumentName(documentName)
      if (!room || !target) return err(notFound())
      const projection = readCanvas(ydoc)
      if (!projection) return err(notFound())
      const current = projection.doc
      const hash = documentHash(current)

      let outcome: CanvasStoreOutcome = 'unchanged'
      let stored = room
      if (hash !== room.hash) {
        const scope = await lookupScope(target)
        if (!scope.ok) return scope
        const saved = await persistThroughService(
          actorId,
          target,
          scope.value,
          current,
        )
        if (!saved.ok) {
          if (saved.error.code === 'DATABASE_ERROR') return saved
          // Refused (invalid document, admin-only element, no permission):
          // everyone goes back to the last stored document.
          mergeExternal(ydoc, current, room.doc, SERVER_ORIGIN)
          logger.warn('canvas_collab.store.reverted', {
            component: 'Realtime',
            documentName,
            userId: actorId,
            reason: saved.error.code,
          })
          return ok('reverted')
        }
        const document = canvasOf(target, saved.value) ?? current
        const savedHash = documentHash(document)
        // The service normalized something: mirror it in the shared state.
        if (savedHash !== hash) {
          mergeExternal(ydoc, current, document, SERVER_ORIGIN)
        }
        stored = {
          workspaceId: room.workspaceId,
          doc: document,
          hash: savedHash,
          stateSaved: false,
        }
        rooms.set(documentName, stored)
        outcome = 'saved'
      }

      if (!stored.stateSaved) {
        const state = await CanvasCollabRepository.saveState({
          documentName,
          workspaceId: stored.workspaceId,
          state: Y.encodeStateAsUpdate(ydoc),
          documentHash: stored.hash,
        })
        if (!state.ok) return state
        rooms.set(documentName, { ...stored, stateSaved: true })
      }
      return ok(outcome)
    },

    unload(documentName: string): void {
      rooms.delete(documentName)
    },
  }
}

export type CanvasCollabRuntime = ReturnType<typeof createCanvasCollabRuntime>
