import { createId } from '@paralleldrive/cuid2'
import type {
  AiProcedure,
  AiProcedureRun,
  AiProcedureRunStep,
  AiProcedureVersion,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type { ProcedureStep } from '@/src/schemas/ai-procedure.schema'

const NOW = new Date('2026-10-30T12:00:00.000Z')

export const BOLETO_STEPS: ProcedureStep[] = [
  {
    key: 'cpf',
    kind: 'COLLECT',
    title: 'Validar CPF',
    required: true,
    condition: null,
    variable: 'cpf',
    prompt: 'o CPF do titular',
    validation: 'CPF',
  },
  {
    key: 'consulta',
    kind: 'HTTP',
    title: 'Consultar boleto',
    required: true,
    condition: null,
    method: 'GET',
    url: 'https://api.exemplo.com.br/boletos?cpf={{cpf}}',
    saves: [{ variable: 'link', path: 'link' }],
  },
  {
    key: 'envio',
    kind: 'MESSAGE',
    title: 'Enviar boleto',
    required: true,
    condition: null,
    text: 'Sua segunda via: {{link}}',
  },
]

export function createFakeAiProcedure(
  overrides?: Partial<AiProcedure>,
): AiProcedure {
  return {
    id: createId(),
    workspaceId: createId(),
    name: 'Segunda via de boleto',
    description: null,
    whenToUse: 'O cliente pede a segunda via de um boleto',
    status: 'ACTIVE',
    steps: BOLETO_STEPS as unknown as AiProcedure['steps'],
    maxAttempts: 3,
    handoffMessage: null,
    whatsappEnabled: true,
    agentIds: [],
    ownerId: null,
    currentVersion: 1,
    createdById: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

export function createFakeAiProcedureVersion(
  overrides?: Partial<AiProcedureVersion>,
): AiProcedureVersion {
  return {
    id: createId(),
    workspaceId: createId(),
    procedureId: createId(),
    number: 1,
    whenToUse: 'O cliente pede a segunda via de um boleto',
    steps: BOLETO_STEPS as unknown as AiProcedureVersion['steps'],
    maxAttempts: 3,
    handoffMessage: null,
    changeNote: null,
    createdById: null,
    createdAt: NOW,
    ...overrides,
  }
}

export function createFakeAiProcedureRun(
  overrides?: Partial<AiProcedureRun>,
): AiProcedureRun {
  return {
    id: createId(),
    workspaceId: createId(),
    procedureId: createId(),
    versionNumber: 1,
    subjectType: 'WHATSAPP_CONVERSATION',
    subjectId: createId(),
    status: 'RUNNING',
    state: { variables: {}, steps: {} },
    failureReason: null,
    startedAt: NOW,
    finishedAt: null,
    updatedAt: NOW,
    ...overrides,
  }
}

export function createFakeAiProcedureRunStep(
  overrides?: Partial<AiProcedureRunStep>,
): AiProcedureRunStep {
  return {
    id: createId(),
    runId: createId(),
    position: 0,
    stepKey: 'cpf',
    kind: 'COLLECT',
    title: 'Validar CPF',
    status: 'OK',
    input: null,
    output: null,
    error: null,
    createdAt: NOW,
    ...overrides,
  }
}

export async function seedAiProcedure(data: {
  workspaceId: string
  name?: string
  status?: AiProcedure['status']
  whatsappEnabled?: boolean
  agentIds?: string[]
}) {
  const procedure = await prisma.aiProcedure.create({
    data: {
      name: 'Segunda via de boleto',
      whenToUse: 'O cliente pede a segunda via',
      steps: BOLETO_STEPS as unknown as object,
      status: 'ACTIVE',
      ...data,
    },
  })
  await prisma.aiProcedureVersion.create({
    data: {
      workspaceId: data.workspaceId,
      procedureId: procedure.id,
      number: 1,
      whenToUse: procedure.whenToUse,
      steps: BOLETO_STEPS as unknown as object,
      maxAttempts: 3,
    },
  })
  return procedure
}
