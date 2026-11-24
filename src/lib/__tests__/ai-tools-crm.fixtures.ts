import type { CrmNote, CrmTask } from '@prisma/client'
import { vi } from 'vitest'
import type { AiToolContext, AnySteelAiTool } from '@/src/lib/ai/tools/types'
import { ok, type Result } from '@/src/lib/result'
import { CrmMemberService } from '@/src/services/crm-member.service'
import {
  CrmPipelineService,
  CrmPipelineStageService,
} from '@/src/services/crm-pipeline.service'
import { WorkspaceService } from '@/src/services/workspace.service'
import type { CrmCompanyDTO } from '@/types/crm-company'
import type { CrmLeadDTO } from '@/types/crm-lead'
import type { CrmMemberDTO } from '@/types/crm-member'
import type { CrmOpportunityDTO } from '@/types/crm-opportunity'
import type { CrmPersonDTO } from '@/types/crm-person'
import type { CrmPipelineDTO, CrmPipelineStageDTO } from '@/types/crm-pipeline'
import type { CrmTaskDTO } from '@/types/crm-task'
import type { WorkspaceDTO } from '@/types/workspace'

/**
 * Shared fixtures of the CRM Steel AI tool tests. The test files mock the
 * services (`vi.mock`) — these helpers only build DTOs and wire defaults.
 */

export const WS = 'ws_1'
export const ME = 'user_me'
export const ctx: AiToolContext = {
  workspaceId: WS,
  actorId: ME,
  source: 'assistant',
}

const T = '2026-10-01T12:00:00.000Z'

export const members: CrmMemberDTO[] = [
  { id: ME, name: 'Ana Souza', email: 'ana@acme.com', image: null },
  {
    id: 'user_bruno',
    name: 'Bruno Lima',
    email: 'bruno@acme.com',
    image: null,
  },
  {
    id: 'user_bruna',
    name: 'Bruna Lima',
    email: 'bruna@acme.com',
    image: null,
  },
]

export function lead(over: Partial<CrmLeadDTO> = {}): CrmLeadDTO {
  return {
    id: 'lead_1',
    workspaceId: WS,
    name: 'Carlos Pereira',
    emails: ['carlos@cliente.com'],
    phones: ['11999990000'],
    company: 'Cliente SA',
    jobTitle: 'CTO',
    city: 'São Paulo',
    linkedin: null,
    source: 'Site',
    channel: null,
    stage: 'RECEIVED',
    score: 10,
    ownerId: ME,
    convertedPersonId: null,
    closeResult: null,
    closedAt: null,
    contractSignedAt: null,
    billingType: null,
    closedAmount: null,
    lostReason: null,
    lostNote: null,
    retryAt: null,
    createdById: ME,
    updatedById: null,
    position: 0,
    createdAt: T,
    updatedAt: T,
    ...over,
  }
}

export function pipeline(over: Partial<CrmPipelineDTO> = {}): CrmPipelineDTO {
  return {
    id: 'pipe_sales',
    workspaceId: WS,
    name: 'Vendas',
    position: 0,
    isDefault: true,
    createdById: ME,
    updatedById: null,
    createdAt: T,
    updatedAt: T,
    ...over,
  }
}

export function stage(
  over: Partial<CrmPipelineStageDTO> = {},
): CrmPipelineStageDTO {
  return {
    id: 'stage_new',
    pipelineId: 'pipe_sales',
    name: 'Novo',
    position: 0,
    probability: 10,
    category: 'OPEN',
    color: null,
    createdAt: T,
    updatedAt: T,
    ...over,
  }
}

export const pipelines = [
  pipeline(),
  pipeline({ id: 'pipe_renew', name: 'Renovação', isDefault: false }),
]

export const stagesByPipeline: Record<string, CrmPipelineStageDTO[]> = {
  pipe_sales: [
    stage({
      id: 'stage_neg',
      name: 'Negociação',
      position: 1,
      probability: 60,
    }),
    stage(),
    stage({
      id: 'stage_won',
      name: 'Ganho',
      position: 2,
      category: 'WON',
      probability: 100,
    }),
    stage({
      id: 'stage_lost',
      name: 'Perdido',
      position: 3,
      category: 'LOST',
      probability: 0,
    }),
  ],
  pipe_renew: [
    stage({
      id: 'stage_r_neg',
      pipelineId: 'pipe_renew',
      name: 'Negociação',
      position: 0,
    }),
    stage({
      id: 'stage_r_open',
      pipelineId: 'pipe_renew',
      name: 'Aberto',
      position: 1,
    }),
  ],
}

export function opportunity(
  over: Partial<CrmOpportunityDTO> = {},
): CrmOpportunityDTO {
  return {
    id: 'opp_1',
    name: 'Contrato Acme',
    amount: 1000,
    probability: null,
    closeDate: '2026-10-31T00:00:00.000Z',
    pipelineId: 'pipe_sales',
    stageId: 'stage_new',
    companyId: null,
    pointOfContactId: null,
    ownerId: ME,
    source: null,
    workspaceId: WS,
    createdById: ME,
    updatedById: null,
    position: 0,
    createdAt: T,
    updatedAt: T,
    wonAt: null,
    stageChangedAt: null,
    ...over,
  }
}

export function person(over: Partial<CrmPersonDTO> = {}): CrmPersonDTO {
  return {
    id: 'person_1',
    name: 'Daniela Rocha',
    emails: ['daniela@acme.com'],
    phones: [],
    city: null,
    jobTitle: 'Compras',
    linkedin: null,
    avatar: null,
    companyId: null,
    workspaceId: WS,
    createdById: ME,
    updatedById: null,
    position: 0,
    createdAt: T,
    updatedAt: T,
    ...over,
  }
}

export function company(over: Partial<CrmCompanyDTO> = {}): CrmCompanyDTO {
  return {
    id: 'company_1',
    name: 'Acme Ltda',
    cnpj: null,
    domain: 'acme.com',
    employees: 50,
    linkedin: null,
    address: { city: 'Campinas' },
    arr: 120000,
    icp: true,
    legalName: null,
    tradeName: null,
    emails: [],
    phones: [],
    cnaeCode: null,
    cnaeDescription: null,
    size: null,
    legalNature: null,
    registrationStatus: null,
    openedAt: null,
    shareCapital: null,
    workspaceId: WS,
    createdById: ME,
    accountOwnerId: null,
    updatedById: null,
    position: 0,
    createdAt: T,
    updatedAt: T,
    ...over,
  }
}

export function taskDto(over: Partial<CrmTaskDTO> = {}): CrmTaskDTO {
  return {
    id: 'task_1',
    title: 'Ligar para o cliente',
    status: 'TODO',
    body: null,
    dueDate: null,
    assigneeId: ME,
    companyId: null,
    personId: null,
    opportunityId: null,
    workspaceId: WS,
    createdById: ME,
    updatedById: null,
    position: 0,
    createdAt: T,
    updatedAt: T,
    ...over,
  }
}

export function taskRow(over: Partial<CrmTask> = {}): CrmTask {
  return {
    id: 'task_1',
    title: 'Ligar para o cliente',
    status: 'TODO',
    body: null,
    dueDate: null,
    assigneeId: ME,
    companyId: null,
    personId: null,
    opportunityId: null,
    workspaceId: WS,
    createdById: ME,
    updatedById: null,
    position: 0,
    createdAt: new Date(T),
    updatedAt: new Date(T),
    deletedAt: null,
    ...over,
  } as CrmTask
}

export function noteRow(over: Partial<CrmNote> = {}): CrmNote {
  return {
    id: 'note_1',
    title: 'Reunião',
    body: 'Cliente pediu desconto',
    companyId: null,
    personId: null,
    opportunityId: null,
    leadId: null,
    workspaceId: WS,
    createdById: ME,
    updatedById: null,
    position: 0,
    createdAt: new Date(T),
    updatedAt: new Date(T),
    deletedAt: null,
    ...over,
  } as CrmNote
}

/** Workspace slug, members and pipelines answered as in a healthy workspace. */
export function wireDefaults() {
  vi.mocked(WorkspaceService.getById).mockResolvedValue(
    ok({ slug: 'acme' } as WorkspaceDTO),
  )
  vi.mocked(CrmMemberService.list).mockResolvedValue(ok(members))
  vi.mocked(CrmPipelineService.list).mockResolvedValue(ok(pipelines))
  vi.mocked(CrmPipelineStageService.list).mockImplementation(
    async (_a, _w, pipelineId) => ok(stagesByPipeline[pipelineId] ?? []),
  )
}

export function expectOk<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(
      `expected ok, got ${result.error.code}: ${result.error.message}`,
    )
  }
  return result.value
}

export function expectErr<T>(result: Result<T>, code: string) {
  if (result.ok) throw new Error(`expected ${code}, got ok`)
  if (result.error.code !== code) {
    throw new Error(
      `expected ${code}, got ${result.error.code}: ${result.error.message}`,
    )
  }
  return result.error
}

/** parse → preview (when present) for a tool, failing loudly on parse errors. */
export async function previewOf(
  tool: AnySteelAiTool,
  args: Record<string, unknown>,
) {
  const parsed = expectOk(tool.parse(args))
  if (!tool.preview) throw new Error(`${tool.name} has no preview`)
  return tool.preview(ctx, parsed)
}

export async function run(tool: AnySteelAiTool, args: Record<string, unknown>) {
  const parsed = expectOk(tool.parse(args))
  return tool.execute(ctx, parsed)
}

export const forbiddenErr = {
  code: 'FORBIDDEN',
  message: 'Sem permissão',
} as const

export const dbErr = { code: 'DATABASE_ERROR', message: 'db down' } as const
