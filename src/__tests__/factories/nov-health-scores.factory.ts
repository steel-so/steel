import { createId } from '@paralleldrive/cuid2'
import type { CrmCustomerHealth, CrmOpportunityHealth } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { seedCrmPipeline, seedCrmPipelineStage } from './crm-pipeline.factory'
import { seedUser } from './user.factory'
import { seedWorkspace } from './workspace.factory'

const nextAction = {
  key: 'reach_out',
  label: 'Retomar o contato com o cliente',
  detail: 'Ligue hoje.',
}

export function createFakeCrmCustomerHealth(
  overrides?: Partial<CrmCustomerHealth>,
): CrmCustomerHealth {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    companyId: createId(),
    riskScore: 55,
    level: 'MEDIUM',
    factors: [
      {
        key: 'engagement',
        label: 'Sem interação recente',
        points: 12,
        max: 20,
        detail: 'Última interação há 60 dias',
      },
    ],
    missing: [],
    nextAction,
    signals: {},
    previousScore: null,
    previousLevel: null,
    computedAt: now,
    createdAt: now,
    ...overrides,
  }
}

export function createFakeCrmOpportunityHealth(
  overrides?: Partial<CrmOpportunityHealth>,
): CrmOpportunityHealth {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    opportunityId: createId(),
    riskScore: 45,
    level: 'MEDIUM',
    factors: [],
    nextAction: {
      key: 'reactivate',
      label: 'Retomar o negócio hoje',
      detail: 'Ligue.',
    },
    signals: {},
    previousScore: null,
    previousLevel: null,
    computedAt: now,
    createdAt: now,
    ...overrides,
  }
}

/** Workspace with a user, the CRM module on and a pipeline with 3 stages. */
export async function seedHealthWorkspace() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  await prisma.workspaceModuleAccess.create({
    data: {
      workspaceId: workspace.id,
      module: 'CRM',
      enabled: true,
      grantedById: user.id,
    },
  })
  const pipeline = await seedCrmPipeline(workspace.id, user.id)
  const open = await seedCrmPipelineStage(pipeline.id, {
    name: 'Qualificação',
    category: 'OPEN',
  })
  const won = await seedCrmPipelineStage(pipeline.id, {
    name: 'Ganho',
    category: 'WON',
    position: 1,
  })
  const lost = await seedCrmPipelineStage(pipeline.id, {
    name: 'Perdido',
    category: 'LOST',
    position: 2,
  })
  return { workspace, user, pipeline, open, won, lost }
}

export async function enableModule(
  workspaceId: string,
  userId: string,
  module: 'SERVICE_DESK' | 'COMMUNICATION',
) {
  return prisma.workspaceModuleAccess.create({
    data: { workspaceId, module, enabled: true, grantedById: userId },
  })
}

/** A WhatsApp conversation with a contact whose id is `waId`. */
export async function seedZapConversation(
  workspaceId: string,
  userId: string,
  waId: string,
  fields: { avgSentimentScore?: number | null; lastMessageAt?: Date | null },
) {
  const connection =
    (await prisma.whatsAppConnection.findFirst({ where: { workspaceId } })) ??
    (await prisma.whatsAppConnection.create({
      data: {
        workspaceId,
        provider: 'META',
        label: 'Oficial',
        phoneNumber: '5511999999999',
        metaPhoneNumberId: `health-${createId()}`,
        metaWabaId: `waba-${createId()}`,
        encryptedMetaAccessToken: 'enc:token',
        createdById: userId,
      },
    }))
  const contact = await prisma.whatsAppContact.upsert({
    where: { workspaceId_waId: { workspaceId, waId } },
    create: { workspaceId, waId, name: 'Contato' },
    update: {},
  })
  return prisma.whatsAppConversation.create({
    data: {
      workspaceId,
      connectionId: connection.id,
      contactId: contact.id,
      status: 'IN_PROGRESS',
      avgSentimentScore: fields.avgSentimentScore ?? null,
      lastMessageAt: fields.lastMessageAt ?? null,
    },
  })
}
