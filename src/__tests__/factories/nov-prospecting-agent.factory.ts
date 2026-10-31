import { createId } from '@paralleldrive/cuid2'
import type {
  CrmProspectDraft,
  CrmProspectingSettings,
  CrmProspectUsage,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'

export function createFakeCrmProspectingSettings(
  overrides?: Partial<CrmProspectingSettings>,
): CrmProspectingSettings {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    enabled: true,
    monthlyWebLimit: 300,
    monthlyDraftLimit: 100,
    allowedChannels: ['EMAIL', 'WHATSAPP'],
    valueProposition: 'Telefonia em nuvem.',
    signalKeywords: [],
    updatedById: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function createFakeCrmProspectUsage(
  overrides?: Partial<CrmProspectUsage>,
): CrmProspectUsage {
  return {
    id: createId(),
    workspaceId: createId(),
    period: new Date(Date.UTC(2026, 10, 1)),
    searches: 0,
    fetches: 0,
    drafts: 0,
    updatedAt: new Date(),
    ...overrides,
  }
}

export function createFakeCrmProspectDraft(
  overrides?: Partial<CrmProspectDraft>,
): CrmProspectDraft {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    leadId: createId(),
    companyId: null,
    personId: null,
    targetName: 'Ana Souza',
    channel: 'EMAIL',
    subject: 'Uma ideia para a Acme',
    body: 'Olá, Ana. Vi que a Acme abriu vagas de TI e talvez possamos ajudar.',
    toEmail: 'ana@acme.com.br',
    toPhone: null,
    summary: 'A Acme está contratando na área de TI.',
    signals: [
      {
        type: 'HIRING',
        evidence: 'Estamos contratando analistas de infraestrutura',
        sourceUrl: 'https://acme.com.br/vagas',
      },
    ],
    sources: [{ url: 'https://acme.com.br/vagas', title: 'Vagas' }],
    status: 'PENDING',
    agentId: null,
    createdById: createId(),
    decidedById: null,
    decidedAt: null,
    rejectReason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

/** A draft row for a workspace and user that already exist. */
export async function seedCrmProspectDraft(
  workspaceId: string,
  createdById: string,
  overrides?: Partial<CrmProspectDraft>,
) {
  const { id: _id, createdAt: _c, updatedAt: _u, ...fake } =
    createFakeCrmProspectDraft({ workspaceId, createdById, ...overrides })
  return prisma.crmProspectDraft.create({
    data: {
      ...fake,
      signals: fake.signals ?? [],
      sources: fake.sources ?? [],
    } as Parameters<typeof prisma.crmProspectDraft.create>[0]['data'],
  })
}
