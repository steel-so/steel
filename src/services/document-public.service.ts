import type { DocumentRecipient, DocumentResponseAction } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { baseEmailUrl } from '@/lib/base-email-url'
import {
  type AppError,
  documentAcceptNotAllowed,
  documentAlreadyAnswered,
  documentExpired,
  documentFieldsInvalid,
  documentLinkUnavailable,
  documentVersionStale,
} from '@/src/errors/app-error'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { documentFields } from '@/src/lib/canvas-document/fields'
import {
  documentPricingItems,
  documentPricingTotals,
} from '@/src/lib/canvas-document/pricing'
import { isProposalValidityPast } from '@/src/lib/crm-proposal-validity'
import {
  sanitizePricingSelection,
  validateDocumentAnswers,
} from '@/src/lib/documents/answers'
import { formatDocumentMoney } from '@/src/lib/documents/format'
import { hashDocumentIp, newDocumentToken } from '@/src/lib/documents/hash'
import { isLinkPreviewBot } from '@/src/lib/documents/user-agent'
import { sendDocumentAnsweredEmail } from '@/src/lib/mail/documents/send-document-emails'
import { err, ok, type Result } from '@/src/lib/result'
import {
  documentLinkUrl,
  jsonRecord,
  toDocumentPublicDTO,
} from '@/src/mappers/document.mapper'
import {
  type DocumentPublicContext,
  DocumentRepository,
} from '@/src/repositories/document.repository'
import { DocumentRecipientRepository } from '@/src/repositories/document-recipient.repository'
import { DocumentResponseRepository } from '@/src/repositories/document-response.repository'
import type {
  AcceptDocumentInput,
  DeclineDocumentInput,
  DocumentFieldValuesDTO,
  DocumentPricingSelectionDTO,
  SubmitDocumentFieldsInput,
} from '@/src/schemas/document.schema'
import type {
  DocumentIdentifyResultDTO,
  DocumentPublicDTO,
} from '@/types/document'
import {
  type DocumentTokenAccess,
  resolveDocumentToken,
} from './document-access'
import { advanceOpportunityOnAccept } from './document-crm-sync'
import { documentPath, notifyDocumentAnswered } from './document-notifications'
import { DocumentVariablesService } from './document-variables.service'
import { dispatchSteelAgentEvent } from './steel-agent-dispatcher'

/**
 * Public link of CRM > Documentos (`/d/<token>`, ADR 0063): no session, the
 * token is the access. Answers are final and carry evidence (version hash,
 * hashed IP, user agent); a stale version, an expired document or a second
 * answer are refused.
 */

/** Evidence of a public request, collected by the route. */
export interface DocumentRequestEvidence {
  ip: string
  userAgent: string | null
}

type OpenContext = DocumentPublicContext & {
  currentVersion: NonNullable<DocumentPublicContext['currentVersion']>
}

type Link = {
  access: DocumentTokenAccess
  context: OpenContext
  recipient: DocumentRecipient | null
}

async function loadLink(token: string): Promise<Result<Link, AppError>> {
  const access = await resolveDocumentToken(token)
  if (!access.ok) return access

  const context = await DocumentRepository.findPublicContext(
    access.value.documentId,
  )
  if (!context.ok) return context
  const version = context.value.currentVersion
  if (!version) return err(documentLinkUnavailable())

  let recipient: DocumentRecipient | null = null
  if (access.value.recipientId) {
    const found = await DocumentRecipientRepository.findById(
      access.value.recipientId,
      access.value.documentId,
    )
    if (!found.ok) return found
    recipient = found.value
  }
  return ok({
    access: access.value,
    context: { ...context.value, currentVersion: version },
    recipient,
  })
}

/** Marks the first/last read; link previews and bots are ignored. */
async function markOpened(
  access: DocumentTokenAccess,
  userAgent: string | null | undefined,
): Promise<Result<{ firstView: boolean }>> {
  if (isLinkPreviewBot(userAgent)) return ok({ firstView: false })
  const now = new Date()
  const viewed = await DocumentRepository.markViewed(access.documentId, now)
  if (!viewed.ok) return viewed
  if (access.recipientId) {
    const marked = await DocumentRecipientRepository.markViewed(
      access.recipientId,
      now,
    )
    if (!marked.ok) return marked
  }
  return ok(viewed.value)
}

/** Accept, decline and submit need an open, unexpired document. */
function assertAnswerable(context: OpenContext): Result<true> {
  if (context.status === 'ACCEPTED' || context.status === 'DECLINED') {
    return err(documentAlreadyAnswered())
  }
  if (
    context.status === 'EXPIRED' ||
    isProposalValidityPast(context.validUntil)
  ) {
    return err(documentExpired())
  }
  return ok(true)
}

/** The frozen content as a canvas document (defensive on malformed JSON). */
function versionCanvas(context: OpenContext): CanvasDocument {
  const content = jsonRecord(context.currentVersion.content)
  return {
    catalog: String(content.catalog ?? ''),
    version: Number(content.version ?? 0),
    rootId: String(content.rootId ?? 'root'),
    nodes: jsonRecord(content.nodes) as CanvasDocument['nodes'],
  }
}

function fieldsError(message: string, errors: Record<string, string>) {
  return { ...documentFieldsInvalid(message), details: { fields: errors } }
}

type Answer = {
  action: DocumentResponseAction
  name: string | null
  email: string | null
  fields: DocumentFieldValuesDTO
  selection: DocumentPricingSelectionDTO
  reason: string | null
}

type Priced =
  | {
      ok: true
      fields: DocumentFieldValuesDTO
      selection: DocumentPricingSelectionDTO
      total: number | null
    }
  | { ok: false; error: AppError }

const AUDIT_ACTION = {
  ACCEPT: 'accept',
  DECLINE: 'reject',
  SUBMIT: 'respond',
} as const

/** Validates the fields and prices the selection against the version. */
function priceAnswer(
  canvas: CanvasDocument,
  fields: DocumentFieldValuesDTO,
  selection: DocumentPricingSelectionDTO,
): Priced {
  const answers = validateDocumentAnswers(documentFields(canvas), fields)
  if (!answers.ok) {
    return { ok: false, error: fieldsError(answers.message, answers.errors) }
  }
  const items = documentPricingItems(canvas)
  const clean = sanitizePricingSelection(items, selection)
  const total =
    items.length > 0 ? documentPricingTotals(canvas, clean).total : null
  return { ok: true, fields: answers.values, selection: clean, total }
}

async function record(
  link: Link,
  answer: Answer,
  total: number | null,
  evidence: DocumentRequestEvidence,
): Promise<Result<true>> {
  const { context } = link
  const ipHash = hashDocumentIp(evidence.ip)
  const saved = await DocumentResponseRepository.answer({
    documentId: context.id,
    workspaceId: context.workspaceId,
    versionId: context.currentVersion.id,
    versionSha256: context.currentVersion.sha256,
    recipientId: link.recipient?.id ?? null,
    action: answer.action,
    name: answer.name,
    email: answer.email,
    fields: answer.fields,
    selection: answer.selection,
    totalValue: total,
    reason: answer.reason,
    ipHash,
    userAgent: evidence.userAgent?.slice(0, 500) ?? null,
    at: new Date(),
  })
  if (!saved.ok) return saved
  if (!saved.value) return err(documentAlreadyAnswered())

  auditMutation({
    entity: 'document',
    action: AUDIT_ACTION[answer.action],
    actorId: null,
    targetId: context.id,
    meta: {
      via: 'public_link',
      workspaceId: context.workspaceId,
      recipientId: link.recipient?.id ?? null,
      versionNumber: context.currentVersion.number,
      ipHash,
    },
  })
  return ok(true)
}

/** Owner e-mail of an accept/decline; a failure is only logged. */
async function emailOwner(
  context: OpenContext,
  input: {
    action: 'ACCEPT' | 'DECLINE'
    readerName: string
    reason: string | null
    total: number | null
  },
): Promise<void> {
  try {
    await sendDocumentAnsweredEmail({
      to: context.owner.email,
      username: context.owner.name,
      documentTitle: context.title,
      workspaceName: context.workspace.name,
      action: input.action,
      readerName: input.readerName,
      reason: input.reason,
      totalLabel: input.total ? formatDocumentMoney(input.total) : null,
      documentUrl: `${baseEmailUrl}/${context.workspace.slug}${documentPath(context.id)}`,
    })
  } catch (error) {
    logger.warn('documents.public.owner_email_failed', {
      documentId: context.id,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

/** Notifications and automations after a final answer (never fail it). */
function afterAnswer(
  link: Link,
  input: {
    action: 'ACCEPT' | 'DECLINE'
    readerName: string
    reason: string | null
    total: number | null
  },
): void {
  const { context } = link
  void notifyDocumentAnswered({
    workspaceId: context.workspaceId,
    document: {
      id: context.id,
      title: context.title,
      ownerId: context.ownerId,
    },
    action: input.action,
    readerName: input.readerName,
  })
  void emailOwner(context, input)
  void dispatchSteelAgentEvent(
    context.workspaceId,
    input.action === 'ACCEPT'
      ? 'crm.document.accepted'
      : 'crm.document.declined',
    {
      documentId: context.id,
      title: context.title,
      kind: context.kind,
      ownerId: context.ownerId,
      recipientId: link.recipient?.id ?? null,
      readerName: input.readerName,
      opportunityId: context.opportunityId,
      totalValue: input.total,
    },
  )
  if (
    input.action === 'ACCEPT' &&
    context.kind === 'PROPOSAL' &&
    context.opportunityId
  ) {
    void advanceOpportunityOnAccept({
      workspaceId: context.workspaceId,
      opportunityId: context.opportunityId,
      documentTitle: context.title,
      acceptedByName: input.readerName,
      totalValue: input.total,
      authorId: context.ownerId,
    })
  }
}

/**
 * The document as the link shows it. `recordView` marks the first/last read
 * (SENT → VIEWED) unless the user agent is a link preview.
 */
async function getPublicDocument(
  token: string,
  options: { recordView?: boolean; userAgent?: string | null } = {},
): Promise<Result<DocumentPublicDTO>> {
  if (options.recordView) {
    const access = await resolveDocumentToken(token)
    if (!access.ok) return access
    const opened = await markOpened(access.value, options.userAgent)
    if (!opened.ok) return opened
  }

  const link = await loadLink(token)
  if (!link.ok) return link

  const variables = await DocumentVariablesService.forDocument(
    link.value.access.documentId,
    link.value.access.recipientId,
  )
  if (!variables.ok) return variables

  return ok(
    toDocumentPublicDTO({
      token,
      context: link.value.context,
      recipient: link.value.recipient,
      variables: variables.value as Record<string, string>,
    }),
  )
}

export const DocumentPublicService = {
  getByToken: getPublicDocument,

  /**
   * First/last read of a link, for callers outside the page (the analytics
   * beacon). Idempotent; bots and link previews are ignored.
   */
  async recordOpen(
    token: string,
    userAgent?: string | null,
  ): Promise<Result<{ firstView: boolean }>> {
    const access = await resolveDocumentToken(token)
    if (!access.ok) return access
    return markOpened(access.value, userAgent)
  },

  /**
   * Generic link asking who reads (`requireIdentification`): the reader gets
   * a personal link of their own, so reads and answers are attributed. A
   * personal token answers with itself.
   */
  async identify(
    token: string,
    input: { name: string; email: string },
  ): Promise<Result<DocumentIdentifyResultDTO>> {
    const access = await resolveDocumentToken(token)
    if (!access.ok) return access
    const { documentId, workspaceId, recipientId } = access.value

    if (recipientId) {
      const own = await DocumentRecipientRepository.findById(
        recipientId,
        documentId,
      )
      if (!own.ok) return own
      return ok({
        token: own.value.token,
        recipientId: own.value.id,
        url: documentLinkUrl(own.value.token),
      })
    }

    const email = input.email.toLowerCase()
    const known = await DocumentRecipientRepository.findIdentified(
      documentId,
      email,
    )
    if (!known.ok) return known
    let reader = known.value
    if (!reader) {
      const created = await DocumentRecipientRepository.createMany(
        documentId,
        workspaceId,
        [
          {
            name: input.name,
            email,
            phone: null,
            personId: null,
            role: 'APPROVER',
            channel: 'LINK',
            token: newDocumentToken(),
          },
        ],
      )
      if (!created.ok) return created
      reader = created.value[0]
    }
    return ok({
      token: reader.token,
      recipientId: reader.id,
      url: documentLinkUrl(reader.token),
    })
  },

  async accept(
    token: string,
    evidence: DocumentRequestEvidence,
    input: AcceptDocumentInput,
  ): Promise<Result<DocumentPublicDTO>> {
    const link = await loadLink(token)
    if (!link.ok) return link
    const { context, recipient } = link.value

    const answerable = assertAnswerable(context)
    if (!answerable.ok) return answerable
    if (input.versionId !== context.currentVersion.id) {
      return err(documentVersionStale())
    }
    if (recipient?.role === 'VIEWER') return err(documentAcceptNotAllowed())

    const priced = priceAnswer(
      versionCanvas(context),
      input.fields,
      input.selection,
    )
    if (!priced.ok) return err(priced.error)

    const recorded = await record(
      link.value,
      {
        action: 'ACCEPT',
        name: input.name,
        email: input.email?.toLowerCase() ?? recipient?.email ?? null,
        fields: priced.fields,
        selection: priced.selection,
        reason: null,
      },
      priced.total,
      evidence,
    )
    if (!recorded.ok) return recorded

    afterAnswer(link.value, {
      action: 'ACCEPT',
      readerName: input.name,
      reason: null,
      total: priced.total,
    })
    return getPublicDocument(token)
  },

  async decline(
    token: string,
    evidence: DocumentRequestEvidence,
    input: DeclineDocumentInput,
  ): Promise<Result<DocumentPublicDTO>> {
    const link = await loadLink(token)
    if (!link.ok) return link
    const { context, recipient } = link.value

    const answerable = assertAnswerable(context)
    if (!answerable.ok) return answerable
    if (input.versionId !== context.currentVersion.id) {
      return err(documentVersionStale())
    }
    if (recipient?.role === 'VIEWER') return err(documentAcceptNotAllowed())

    const name = input.name || recipient?.name || null
    const recorded = await record(
      link.value,
      {
        action: 'DECLINE',
        name,
        email: recipient?.email ?? null,
        fields: {},
        selection: {},
        reason: input.reason || null,
      },
      null,
      evidence,
    )
    if (!recorded.ok) return recorded

    afterAnswer(link.value, {
      action: 'DECLINE',
      readerName: name ?? 'O leitor do link',
      reason: input.reason || null,
      total: null,
    })
    return getPublicDocument(token)
  },

  /** Fields sent without accepting (documents that only collect data). */
  async submit(
    token: string,
    evidence: DocumentRequestEvidence,
    input: SubmitDocumentFieldsInput,
  ): Promise<Result<DocumentPublicDTO>> {
    const link = await loadLink(token)
    if (!link.ok) return link
    const { context, recipient } = link.value

    const answerable = assertAnswerable(context)
    if (!answerable.ok) return answerable
    if (input.versionId !== context.currentVersion.id) {
      return err(documentVersionStale())
    }
    if (recipient) {
      const already = await DocumentResponseRepository.hasAnswer(
        context.id,
        recipient.id,
        'SUBMIT',
      )
      if (!already.ok) return already
      if (already.value) return err(documentAlreadyAnswered())
    }

    const canvas = versionCanvas(context)
    if (documentFields(canvas).length === 0) {
      return err(
        documentFieldsInvalid('Este documento não tem campos para enviar'),
      )
    }
    const priced = priceAnswer(canvas, input.fields, input.selection)
    if (!priced.ok) return err(priced.error)

    const recorded = await record(
      link.value,
      {
        action: 'SUBMIT',
        name: input.name || recipient?.name || null,
        email: input.email?.toLowerCase() ?? recipient?.email ?? null,
        fields: priced.fields,
        selection: priced.selection,
        reason: null,
      },
      priced.total,
      evidence,
    )
    if (!recorded.ok) return recorded

    return getPublicDocument(token)
  },
}
