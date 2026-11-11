import { createId } from '@paralleldrive/cuid2'
import type { DocumentStatus, Prisma } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { seedUser } from './user.factory'
import { seedWorkspace } from './workspace.factory'

/**
 * Documents with reading data for the analytics tests (documents analytics
 * slice). `content` is a minimal canvas document of the `document` catalog
 * with one `section` per entry of `sections` (id + heading).
 */

export function documentContent(
  sections: Array<{ id: string; title: string; name?: string }>,
): Prisma.InputJsonValue {
  const nodes: Record<string, unknown> = {
    root: {
      id: 'root',
      type: 'document',
      props: {},
      children: sections.map((section) => section.id),
    },
  }
  for (const section of sections) {
    const headingId = `${section.id}-h`
    nodes[section.id] = {
      id: section.id,
      type: 'section',
      props: {},
      children: [headingId],
      ...(section.name ? { meta: { name: section.name } } : {}),
    }
    nodes[headingId] = {
      id: headingId,
      type: 'heading',
      props: { text: section.title },
      children: [],
    }
  }
  return { catalog: 'document', version: 1, rootId: 'root', nodes }
}

export const DEFAULT_SECTIONS = [
  { id: 'sec-intro', title: 'Introdução' },
  { id: 'sec-scope', title: 'Escopo' },
  { id: 'sec-price', title: 'Investimento' },
]

export interface SeedDocumentOptions {
  workspaceId?: string
  ownerId?: string
  title?: string
  status?: DocumentStatus
  isTemplate?: boolean
  templateId?: string | null
  linkEnabled?: boolean
  deletedAt?: Date | null
  /** Freeze a version (the link only works for sent documents). */
  sent?: boolean
  content?: Prisma.InputJsonValue
  settings?: Prisma.InputJsonValue
}

/** A document (sent by default, with a current version) and its owner. */
export async function seedDocument(options: SeedDocumentOptions = {}) {
  const workspaceId = options.workspaceId ?? (await seedWorkspace()).id
  const ownerId = options.ownerId ?? (await seedUser()).id
  const content = options.content ?? documentContent(DEFAULT_SECTIONS)
  const sent = options.sent ?? !options.isTemplate
  const document = await prisma.document.create({
    data: {
      workspaceId,
      title: options.title ?? 'Proposta comercial',
      status: options.status ?? (sent ? 'SENT' : 'DRAFT'),
      isTemplate: options.isTemplate ?? false,
      templateId: options.templateId ?? null,
      linkEnabled: options.linkEnabled ?? true,
      deletedAt: options.deletedAt ?? null,
      content,
      settings: options.settings ?? {},
      publicToken: `pub-${createId()}`,
      ownerId,
      createdById: ownerId,
      sentAt: sent ? new Date() : null,
    },
  })
  if (!sent) return { document, workspaceId, ownerId, versionId: null }

  const version = await prisma.documentVersion.create({
    data: {
      documentId: document.id,
      workspaceId,
      number: 1,
      content,
      sha256: 'a'.repeat(64),
      createdById: ownerId,
    },
  })
  const updated = await prisma.document.update({
    where: { id: document.id },
    data: { currentVersionId: version.id },
  })
  return { document: updated, workspaceId, ownerId, versionId: version.id }
}

export async function seedRecipient(
  documentId: string,
  workspaceId: string,
  overrides: Partial<{ name: string; email: string; token: string }> = {},
) {
  return prisma.documentRecipient.create({
    data: {
      documentId,
      workspaceId,
      name: overrides.name ?? 'Maria Souza',
      email: overrides.email ?? 'maria@cliente.com.br',
      token: overrides.token ?? `rcp-${createId()}`,
      sentAt: new Date(),
    },
  })
}

export async function seedSession(input: {
  documentId: string
  workspaceId: string
  recipientId?: string | null
  visitorId?: string
  device?: string | null
  startedAt?: Date
  lastSeenAt?: Date
  activeMs?: number
  maxScrollPct?: number
  reachedEnd?: boolean
}) {
  const startedAt = input.startedAt ?? new Date()
  return prisma.documentSession.create({
    data: {
      documentId: input.documentId,
      workspaceId: input.workspaceId,
      recipientId: input.recipientId ?? null,
      sessionKey: createId(),
      visitorId: input.visitorId ?? `visitor-${createId()}`,
      ipHash: 'hash',
      device: input.device === undefined ? 'desktop' : input.device,
      startedAt,
      lastSeenAt: input.lastSeenAt ?? startedAt,
      activeMs: input.activeMs ?? 0,
      maxScrollPct: input.maxScrollPct ?? 0,
      reachedEnd: input.reachedEnd ?? false,
    },
  })
}

export async function seedSectionStat(input: {
  sessionId: string
  documentId: string
  sectionId: string
  activeMs: number
  views?: number
}) {
  return prisma.documentSectionStat.create({
    data: {
      sessionId: input.sessionId,
      documentId: input.documentId,
      sectionId: input.sectionId,
      activeMs: input.activeMs,
      views: input.views ?? 1,
      firstSeenAt: new Date(),
    },
  })
}
