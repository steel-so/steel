import type { DocumentImport, Role } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDocumentImport } from '@/src/__tests__/factories/document-ai.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  aiQuotaExceeded,
  databaseError,
  featureNotEnabled,
} from '@/src/errors'
import type {
  AiChatRequest,
  AiChatResponse,
  AiStreamChunk,
} from '@/src/lib/ai/types'
import { createEmptyDocumentContent } from '@/src/lib/canvas-document/catalog'
import { err, ok } from '@/src/lib/result'
import { CreateDocumentImportSchema } from '@/src/schemas/document.schema'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/ai-settings.repository')
vi.mock('@/src/repositories/document-import.repository')
vi.mock('@/src/services/ai-usage.service')
vi.mock('@/src/services/feature-flag.service')
vi.mock('@/src/services/platform-ai-settings.service')
vi.mock('@/lib/axiom/audit')
vi.mock('@/src/lib/storage/s3', () => ({
  ensureBucket: vi.fn(async () => undefined),
  putObject: vi.fn(async () => undefined),
  getObject: vi.fn(async () => Buffer.from('%PDF-1.4 conteúdo')),
}))
vi.mock('@/src/lib/queue/queues', () => ({
  getDocumentsAiQueue: vi.fn(),
}))
vi.mock('@/src/lib/document-ai/realtime', () => ({
  publishDocumentImport: vi.fn(async () => undefined),
}))
vi.mock('@/src/lib/document-ai/extract', async (original) => ({
  ...(await original<typeof import('@/src/lib/document-ai/extract')>()),
  countPdfPages: vi.fn(),
  extractPdfPages: vi.fn(),
  extractDocxText: vi.fn(),
}))
vi.mock('@/src/lib/canvas-document/outline', async (original) => ({
  ...(await original<typeof import('@/src/lib/canvas-document/outline')>()),
  outlineToDocument: vi.fn(),
}))
vi.mock('@/src/lib/ai', async (original) => ({
  ...(await original<typeof import('@/src/lib/ai')>()),
  isAiProviderConfigured: vi.fn(() => true),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { isAiProviderConfigured } from '@/src/lib/ai'
import { outlineToDocument } from '@/src/lib/canvas-document/outline'
import {
  countPdfPages,
  extractDocxText,
  extractPdfPages,
} from '@/src/lib/document-ai/extract'
import { publishDocumentImport } from '@/src/lib/document-ai/realtime'
import { getDocumentsAiQueue } from '@/src/lib/queue/queues'
import { getObject, putObject } from '@/src/lib/storage/s3'
import { AiUsageRepository } from '@/src/repositories/ai-settings.repository'
import { DocumentImportRepository } from '@/src/repositories/document-import.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { AiUsageService } from '@/src/services/ai-usage.service'
import { assertFeature } from '@/src/services/feature-flag.service'
import { PlatformAiSettingsService } from '@/src/services/platform-ai-settings.service'
import { DocumentImportService } from '../document-import.service'

const membership = vi.mocked(MembershipRepository)
const imports = vi.mocked(DocumentImportRepository)
const usageRepo = vi.mocked(AiUsageRepository)
const ai = vi.mocked(AiUsageService)
const feature = vi.mocked(assertFeature)
const platform = vi.mocked(PlatformAiSettingsService)
const audit = vi.mocked(auditMutation)
const configured = vi.mocked(isAiProviderConfigured)
const toDocument = vi.mocked(outlineToDocument)
const pageCount = vi.mocked(countPdfPages)
const pdfPages = vi.mocked(extractPdfPages)
const docxText = vi.mocked(extractDocxText)
const publish = vi.mocked(publishDocumentImport)
const queue = vi.mocked(getDocumentsAiQueue)
const download = vi.mocked(getObject)
const upload = vi.mocked(putObject)

const WS = 'ws1'
const ACTOR = 'u1'
const PDF = Buffer.from('%PDF-1.4\n%conteúdo')
const DOCX = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])

// ─── fake provider ───────────────────────────────────────────────────────

const ANSWER = {
  title: 'Proposta comercial',
  kind: 'PROPOSAL',
  primaryColor: '#123456',
  sections: [
    {
      name: 'Capa',
      variant: 'cover',
      pageBreakBefore: null,
      blocks: [{ type: 'heading', text: 'Proposta comercial', level: 1 }],
    },
    {
      name: 'Investimento',
      variant: null,
      pageBreakBefore: null,
      blocks: [
        {
          type: 'pricing',
          title: null,
          showTotals: true,
          items: [
            {
              name: 'Ramal em nuvem',
              description: null,
              unit: 'ramal',
              unitPrice: 39.9,
              quantity: 40,
              discountPct: null,
              optional: null,
              recurrence: 'monthly',
            },
          ],
        },
      ],
    },
    {
      name: 'Aceite',
      variant: null,
      pageBreakBefore: null,
      blocks: [
        {
          type: 'field',
          fieldType: 'field-text',
          label: 'Nome',
          required: true,
          placeholder: null,
          options: null,
        },
        {
          type: 'accept',
          buttonLabel: null,
          terms: 'Li e concordo',
          allowDecline: null,
        },
      ],
    },
  ],
}

function response(
  text: string,
  stopReason: AiChatResponse['stopReason'] = 'end',
): AiChatResponse {
  return {
    text,
    toolCalls: [],
    message: { role: 'assistant', content: text },
    usage: { inputTokens: 1000, outputTokens: 500 },
    stopReason,
  }
}

type Reply = AiChatResponse | Error
const replies: Reply[] = []
const requests: AiChatRequest[] = []

const chatStream = vi.fn((request: AiChatRequest) => {
  requests.push(request)
  const reply = replies.shift() ?? response(JSON.stringify(ANSWER))
  return (async function* (): AsyncGenerator<AiStreamChunk> {
    if (reply instanceof Error) throw reply
    yield { type: 'text', delta: reply.text }
    yield { type: 'done', response: reply }
  })()
})

const provider = { id: 'anthropic' as const, chat: vi.fn(), chatStream }

const CLAUDE = {
  key: 'anthropic:claude-sonnet-5',
  provider: 'anthropic',
  model: 'claude-sonnet-5',
  label: 'Claude Sonnet 5',
  pricing: { inputUsdPer1M: 2, outputUsdPer1M: 10 },
}
const LEGACY = {
  key: 'legacy:text-model',
  provider: 'openai',
  model: 'text-model',
  label: 'Texto',
}

function prepared(model: Record<string, unknown> = CLAUDE) {
  return ok({
    feature: 'CRM_ASSISTANT' as const,
    provider: provider as never,
    model: model as never,
  })
}

function asRole(role: Role) {
  membership.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role, userId: ACTOR, workspaceId: WS })),
  )
}

function stored(overrides: Partial<DocumentImport> = {}) {
  return createFakeDocumentImport({
    id: 'imp1',
    workspaceId: WS,
    createdById: ACTOR,
    mode: 'PDF',
    status: 'PENDING',
    fileKey: `${WS}/imports/imp1/proposta.pdf`,
    fileName: 'proposta.pdf',
    pageCount: 3,
    ...overrides,
  })
}

const add = vi.fn()

beforeEach(() => {
  replies.length = 0
  requests.length = 0
  asRole('MEMBER')
  feature.mockResolvedValue(ok(true))
  ai.prepare.mockResolvedValue(prepared())
  ai.record.mockResolvedValue(undefined)
  ai.price.mockReturnValue(0.01)
  ai.resolveModel.mockResolvedValue(
    ok({
      model: CLAUDE as never,
      settings: { monthlyQuotaUsd: 50 } as never,
    }),
  )
  usageRepo.sumSince.mockResolvedValue(ok({ costUsd: 10 } as never))
  platform.getCostMargin.mockResolvedValue(1.2)
  configured.mockReturnValue(true)
  pageCount.mockResolvedValue(ok(3))
  pdfPages.mockResolvedValue(ok(['Página um', 'Página dois']))
  docxText.mockResolvedValue(ok('Contrato de prestação de serviços'))
  add.mockReset()
  add.mockResolvedValue({ id: 'job' })
  queue.mockReturnValue({ add } as never)
  download.mockResolvedValue(PDF)
  imports.create.mockImplementation(async (data) =>
    ok(
      createFakeDocumentImport({
        ...(data as Partial<DocumentImport>),
        progress: data.progress as Prisma.JsonValue,
      }),
    ),
  )
  // The repository returns the whole updated row: merge onto the loaded one.
  imports.update.mockImplementation(async (id, data) => {
    const loaded = await imports.findForRun.getMockImplementation()?.(id)
    const row = loaded?.ok && loaded.value ? loaded.value : stored({ id })
    return ok({ ...row, ...(data as unknown as Partial<DocumentImport>) })
  })
  imports.findForRun.mockResolvedValue(ok(stored()))
  imports.countActive.mockResolvedValue(ok(0))
  imports.findById.mockResolvedValue(ok(stored()))
  imports.complete.mockImplementation(async (id, document, result) =>
    ok({
      import: stored({
        id,
        status: 'READY',
        documentId: 'doc1',
        kind: document.kind,
        costUsd: new Prisma.Decimal(result.costUsd),
      }),
      document: { id: 'doc1' } as never,
    }),
  )
  toDocument.mockReturnValue({
    content: createEmptyDocumentContent(),
    theme: { primaryColor: '#123456' },
  })
})

const fileInput = (mode: 'PDF' | 'DOCX', title?: string) =>
  CreateDocumentImportSchema.parse({ mode, kind: 'OTHER', title })

// ─── context ─────────────────────────────────────────────────────────────

describe('DocumentImportService.context()', () => {
  it('should return quota, limits and the estimate of the model', async () => {
    const ctx = expectOk(await DocumentImportService.context(ACTOR, WS))

    expect(ctx).toEqual(
      expect.objectContaining({
        available: true,
        unavailableReason: null,
        nativePdf: true,
        maxBytes: 20 * 1024 * 1024,
        maxPages: 60,
        quota: {
          usedUsd: 10,
          quotaUsd: 50,
          remainingUsd: 40,
          exceeded: false,
        },
      }),
    )
    expect(ctx.estimate?.model).toBe('Claude Sonnet 5')
    expect(ctx.estimate?.pageUsd).toBeGreaterThan(0)
    expect(ctx.estimate?.promptUsd).toBeGreaterThan(ctx.estimate?.baseUsd ?? 0)
  })

  it('should explain when the plan has no CRM AI', async () => {
    feature.mockResolvedValue(err(featureNotEnabled('crm.aiAssistant')))

    const ctx = expectOk(await DocumentImportService.context(ACTOR, WS))

    expect(ctx.available).toBe(false)
    expect(ctx.unavailableReason).toMatch(/plano/)
  })

  it('should explain when no model is usable', async () => {
    ai.resolveModel.mockResolvedValue(
      ok({ model: null, settings: { monthlyQuotaUsd: 5 } as never }),
    )
    usageRepo.sumSince.mockResolvedValue(ok({ costUsd: 9 } as never))

    const ctx = expectOk(await DocumentImportService.context(ACTOR, WS))

    expect(ctx.available).toBe(false)
    expect(ctx.unavailableReason).toMatch(/Nenhum modelo/)
    expect(ctx.estimate).toBeNull()
    expect(ctx.nativePdf).toBe(false)
    expect(ctx.quota.exceeded).toBe(true)
  })

  it('should flag a model that only reads text', async () => {
    ai.resolveModel.mockResolvedValue(
      ok({
        model: LEGACY as never,
        settings: { monthlyQuotaUsd: 50 } as never,
      }),
    )

    const ctx = expectOk(await DocumentImportService.context(ACTOR, WS))

    expect(ctx.nativePdf).toBe(false)
  })

  it('should deny a viewer and a non-member', async () => {
    asRole('VIEWER')
    expectErr(await DocumentImportService.context(ACTOR, WS), 'FORBIDDEN')

    membership.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await DocumentImportService.context(ACTOR, WS), 'FORBIDDEN')
  })

  it('should propagate database errors', async () => {
    ai.resolveModel.mockResolvedValue(err(databaseError('x')))
    expectErr(await DocumentImportService.context(ACTOR, WS), 'DATABASE_ERROR')

    ai.resolveModel.mockResolvedValue(
      ok({
        model: CLAUDE as never,
        settings: { monthlyQuotaUsd: 50 } as never,
      }),
    )
    usageRepo.sumSince.mockResolvedValue(err(databaseError('x')))
    expectErr(await DocumentImportService.context(ACTOR, WS), 'DATABASE_ERROR')
  })
})

// ─── create ──────────────────────────────────────────────────────────────

describe('DocumentImportService.create()', () => {
  const pdf = { buffer: PDF, contentType: 'application/pdf', fileName: 'a.pdf' }

  it('should store a PDF, create the import and queue the build', async () => {
    const dto = expectOk(
      await DocumentImportService.create(
        ACTOR,
        WS,
        fileInput('PDF', 'Minha proposta'),
        { ...pdf, fileName: 'C:\\docs\\Proposta 2027.pdf' },
      ),
    )

    expect(dto.status).toBe('PENDING')
    expect(dto.fileName).toBe('Proposta 2027.pdf')
    expect(dto.progress).toEqual({ step: 'queued', message: 'Na fila', pct: 0 })
    const key = upload.mock.calls[0][0].key
    expect(key).toBe(`${WS}/imports/${dto.id}/Proposta_2027.pdf`)
    expect(upload.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        bucket: 'documents',
        contentType: 'application/pdf',
      }),
    )
    expect(imports.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: dto.id,
        mode: 'PDF',
        fileKey: key,
        fileSize: PDF.byteLength,
        pageCount: 3,
        prompt: null,
        createdById: ACTOR,
      }),
    )
    expect(add).toHaveBeenCalledWith(
      'import',
      { importId: dto.id, title: 'Minha proposta' },
      { jobId: dto.id, attempts: 2 },
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'document_import',
        action: 'create',
        targetId: dto.id,
      }),
    )
  })

  it('should store a DOCX without a page count', async () => {
    const dto = expectOk(
      await DocumentImportService.create(ACTOR, WS, fileInput('DOCX'), {
        buffer: DOCX,
        contentType: '',
        fileName: 'contrato.docx',
      }),
    )

    expect(dto.mode).toBe('DOCX')
    expect(pageCount).not.toHaveBeenCalled()
    expect(upload.mock.calls[0][0].contentType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    expect(add.mock.calls[0][1]).toEqual({ importId: dto.id })
  })

  it('should queue a prompt without touching the storage', async () => {
    const dto = expectOk(
      await DocumentImportService.create(
        ACTOR,
        WS,
        CreateDocumentImportSchema.parse({
          mode: 'PROMPT',
          kind: 'PROPOSAL',
          prompt: 'Proposta de PABX em nuvem',
        }),
      ),
    )

    expect(dto.mode).toBe('PROMPT')
    expect(dto.progress.message).toBe('Na fila')
    expect(upload).not.toHaveBeenCalled()
    expect(imports.create).toHaveBeenCalledWith(
      expect.objectContaining({
        fileKey: null,
        fileName: null,
        fileSize: null,
        prompt: 'Proposta de PABX em nuvem',
      }),
    )
  })

  it.each([
    ['no file', 'PDF', undefined, /Envie um arquivo/],
    [
      'an empty file',
      'PDF',
      { ...pdf, buffer: Buffer.alloc(0) },
      /Envie um arquivo/,
    ],
    [
      'a file over 20 MB',
      'PDF',
      { ...pdf, buffer: Buffer.alloc(20 * 1024 * 1024 + 1) },
      /20 MB/,
    ],
    [
      'a PDF that is not a PDF',
      'PDF',
      { ...pdf, buffer: Buffer.from('hello') },
      /PDF válido/,
    ],
    [
      'a DOCX that is not a DOCX',
      'DOCX',
      { ...pdf, fileName: 'a.docx' },
      /DOCX válido/,
    ],
  ] as const)('should refuse %s', async (_name, mode, file, message) => {
    const error = expectErr(
      await DocumentImportService.create(ACTOR, WS, fileInput(mode), file),
      'DOCUMENT_IMPORT_UNSUPPORTED',
    )
    expect(error.message).toMatch(message)
    expect(upload).not.toHaveBeenCalled()
    expect(imports.create).not.toHaveBeenCalled()
  })

  it('should refuse a PDF it cannot read or with too many pages', async () => {
    pageCount.mockResolvedValueOnce(err('Não foi possível ler este PDF.'))
    const unreadable = expectErr(
      await DocumentImportService.create(ACTOR, WS, fileInput('PDF'), pdf),
      'DOCUMENT_IMPORT_UNSUPPORTED',
    )
    expect(unreadable.message).toMatch(/ler este PDF/)

    pageCount.mockResolvedValueOnce(ok(61))
    const long = expectErr(
      await DocumentImportService.create(ACTOR, WS, fileInput('PDF'), pdf),
      'DOCUMENT_IMPORT_UNSUPPORTED',
    )
    expect(long.message).toBe('O PDF tem 61 páginas; o limite é 60')
  })

  it('should deny a viewer before reading the file', async () => {
    asRole('VIEWER')
    expectErr(
      await DocumentImportService.create(ACTOR, WS, fileInput('PDF'), pdf),
      'FORBIDDEN',
    )
    expect(pageCount).not.toHaveBeenCalled()
  })

  it('should stop on the plan feature and the quota', async () => {
    feature.mockResolvedValueOnce(err(featureNotEnabled('crm.aiAssistant')))
    expectErr(
      await DocumentImportService.create(ACTOR, WS, fileInput('PDF'), pdf),
      'FEATURE_NOT_ENABLED',
    )

    ai.prepare.mockResolvedValueOnce(err(aiQuotaExceeded(50, 50)))
    expectErr(
      await DocumentImportService.create(ACTOR, WS, fileInput('PDF'), pdf),
      'AI_QUOTA_EXCEEDED',
    )
    expect(upload).not.toHaveBeenCalled()
  })

  it('should cap the imports a user runs at once', async () => {
    imports.countActive.mockResolvedValueOnce(ok(3))
    const error = expectErr(
      await DocumentImportService.create(ACTOR, WS, fileInput('PDF'), pdf),
      'CONFLICT',
    )
    expect(error.message).toMatch(/3 documentos sendo montados/)
    expect(imports.countActive).toHaveBeenCalledWith(WS, ACTOR)

    imports.countActive.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await DocumentImportService.create(ACTOR, WS, fileInput('PDF'), pdf),
      'DATABASE_ERROR',
    )
    expect(upload).not.toHaveBeenCalled()
  })

  it('should answer STORAGE_ERROR when MinIO fails', async () => {
    upload.mockRejectedValueOnce(new Error('minio down'))
    expectErr(
      await DocumentImportService.create(ACTOR, WS, fileInput('PDF'), pdf),
      'STORAGE_ERROR',
    )
    expect(imports.create).not.toHaveBeenCalled()
  })

  it('should audit and propagate a database failure', async () => {
    imports.create.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await DocumentImportService.create(ACTOR, WS, fileInput('PDF'), pdf),
      'DATABASE_ERROR',
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failure', reason: 'DATABASE_ERROR' }),
    )
    expect(add).not.toHaveBeenCalled()
  })

  it('should fail the import when the queue is down', async () => {
    add.mockRejectedValueOnce(new Error('redis down'))
    const error = expectErr(
      await DocumentImportService.create(ACTOR, WS, fileInput('PDF'), pdf),
      'DOCUMENT_IMPORT_FAILED',
    )
    expect(error.message).toMatch(/iniciar a importação/)
    expect(imports.update).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'FAILED' }),
    )
  })
})

// ─── get ─────────────────────────────────────────────────────────────────

describe('DocumentImportService.get()', () => {
  it('should return the import of the requester', async () => {
    const dto = expectOk(await DocumentImportService.get(ACTOR, WS, 'imp1'))
    expect(dto.id).toBe('imp1')
    expect(imports.findById).toHaveBeenCalledWith('imp1', WS)
  })

  it("should hide another member's import, but not from an admin", async () => {
    imports.findById.mockResolvedValue(ok(stored({ createdById: 'other' })))
    expectErr(
      await DocumentImportService.get(ACTOR, WS, 'imp1'),
      'DOCUMENT_IMPORT_NOT_FOUND',
    )

    asRole('ADMIN')
    expectOk(await DocumentImportService.get(ACTOR, WS, 'imp1'))
  })

  it('should close an import the worker lost', async () => {
    const old = new Date(Date.now() - 31 * 60 * 1000)
    imports.findById.mockResolvedValue(
      ok(stored({ status: 'RUNNING', createdAt: old })),
    )

    const dto = expectOk(await DocumentImportService.get(ACTOR, WS, 'imp1'))

    expect(dto.status).toBe('FAILED')
    expect(dto.error).toMatch(/demorou demais/)
    expect(imports.update).toHaveBeenCalledWith(
      'imp1',
      expect.objectContaining({ status: 'FAILED' }),
    )
  })

  it('should report a lost import even when saving fails', async () => {
    const old = new Date(Date.now() - 31 * 60 * 1000)
    imports.findById.mockResolvedValue(ok(stored({ createdAt: old })))
    imports.update.mockResolvedValueOnce(err(databaseError('x')))

    const dto = expectOk(await DocumentImportService.get(ACTOR, WS, 'imp1'))

    expect(dto.status).toBe('FAILED')
    expect(dto.progress.step).toBe('failed')
  })

  it('should leave a recent or finished import alone', async () => {
    const old = new Date(Date.now() - 31 * 60 * 1000)
    imports.findById.mockResolvedValue(
      ok(stored({ status: 'READY', createdAt: old })),
    )
    const dto = expectOk(await DocumentImportService.get(ACTOR, WS, 'imp1'))
    expect(dto.status).toBe('READY')
    expect(imports.update).not.toHaveBeenCalled()
  })

  it('should propagate not found and authorization errors', async () => {
    imports.findById.mockResolvedValue(
      err({ code: 'DOCUMENT_IMPORT_NOT_FOUND', message: 'x' } as never),
    )
    expectErr(
      await DocumentImportService.get(ACTOR, WS, 'nope'),
      'DOCUMENT_IMPORT_NOT_FOUND',
    )

    asRole('VIEWER')
    expectErr(await DocumentImportService.get(ACTOR, WS, 'imp1'), 'FORBIDDEN')
  })
})

// ─── run ─────────────────────────────────────────────────────────────────

function lastUpdate() {
  return imports.update.mock.calls.at(-1)?.[1]
}

describe('DocumentImportService.run()', () => {
  it('should send the PDF natively and create the draft document', async () => {
    const result = expectOk(
      await DocumentImportService.run('imp1', { title: '  Proposta ACME  ' }),
    )

    expect(result).toEqual({ status: 'ready', documentId: 'doc1' })
    const request = requests[0]
    expect(request.jsonSchema?.name).toBe('document_outline')
    expect(request.system).toMatch(/Keep the source text faithfully/)
    const content = request.messages[0].content as { type: string }[]
    expect(content[0]).toEqual(
      expect.objectContaining({
        type: 'document',
        mediaType: 'application/pdf',
        filename: 'proposta.pdf',
        data: PDF.toString('base64'),
      }),
    )
    expect(imports.update.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        status: 'RUNNING',
        progress: expect.objectContaining({ step: 'reading' }),
      }),
    )

    const [, document, done] = imports.complete.mock.calls[0]
    expect(document).toEqual(
      expect.objectContaining({
        workspaceId: WS,
        kind: 'PROPOSAL',
        title: 'Proposta ACME',
        source: 'PDF_IMPORT',
        ownerId: ACTOR,
        theme: { primaryColor: '#123456' },
        settings: expect.objectContaining({ layout: 'paged' }),
      }),
    )
    expect(document.publicToken).toMatch(/^[A-Za-z0-9_-]{24}$/)
    expect(done).toEqual(
      expect.objectContaining({
        costUsd: 0.01,
        model: 'anthropic:claude-sonnet-5',
        progress: { step: 'done', message: 'Pronto', pct: 100 },
      }),
    )

    const outline = toDocument.mock.calls[0][0]
    expect(outline.sections.map((section) => section.name)).toEqual([
      'Capa',
      'Investimento',
      'Aceite',
    ])
    const pricing = outline.sections[1].blocks[0] as {
      items: { id: string }[]
    }
    expect(pricing.items[0].id).toBe('item-1')
    expect(ai.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspaceId: WS,
        userId: ACTOR,
        scope: { module: 'CRM' },
      }),
    )
    expect(publish.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ status: 'READY', documentId: 'doc1' }),
    )
  })

  it("should keep the user's kind and use the model's title", async () => {
    imports.findForRun.mockResolvedValue(ok(stored({ kind: 'CONTRACT' })))

    expectOk(await DocumentImportService.run('imp1'))

    const [, document] = imports.complete.mock.calls[0]
    expect(document.kind).toBe('CONTRACT')
    expect(document.title).toBe('Proposta comercial')
    expect(requests[0].messages[0].content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('CONTRACT (Contrato)'),
        }),
      ]),
    )
  })

  it('should write a document from a prompt as a web page', async () => {
    imports.findForRun.mockResolvedValue(
      ok(
        stored({
          mode: 'PROMPT',
          fileKey: null,
          fileName: null,
          pageCount: null,
          prompt: 'Proposta de PABX em nuvem para clínica',
        }),
      ),
    )

    expectOk(await DocumentImportService.run('imp1'))

    expect(download).not.toHaveBeenCalled()
    expect(requests[0].system).toMatch(/write a complete business document/)
    expect(requests[0].messages[0].content).toEqual(
      expect.stringContaining('Proposta de PABX em nuvem para clínica'),
    )
    const [, document, done] = imports.complete.mock.calls[0]
    expect(document.source).toBe('AI_PROMPT')
    expect(document.settings).toEqual(
      expect.objectContaining({ layout: 'web' }),
    )
    expect(imports.update.mock.calls[0][1]?.progress).toEqual(
      expect.objectContaining({ message: 'Lendo o pedido' }),
    )
    expect(done.progress).toEqual(
      expect.objectContaining({ message: 'Pronto' }),
    )
  })

  it('should send a DOCX as fenced text', async () => {
    imports.findForRun.mockResolvedValue(
      ok(stored({ mode: 'DOCX', fileName: 'contrato.docx', pageCount: null })),
    )

    expectOk(await DocumentImportService.run('imp1'))

    const content = String(requests[0].messages[0].content)
    expect(content).toContain('contrato.docx')
    expect(content).toContain('<untrusted_content source="knowledge_document">')
    expect(content).toContain('Contrato de prestação de serviços')
  })

  it('should fail a DOCX without text', async () => {
    imports.findForRun.mockResolvedValue(ok(stored({ mode: 'DOCX' })))
    docxText.mockResolvedValue(err('Não foi possível ler o texto deste DOCX.'))

    expect(expectOk(await DocumentImportService.run('imp1'))).toEqual({
      status: 'failed',
    })
    expect(lastUpdate()).toEqual(
      expect.objectContaining({
        status: 'FAILED',
        error: 'Não foi possível ler o texto deste DOCX.',
      }),
    )
    expect(chatStream).not.toHaveBeenCalled()
  })

  it('should send the page text to a model without PDF input', async () => {
    ai.prepare.mockResolvedValue(prepared(LEGACY))
    pdfPages.mockResolvedValue(ok(['Cláusula 1', '']))

    expectOk(await DocumentImportService.run('imp1'))

    const content = String(requests[0].messages[0].content)
    expect(content).toContain('<pagina numero="1">\nCláusula 1\n</pagina>')
    expect(content).toContain('[página sem texto]')
  })

  it('should fail a scanned PDF for a model without PDF input', async () => {
    ai.prepare.mockResolvedValue(prepared(LEGACY))
    pdfPages.mockResolvedValue(ok(['', '']))

    expect(expectOk(await DocumentImportService.run('imp1')).status).toBe(
      'failed',
    )
    expect(lastUpdate()?.error).toMatch(/digitalizado/)
  })

  it('should fail an unreadable PDF for a text-only model', async () => {
    ai.prepare.mockResolvedValue(prepared(LEGACY))
    pdfPages.mockResolvedValue(err('Não foi possível ler este PDF.'))

    expectOk(await DocumentImportService.run('imp1'))
    expect(lastUpdate()?.error).toBe('Não foi possível ler este PDF.')
  })

  it('should tell the user when a long text was cut', async () => {
    ai.prepare.mockResolvedValue(prepared(LEGACY))
    pdfPages.mockResolvedValue(ok(['x'.repeat(310_000)]))

    expectOk(await DocumentImportService.run('imp1'))

    const [, , done] = imports.complete.mock.calls[0]
    expect((done.progress as { message: string }).message).toMatch(
      /final ficou de fora/,
    )
  })

  it('should fall back to the text when the PDF is refused', async () => {
    replies.push(new Error('400 PDF not supported'))

    const result = expectOk(await DocumentImportService.run('imp1'))

    expect(result.status).toBe('ready')
    expect(requests).toHaveLength(2)
    expect(String(requests[1].messages[0].content)).toContain('Página um')
  })

  it('should fail when the text fallback cannot read the PDF', async () => {
    replies.push(new Error('400 PDF not supported'))
    pdfPages.mockResolvedValue(err('Não foi possível ler este PDF.'))

    expectOk(await DocumentImportService.run('imp1'))
    expect(lastUpdate()?.error).toBe('Não foi possível ler este PDF.')
  })

  it('should fail with a pt-BR reason when the provider is down', async () => {
    imports.findForRun.mockResolvedValue(ok(stored({ mode: 'PROMPT' })))
    replies.push(new Error('timeout'))

    expectOk(await DocumentImportService.run('imp1'))

    expect(lastUpdate()).toEqual(
      expect.objectContaining({
        status: 'FAILED',
        error: 'A IA não respondeu agora. Tente de novo em instantes.',
        progress: expect.objectContaining({ step: 'failed' }),
      }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'document_import',
        outcome: 'failure',
      }),
    )
  })

  it('should fail on a refusal', async () => {
    replies.push(response('', 'refusal'))

    expectOk(await DocumentImportService.run('imp1'))
    expect(lastUpdate()?.error).toMatch(/recusou/)
    expect(lastUpdate()?.costUsd).toBe(0.01)
  })

  it('should repair an invalid answer once', async () => {
    replies.push(response('{"title": "", "kind": "PROPOSAL", "sections": []}'))

    expect(expectOk(await DocumentImportService.run('imp1')).status).toBe(
      'ready',
    )
    expect(requests).toHaveLength(2)
    const repair = requests[1].messages.at(-1)
    expect(String(repair?.content)).toMatch(/could not be used/)
  })

  it('should give up after the repair', async () => {
    replies.push(response('not json'), response('```json\n{}\n```'))

    expectOk(await DocumentImportService.run('imp1'))

    expect(requests).toHaveLength(2)
    expect(lastUpdate()?.error).toMatch(/não conseguiu montar/)
  })

  it('should ask for a compact answer when it was cut off', async () => {
    replies.push(response('{"title": "Pro', 'max_tokens'))

    expectOk(await DocumentImportService.run('imp1'))

    expect(String(requests[1].messages.at(-1)?.content)).toMatch(/cut off/)
  })

  it('should fail when the outline cannot be assembled', async () => {
    toDocument.mockImplementationOnce(() => {
      throw new Error('unknown block')
    })
    expectOk(await DocumentImportService.run('imp1'))
    expect(lastUpdate()?.error).toMatch(/não pôde ser aberto no editor/)

    toDocument.mockReturnValueOnce({
      content: { nodes: {} } as never,
      theme: {},
    })
    expectOk(await DocumentImportService.run('imp1'))
    expect(lastUpdate()?.error).toMatch(/não pôde ser aberto no editor/)
  })

  it('should fail when the call cannot be prepared any more', async () => {
    ai.prepare.mockResolvedValue(err(aiQuotaExceeded(50, 50)))

    expectOk(await DocumentImportService.run('imp1'))

    expect(lastUpdate()).toEqual(
      expect.objectContaining({ status: 'FAILED', costUsd: null }),
    )
    expect(chatStream).not.toHaveBeenCalled()
  })

  it('should fail when the file is gone from the storage', async () => {
    download.mockRejectedValueOnce(new Error('NoSuchKey'))

    expectOk(await DocumentImportService.run('imp1'))
    expect(lastUpdate()?.error).toMatch(/ler o arquivo enviado/)
  })

  it('should skip a missing or finished import', async () => {
    imports.findForRun.mockResolvedValueOnce(ok(null))
    expect(expectOk(await DocumentImportService.run('gone'))).toEqual({
      status: 'skipped',
    })

    imports.findForRun.mockResolvedValueOnce(ok(stored({ status: 'READY' })))
    expect(expectOk(await DocumentImportService.run('imp1')).status).toBe(
      'skipped',
    )
    expect(imports.update).not.toHaveBeenCalled()
  })

  it('should return the database error so the job retries', async () => {
    imports.findForRun.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await DocumentImportService.run('imp1'), 'DATABASE_ERROR')

    imports.complete.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await DocumentImportService.run('imp1'), 'DATABASE_ERROR')
    expect(lastUpdate()?.status).toBe('FAILED')
  })

  it('should still publish when saving the progress fails', async () => {
    imports.update.mockResolvedValue(err(databaseError('x')))

    expectOk(await DocumentImportService.run('imp1'))

    expect(publish.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        progress: expect.objectContaining({ step: 'reading' }),
      }),
    )
  })

  it('should push the progress while the model writes', async () => {
    imports.findForRun.mockResolvedValue(ok(stored({ pageCount: 1 })))
    vi.useFakeTimers({ toFake: ['Date'] })
    const start = Date.now()
    const text = JSON.stringify(ANSWER)
    chatStream.mockImplementationOnce((request: AiChatRequest) => {
      requests.push(request)
      return (async function* (): AsyncGenerator<AiStreamChunk> {
        vi.setSystemTime(start + 3_000)
        yield { type: 'text', delta: text.slice(0, 10) }
        vi.setSystemTime(start + 3_500)
        yield { type: 'text', delta: text.slice(10, 20) }
        vi.setSystemTime(start + 7_000)
        yield { type: 'text', delta: text.slice(20) }
        yield { type: 'done', response: response(text) }
      })()
    })
    try {
      expectOk(await DocumentImportService.run('imp1'))
    } finally {
      vi.useRealTimers()
    }

    const steps = imports.update.mock.calls.map(
      ([, data]) => (data.progress as { step?: string } | undefined)?.step,
    )
    expect(steps).toEqual([
      'reading',
      'structure',
      'structure',
      'sections',
      'sections',
    ])
  })
})
