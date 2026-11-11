import { describe, expect, it, vi } from 'vitest'
import { seedDocumentImport } from '@/src/__tests__/factories/document-ai.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { createEmptyDocumentContent } from '@/src/lib/canvas-document/catalog'
import { prisma } from '@/src/lib/prisma'
import { DocumentImportRepository } from '../document-import.repository'

async function setup() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  return { workspace, user }
}

describe('DocumentImportRepository', () => {
  describe('create()', () => {
    it('should store the import with its progress', async () => {
      const { workspace, user } = await setup()

      const row = expectOk(
        await DocumentImportRepository.create({
          id: 'imp_create_1',
          workspaceId: workspace.id,
          mode: 'PDF',
          kind: 'CONTRACT',
          fileKey: `${workspace.id}/imports/imp_create_1/a.pdf`,
          fileName: 'a.pdf',
          fileSize: 1234,
          pageCount: 3,
          progress: { step: 'queued', message: 'Na fila', pct: 0 },
          createdById: user.id,
        }),
      )

      expect(row.id).toBe('imp_create_1')
      expect(row.status).toBe('PENDING')
      expect(row.kind).toBe('CONTRACT')
      expect(row.progress).toEqual({
        step: 'queued',
        message: 'Na fila',
        pct: 0,
      })
    })

    it('should return DATABASE_ERROR on a broken reference', async () => {
      expectErr(
        await DocumentImportRepository.create({
          workspaceId: 'missing',
          mode: 'PROMPT',
          kind: 'OTHER',
          prompt: 'x',
          progress: {},
          createdById: 'missing',
        }),
        'DATABASE_ERROR',
      )
    })
  })

  describe('findById()', () => {
    it('should scope the import to its workspace', async () => {
      const { workspace, user } = await setup()
      const other = await seedWorkspace()
      const seeded = await seedDocumentImport(workspace.id, user.id)

      const found = expectOk(
        await DocumentImportRepository.findById(seeded.id, workspace.id),
      )
      expect(found.id).toBe(seeded.id)
      expectErr(
        await DocumentImportRepository.findById(seeded.id, other.id),
        'DOCUMENT_IMPORT_NOT_FOUND',
      )
    })

    it('should return DATABASE_ERROR when the query fails', async () => {
      vi.spyOn(prisma.documentImport, 'findFirst').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(
        await DocumentImportRepository.findById('x', 'y'),
        'DATABASE_ERROR',
      )
    })
  })

  describe('countActive()', () => {
    it("should count the user's queued and running imports", async () => {
      const { workspace, user } = await setup()
      const other = await seedUser()
      await seedDocumentImport(workspace.id, user.id)
      await seedDocumentImport(workspace.id, user.id, { status: 'RUNNING' })
      await seedDocumentImport(workspace.id, user.id, { status: 'READY' })
      await seedDocumentImport(workspace.id, other.id)

      const count = await DocumentImportRepository.countActive(
        workspace.id,
        user.id,
      )
      expect(expectOk(count)).toBe(2)
    })

    it('should return DATABASE_ERROR when the query fails', async () => {
      vi.spyOn(prisma.documentImport, 'count').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(
        await DocumentImportRepository.countActive('x', 'y'),
        'DATABASE_ERROR',
      )
    })
  })

  describe('findForRun()', () => {
    it('should load by id only, or null', async () => {
      const { workspace, user } = await setup()
      const seeded = await seedDocumentImport(workspace.id, user.id)

      const found = expectOk(
        await DocumentImportRepository.findForRun(seeded.id),
      )
      expect(found?.id).toBe(seeded.id)
      const missing = await DocumentImportRepository.findForRun('nope')
      expect(expectOk(missing)).toBeNull()
    })

    it('should return DATABASE_ERROR when the query fails', async () => {
      vi.spyOn(prisma.documentImport, 'findUnique').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(
        await DocumentImportRepository.findForRun('x'),
        'DATABASE_ERROR',
      )
    })
  })

  describe('update()', () => {
    it('should change only the fields sent', async () => {
      const { workspace, user } = await setup()
      const seeded = await seedDocumentImport(workspace.id, user.id, {
        progress: { step: 'queued' },
      })

      const running = expectOk(
        await DocumentImportRepository.update(seeded.id, {
          status: 'RUNNING',
          model: 'anthropic:claude-sonnet-5',
        }),
      )
      expect(running.status).toBe('RUNNING')
      expect(running.progress).toEqual({ step: 'queued' })

      const failed = expectOk(
        await DocumentImportRepository.update(seeded.id, {
          status: 'FAILED',
          progress: { step: 'failed', message: 'Erro', pct: 100 },
          error: 'Erro',
          costUsd: 0.0123,
          finishedAt: new Date(),
        }),
      )
      expect(failed.progress).toEqual({
        step: 'failed',
        message: 'Erro',
        pct: 100,
      })
      expect(Number(failed.costUsd)).toBeCloseTo(0.0123)
      expect(failed.model).toBe('anthropic:claude-sonnet-5')
    })

    it('should return DATABASE_ERROR for an unknown id', async () => {
      expectErr(
        await DocumentImportRepository.update('missing', { status: 'READY' }),
        'DATABASE_ERROR',
      )
    })
  })

  describe('complete()', () => {
    it('should create the draft and its event, then close', async () => {
      const { workspace, user } = await setup()
      const seeded = await seedDocumentImport(workspace.id, user.id, {
        status: 'RUNNING',
      })

      const result = expectOk(
        await DocumentImportRepository.complete(
          seeded.id,
          {
            workspaceId: workspace.id,
            kind: 'PROPOSAL',
            title: 'Proposta importada',
            source: 'PDF_IMPORT',
            content: createEmptyDocumentContent(),
            theme: { primaryColor: '#123456' },
            settings: { layout: 'paged' },
            publicToken: `tok_${seeded.id}`,
            ownerId: user.id,
          },
          {
            progress: { step: 'done', message: 'Pronto', pct: 100 },
            costUsd: 0.05,
            model: 'anthropic:claude-sonnet-5',
          },
        ),
      )

      expect(result.document).toEqual(
        expect.objectContaining({
          workspaceId: workspace.id,
          status: 'DRAFT',
          kind: 'PROPOSAL',
          source: 'PDF_IMPORT',
          ownerId: user.id,
          createdById: user.id,
          theme: { primaryColor: '#123456' },
        }),
      )
      expect(result.import).toEqual(
        expect.objectContaining({
          status: 'READY',
          documentId: result.document.id,
          kind: 'PROPOSAL',
          error: null,
        }),
      )
      expect(result.import.finishedAt).toBeInstanceOf(Date)
      const events = await prisma.documentEvent.findMany({
        where: { documentId: result.document.id },
      })
      expect(events).toEqual([
        expect.objectContaining({
          type: 'CREATED',
          actorId: user.id,
          data: { source: 'PDF_IMPORT', importId: seeded.id },
        }),
      ])
    })

    it('should roll back when the import is gone', async () => {
      const { workspace, user } = await setup()

      expectErr(
        await DocumentImportRepository.complete(
          'missing',
          {
            workspaceId: workspace.id,
            kind: 'OTHER',
            title: 'X',
            source: 'AI_PROMPT',
            content: createEmptyDocumentContent(),
            theme: {},
            settings: {},
            publicToken: 'tok_rollback',
            ownerId: user.id,
          },
          { progress: {}, costUsd: 0, model: null },
        ),
        'DATABASE_ERROR',
      )
      expect(
        await prisma.document.count({ where: { workspaceId: workspace.id } }),
      ).toBe(0)
    })
  })
})
