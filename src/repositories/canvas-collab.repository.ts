import { appError } from '@/src/errors/app-error'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export interface CanvasCollabStateRow {
  state: Uint8Array
  documentHash: string
}

/** Where a co-edited document lives and its stored JSON document. */
export interface CanvasCollabScope {
  workspaceId: string
  /** Site of a page/global; `null` for e-mail templates. */
  siteId: string | null
  /** The stored document (raw JSON; e-mail templates may still be v1). */
  document: unknown
}

const notFound = () =>
  appError('CANVAS_COLLAB_NOT_FOUND', 'Documento não encontrado')

/**
 * Persistence of the real-time co-editing: the Yjs state rows and the
 * lookups that resolve a realtime room to its workspace. Writes of the
 * documents themselves go through the owning services.
 */
export const CanvasCollabRepository = {
  async findState(
    documentName: string,
  ): Promise<Result<CanvasCollabStateRow | null>> {
    try {
      const row = await prisma.canvasCollabState.findUnique({
        where: { documentName },
        select: { state: true, documentHash: true },
      })
      return ok(
        row
          ? { state: new Uint8Array(row.state), documentHash: row.documentHash }
          : null,
      )
    } catch (error) {
      return err(dbError('Failed to load canvas collab state', error))
    }
  },

  async saveState(data: {
    documentName: string
    workspaceId: string
    state: Uint8Array
    documentHash: string
  }): Promise<Result<true>> {
    try {
      const state = new Uint8Array(data.state)
      await prisma.canvasCollabState.upsert({
        where: { documentName: data.documentName },
        create: { ...data, state },
        update: { state, documentHash: data.documentHash },
      })
      return ok(true)
    } catch (error) {
      return err(dbError('Failed to save canvas collab state', error))
    }
  },

  async deleteState(documentName: string): Promise<Result<true>> {
    try {
      await prisma.canvasCollabState.deleteMany({ where: { documentName } })
      return ok(true)
    } catch (error) {
      return err(dbError('Failed to delete canvas collab state', error))
    }
  },

  async findSitePage(id: string): Promise<Result<CanvasCollabScope>> {
    try {
      const page = await prisma.sitePage.findUnique({
        where: { id },
        select: {
          siteId: true,
          document: true,
          site: { select: { workspaceId: true } },
        },
      })
      if (!page) return err(notFound())
      return ok({
        workspaceId: page.site.workspaceId,
        siteId: page.siteId,
        document: page.document,
      })
    } catch (error) {
      return err(dbError('Failed to find site page scope', error))
    }
  },

  async findSiteGlobal(id: string): Promise<Result<CanvasCollabScope>> {
    try {
      const global = await prisma.siteGlobal.findUnique({
        where: { id },
        select: {
          siteId: true,
          document: true,
          site: { select: { workspaceId: true } },
        },
      })
      if (!global) return err(notFound())
      return ok({
        workspaceId: global.site.workspaceId,
        siteId: global.siteId,
        document: global.document,
      })
    } catch (error) {
      return err(dbError('Failed to find site global scope', error))
    }
  },

  /** Visual-builder templates only (the v1/v2 check is the service's). */
  async findEmailTemplate(id: string): Promise<Result<CanvasCollabScope>> {
    try {
      const template = await prisma.crmEmailTemplate.findFirst({
        where: { id, deletedAt: null, kind: 'BUILDER' },
        select: { workspaceId: true, builderDocument: true },
      })
      if (!template) return err(notFound())
      return ok({
        workspaceId: template.workspaceId,
        siteId: null,
        document: template.builderDocument,
      })
    } catch (error) {
      return err(dbError('Failed to find e-mail template scope', error))
    }
  },
}
