import type {
  CrmNewsletter,
  CrmNewsletterIssueWhatsApp,
  CrmNewsletterPoll,
  CrmNewsletterWhatsAppRecipient,
  Prisma,
} from '@prisma/client'
import { emailDocument } from '@/src/__tests__/helpers/email-canvas'
import { POLL_BLOCK } from '@/src/lib/newsletter/poll-links'
import { prisma } from '@/src/lib/prisma'

/** Slice nl2-engage (polls + WhatsApp version): fakes and seeds. */

const NOW = new Date('2026-10-28T13:00:00.000Z')

/** Issue document with one poll block (`poll1`, options Sim/Não/Talvez). */
export function pollIssueDocument(
  props: Record<string, unknown> = {},
): Prisma.JsonValue {
  return emailDocument([
    [
      [
        {
          type: POLL_BLOCK,
          id: 'poll1',
          props: {
            question: 'Gostou?',
            options: [{ label: 'Sim' }, { label: 'Não' }, { label: 'Talvez' }],
            ...props,
          },
        },
      ],
    ],
  ]) as unknown as Prisma.JsonValue
}

export function createFakePoll(
  overrides?: Partial<CrmNewsletterPoll>,
): CrmNewsletterPoll {
  return {
    id: 'pl1',
    workspaceId: 'ws1',
    issueId: 'is1',
    blockId: 'poll1',
    question: 'Gostou?',
    options: [{ label: 'Sim' }, { label: 'Não' }, { label: 'Talvez' }],
    showResults: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

export function createFakeIssueWhatsApp(
  overrides?: Partial<CrmNewsletterIssueWhatsApp>,
): CrmNewsletterIssueWhatsApp {
  return {
    issueId: 'is1',
    workspaceId: 'ws1',
    enabled: true,
    connectionId: 'c1',
    templateId: null,
    variables: null,
    text: 'Oi {primeiro_nome}! {assunto}: {resumo} {link}',
    legalBasis: 'CONSENT',
    consentConfirmedAt: NOW,
    consentConfirmedById: 'u1',
    startedAt: null,
    updatedById: 'u1',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

export function createFakeWhatsAppRecipient(
  overrides?: Partial<CrmNewsletterWhatsAppRecipient>,
): CrmNewsletterWhatsAppRecipient {
  return {
    id: 'w1',
    issueId: 'is1',
    workspaceId: 'ws1',
    subscriberId: 's1',
    personId: 'p1',
    name: 'Ana Lima',
    waId: '5511999990000',
    status: 'SENDING',
    skipReason: null,
    providerMessageId: null,
    error: null,
    sentAt: null,
    deliveredAt: null,
    readAt: null,
    failedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

// ─── Integration seeds ──────────────────────────────────────────────────────

export async function seedPerson(
  workspaceId: string,
  createdById: string,
  data: { name?: string; phones?: string[]; deletedAt?: Date | null } = {},
) {
  return prisma.crmPerson.create({
    data: {
      workspaceId,
      createdById,
      name: data.name ?? 'Ana Lima',
      phones: data.phones ?? [],
      deletedAt: data.deletedAt ?? null,
    },
  })
}

/** Issue delivery row (the e-mail snapshot) of a subscriber. */
export async function seedIssueRecipient(
  newsletter: CrmNewsletter,
  issueId: string,
  subscriber: { id: string; email: string; name: string | null },
) {
  return prisma.crmNewsletterIssueRecipient.create({
    data: {
      issueId,
      workspaceId: newsletter.workspaceId,
      subscriberId: subscriber.id,
      email: subscriber.email,
      name: subscriber.name,
      status: 'SENT',
    },
  })
}
