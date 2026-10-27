import { createHash } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import type { Job } from 'bullmq'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeArchiveConversation,
  createFakeArchiveMessage,
  createFakeDoneWhatsAppArchive,
  createFakeWhatsAppArchive,
  createFakeWhatsAppArchiveSettings,
} from '@/src/__tests__/factories/whatsapp-archive.factory'
import { databaseError, whatsappArchiveNotFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

const mocks = vi.hoisted(() => ({
  repo: {
    findById: vi.fn(),
    getSettings: vi.fn(),
    markRunning: vi.fn(),
    markDone: vi.fn(),
    markFailed: vi.fn(),
    markOffsiteCopied: vi.fn(),
    listExpired: vi.fn(),
    markExpired: vi.fn(),
    listLiveObjects: vi.fn(),
    listConversationBatch: vi.fn(),
    listMessagePage: vi.fn(),
  },
  prisma: { workspace: { findUnique: vi.fn() } },
  s3: {
    ensureBucket: vi.fn(),
    getS3Client: vi.fn(),
    getObjectStream: vi.fn(),
    deleteObjects: vi.fn(),
    listObjectKeys: vi.fn(),
  },
  send: vi.fn(),
  offsite: {
    getOffsiteConfig: vi.fn(),
    uploadAndVerifyOffsiteStream: vi.fn(),
    deleteOffsiteKey: vi.fn(),
  },
  enqueueOffsite: vi.fn(),
  scheduleAll: vi.fn(),
  audit: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/src/repositories/whatsapp-archive.repository', () => ({
  WhatsAppArchiveRepository: mocks.repo,
}))
vi.mock('@/src/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/src/lib/storage/s3', () => mocks.s3)
vi.mock('@/src/lib/storage/offsite-backup', () => mocks.offsite)
vi.mock('@/src/lib/queue/whatsapp-archive', () => ({
  enqueueWhatsappArchiveOffsiteCopy: mocks.enqueueOffsite,
}))
vi.mock('@/src/services/whatsapp-archive.service', () => ({
  WhatsAppArchiveService: { scheduleAll: mocks.scheduleAll },
}))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: mocks.audit }))
vi.mock('@/lib/axiom/logger', () => ({ logger: mocks.logger }))

import { WhatsappArchiveJob } from '@/src/lib/queue/jobs'
import {
  archiveOffsiteConfig,
  CONVERSATION_BATCH,
  handleWhatsappArchiveJob,
  iterateAtendimentos,
  MESSAGE_PAGE,
  processWhatsappArchive,
} from '@/src/lib/queue/processors/whatsapp-archive'

const NOW = new Date('2026-10-26T05:00:00.000Z')
const OFFSITE = {
  endpoint: 'https://s3.offsite.example',
  region: 'auto',
  bucket: 'off',
  accessKeyId: 'k',
  secretAccessKey: 's',
  prefix: 'steel/',
  forcePathStyle: false,
  serverSideEncryption: true,
  retentionDays: 90,
}

function job(
  name: string,
  data: unknown = { archiveId: 'a1' },
  attempts = { made: 0, max: 3 },
): Job {
  return {
    id: 'j1',
    name,
    data,
    attemptsMade: attempts.made,
    opts: { attempts: attempts.max },
  } as unknown as Job
}

/** Reads a zip (stored or deflated entries) through its central directory. */
function readZip(buffer: Buffer): Map<string, Buffer> {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const count = buffer.readUInt16LE(end + 10)
  let cursor = buffer.readUInt32LE(end + 16)
  const files = new Map<string, Buffer>()
  for (let i = 0; i < count; i++) {
    const method = buffer.readUInt16LE(cursor + 10)
    const size = buffer.readUInt32LE(cursor + 20)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const local = buffer.readUInt32LE(cursor + 42)
    const name = buffer.toString('utf-8', cursor + 46, cursor + 46 + nameLength)
    const start =
      local +
      30 +
      buffer.readUInt16LE(local + 26) +
      buffer.readUInt16LE(local + 28)
    const raw = buffer.subarray(start, start + size)
    files.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw))
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return files
}

async function readBody(body: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of body) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex')

let tempRoot: string
let uploaded: Buffer | null
const renderPdf = vi.fn(
  async (input: { conversationId: string; dayKey: string }) =>
    Buffer.from(`%PDF-${input.conversationId}-${input.dayKey}`),
)

beforeEach(async () => {
  vi.clearAllMocks()
  tempRoot = await mkdtemp(join(tmpdir(), 'zap-archive-test-'))
  uploaded = null
  mocks.send.mockImplementation(
    async (command: { input: { Body: AsyncIterable<Uint8Array> } }) => {
      uploaded = await readBody(command.input.Body)
      return {}
    },
  )
  mocks.s3.getS3Client.mockReturnValue({ send: mocks.send })
  mocks.s3.ensureBucket.mockResolvedValue(undefined)
  mocks.prisma.workspace.findUnique.mockResolvedValue({
    id: 'ws1',
    name: 'Fidelizza+',
    slug: 'fidelizza-mais',
  })
  mocks.repo.findById.mockResolvedValue(
    ok(createFakeWhatsAppArchive({ id: 'a1' })),
  )
  mocks.repo.getSettings.mockResolvedValue(
    ok(createFakeWhatsAppArchiveSettings()),
  )
  mocks.repo.markRunning.mockResolvedValue(ok({}))
  mocks.repo.markDone.mockResolvedValue(ok({}))
  mocks.repo.markFailed.mockResolvedValue(ok(true))
  mocks.repo.listConversationBatch.mockResolvedValue(ok([]))
  mocks.repo.listMessagePage.mockResolvedValue(ok([]))
  mocks.offsite.getOffsiteConfig.mockReturnValue(null)
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

describe('build', () => {
  const ana = { id: 'u1', name: 'Ana Souza' }
  const conversation = createFakeArchiveConversation({
    id: 'c1',
    contact: { name: 'Maria Silva', waId: '5511988887777' },
  })
  const aiOnly = createFakeArchiveConversation({
    id: 'c2',
    contact: { name: null, waId: '5511977776666' },
    assignedUser: { id: 'u9', name: 'Zé' },
  })
  const bsuid = createFakeArchiveConversation({
    id: 'c3',
    contact: { name: 'Sem Fone', waId: 'BR.123' },
  })

  function seedMessages() {
    mocks.repo.listConversationBatch.mockResolvedValue(
      ok([conversation, aiOnly, bsuid]),
    )
    mocks.repo.listMessagePage.mockImplementation(async (id: string) => {
      if (id === 'c1') {
        return ok([
          createFakeArchiveMessage({
            createdAt: new Date('2026-10-20T17:05:00.000Z'),
          }),
          createFakeArchiveMessage({
            direction: 'OUT',
            senderUserId: ana.id,
            senderUser: { name: ana.name },
            createdAt: new Date('2026-10-20T17:06:00.000Z'),
          }),
          createFakeArchiveMessage({
            direction: 'OUT',
            senderUserId: 'u2',
            senderUser: { name: 'Bia' },
            createdAt: new Date('2026-10-20T17:07:00.000Z'),
          }),
          // Next São Paulo day: a second atendimento of the same conversation.
          createFakeArchiveMessage({
            createdAt: new Date('2026-10-22T12:00:00.000Z'),
          }),
        ])
      }
      if (id === 'c2') {
        return ok([
          createFakeArchiveMessage({
            createdAt: new Date('2026-10-21T13:00:00.000Z'),
          }),
          createFakeArchiveMessage({
            direction: 'OUT',
            sentByAi: true,
            createdAt: new Date('2026-10-21T13:01:00.000Z'),
          }),
        ])
      }
      return ok([
        createFakeArchiveMessage({
          createdAt: new Date('2026-10-23T10:00:00.000Z'),
        }),
      ])
    })
  }

  it('streams the atendimentos into the zip with the index and uploads it', async () => {
    seedMessages()
    const result = await handleWhatsappArchiveJob(
      job(WhatsappArchiveJob.Build),
      NOW,
      {
        renderPdf,
        tempRoot,
      },
    )

    expect(result).toEqual({
      built: true,
      sizeBytes: uploaded?.length,
      fileCount: 6,
      atendimentoCount: 4,
    })
    expect(mocks.repo.markRunning).toHaveBeenCalledWith(
      'a1',
      'FIDELIZZAMAIS',
      NOW,
    )
    expect(mocks.repo.listConversationBatch).toHaveBeenCalledWith(
      'ws1',
      {
        start: new Date('2026-10-19T03:00:00.000Z'),
        end: new Date('2026-10-26T02:59:59.999Z'),
      },
      null,
      CONVERSATION_BATCH,
    )

    const files = readZip(uploaded as Buffer)
    const base = 'FIDELIZZAMAIS/WHATSAPP'
    expect([...files.keys()]).toEqual([
      `${base}/2026-10-20/ana-souza/maria-silva-5511988887777-2026-10-20-14h05.pdf`,
      `${base}/2026-10-20/bia/maria-silva-5511988887777-2026-10-20-14h05.pdf`,
      `${base}/2026-10-22/sem-atendente/maria-silva-5511988887777-2026-10-22-09h00.pdf`,
      `${base}/2026-10-21/IA/5511977776666-2026-10-21-10h00.pdf`,
      `${base}/2026-10-23/sem-atendente/sem-fone-br-123-2026-10-23-07h00.pdf`,
      `${base}/INDICE.csv`,
    ])
    const pdf = files.get(
      `${base}/2026-10-20/ana-souza/maria-silva-5511988887777-2026-10-20-14h05.pdf`,
    ) as Buffer
    expect(pdf.toString()).toBe('%PDF-c1-2026-10-20')

    const index = (files.get(`${base}/INDICE.csv`) as Buffer).toString('utf-8')
    const lines = index.trim().split('\r\n')
    expect(lines).toHaveLength(6)
    expect(lines[1]).toBe(
      `2026-10-20/ana-souza/maria-silva-5511988887777-2026-10-20-14h05.pdf,20/10/2026,14:05:00,Ana Souza,Maria Silva,+5511988887777,3,${sha(pdf)}`,
    )
    expect(lines[4]).toContain(',IA,,+5511977776666,2,')
    // A BSUID contact has no phone column.
    expect(lines[5]).toContain(',Sem atendente,Sem Fone,,1,')

    const done = mocks.repo.markDone.mock.calls[0][1]
    expect(done).toMatchObject({
      objectKey: 'ws1/a1.zip',
      sizeBytes: uploaded?.length,
      sha256: sha(uploaded as Buffer),
      fileCount: 6,
      atendimentoCount: 4,
      completedAt: NOW,
      expiresAt: new Date('2027-01-24T05:00:00.000Z'),
    })
    expect(mocks.send.mock.calls[0][0].input).toMatchObject({
      Bucket: 'whatsapp-archives',
      Key: 'ws1/a1.zip',
      ContentType: 'application/zip',
      ContentLength: uploaded?.length,
    })
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'whatsapp_archive', action: 'create' }),
    )

    // The header gets the attendants; the AI-only atendimento says IA.
    const inputs = renderPdf.mock.calls.map(([input]) => input)
    expect(inputs[0]).toMatchObject({
      attendants: ['Ana Souza', 'Bia'],
      connectionLabel: 'Cobrança',
      protocol: null,
    })
    expect(inputs[2]).toMatchObject({ attendants: ['IA'] })

    // Temp files are gone; no off-site config → only a warning.
    expect(await readdir(tempRoot)).toEqual([])
    expect(mocks.enqueueOffsite).not.toHaveBeenCalled()
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'queue.whatsapp_archive.offsite_not_configured',
      expect.anything(),
    )
  })

  it('queues the off-site copy when configured', async () => {
    mocks.offsite.getOffsiteConfig.mockReturnValue(OFFSITE)
    const result = await handleWhatsappArchiveJob(
      job(WhatsappArchiveJob.Build),
      NOW,
      {
        renderPdf,
        tempRoot,
      },
    )
    expect(result).toMatchObject({
      built: true,
      fileCount: 1,
      atendimentoCount: 0,
    })
    expect(mocks.enqueueOffsite).toHaveBeenCalledWith('a1')
    // An empty period still has the index (header only).
    const files = readZip(uploaded as Buffer)
    expect([...files.keys()]).toEqual(['FIDELIZZAMAIS/WHATSAPP/INDICE.csv'])
  })

  it('uses the configured root folder and the full-history range', async () => {
    mocks.repo.findById.mockResolvedValue(
      ok(
        createFakeWhatsAppArchive({
          id: 'a1',
          kind: 'MONTHLY_FULL',
          periodStart: null,
          periodEnd: new Date('2026-11-01T02:59:59.999Z'),
          status: 'RUNNING',
        }),
      ),
    )
    mocks.repo.getSettings.mockResolvedValue(
      ok(createFakeWhatsAppArchiveSettings({ rootFolderName: 'BANCO_X' })),
    )
    await handleWhatsappArchiveJob(job(WhatsappArchiveJob.Build), NOW, {
      renderPdf,
      tempRoot,
    })
    expect(mocks.repo.markRunning).toHaveBeenCalledWith('a1', 'BANCO_X', NOW)
    expect(mocks.repo.listConversationBatch.mock.calls[0][1]).toEqual({
      start: null,
      end: new Date('2026-11-01T02:59:59.999Z'),
    })
    expect(mocks.repo.markDone.mock.calls[0][1].expiresAt).toEqual(
      new Date('2027-10-26T05:00:00.000Z'),
    )
  })

  it('falls back to the default root without settings', async () => {
    mocks.repo.getSettings.mockResolvedValue(ok(null))
    await handleWhatsappArchiveJob(job(WhatsappArchiveJob.Build), NOW, {
      renderPdf,
      tempRoot,
    })
    expect(mocks.repo.markRunning).toHaveBeenCalledWith(
      'a1',
      'FIDELIZZAMAIS',
      NOW,
    )
  })

  it('skips a missing or finished archive', async () => {
    mocks.repo.findById.mockResolvedValueOnce(err(whatsappArchiveNotFound()))
    expect(
      await handleWhatsappArchiveJob(job(WhatsappArchiveJob.Build), NOW),
    ).toEqual({ built: false, reason: 'not_found' })

    mocks.repo.findById.mockResolvedValueOnce(
      ok(createFakeDoneWhatsAppArchive({ id: 'a1' })),
    )
    expect(
      await handleWhatsappArchiveJob(job(WhatsappArchiveJob.Build), NOW),
    ).toEqual({ built: false, reason: 'status_done' })
    expect(mocks.repo.markRunning).not.toHaveBeenCalled()
  })

  it('throws when the archive cannot be read', async () => {
    mocks.repo.findById.mockResolvedValue(err(databaseError('db down')))
    await expect(
      handleWhatsappArchiveJob(job(WhatsappArchiveJob.Build), NOW),
    ).rejects.toThrow('db down')
  })

  it('leaves the archive running for a retry, and cleans the temp files', async () => {
    seedMessages()
    renderPdf.mockRejectedValueOnce(new Error('render failed'))
    await expect(
      handleWhatsappArchiveJob(job(WhatsappArchiveJob.Build), NOW, {
        renderPdf,
        tempRoot,
      }),
    ).rejects.toThrow('render failed')
    expect(mocks.repo.markFailed).not.toHaveBeenCalled()
    expect(await readdir(tempRoot)).toEqual([])
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'queue.whatsapp_archive.failed',
      expect.objectContaining({ final: false }),
    )
  })

  it('marks the archive failed on the last attempt', async () => {
    mocks.repo.listConversationBatch.mockResolvedValue(
      err(databaseError('boom')),
    )
    await expect(
      handleWhatsappArchiveJob(
        job(WhatsappArchiveJob.Build, { archiveId: 'a1' }, { made: 2, max: 3 }),
        NOW,
        { renderPdf, tempRoot },
      ),
    ).rejects.toThrow('boom')
    expect(mocks.repo.markFailed).toHaveBeenCalledWith('a1', 'boom')
  })

  it('fails without the workspace (before creating temp files)', async () => {
    mocks.prisma.workspace.findUnique.mockResolvedValue(null)
    await expect(
      handleWhatsappArchiveJob(
        // No `opts.attempts`: a single attempt, so this one is the last.
        { ...job(WhatsappArchiveJob.Build), opts: undefined } as unknown as Job,
        NOW,
        { renderPdf, tempRoot },
      ),
    ).rejects.toThrow('Workspace ws1 not found')
    expect(mocks.repo.markFailed).toHaveBeenCalled()
  })

  it('fails when the zip cannot read the index back', async () => {
    seedMessages()
    renderPdf.mockImplementationOnce(async (input) => {
      const [dir] = await readdir(tempRoot)
      await rm(join(tempRoot, dir, 'INDICE.csv'), { force: true })
      return Buffer.from(`%PDF-${input.conversationId}`)
    })
    await expect(
      handleWhatsappArchiveJob(job(WhatsappArchiveJob.Build), NOW, {
        renderPdf,
        tempRoot,
      }),
    ).rejects.toThrow(/ENOENT/)
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('names a sender without a user name "Atendente" in the index', async () => {
    mocks.repo.listConversationBatch.mockResolvedValue(ok([conversation]))
    mocks.repo.listMessagePage.mockResolvedValue(
      ok([
        createFakeArchiveMessage({
          direction: 'OUT',
          senderUserId: 'u7',
          senderUser: null,
        }),
      ]),
    )
    await handleWhatsappArchiveJob(
      { ...job(WhatsappArchiveJob.Build), opts: undefined } as unknown as Job,
      NOW,
      { renderPdf, tempRoot },
    )
    const index = readZip(uploaded as Buffer).get(
      'FIDELIZZAMAIS/WHATSAPP/INDICE.csv',
    ) as Buffer
    expect(index.toString()).toContain(
      '2026-10-20/atendente-u7/maria-silva-5511988887777-2026-10-20-14h05.pdf,20/10/2026,14:05:00,Atendente,',
    )
  })

  it('processWhatsappArchive builds with the default renderer and temp dir', async () => {
    const result = await processWhatsappArchive(job(WhatsappArchiveJob.Build))
    expect(result).toMatchObject({ built: true, fileCount: 1 })
  })

  it('fails when the upload fails', async () => {
    mocks.send.mockRejectedValue(new Error('minio down'))
    await expect(
      handleWhatsappArchiveJob(job(WhatsappArchiveJob.Build), NOW, {
        renderPdf,
        tempRoot,
      }),
    ).rejects.toThrow('minio down')
    expect(mocks.repo.markDone).not.toHaveBeenCalled()
  })

  it('fails with a non-Error rejection message', async () => {
    mocks.repo.markRunning.mockRejectedValue('plain failure')
    await expect(
      handleWhatsappArchiveJob(
        job(WhatsappArchiveJob.Build, { archiveId: 'a1' }, { made: 0, max: 1 }),
        NOW,
        { renderPdf, tempRoot },
      ),
    ).rejects.toBe('plain failure')
    expect(mocks.repo.markFailed).toHaveBeenCalledWith('a1', 'plain failure')
  })
})

describe('iterateAtendimentos', () => {
  const range = { start: null, end: NOW }

  it('pages conversations and messages, splitting by São Paulo day', async () => {
    const full = Array.from({ length: CONVERSATION_BATCH }, (_, i) =>
      createFakeArchiveConversation({ id: `c${String(i).padStart(3, '0')}` }),
    )
    const last = createFakeArchiveConversation({ id: 'z1' })
    mocks.repo.listConversationBatch
      .mockResolvedValueOnce(ok(full))
      .mockResolvedValueOnce(ok([last]))

    const day = new Date('2026-10-20T12:00:00.000Z').getTime()
    const longPage = Array.from({ length: MESSAGE_PAGE }, (_, i) =>
      createFakeArchiveMessage({
        id: `m${i}`,
        createdAt: new Date(day + i * 1000),
      }),
    )
    const tail = [
      createFakeArchiveMessage({ id: 'tail', createdAt: new Date(day + 1e6) }),
    ]
    mocks.repo.listMessagePage.mockImplementation(
      async (id: string, _range: unknown, after: { id: string } | null) => {
        if (id !== 'z1') return ok([])
        return ok(after ? tail : longPage)
      },
    )

    const seen = []
    for await (const atendimento of iterateAtendimentos('ws1', range)) {
      seen.push(atendimento)
    }
    expect(seen).toHaveLength(1)
    expect(seen[0].conversation.id).toBe('z1')
    expect(seen[0].messages).toHaveLength(MESSAGE_PAGE + 1)
    expect(mocks.repo.listConversationBatch.mock.calls[1][2]).toBe('c049')
    const lastPageCall = mocks.repo.listMessagePage.mock.calls.at(-1)
    expect(lastPageCall?.[2]).toEqual({
      createdAt: longPage[MESSAGE_PAGE - 1].createdAt,
      id: `m${MESSAGE_PAGE - 1}`,
    })
  })

  it('throws when a page cannot be read', async () => {
    mocks.repo.listConversationBatch.mockResolvedValue(
      ok([createFakeArchiveConversation()]),
    )
    mocks.repo.listMessagePage.mockResolvedValue(err(databaseError('page')))
    const iterator = iterateAtendimentos('ws1', range)
    await expect(iterator.next()).rejects.toThrow('page')
  })
})

describe('copy-to-offsite', () => {
  const done = createFakeDoneWhatsAppArchive({ id: 'a1' })

  beforeEach(() => {
    mocks.offsite.getOffsiteConfig.mockReturnValue(OFFSITE)
    mocks.repo.findById.mockResolvedValue(ok(done))
    mocks.repo.markOffsiteCopied.mockResolvedValue(ok(true))
    mocks.s3.getObjectStream.mockImplementation(async () => ({
      body: new Blob([Buffer.from('zip')]).stream(),
      contentLength: 3,
    }))
    mocks.offsite.uploadAndVerifyOffsiteStream.mockResolvedValue({
      key: 'steel-whatsapp-archives/ws1/a1.zip',
      sizeBytes: 2048,
      encryptedChecksum: done.sha256,
    })
  })

  it('streams the package to the archive prefix and records it', async () => {
    const result = await handleWhatsappArchiveJob(
      job(WhatsappArchiveJob.CopyToOffsite),
      NOW,
    )
    expect(result).toEqual({
      copied: true,
      offsiteKey: 'steel-whatsapp-archives/ws1/a1.zip',
    })
    const [config, input] =
      mocks.offsite.uploadAndVerifyOffsiteStream.mock.calls[0]
    expect(config.prefix).toBe('steel-whatsapp-archives/')
    expect(input).toMatchObject({
      key: 'ws1/a1.zip',
      sizeBytes: 2048,
      sha256: done.sha256,
      contentType: 'application/zip',
    })
    expect(mocks.repo.markOffsiteCopied).toHaveBeenCalledWith(
      'a1',
      'steel-whatsapp-archives/ws1/a1.zip',
      NOW,
    )
  })

  it('is inert without the off-site config', async () => {
    mocks.offsite.getOffsiteConfig.mockReturnValue(null)
    expect(
      await handleWhatsappArchiveJob(
        job(WhatsappArchiveJob.CopyToOffsite),
        NOW,
      ),
    ).toEqual({ copied: false, reason: 'offsite_not_configured' })
  })

  it('skips missing or unfinished archives', async () => {
    mocks.repo.findById.mockResolvedValueOnce(err(whatsappArchiveNotFound()))
    expect(
      await handleWhatsappArchiveJob(
        job(WhatsappArchiveJob.CopyToOffsite),
        NOW,
      ),
    ).toEqual({ copied: false, reason: 'not_found' })

    for (const row of [
      createFakeWhatsAppArchive({ status: 'RUNNING' }),
      createFakeDoneWhatsAppArchive({ objectKey: null }),
      createFakeDoneWhatsAppArchive({ sizeBytes: null }),
      createFakeDoneWhatsAppArchive({ sha256: null }),
    ]) {
      mocks.repo.findById.mockResolvedValueOnce(ok(row))
      expect(
        await handleWhatsappArchiveJob(
          job(WhatsappArchiveJob.CopyToOffsite),
          NOW,
        ),
      ).toEqual({ copied: false, reason: 'not_ready' })
    }
  })

  it('throws on a database error', async () => {
    mocks.repo.findById.mockResolvedValue(err(databaseError('db')))
    await expect(
      handleWhatsappArchiveJob(job(WhatsappArchiveJob.CopyToOffsite), NOW),
    ).rejects.toThrow('db')
  })

  it('rethrows a provider failure for the retry', async () => {
    mocks.offsite.uploadAndVerifyOffsiteStream.mockRejectedValue(
      new Error('verification failed'),
    )
    await expect(
      handleWhatsappArchiveJob(job(WhatsappArchiveJob.CopyToOffsite), NOW),
    ).rejects.toThrow('verification failed')
    expect(mocks.repo.markOffsiteCopied).not.toHaveBeenCalled()

    mocks.offsite.uploadAndVerifyOffsiteStream.mockRejectedValue('raw')
    await expect(
      handleWhatsappArchiveJob(job(WhatsappArchiveJob.CopyToOffsite), NOW),
    ).rejects.toBe('raw')
  })
})

describe('archiveOffsiteConfig', () => {
  it('puts the packages next to the backups, never under their prefix', () => {
    expect(archiveOffsiteConfig({ ...OFFSITE, prefix: 'steel/' }).prefix).toBe(
      'steel-whatsapp-archives/',
    )
    expect(archiveOffsiteConfig({ ...OFFSITE, prefix: 'a/b//' }).prefix).toBe(
      'a/b-whatsapp-archives/',
    )
    expect(archiveOffsiteConfig({ ...OFFSITE, prefix: '' }).prefix).toBe(
      'whatsapp-archives/',
    )
  })
})

describe('prune-expired', () => {
  beforeEach(() => {
    mocks.repo.listExpired.mockResolvedValue(
      ok([
        createFakeDoneWhatsAppArchive({
          id: 'old1',
          objectKey: 'ws1/old1.zip',
          offsiteKey: 'steel-whatsapp-archives/ws1/old1.zip',
        }),
        createFakeDoneWhatsAppArchive({ id: 'old2', objectKey: null }),
      ]),
    )
    mocks.repo.markExpired.mockResolvedValue(ok(2))
    mocks.repo.listLiveObjects.mockResolvedValue(
      ok([
        { id: 'a1', workspaceId: 'ws1', objectKey: 'ws1/a1.zip' },
        { id: 'run', workspaceId: 'ws1', objectKey: null },
      ]),
    )
    mocks.s3.listObjectKeys.mockResolvedValue([
      'ws1/a1.zip',
      'ws1/run.zip',
      'gone/x.zip',
    ])
  })

  it('deletes expired files here and off-site, and orphans', async () => {
    mocks.offsite.getOffsiteConfig.mockReturnValue(OFFSITE)
    const result = await handleWhatsappArchiveJob(
      job(WhatsappArchiveJob.PruneExpired),
      NOW,
    )
    expect(result).toEqual({ expired: 2, orphans: 1 })
    expect(mocks.s3.deleteObjects).toHaveBeenNthCalledWith(
      1,
      'whatsapp-archives',
      ['ws1/old1.zip'],
    )
    expect(mocks.offsite.deleteOffsiteKey).toHaveBeenCalledWith(
      OFFSITE,
      'steel-whatsapp-archives/ws1/old1.zip',
    )
    expect(mocks.repo.markExpired).toHaveBeenCalledWith(['old1', 'old2'])
    expect(mocks.s3.deleteObjects).toHaveBeenNthCalledWith(
      2,
      'whatsapp-archives',
      ['gone/x.zip'],
    )
  })

  it('skips the off-site delete without config and nothing to delete', async () => {
    mocks.repo.listExpired.mockResolvedValue(
      ok([
        createFakeDoneWhatsAppArchive({
          id: 'old1',
          objectKey: null,
          offsiteKey: 'k',
        }),
      ]),
    )
    mocks.s3.listObjectKeys.mockResolvedValue(['ws1/a1.zip'])
    const result = await handleWhatsappArchiveJob(
      job(WhatsappArchiveJob.PruneExpired),
      NOW,
    )
    expect(result).toEqual({ expired: 2, orphans: 0 })
    expect(mocks.s3.deleteObjects).not.toHaveBeenCalled()
    expect(mocks.offsite.deleteOffsiteKey).not.toHaveBeenCalled()
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'queue.whatsapp_archive.offsite_prune_skipped',
      expect.anything(),
    )
  })

  it('throws on a database error', async () => {
    mocks.repo.listExpired.mockResolvedValue(err(databaseError('db')))
    await expect(
      handleWhatsappArchiveJob(job(WhatsappArchiveJob.PruneExpired), NOW),
    ).rejects.toThrow('db')
  })
})

describe('schedule ticks and dispatch', () => {
  it('queues the weekly and monthly packages of every opted-in workspace', async () => {
    mocks.scheduleAll.mockResolvedValue(
      ok({ queued: 2, skipped: 1, failed: 0 }),
    )
    expect(
      await handleWhatsappArchiveJob(
        job(WhatsappArchiveJob.ScheduleWeekly),
        NOW,
      ),
    ).toEqual({ queued: 2, skipped: 1, failed: 0 })
    expect(mocks.scheduleAll).toHaveBeenCalledWith('WEEKLY', NOW)

    await handleWhatsappArchiveJob(job(WhatsappArchiveJob.ScheduleMonthly), NOW)
    expect(mocks.scheduleAll).toHaveBeenLastCalledWith('MONTHLY_FULL', NOW)
  })

  it('throws when the workspaces cannot be listed', async () => {
    mocks.scheduleAll.mockResolvedValue(err(databaseError('db')))
    await expect(
      handleWhatsappArchiveJob(job(WhatsappArchiveJob.ScheduleWeekly), NOW),
    ).rejects.toThrow('db')
  })

  it('rejects unknown jobs', async () => {
    await expect(handleWhatsappArchiveJob(job('nope'), NOW)).rejects.toThrow(
      'Unknown whatsapp-archive job: nope (id=j1)',
    )
    await expect(
      handleWhatsappArchiveJob({ name: 'nope' } as Job, NOW),
    ).rejects.toThrow('(id=unknown)')
  })

  it('processWhatsappArchive runs with the current clock', async () => {
    mocks.scheduleAll.mockResolvedValue(
      ok({ queued: 0, skipped: 0, failed: 0 }),
    )
    await processWhatsappArchive(job(WhatsappArchiveJob.ScheduleWeekly))
    expect(mocks.scheduleAll).toHaveBeenCalledWith('WEEKLY', expect.any(Date))
  })
})
