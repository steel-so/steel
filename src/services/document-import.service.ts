import { randomBytes } from 'node:crypto'
import { createId } from '@paralleldrive/cuid2'
import type { DocumentImport, DocumentKind } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { conflict, storageError } from '@/src/errors'
import {
  documentImportFailed,
  documentImportNotFound,
  documentImportUnsupported,
} from '@/src/errors/app-error'
import { isAiProviderConfigured } from '@/src/lib/ai'
import { aiModelPricing } from '@/src/lib/ai/models'
import {
  currentPeriodStart,
  isQuotaExceeded,
  remainingUsd,
} from '@/src/lib/ai/quota'
import type { AiContentPart, AiUsageTokens } from '@/src/lib/ai/types'
import { validateDocumentContent } from '@/src/lib/canvas-document/catalog'
import {
  type DocumentOutline,
  outlineToDocument,
} from '@/src/lib/canvas-document/outline'
import {
  acceptsPdfInput,
  DOCUMENT_FILES_BUCKET,
  DOCUMENT_IMPORT_DOCX_TYPE,
  DOCUMENT_IMPORT_PDF_TYPE,
  documentImportFileName,
  documentImportKey,
  outlineMaxTokens,
} from '@/src/lib/document-ai/constants'
import { estimateDocumentAi } from '@/src/lib/document-ai/estimate'
import {
  countPdfPages,
  extractDocxText,
  extractPdfPages,
  looksLikeDocx,
  looksLikePdf,
  pagesAsText,
} from '@/src/lib/document-ai/extract'
import {
  type DocumentImportProgress,
  failedProgress,
  progressOf,
  streamingProgress,
} from '@/src/lib/document-ai/progress'
import {
  boundText,
  buildImportSystem,
  buildPromptSystem,
  pdfImportContent,
  promptContent,
  textImportContent,
} from '@/src/lib/document-ai/prompts'
import { publishDocumentImport } from '@/src/lib/document-ai/realtime'
import { outlineCall } from '@/src/lib/document-ai/run'
import { DocumentsAiJob } from '@/src/lib/queue/jobs'
import { getDocumentsAiQueue } from '@/src/lib/queue/queues'
import { err, ok, type Result } from '@/src/lib/result'
import {
  deleteObject,
  ensureBucket,
  getObject,
  putObject,
} from '@/src/lib/storage/s3'
import { toDocumentImportDTO } from '@/src/mappers/document-import.mapper'
import { AiUsageRepository } from '@/src/repositories/ai-settings.repository'
import { DocumentImportRepository } from '@/src/repositories/document-import.repository'
import {
  type CreateDocumentImportInput,
  DEFAULT_DOCUMENT_SETTINGS,
  DOCUMENT_IMPORT_MAX_BYTES,
  DOCUMENT_IMPORT_MAX_PAGES,
} from '@/src/schemas/document.schema'
import type { DocumentImportDTO } from '@/types/document'
import type { DocumentImportContextDTO } from '@/types/document-import'
import { AiUsageService, type PreparedAiCall } from './ai-usage.service'
import { assertModuleMember } from './authz'
import { assertFeature } from './feature-flag.service'
import { PlatformAiSettingsService } from './platform-ai-settings.service'

/**
 * AI import of CRM > Documentos (ADR 0063, docs/documents/README.md): a PDF
 * or DOCX (or a request in text) becomes a draft document. `create`
 * validates the file, checks the CRM AI quota, stores the file in MinIO and
 * enqueues `documents-ai`; the worker calls `run`, which asks the model for
 * a `DocumentOutline` (structured output), assembles it with the catalog
 * presets (`outlineToDocument`) and stores the document. Progress is kept
 * on the row and pushed to the SSE. Usage goes to the CRM AI ledger
 * (`CRM_ASSISTANT`, module CRM), like the site generator.
 */

const COMPONENT = 'DocumentImportService'
/** Progress is saved/pushed at most this often while the model writes. */
const PROGRESS_INTERVAL_MS = 2_500
/** Characters the answer usually has per page (moves the progress bar). */
const CHARS_PER_PAGE = 2_500
const PROMPT_EXPECTED_CHARS = 14_000
/** Imports one user may have queued or running at once (cost guard). */
export const MAX_ACTIVE_IMPORTS = 3

export interface DocumentImportFile {
  buffer: Buffer
  contentType: string
  fileName: string
}

export interface DocumentImportRunResult {
  status: 'ready' | 'failed' | 'skipped'
  documentId?: string
}

const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000

const PROVIDER_FAILED = 'A IA não respondeu agora. Tente de novo em instantes.'
const REFUSED =
  'A IA recusou o conteúdo deste arquivo. Revise o arquivo ou monte o documento no editor.'
const READ_FAILED =
  'Não foi possível ler o arquivo enviado. Envie o arquivo de novo.'

/** CRM module + the documents permission of the legacy proposals. */
function authorize(actorId: string, workspaceId: string) {
  return assertModuleMember(actorId, workspaceId, 'CRM', {
    resource: 'documents',
    action: 'CREATE',
  })
}

/** The model reads up to 60 pages before it writes: wait that long for
 * the first chunk before failing over to another model. */
const FIRST_CHUNK_TIMEOUT_MS = 10 * 60 * 1000

/** Plan feature + model + quota (the same gate as the site generator). */
async function prepareCall(
  actorId: string,
  workspaceId: string,
): Promise<Result<PreparedAiCall>> {
  const feature = await assertFeature(workspaceId, 'crm.aiAssistant')
  if (!feature.ok) return feature
  return AiUsageService.prepare(workspaceId, 'CRM_ASSISTANT', actorId, [], {
    timeoutMs: FIRST_CHUNK_TIMEOUT_MS,
  })
}

interface CheckedFile {
  mode: 'PDF' | 'DOCX'
  fileName: string
  contentType: string
  pageCount: number | null
}

/** Type (by content, not by name), size and pages of an upload. */
async function checkFile(
  mode: CreateDocumentImportInput['mode'],
  file: DocumentImportFile | undefined,
): Promise<Result<CheckedFile>> {
  if (!file || file.buffer.byteLength === 0) {
    return err(documentImportUnsupported('Envie um arquivo PDF ou DOCX'))
  }
  if (file.buffer.byteLength > DOCUMENT_IMPORT_MAX_BYTES) {
    return err(documentImportUnsupported('O arquivo passa de 20 MB'))
  }
  const fileName = documentImportFileName(file.fileName)
  if (mode === 'DOCX') {
    if (!looksLikeDocx(file.buffer)) {
      return err(documentImportUnsupported('O arquivo não é um DOCX válido'))
    }
    return ok({
      mode,
      fileName,
      contentType: DOCUMENT_IMPORT_DOCX_TYPE,
      pageCount: null,
    })
  }
  if (!looksLikePdf(file.buffer)) {
    return err(documentImportUnsupported('O arquivo não é um PDF válido'))
  }
  const pages = await countPdfPages(file.buffer)
  if (!pages.ok) return err(documentImportUnsupported(pages.error))
  if (pages.value > DOCUMENT_IMPORT_MAX_PAGES) {
    return err(
      documentImportUnsupported(
        `O PDF tem ${pages.value} páginas; o limite é ${DOCUMENT_IMPORT_MAX_PAGES}`,
      ),
    )
  }
  return ok({
    mode: 'PDF',
    fileName,
    contentType: DOCUMENT_IMPORT_PDF_TYPE,
    pageCount: pages.value,
  })
}

/** Saves the progress on the row and pushes it to the SSE. */
async function saveProgress(
  row: DocumentImport,
  progress: DocumentImportProgress,
  extra: Parameters<typeof DocumentImportRepository.update>[1] = {},
): Promise<DocumentImport> {
  const updated = await DocumentImportRepository.update(row.id, {
    ...extra,
    progress,
  })
  const next = updated.ok ? updated.value : { ...row, progress }
  await publishDocumentImport(toDocumentImportDTO(next))
  return next
}

/** Closes the import as FAILED with a pt-BR reason. */
async function fail(
  row: DocumentImport,
  message: string,
  costUsd: number | null,
): Promise<DocumentImportRunResult> {
  await saveProgress(row, failedProgress(message), {
    status: 'FAILED',
    error: message,
    costUsd,
    finishedAt: new Date(),
  })
  auditMutation({
    entity: 'document_import',
    action: 'update',
    actorId: row.createdById,
    targetId: row.id,
    outcome: 'failure',
    reason: message,
    meta: { workspaceId: row.workspaceId, mode: row.mode },
  })
  logger.warn('documents.import.failed', {
    component: COMPONENT,
    workspaceId: row.workspaceId,
    importId: row.id,
    mode: row.mode,
    message,
  })
  return { status: 'failed' }
}

interface ModelInput {
  system: string
  content: string | AiContentPart[]
  /** Text of the file, for the fallback when the PDF itself is refused. */
  fallback: (() => Promise<Result<string, string>>) | null
  native: boolean
  truncated: boolean
}

async function readPdfText(
  buffer: Buffer,
): Promise<Result<{ text: string; truncated: boolean }, string>> {
  const pages = await extractPdfPages(buffer)
  if (!pages.ok) return pages
  if (pages.value.every((page) => !page)) {
    return err(
      'O PDF não tem texto selecionável (parece digitalizado) e o modelo de IA deste workspace não lê imagens de PDF.',
    )
  }
  return ok(boundText(pagesAsText(pages.value)))
}

/** What the model reads: the PDF, its text, the DOCX text or the request. */
async function buildModelInput(
  row: DocumentImport,
  call: PreparedAiCall,
  title: string | undefined,
): Promise<Result<ModelInput, string>> {
  const kind = row.kind
  if (row.mode === 'PROMPT') {
    return ok({
      system: buildPromptSystem(),
      content: promptContent({ prompt: row.prompt ?? '', kind, title }),
      fallback: null,
      native: false,
      truncated: false,
    })
  }

  let buffer: Buffer
  try {
    buffer = await getObject({
      bucket: DOCUMENT_FILES_BUCKET,
      key: row.fileKey ?? '',
    })
  } catch {
    return err(READ_FAILED)
  }
  const fileName = row.fileName ?? 'arquivo'
  const asText = (text: string) =>
    textImportContent({ text, fileName, kind, title })

  if (row.mode === 'DOCX') {
    const text = await extractDocxText(buffer)
    if (!text.ok) return text
    const bounded = boundText(text.value)
    return ok({
      system: buildImportSystem(),
      content: asText(bounded.text),
      fallback: null,
      native: false,
      truncated: bounded.truncated,
    })
  }

  if (acceptsPdfInput(call.model)) {
    return ok({
      system: buildImportSystem(),
      content: pdfImportContent({
        base64: buffer.toString('base64'),
        fileName,
        kind,
        title,
      }),
      fallback: async () => {
        const text = await readPdfText(buffer)
        return text.ok ? ok(asText(text.value.text)) : text
      },
      native: true,
      truncated: false,
    })
  }
  const text = await readPdfText(buffer)
  if (!text.ok) return text
  return ok({
    system: buildImportSystem(),
    content: asText(text.value.text),
    fallback: null,
    native: false,
    truncated: text.value.truncated,
  })
}

/**
 * The uploaded file is only the model's input: once the document exists it
 * is deleted (less personal data kept, LGPD). Best effort — the workspace
 * purge still covers a leftover.
 */
async function dropSourceFile(row: DocumentImport): Promise<void> {
  if (!row.fileKey) return
  try {
    await deleteObject({ bucket: DOCUMENT_FILES_BUCKET, key: row.fileKey })
  } catch (cause) {
    logger.warn('documents.import.source_delete_failed', {
      component: COMPONENT,
      workspaceId: row.workspaceId,
      importId: row.id,
      message: cause instanceof Error ? cause.message : String(cause),
    })
  }
}

/** Records every provider call and keeps the running cost. */
function usageMeter(call: PreparedAiCall, row: DocumentImport) {
  let costUsd = 0
  return {
    onUsage: async (usage: AiUsageTokens) => {
      costUsd += AiUsageService.price(call, usage)
      await AiUsageService.record(call, {
        workspaceId: row.workspaceId,
        userId: row.createdById,
        usage,
        scope: { module: 'CRM' },
      })
    },
    cost: () => round(costUsd),
  }
}

function failureMessage(reason: 'provider' | 'refusal' | 'invalid'): string {
  if (reason === 'provider') return PROVIDER_FAILED
  if (reason === 'refusal') return REFUSED
  return documentImportFailed().message
}

/** The canvas document of an outline, checked by the catalog. */
function assemble(
  outline: DocumentOutline,
): Result<{ content: unknown; theme: Record<string, unknown> }, string> {
  let built: ReturnType<typeof outlineToDocument>
  try {
    built = outlineToDocument(outline)
  } catch (cause) {
    return err(cause instanceof Error ? cause.message : String(cause))
  }
  const checked = validateDocumentContent(built.content)
  if (!checked.ok) return err(checked.error)
  return ok({ content: checked.value, theme: built.theme })
}

/** An unfinished import older than this is considered lost. */
export const DOCUMENT_IMPORT_STALE_MS = 30 * 60 * 1000
const STALE_MESSAGE =
  'A montagem demorou demais e foi interrompida. Tente de novo.'

function isStale(row: DocumentImport, now = Date.now()): boolean {
  if (row.status === 'READY' || row.status === 'FAILED') return false
  return now - row.createdAt.getTime() > DOCUMENT_IMPORT_STALE_MS
}

async function closeStale(row: DocumentImport): Promise<DocumentImport> {
  const closed = await DocumentImportRepository.update(row.id, {
    status: 'FAILED',
    error: STALE_MESSAGE,
    progress: failedProgress(STALE_MESSAGE),
    finishedAt: new Date(),
  })
  logger.warn('documents.import.stale', {
    component: COMPONENT,
    workspaceId: row.workspaceId,
    importId: row.id,
    status: row.status,
  })
  return closed.ok
    ? closed.value
    : {
        ...row,
        status: 'FAILED',
        error: STALE_MESSAGE,
        progress: failedProgress(STALE_MESSAGE),
      }
}

export const DocumentImportService = {
  /** Quota, model and cost estimate shown before an import. */
  async context(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<DocumentImportContextDTO>> {
    const membership = await authorize(actorId, workspaceId)
    if (!membership.ok) return membership

    const [feature, resolved, usage, margin] = await Promise.all([
      assertFeature(workspaceId, 'crm.aiAssistant'),
      AiUsageService.resolveModel(workspaceId, 'CRM_ASSISTANT', actorId),
      AiUsageRepository.sumSince(workspaceId, currentPeriodStart()),
      PlatformAiSettingsService.getCostMargin(),
    ])
    if (!resolved.ok) return resolved
    if (!usage.ok) return usage

    const model = resolved.value.model
    const quotaUsd = resolved.value.settings.monthlyQuotaUsd
    const usedUsd = usage.value.costUsd
    const usable = model !== null && isAiProviderConfigured(model.provider)
    return ok({
      available: feature.ok && usable,
      unavailableReason: !feature.ok
        ? 'A IA do CRM não está incluída no plano deste workspace.'
        : usable
          ? null
          : 'Nenhum modelo de IA está disponível. Peça a um administrador para configurar em Ajustes > Steel IA.',
      nativePdf: model !== null && acceptsPdfInput(model),
      maxBytes: DOCUMENT_IMPORT_MAX_BYTES,
      maxPages: DOCUMENT_IMPORT_MAX_PAGES,
      quota: {
        usedUsd: Math.round(usedUsd * 100) / 100,
        quotaUsd,
        remainingUsd: remainingUsd(usedUsd, quotaUsd),
        exceeded: isQuotaExceeded(usedUsd, quotaUsd),
      },
      estimate: model
        ? {
            ...estimateDocumentAi(aiModelPricing(model), margin),
            model: model.label,
          }
        : null,
    })
  },

  /**
   * "Importar PDF/DOCX" or "Gerar com IA": checks everything that can fail
   * up front (permission, file, plan, quota), stores the file and queues
   * the build. The document appears when the import turns READY.
   */
  async create(
    actorId: string,
    workspaceId: string,
    input: CreateDocumentImportInput,
    file?: DocumentImportFile,
  ): Promise<Result<DocumentImportDTO>> {
    const membership = await authorize(actorId, workspaceId)
    if (!membership.ok) return membership

    let checked: CheckedFile | null = null
    if (input.mode !== 'PROMPT') {
      const result = await checkFile(input.mode, file)
      if (!result.ok) return result
      checked = result.value
    }

    const active = await DocumentImportRepository.countActive(
      workspaceId,
      actorId,
    )
    if (!active.ok) return active
    if (active.value >= MAX_ACTIVE_IMPORTS) {
      return err(
        conflict(
          `Você já tem ${MAX_ACTIVE_IMPORTS} documentos sendo montados. Espere um terminar para começar outro.`,
        ),
      )
    }

    const call = await prepareCall(actorId, workspaceId)
    if (!call.ok) return call

    const id = createId()
    let fileKey: string | null = null
    if (checked && file) {
      fileKey = documentImportKey(workspaceId, id, checked.fileName)
      try {
        await ensureBucket(DOCUMENT_FILES_BUCKET)
        await putObject({
          bucket: DOCUMENT_FILES_BUCKET,
          key: fileKey,
          body: file.buffer,
          contentType: checked.contentType,
        })
      } catch (cause) {
        logger.error('documents.import.upload_failed', {
          component: COMPONENT,
          workspaceId,
          message: cause instanceof Error ? cause.message : String(cause),
        })
        return err(storageError('Não foi possível guardar o arquivo enviado'))
      }
    }

    const created = await DocumentImportRepository.create({
      id,
      workspaceId,
      mode: input.mode,
      kind: input.kind,
      fileKey,
      fileName: checked?.fileName ?? null,
      fileSize: file && checked ? file.buffer.byteLength : null,
      pageCount: checked?.pageCount ?? null,
      prompt: input.mode === 'PROMPT' ? (input.prompt ?? null) : null,
      progress: progressOf('queued', input.mode === 'PROMPT'),
      createdById: actorId,
    })
    if (!created.ok) {
      auditMutation({
        entity: 'document_import',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: created.error.code,
      })
      return created
    }

    try {
      await getDocumentsAiQueue().add(
        DocumentsAiJob.Import,
        { importId: id, ...(input.title && { title: input.title }) },
        { jobId: id, attempts: 2 },
      )
    } catch (cause) {
      logger.error('documents.import.enqueue_failed', {
        component: COMPONENT,
        workspaceId,
        importId: id,
        message: cause instanceof Error ? cause.message : String(cause),
      })
      const message = 'Não foi possível iniciar a importação. Tente de novo.'
      await DocumentImportRepository.update(id, {
        status: 'FAILED',
        error: message,
        progress: failedProgress(message),
        finishedAt: new Date(),
      })
      return err(documentImportFailed(message))
    }

    auditMutation({
      entity: 'document_import',
      action: 'create',
      actorId,
      targetId: id,
      meta: {
        workspaceId,
        mode: input.mode,
        kind: input.kind,
        pages: checked?.pageCount ?? null,
        model: call.value.model.key,
      },
    })
    logger.info('documents.import.created', {
      component: COMPONENT,
      workspaceId,
      importId: id,
      mode: input.mode,
      pages: checked?.pageCount ?? null,
      bytes: file?.buffer.byteLength ?? 0,
    })
    return ok(toDocumentImportDTO(created.value))
  },

  /** One import of the requester (admins see any of the workspace). */
  async get(
    actorId: string,
    workspaceId: string,
    importId: string,
  ): Promise<Result<DocumentImportDTO>> {
    const membership = await authorize(actorId, workspaceId)
    if (!membership.ok) return membership
    const row = await DocumentImportRepository.findById(importId, workspaceId)
    if (!row.ok) return row
    if (row.value.createdById !== actorId && !membership.value.isPrivileged) {
      return err(documentImportNotFound())
    }
    if (isStale(row.value)) {
      // The worker died mid-build (deploy, OOM): close it so the dialog
      // stops waiting. A late worker skips a FAILED import.
      return ok(toDocumentImportDTO(await closeStale(row.value)))
    }
    return ok(toDocumentImportDTO(row.value))
  },

  /**
   * The build, run by the `documents-ai` worker. Idempotent: a finished
   * import is skipped. Returns `err` only when the row cannot be read or
   * saved (BullMQ retries); everything else ends as READY or FAILED.
   */
  async run(
    importId: string,
    options: { title?: string } = {},
  ): Promise<Result<DocumentImportRunResult>> {
    const loaded = await DocumentImportRepository.findForRun(importId)
    if (!loaded.ok) return loaded
    if (!loaded.value || ['READY', 'FAILED'].includes(loaded.value.status)) {
      return ok({ status: 'skipped' })
    }
    const prompt = loaded.value.mode === 'PROMPT'
    let row = await saveProgress(loaded.value, progressOf('reading', prompt), {
      status: 'RUNNING',
    })

    const call = await prepareCall(row.createdById, row.workspaceId)
    if (!call.ok) return ok(await fail(row, call.error.message, null))

    const input = await buildModelInput(row, call.value, options.title)
    if (!input.ok) return ok(await fail(row, input.error, null))

    row = await saveProgress(row, progressOf('structure', prompt), {
      model: call.value.model.key,
    })

    const meter = usageMeter(call.value, row)
    const expected = prompt
      ? PROMPT_EXPECTED_CHARS
      : (row.pageCount ?? 4) * CHARS_PER_PAGE
    let lastSaved = Date.now()
    let saving: Promise<unknown> = Promise.resolve()
    const onProgress = (received: number) => {
      const now = Date.now()
      if (now - lastSaved < PROGRESS_INTERVAL_MS) return
      lastSaved = now
      const progress = streamingProgress(received, expected, prompt)
      saving = saving.then(() => saveProgress(row, progress))
    }
    const ask = (content: string | AiContentPart[]) =>
      outlineCall({
        provider: call.value.provider,
        model: call.value.model.model,
        system: input.value.system,
        content,
        maxTokens: outlineMaxTokens(call.value.model),
        onUsage: meter.onUsage,
        onProgress,
      })

    let answer = await ask(input.value.content)
    // A model that rejects the PDF itself gets its text instead.
    if (!answer.ok && answer.reason === 'provider' && input.value.fallback) {
      logger.warn('documents.import.native_pdf_failed', {
        component: COMPONENT,
        workspaceId: row.workspaceId,
        importId: row.id,
        model: call.value.model.key,
        message:
          answer.cause instanceof Error
            ? answer.cause.message
            : String(answer.cause),
      })
      const text = await input.value.fallback()
      if (!text.ok) {
        await saving
        return ok(await fail(row, text.error, meter.cost()))
      }
      answer = await ask(text.value)
    }
    await saving

    if (!answer.ok) {
      logger.error('documents.import.model_failed', {
        component: COMPONENT,
        workspaceId: row.workspaceId,
        importId: row.id,
        model: call.value.model.key,
        reason: answer.reason,
        attempts: answer.attempts,
        problems: answer.problems.slice(0, 3),
      })
      return ok(await fail(row, failureMessage(answer.reason), meter.cost()))
    }

    row = await saveProgress(row, progressOf('sections', prompt))
    const assembled = assemble(answer.outline)
    if (!assembled.ok) {
      logger.error('documents.import.assemble_failed', {
        component: COMPONENT,
        workspaceId: row.workspaceId,
        importId: row.id,
        message: assembled.error,
      })
      return ok(
        await fail(
          row,
          'A IA montou um documento que não pôde ser aberto no editor. Tente de novo.',
          meter.cost(),
        ),
      )
    }

    const kind: DocumentKind =
      row.kind === 'OTHER' ? answer.outline.kind : row.kind
    const title = (options.title?.trim() || answer.outline.title).slice(0, 200)
    const done = progressOf('done', prompt)
    const completed = await DocumentImportRepository.complete(
      row.id,
      {
        workspaceId: row.workspaceId,
        kind,
        title,
        source: prompt ? 'AI_PROMPT' : 'PDF_IMPORT',
        content: assembled.value.content,
        theme: assembled.value.theme,
        settings: {
          ...DEFAULT_DOCUMENT_SETTINGS,
          // A file keeps its pages; a written document reads as a web page.
          layout: prompt ? 'web' : 'paged',
        },
        publicToken: randomBytes(18).toString('base64url'),
        ownerId: row.createdById,
      },
      {
        progress: input.value.truncated
          ? {
              ...done,
              message:
                'Pronto — o arquivo era longo e o final ficou de fora; confira no editor.',
            }
          : done,
        costUsd: meter.cost(),
        model: call.value.model.key,
      },
    )
    if (!completed.ok) {
      await fail(row, documentImportFailed().message, meter.cost())
      return completed
    }

    await publishDocumentImport(toDocumentImportDTO(completed.value.import))
    await dropSourceFile(row)
    auditMutation({
      entity: 'document_import',
      action: 'update',
      actorId: row.createdById,
      targetId: row.id,
      meta: {
        workspaceId: row.workspaceId,
        documentId: completed.value.document.id,
        mode: row.mode,
        kind,
        costUsd: meter.cost(),
      },
    })
    logger.info('documents.import.ready', {
      component: COMPONENT,
      workspaceId: row.workspaceId,
      importId: row.id,
      documentId: completed.value.document.id,
      mode: row.mode,
      native: input.value.native,
      sections: answer.outline.sections.length,
      attempts: answer.attempts,
      costUsd: meter.cost(),
      model: call.value.model.key,
    })
    return ok({ status: 'ready', documentId: completed.value.document.id })
  },
}
