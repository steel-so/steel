import type { CrmHealthLevel, Prisma } from '@prisma/client'
import { HEALTH_LEVEL_LABEL } from '@/src/lib/crm-health/core'
import type {
  Customer360CompanyRow,
  Customer360PersonRow,
} from '@/src/repositories/customer-360.repository'
import type {
  Customer360CallDTO,
  Customer360CompanyDTO,
  Customer360ConversationDTO,
  Customer360DocumentDTO,
  Customer360HealthDTO,
  Customer360LeadDTO,
  Customer360OpportunityDTO,
  Customer360PersonDTO,
  Customer360TicketDTO,
} from '@/types/customer-360'
import { parseNextAction } from './crm-health.mapper'

const money = (value: Prisma.Decimal | null): number | null =>
  value === null ? null : Number(value)

export const toCustomer360PersonDTO = (
  row: Customer360PersonRow,
): Customer360PersonDTO => ({
  id: row.id,
  name: row.name,
  jobTitle: row.jobTitle,
  emails: row.emails,
  phones: row.phones,
  companyId: row.companyId,
})

export const toCustomer360CompanyDTO = (
  row: Customer360CompanyRow,
): Customer360CompanyDTO => ({
  id: row.id,
  name: row.name,
  cnpj: row.cnpj,
  arr: money(row.arr),
  accountOwnerId: row.accountOwnerId,
  accountOwnerName: row.accountOwner?.name ?? null,
})

export const toCustomer360HealthDTO = (row: {
  riskScore: number
  level: CrmHealthLevel
  nextAction: unknown
  computedAt: Date
}): Customer360HealthDTO => ({
  level: row.level,
  levelLabel: HEALTH_LEVEL_LABEL[row.level],
  riskScore: row.riskScore,
  healthScore: 100 - row.riskScore,
  nextActionLabel: parseNextAction(row.nextAction).label,
  computedAt: row.computedAt.toISOString(),
})

export const toCustomer360OpportunityDTO = (row: {
  id: string
  name: string
  amount: Prisma.Decimal | null
  closeDate: Date | null
  updatedAt: Date
  stage: { name: string; category: string }
  pipeline: { name: string }
  owner: { name: string } | null
}): Customer360OpportunityDTO => ({
  id: row.id,
  name: row.name,
  amount: money(row.amount),
  stageName: row.stage.name,
  stageCategory: row.stage.category,
  pipelineName: row.pipeline.name,
  ownerName: row.owner?.name ?? null,
  closeDate: row.closeDate?.toISOString() ?? null,
  updatedAt: row.updatedAt.toISOString(),
})

export const toCustomer360LeadDTO = (row: {
  id: string
  name: string
  stage: string
  createdAt: Date
  owner: { name: string } | null
}): Customer360LeadDTO => ({
  id: row.id,
  name: row.name,
  stage: row.stage,
  ownerName: row.owner?.name ?? null,
  createdAt: row.createdAt.toISOString(),
})

export const toCustomer360TicketDTO = (row: {
  id: string
  number: number
  title: string
  type: string
  createdAt: Date
  closedAt: Date | null
  resolvedAt: Date | null
  resolutionDueAt: Date | null
  resolutionBreached: boolean
  firstResponseBreached: boolean
  csatScore: number | null
  phase: { name: string; category: string }
  priority: { name: string } | null
}): Customer360TicketDTO => ({
  id: row.id,
  number: row.number,
  title: row.title,
  type: row.type,
  phaseName: row.phase.name,
  phaseCategory: row.phase.category,
  priorityName: row.priority?.name ?? null,
  open: row.closedAt === null && row.resolvedAt === null,
  slaBreached: row.resolutionBreached || row.firstResponseBreached,
  resolutionDueAt: row.resolutionDueAt?.toISOString() ?? null,
  csatScore: row.csatScore,
  createdAt: row.createdAt.toISOString(),
})

export const toCustomer360ConversationDTO = (row: {
  id: string
  status: string
  lastMessageAt: Date | null
  contact: { name: string | null; waId: string }
  connection: { label: string }
}): Customer360ConversationDTO => ({
  id: row.id,
  contactName: row.contact.name,
  contactPhone: row.contact.waId,
  status: row.status,
  connectionLabel: row.connection.label,
  lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
})

export const toCustomer360CallDTO = (row: {
  id: string
  direction: string
  status: string
  durationSeconds: number | null
  summary: string | null
  conversationId: string | null
  createdAt: Date
}): Customer360CallDTO => ({
  id: row.id,
  direction: row.direction,
  status: row.status,
  durationSeconds: row.durationSeconds,
  summary: row.summary,
  conversationId: row.conversationId,
  createdAt: row.createdAt.toISOString(),
})

export const toCustomer360DocumentDTO = (row: {
  id: string
  title: string
  kind: string
  status: string
  totalValue: Prisma.Decimal | null
  updatedAt: Date
}): Customer360DocumentDTO => ({
  id: row.id,
  title: row.title,
  kind: row.kind,
  status: row.status,
  totalValue: money(row.totalValue),
  updatedAt: row.updatedAt.toISOString(),
})
