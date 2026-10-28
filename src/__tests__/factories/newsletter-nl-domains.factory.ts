import { createId } from '@paralleldrive/cuid2'
import type {
  CrmNewsletterStatus,
  WorkspaceSendingDomain,
  WorkspaceSendingDomainStatus,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type { SendingDomainRecord } from '@/src/schemas/sending-domain.schema'

/** Sending domains (ADR 0054): fake rows (unit) and seeds (integration). */

export function fakeSendingDomainRecords(
  status = 'pending',
): SendingDomainRecord[] {
  return [
    {
      record: 'SPF',
      type: 'MX',
      name: 'send.news',
      value: 'feedback-smtp.sa-east-1.amazonses.com',
      ttl: 'Auto',
      priority: 10,
      status,
    },
    {
      record: 'SPF',
      type: 'TXT',
      name: 'send.news',
      value: 'v=spf1 include:amazonses.com ~all',
      ttl: 'Auto',
      status,
    },
    {
      record: 'DKIM',
      type: 'TXT',
      name: 'resend._domainkey.news',
      value: 'p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQ',
      ttl: 'Auto',
      status,
    },
  ]
}

export function createFakeSendingDomain(
  overrides?: Partial<WorkspaceSendingDomain>,
): WorkspaceSendingDomain {
  const now = new Date('2026-10-28T12:00:00.000Z')
  return {
    id: createId(),
    workspaceId: createId(),
    name: 'news.acme.com.br',
    resendDomainId: `rd_${createId()}`,
    status: 'PENDING',
    records: fakeSendingDomainRecords(),
    region: 'sa-east-1',
    failureReason: null,
    lastCheckedAt: null,
    verifiedAt: null,
    createdById: createId(),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export async function seedSendingDomain(data: {
  workspaceId: string
  createdById: string
  name?: string
  status?: WorkspaceSendingDomainStatus
  resendDomainId?: string | null
  lastCheckedAt?: Date | null
  verifiedAt?: Date | null
  createdAt?: Date
}) {
  return prisma.workspaceSendingDomain.create({
    data: {
      workspaceId: data.workspaceId,
      createdById: data.createdById,
      name: data.name ?? `news.${createId()}.com.br`,
      resendDomainId:
        data.resendDomainId === undefined
          ? `rd_${createId()}`
          : data.resendDomainId,
      status: data.status ?? 'PENDING',
      records: fakeSendingDomainRecords(),
      lastCheckedAt: data.lastCheckedAt ?? null,
      verifiedAt: data.verifiedAt ?? null,
      ...(data.createdAt ? { createdAt: data.createdAt } : {}),
    },
  })
}

/** Minimal newsletter row, only what the domain rules look at. */
export async function seedDomainNewsletter(data: {
  workspaceId: string
  createdById: string
  fromEmail: string
  sendingDomainId?: string | null
  status?: CrmNewsletterStatus
  deletedAt?: Date | null
}) {
  return prisma.crmNewsletter.create({
    data: {
      workspaceId: data.workspaceId,
      createdById: data.createdById,
      name: 'Novidades',
      slug: `novidades-${createId()}`,
      fromName: 'Acme',
      fromEmail: data.fromEmail,
      sendingDomainId: data.sendingDomainId ?? null,
      status: data.status ?? 'ACTIVE',
      deletedAt: data.deletedAt ?? null,
    },
  })
}
