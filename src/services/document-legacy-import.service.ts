import { createHash, randomBytes } from 'node:crypto'
import type { CrmProposalStatus, DocumentStatus, Prisma } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { crmProposalNotFound, crmProposalTemplateNotFound } from '@/src/errors'
import { documentContentInvalid } from '@/src/errors/app-error'
import {
  convertLegacyProposal,
  type LegacyProposalSection,
} from '@/src/lib/canvas-document/convert-proposal'
import { err, ok, type Result } from '@/src/lib/result'
import { indexSearchDocument } from '@/src/lib/search/index-hooks'
import {
  DocumentLegacyRepository,
  type LegacyDocumentData,
  type LegacyEventData,
  type LegacyProposalRow,
  type LegacySessionData,
  type LegacyTemplateRow,
} from '@/src/repositories/document-legacy.repository'
import { CrmProposalSectionContentSchema } from '@/src/schemas/crm-proposal.schema'
import { DEFAULT_DOCUMENT_SETTINGS } from '@/src/schemas/document.schema'
import { assertModuleMember } from './authz'

/**
 * Migration of the legacy CRM proposals into documents (ADR 0063,
 * docs/documents/README.md "Migração das propostas"). Templates become
 * PROPOSAL templates; proposals become PROPOSAL documents with the same
 * public token, CRM links, owner, validity, status, acceptance, views and an
 * ACCEPTED event for legacy signatures (the signature itself stays in the
 * old table). Idempotent: keyed by `legacyTemplateId` / `legacyProposalId`,
 * so the worker and the on-the-fly conversion behind the redirects can race.
 */

export const LEGACY_IMPORT_BATCH = 50

const STATUS_MAP: Record<CrmProposalStatus, DocumentStatus> = {
  DRAFT: 'DRAFT',
  SENT: 'SENT',
  VIEWED: 'VIEWED',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'DECLINED',
  EXPIRED: 'EXPIRED',
}

export interface LegacyImportOutcome {
  documentId: string
  created: boolean
}

export interface LegacyWorkspaceSummary {
  templates: number
  proposals: number
  failed: number
}

/** JSON with object keys sorted at every level (stable hash input). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/** SHA-256 of the canonical content + theme + settings of a version. */
export function versionSha256(
  content: unknown,
  theme: unknown,
  settings: unknown,
): string {
  return createHash('sha256')
    .update(canonicalJson({ content, theme, settings }))
    .digest('hex')
}

function newPublicToken(): string {
  return randomBytes(32).toString('base64url')
}

function templateSections(row: LegacyTemplateRow): LegacyProposalSection[] {
  return row.sections.map((s) => ({
    type: s.type,
    order: s.order,
    enabled: s.enabled,
    content: s.defaultContent,
  }))
}

function proposalSections(row: LegacyProposalRow): LegacyProposalSection[] {
  return row.sections.map((s) => ({
    type: s.type,
    order: s.order,
    enabled: s.enabled,
    content: s.content,
  }))
}

/** Legacy pricing total of an enabled PRODUCTS_PRICING section, if any. */
export function legacyTotalValue(
  sections: { type: string; enabled: boolean; content: unknown }[],
): number | null {
  for (const section of sections) {
    if (section.type !== 'PRODUCTS_PRICING' || !section.enabled) continue
    const parsed = CrmProposalSectionContentSchema.safeParse(section.content)
    if (parsed.success && parsed.data.type === 'PRODUCTS_PRICING') {
      return parsed.data.total
    }
  }
  return null
}

function minDate(dates: (Date | null | undefined)[]): Date | null {
  const valid = dates.filter((d): d is Date => d instanceof Date)
  if (valid.length === 0) return null
  return new Date(Math.min(...valid.map((d) => d.getTime())))
}

function maxDate(dates: Date[]): Date | null {
  if (dates.length === 0) return null
  return new Date(Math.max(...dates.map((d) => d.getTime())))
}

function convert(
  input: Parameters<typeof convertLegacyProposal>[0],
): Result<ReturnType<typeof convertLegacyProposal>> {
  try {
    return ok(convertLegacyProposal(input))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return err(documentContentInvalid(message))
  }
}

function templateData(
  row: LegacyTemplateRow,
  content: unknown,
  theme: unknown,
): LegacyDocumentData {
  return {
    workspaceId: row.workspaceId,
    status: 'DRAFT',
    title: row.name,
    description: row.description,
    isTemplate: true,
    templateId: null,
    content: content as unknown as Prisma.InputJsonValue,
    theme: theme as unknown as Prisma.InputJsonValue,
    settings: DEFAULT_DOCUMENT_SETTINGS as unknown as Prisma.InputJsonValue,
    publicToken: newPublicToken(),
    validUntil: null,
    totalValue: legacyTotalValue(templateSections(row)),
    sentAt: null,
    firstViewedAt: null,
    lastViewedAt: null,
    acceptedAt: null,
    acceptedByName: null,
    expiredAt: null,
    companyId: null,
    personId: null,
    opportunityId: null,
    leadId: null,
    ownerId: row.createdById,
    createdById: row.createdById,
    updatedById: row.updatedById,
    legacyProposalId: null,
    legacyTemplateId: row.id,
    position: row.position,
    createdAt: row.createdAt,
  }
}

/** Views → reading sessions (no per-section stats: the beacon had none). */
function sessionsOf(row: LegacyProposalRow): LegacySessionData[] {
  return row.views.map((view) => ({
    sessionKey: view.viewId,
    // The legacy beacon had no visitor id: the hashed IP stands in, so
    // unique readers still count once per network.
    visitorId: `legacy-${view.ipHash.slice(0, 32)}`,
    ipHash: view.ipHash,
    referrer: view.referrer,
    startedAt: view.createdAt,
    lastSeenAt: view.updatedAt,
    activeMs: view.durationMs,
    maxScrollPct: view.scrolledPct,
    reachedEnd: view.reachedEnd,
  }))
}

function eventsOf(
  row: LegacyProposalRow,
  sentAt: Date | null,
): LegacyEventData[] {
  const events: LegacyEventData[] = [
    { type: 'CREATED', data: { legacy: true }, createdAt: row.createdAt },
  ]
  if (sentAt) {
    events.push({ type: 'SENT', data: { legacy: true }, createdAt: sentAt })
  }
  if (row.signatures.length > 0) {
    for (const signature of row.signatures) {
      events.push({
        type: 'ACCEPTED',
        data: {
          legacySignature: true,
          signerName: signature.signerName,
          signedAt: signature.signedAt.toISOString(),
        },
        createdAt: signature.signedAt,
      })
    }
  } else if (row.acceptedAt) {
    events.push({
      type: 'ACCEPTED',
      data: { legacy: true, name: row.acceptedByName },
      createdAt: row.acceptedAt,
    })
  }
  if (row.status === 'REJECTED') {
    events.push({
      type: 'DECLINED',
      data: { legacy: true },
      createdAt: row.updatedAt,
    })
  }
  if (row.expiredAt) {
    events.push({
      type: 'EXPIRED',
      data: { legacy: true },
      createdAt: row.expiredAt,
    })
  }
  return events
}

async function rereadAfterRace(
  read: () => Promise<Result<string | null>>,
  notFound: () => ReturnType<typeof crmProposalNotFound>,
): Promise<Result<LegacyImportOutcome>> {
  const again = await read()
  if (!again.ok) return again
  if (!again.value) return err(notFound())
  return ok({ documentId: again.value, created: false })
}

export const DocumentLegacyImportService = {
  /** Workspaces that still have legacy templates or proposals. */
  listWorkspaces(): Promise<Result<string[]>> {
    return DocumentLegacyRepository.legacyWorkspaceIds()
  },

  async importTemplate(
    templateId: string,
  ): Promise<Result<LegacyImportOutcome>> {
    const existing =
      await DocumentLegacyRepository.documentIdByLegacyTemplate(templateId)
    if (!existing.ok) return existing
    if (existing.value) {
      return ok({ documentId: existing.value, created: false })
    }

    const row = await DocumentLegacyRepository.findTemplate(templateId)
    if (!row.ok) return row
    if (!row.value) return err(crmProposalTemplateNotFound())
    const template = row.value

    const converted = convert({
      title: template.name,
      sections: templateSections(template),
      logoUrl: template.logoUrl,
    })
    if (!converted.ok) return converted

    const created = await DocumentLegacyRepository.createTemplateDocument(
      templateData(template, converted.value.content, converted.value.theme),
    )
    if (!created.ok) return created
    if (!created.value) {
      return rereadAfterRace(
        () => DocumentLegacyRepository.documentIdByLegacyTemplate(templateId),
        crmProposalTemplateNotFound,
      )
    }

    auditMutation({
      entity: 'document',
      action: 'migrate',
      actorId: null,
      targetId: created.value.id,
      meta: { legacyTemplateId: templateId, workspaceId: template.workspaceId },
    })
    const documentId = created.value.id
    void indexSearchDocument('crm-document', template.workspaceId, documentId)
    return ok({ documentId, created: true })
  },

  async importProposal(
    proposalId: string,
  ): Promise<Result<LegacyImportOutcome>> {
    const existing =
      await DocumentLegacyRepository.documentIdByLegacyProposal(proposalId)
    if (!existing.ok) return existing
    if (existing.value) {
      return ok({ documentId: existing.value, created: false })
    }

    const row = await DocumentLegacyRepository.findProposal(proposalId)
    if (!row.ok) return row
    if (!row.value) return err(crmProposalNotFound())
    const proposal = row.value

    // The template goes first so the document keeps its "created from".
    let templateId: string | null = null
    if (proposal.templateId) {
      const template = await DocumentLegacyImportService.importTemplate(
        proposal.templateId,
      )
      templateId = template.ok ? template.value.documentId : null
    }

    const converted = convert({
      title: proposal.name,
      sections: proposalSections(proposal),
      logoUrl: proposal.template?.logoUrl,
      hasValidity: proposal.validUntil !== null,
    })
    if (!converted.ok) return converted
    const { content, theme } = converted.value
    const settings = DEFAULT_DOCUMENT_SETTINGS

    const viewDates = proposal.views.map((v) => v.createdAt)
    const lastSeen = proposal.views.map((v) => v.updatedAt)
    const firstViewedAt = minDate(viewDates)
    const sent = proposal.status !== 'DRAFT'
    const sentAt = sent
      ? minDate([firstViewedAt, proposal.acceptedAt, proposal.updatedAt])
      : null
    const status = STATUS_MAP[proposal.status]

    const created = await DocumentLegacyRepository.createProposalDocument({
      document: {
        workspaceId: proposal.workspaceId,
        status,
        title: proposal.name,
        description: null,
        isTemplate: false,
        templateId,
        content: content as unknown as Prisma.InputJsonValue,
        theme: theme as unknown as Prisma.InputJsonValue,
        settings: settings as unknown as Prisma.InputJsonValue,
        publicToken: proposal.shareToken,
        validUntil: proposal.validUntil,
        totalValue: legacyTotalValue(proposal.sections),
        sentAt,
        firstViewedAt,
        lastViewedAt: maxDate(lastSeen),
        acceptedAt: proposal.acceptedAt,
        acceptedByName: proposal.acceptedByName,
        expiredAt: proposal.expiredAt,
        companyId: proposal.companyId,
        personId: proposal.contactId,
        opportunityId: proposal.opportunityId,
        leadId: proposal.leadId,
        ownerId: proposal.responsibleId,
        createdById: proposal.createdById,
        updatedById: proposal.updatedById,
        legacyProposalId: proposal.id,
        legacyTemplateId: null,
        position: proposal.position,
        createdAt: proposal.createdAt,
      },
      version:
        sent && sentAt
          ? {
              sha256: versionSha256(content, theme, settings),
              createdAt: sentAt,
            }
          : null,
      acceptance:
        proposal.status === 'ACCEPTED' && proposal.acceptedAt
          ? {
              name: proposal.acceptedByName ?? 'Cliente',
              createdAt: proposal.acceptedAt,
            }
          : null,
      sessions: sessionsOf(proposal),
      events: eventsOf(proposal, sentAt),
    })
    if (!created.ok) return created
    if (!created.value) {
      return rereadAfterRace(
        () => DocumentLegacyRepository.documentIdByLegacyProposal(proposalId),
        crmProposalNotFound,
      )
    }

    auditMutation({
      entity: 'document',
      action: 'migrate',
      actorId: null,
      targetId: created.value.id,
      meta: { legacyProposalId: proposalId, workspaceId: proposal.workspaceId },
    })
    const documentId = created.value.id
    void indexSearchDocument('crm-document', proposal.workspaceId, documentId)
    return ok({ documentId, created: true })
  },

  /**
   * One workspace, in batches: templates first (proposals link to them),
   * then proposals. A record that fails is logged and skipped; the next run
   * picks it up again.
   */
  async importWorkspace(
    workspaceId: string,
    batch = LEGACY_IMPORT_BATCH,
  ): Promise<Result<LegacyWorkspaceSummary>> {
    const summary: LegacyWorkspaceSummary = {
      templates: 0,
      proposals: 0,
      failed: 0,
    }
    const failed = new Set<string>()

    const phases = [
      {
        kind: 'template' as const,
        pending: (take: number) =>
          DocumentLegacyRepository.pendingTemplateIds(workspaceId, take),
        run: (id: string) => DocumentLegacyImportService.importTemplate(id),
      },
      {
        kind: 'proposal' as const,
        pending: (take: number) =>
          DocumentLegacyRepository.pendingProposalIds(workspaceId, take),
        run: (id: string) => DocumentLegacyImportService.importProposal(id),
      },
    ]

    for (const phase of phases) {
      for (;;) {
        const ids = await phase.pending(batch + failed.size)
        if (!ids.ok) return ids
        const todo = ids.value.filter((id) => !failed.has(id))
        if (todo.length === 0) break
        for (const id of todo) {
          const result = await phase.run(id)
          if (!result.ok) {
            failed.add(id)
            summary.failed += 1
            logger.warn('documents.legacy_import.record_failed', {
              component: 'DocumentLegacyImport',
              workspaceId,
              kind: phase.kind,
              legacyId: id,
              code: result.error.code,
            })
            continue
          }
          if (phase.kind === 'template') summary.templates += 1
          else summary.proposals += 1
        }
      }
    }

    return ok(summary)
  },

  /**
   * Document behind `/crm/proposals/<id>`, converting the proposal now when
   * the worker hasn't reached it yet. CRM members who may view documents.
   */
  async documentForProposal(
    actorId: string,
    workspaceId: string,
    proposalId: string,
  ): Promise<Result<string>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'documents',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const ref = await DocumentLegacyRepository.findProposalRef(
      proposalId,
      workspaceId,
    )
    if (!ref.ok) return ref
    if (!ref.value) return err(crmProposalNotFound())

    const imported =
      await DocumentLegacyImportService.importProposal(proposalId)
    if (!imported.ok) return imported
    return ok(imported.value.documentId)
  },

  /**
   * Public token for an old link `/p/<token>`: the same token serves
   * `/d/<token>`. Converts the proposal now when needed; `false` when no
   * live proposal or document answers to it.
   */
  async ensurePublicToken(token: string): Promise<Result<boolean>> {
    const doc = await DocumentLegacyRepository.documentIdByPublicToken(token)
    if (!doc.ok) return doc
    if (doc.value) return ok(true)

    const ref =
      await DocumentLegacyRepository.findProposalRefByShareToken(token)
    if (!ref.ok) return ref
    if (!ref.value) return ok(false)

    const imported = await DocumentLegacyImportService.importProposal(
      ref.value.id,
    )
    if (!imported.ok) return imported
    return ok(true)
  },
}
