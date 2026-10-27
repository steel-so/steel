import { createId } from '@paralleldrive/cuid2'
import type { Prisma, WhatsAppArchiveSettings } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type {
  ArchiveConversationRow,
  ArchiveMessageRow,
  WhatsAppArchiveWithTrigger,
} from '@/src/repositories/whatsapp-archive.repository'

/** WhatsApp archive (ADR 0052): fakes (unit) and seeds (integration/e2e). */

export function createFakeWhatsAppArchive(
  overrides?: Partial<WhatsAppArchiveWithTrigger>,
): WhatsAppArchiveWithTrigger {
  return {
    id: createId(),
    workspaceId: 'ws1',
    kind: 'WEEKLY',
    periodStart: new Date('2026-10-19T03:00:00.000Z'),
    periodEnd: new Date('2026-10-26T02:59:59.999Z'),
    status: 'QUEUED',
    objectKey: null,
    sizeBytes: null,
    sha256: null,
    fileCount: 0,
    atendimentoCount: 0,
    rootFolderName: null,
    offsiteKey: null,
    offsiteCopiedAt: null,
    error: null,
    triggeredById: null,
    startedAt: null,
    completedAt: null,
    expiresAt: null,
    createdAt: new Date('2026-10-26T05:00:00.000Z'),
    updatedAt: new Date('2026-10-26T05:00:00.000Z'),
    triggeredBy: null,
    ...overrides,
  }
}

/** A finished package that can be downloaded until 2027. */
export function createFakeDoneWhatsAppArchive(
  overrides?: Partial<WhatsAppArchiveWithTrigger>,
): WhatsAppArchiveWithTrigger {
  return createFakeWhatsAppArchive({
    status: 'DONE',
    objectKey: 'ws1/a1.zip',
    sizeBytes: BigInt(2048),
    sha256: 'ab'.repeat(32),
    fileCount: 3,
    atendimentoCount: 2,
    rootFolderName: 'FIDELIZZAMAIS',
    completedAt: new Date('2026-10-26T05:10:00.000Z'),
    expiresAt: new Date('2027-01-24T05:10:00.000Z'),
    ...overrides,
  })
}

export function createFakeWhatsAppArchiveSettings(
  overrides?: Partial<WhatsAppArchiveSettings>,
): WhatsAppArchiveSettings {
  return {
    workspaceId: 'ws1',
    enabled: true,
    rootFolderName: null,
    updatedById: null,
    createdAt: new Date('2026-10-20T12:00:00.000Z'),
    updatedAt: new Date('2026-10-20T12:00:00.000Z'),
    ...overrides,
  }
}

export function createFakeArchiveConversation(
  overrides?: Partial<ArchiveConversationRow>,
): ArchiveConversationRow {
  return {
    id: createId(),
    connection: { label: 'Cobrança', phoneNumber: '551130000000' },
    contact: { name: 'Maria Silva', waId: '5511988887777' },
    assignedUser: null,
    ...overrides,
  }
}

export function createFakeArchiveMessage(
  overrides?: Partial<ArchiveMessageRow>,
): ArchiveMessageRow {
  return {
    id: createId(),
    direction: 'IN',
    type: 'TEXT',
    text: 'Olá',
    mediaUrl: null,
    sentByAi: false,
    senderUserId: null,
    senderUser: null,
    deletedAt: null,
    createdAt: new Date('2026-10-20T17:05:00.000Z'),
    ...overrides,
  }
}

export async function seedWhatsAppArchive(
  workspaceId: string,
  overrides?: Partial<
    Omit<Prisma.WhatsAppArchiveUncheckedCreateInput, 'workspaceId'>
  >,
) {
  return prisma.whatsAppArchive.create({
    data: {
      workspaceId,
      kind: 'WEEKLY',
      periodStart: new Date('2026-10-19T03:00:00.000Z'),
      periodEnd: new Date('2026-10-26T02:59:59.999Z'),
      ...overrides,
    },
  })
}

export async function seedWhatsAppArchiveSettings(
  workspaceId: string,
  overrides?: Partial<
    Omit<Prisma.WhatsAppArchiveSettingsUncheckedCreateInput, 'workspaceId'>
  >,
) {
  return prisma.whatsAppArchiveSettings.create({
    data: { workspaceId, enabled: true, ...overrides },
  })
}
