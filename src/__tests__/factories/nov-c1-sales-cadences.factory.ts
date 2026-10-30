import { createId } from '@paralleldrive/cuid2'
import type {
  CrmCadence,
  CrmCadenceEnrollment,
  CrmCadenceStep,
  Prisma,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type {
  CrmCadenceEnrollmentForRun,
  CrmCadenceWithSteps,
} from '@/src/repositories/crm-cadence.repository'
import { createFakeCrmLead } from './crm-lead.factory'

export function createFakeCrmCadenceStep(
  overrides?: Partial<CrmCadenceStep>,
): CrmCadenceStep {
  const now = new Date()
  return {
    id: createId(),
    cadenceId: createId(),
    workspaceId: createId(),
    position: 0,
    type: 'EMAIL',
    delayValue: 0,
    delayUnit: 'DAYS',
    subject: 'Olá, {{primeiro_nome}}',
    body: 'Vi que a {{empresa}} cresce rápido.',
    whatsappTemplateId: null,
    templateVariables: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function createFakeCrmCadence(
  overrides?: Partial<CrmCadence> & { steps?: CrmCadenceStep[] },
): CrmCadenceWithSteps {
  const now = new Date()
  const { steps, ...rest } = overrides ?? {}
  const id = rest.id ?? createId()
  const workspaceId = rest.workspaceId ?? createId()
  return {
    id,
    workspaceId,
    name: 'Prospecção outbound',
    description: null,
    status: 'ACTIVE',
    emailFrom: 'vendas@mail.example.com',
    emailReplyTo: null,
    whatsappConnectionId: null,
    stopOnReply: true,
    stopOnClick: false,
    windowStartHour: null,
    windowEndHour: null,
    weekdaysOnly: false,
    createdById: createId(),
    updatedById: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...rest,
    steps: steps ?? [
      createFakeCrmCadenceStep({ cadenceId: id, workspaceId, position: 0 }),
    ],
  }
}

export function createFakeCrmCadenceEnrollment(
  overrides?: Partial<CrmCadenceEnrollment>,
): CrmCadenceEnrollment {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    cadenceId: createId(),
    leadId: createId(),
    status: 'ACTIVE',
    nextPosition: 0,
    nextRunAt: now,
    claimedAt: now,
    stopReason: null,
    repliedVia: null,
    enrolledById: createId(),
    enrolledAt: now,
    finishedAt: null,
    updatedAt: now,
    ...overrides,
  }
}

/** A claimed enrollment with its cadence (steps) and lead, as the worker sees it. */
export function createFakeEnrollmentForRun(overrides?: {
  enrollment?: Partial<CrmCadenceEnrollment>
  cadence?: Partial<CrmCadence> & { steps?: CrmCadenceStep[] }
  lead?: Partial<ReturnType<typeof createFakeCrmLead>>
  owner?: { id: string; name: string; email: string } | null
}): CrmCadenceEnrollmentForRun {
  const cadence = createFakeCrmCadence(overrides?.cadence)
  const lead = createFakeCrmLead({
    workspaceId: cadence.workspaceId,
    name: 'Ana Souza',
    emails: ['ana@empresa.com.br'],
    phones: ['(11) 99999-0000'],
    company: 'Empresa SA',
    ...overrides?.lead,
  })
  return {
    ...createFakeCrmCadenceEnrollment({
      workspaceId: cadence.workspaceId,
      cadenceId: cadence.id,
      leadId: lead.id,
      ...overrides?.enrollment,
    }),
    cadence,
    lead: {
      ...lead,
      owner:
        overrides?.owner === undefined
          ? { id: 'owner1', name: 'Bruno Lima', email: 'bruno@vendas.com.br' }
          : overrides.owner,
    },
  }
}

export async function seedCrmCadence(
  workspaceId: string,
  createdById: string,
  overrides?: Partial<
    Pick<
      CrmCadence,
      | 'name'
      | 'status'
      | 'emailFrom'
      | 'stopOnReply'
      | 'stopOnClick'
      | 'deletedAt'
      | 'whatsappConnectionId'
    >
  >,
  steps: Omit<
    Prisma.CrmCadenceStepUncheckedCreateInput,
    'cadenceId' | 'workspaceId' | 'position'
  >[] = [{ type: 'TASK', subject: 'Ligar', body: '' }],
) {
  return prisma.crmCadence.create({
    data: {
      workspaceId,
      createdById,
      name: 'Cadência de teste',
      emailFrom: 'vendas@mail.example.com',
      ...overrides,
      steps: {
        create: steps.map((step, position) => ({
          workspaceId,
          position,
          ...step,
        })),
      },
    },
    include: { steps: { orderBy: { position: 'asc' } } },
  })
}

export async function seedCrmCadenceEnrollment(input: {
  workspaceId: string
  cadenceId: string
  leadId: string
  enrolledById: string
  overrides?: Partial<
    Pick<
      CrmCadenceEnrollment,
      | 'status'
      | 'nextPosition'
      | 'nextRunAt'
      | 'claimedAt'
      | 'stopReason'
      | 'finishedAt'
    >
  >
}) {
  const { overrides, ...ids } = input
  return prisma.crmCadenceEnrollment.create({
    data: { nextRunAt: new Date(Date.now() - 1000), ...ids, ...overrides },
  })
}
