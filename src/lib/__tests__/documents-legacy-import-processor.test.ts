import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { service, queue, loggerMock } = vi.hoisted(() => ({
  service: { listWorkspaces: vi.fn(), importWorkspace: vi.fn() },
  queue: { add: vi.fn(), getJob: vi.fn() },
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/src/services/document-legacy-import.service', () => ({
  DocumentLegacyImportService: service,
}))
vi.mock('@/src/lib/queue/queues', () => ({
  getDocumentsLegacyImportQueue: () => queue,
}))
vi.mock('@/lib/axiom/logger', () => ({ logger: loggerMock }))

import { DocumentsLegacyImportJob } from '@/src/lib/queue/jobs'
import {
  processDocumentsLegacyImport,
  workspaceJobId,
} from '@/src/lib/queue/processors/documents-legacy-import'

function fakeJob(name: string, data: unknown = {}, id = 'job-1'): Job {
  return { id, name, data } as unknown as Job
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('processDocumentsLegacyImport', () => {
  it('fans out one deduplicated job per legacy workspace', async () => {
    const finished = {
      isCompleted: vi.fn(async () => true),
      isFailed: vi.fn(async () => false),
      remove: vi.fn(async () => undefined),
    }
    queue.getJob.mockImplementation(async (id: string) =>
      id.endsWith('ws-a') ? finished : undefined,
    )
    service.listWorkspaces.mockResolvedValue({
      ok: true,
      value: ['ws-a', 'ws-b'],
    })

    const result = await processDocumentsLegacyImport(
      fakeJob(DocumentsLegacyImportJob.Run),
    )

    expect(result).toEqual({ workspaces: 2 })
    expect(queue.add).toHaveBeenCalledTimes(2)
    expect(queue.add).toHaveBeenNthCalledWith(
      1,
      DocumentsLegacyImportJob.ImportWorkspace,
      { workspaceId: 'ws-a' },
      { jobId: 'documents-legacy-import-ws-ws-a' },
    )
    // A finished job of a previous boot no longer blocks the fixed id.
    expect(finished.remove).toHaveBeenCalledTimes(1)
    expect(loggerMock.info).toHaveBeenCalledWith(
      'queue.documents_legacy_import.run_completed',
      expect.objectContaining({ workspaces: 2 }),
    )
  })

  it('throws so BullMQ retries when the workspace list fails', async () => {
    service.listWorkspaces.mockResolvedValue({
      ok: false,
      error: { code: 'DATABASE_ERROR', message: 'boom' },
    })
    await expect(
      processDocumentsLegacyImport(fakeJob(DocumentsLegacyImportJob.Run)),
    ).rejects.toThrow('DATABASE_ERROR')
    expect(queue.add).not.toHaveBeenCalled()
  })

  it('migrates one workspace and logs the summary', async () => {
    const summary = { templates: 2, proposals: 5, failed: 1 }
    service.importWorkspace.mockResolvedValue({ ok: true, value: summary })

    const result = await processDocumentsLegacyImport(
      fakeJob(DocumentsLegacyImportJob.ImportWorkspace, { workspaceId: 'w1' }),
    )

    expect(result).toEqual(summary)
    expect(service.importWorkspace).toHaveBeenCalledWith('w1')
    expect(loggerMock.info).toHaveBeenCalledWith(
      'queue.documents_legacy_import.workspace_completed',
      expect.objectContaining({ workspaceId: 'w1', proposals: 5 }),
    )
  })

  it('throws when the workspace batch cannot be read', async () => {
    service.importWorkspace.mockResolvedValue({
      ok: false,
      error: { code: 'DATABASE_ERROR', message: 'down' },
    })
    await expect(
      processDocumentsLegacyImport(
        fakeJob(DocumentsLegacyImportJob.ImportWorkspace, {
          workspaceId: 'w1',
        }),
      ),
    ).rejects.toThrow('Failed to migrate legacy proposals of w1')
  })

  it('rejects unknown job names, with or without an id', async () => {
    await expect(processDocumentsLegacyImport(fakeJob('nope'))).rejects.toThrow(
      'Unknown documents-legacy-import job: nope (id=job-1)',
    )
    await expect(
      processDocumentsLegacyImport({ name: 'nope' } as unknown as Job),
    ).rejects.toThrow('(id=unknown)')
  })

  it('builds the per-workspace job id', () => {
    expect(workspaceJobId('abc')).toBe('documents-legacy-import-ws-abc')
  })
})
