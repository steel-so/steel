import type { ModuleKind, Prisma } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import type { CrmReportRow } from '@/src/lib/crm-report-runner'
import { runCrmReportQuery } from '@/src/lib/crm-report-runner'
import { err, ok, type Result } from '@/src/lib/result'
import { toCrmReportDTO } from '@/src/mappers/crm-report.mapper'
import { CrmReportRepository } from '@/src/repositories/crm-report.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import type {
  CreateCrmReportDTO,
  CrmReportData,
  CrmReportSource,
  UpdateCrmReportDTO,
} from '@/src/schemas/crm-report.schema'
import { CrmCompanyService } from '@/src/services/crm-company.service'
import { CrmLeadService } from '@/src/services/crm-lead.service'
import { CrmNoteService } from '@/src/services/crm-note.service'
import { CrmOpportunityService } from '@/src/services/crm-opportunity.service'
import { CrmPersonService } from '@/src/services/crm-person.service'
import { CrmProductService } from '@/src/services/crm-product.service'
import { CrmTaskService } from '@/src/services/crm-task.service'
import { WhatsAppBroadcastService } from '@/src/services/whatsapp-broadcast.service'
import { WhatsAppConversationService } from '@/src/services/whatsapp-conversation.service'
import type { CrmReportDTO } from '@/types/crm-report'
import { assertMember, assertModuleEnabled, assertModuleMember } from './authz'

/**
 * Conversation rows carry only `assignedUserId`; a report (and its CSV/Excel
 * export) must show the agent's name, so each row gets `assignedUserName`
 * from the workspace members. An agent who left the workspace keeps a label
 * instead of a raw id.
 */
async function withAssigneeNames(
  workspaceId: string,
  conversations: Result<{ assignedUserId: string | null }[]>,
): Promise<Result<CrmReportRow[]>> {
  if (!conversations.ok) return conversations
  const members =
    await MembershipRepository.listWithUserByWorkspace(workspaceId)
  if (!members.ok) return members
  const names = new Map(
    members.value.map((member) => [member.userId, member.user.name]),
  )
  return ok(
    conversations.value.map((conversation) => ({
      ...conversation,
      assignedUserName: conversation.assignedUserId
        ? (names.get(conversation.assignedUserId) ?? 'Ex-membro')
        : 'Sem atendente',
    })) as unknown as CrmReportRow[],
  )
}

/** Busca as linhas brutas da fonte via o service correspondente (com VIEW). */
async function fetchSourceRows(
  actorId: string,
  workspaceId: string,
  source: CrmReportSource,
): Promise<Result<CrmReportRow[]>> {
  switch (source) {
    case 'company':
      return CrmCompanyService.list(actorId, workspaceId, {
        icp: undefined,
      }) as Promise<Result<CrmReportRow[]>>
    case 'person':
      return CrmPersonService.list(actorId, workspaceId, {}) as Promise<
        Result<CrmReportRow[]>
      >
    case 'opportunity':
      return CrmOpportunityService.list(actorId, workspaceId, {}) as Promise<
        Result<CrmReportRow[]>
      >
    case 'lead':
      return CrmLeadService.list(actorId, workspaceId, {}) as Promise<
        Result<CrmReportRow[]>
      >
    case 'task':
      return CrmTaskService.list(actorId, workspaceId, {}) as Promise<
        Result<CrmReportRow[]>
      >
    case 'note':
      return CrmNoteService.list(actorId, workspaceId, {}) as Promise<
        Result<CrmReportRow[]>
      >
    case 'product':
      return CrmProductService.list(actorId, workspaceId, {
        active: undefined,
      }) as Promise<Result<CrmReportRow[]>>
    case 'whatsapp_conversation':
      return withAssigneeNames(
        workspaceId,
        await WhatsAppConversationService.list(actorId, workspaceId),
      )
    case 'whatsapp_broadcast':
      return WhatsAppBroadcastService.list(actorId, workspaceId) as Promise<
        Result<CrmReportRow[]>
      >
    default:
      return ok([])
  }
}

export const CrmReportService = {
  async list(
    actorId: string,
    workspaceId: string,
    module: ModuleKind = 'CRM',
  ): Promise<Result<CrmReportDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, module, {
      resource: 'reports',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const result = await CrmReportRepository.listByWorkspace(
      workspaceId,
      module,
    )
    if (!result.ok) return result

    return ok(result.value.map(toCrmReportDTO))
  },

  async getById(
    actorId: string,
    workspaceId: string,
    reportId: string,
  ): Promise<Result<CrmReportDTO>> {
    const membership = await assertMember(actorId, workspaceId, {
      resource: 'reports',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const report = await CrmReportRepository.findById(reportId, workspaceId)
    if (!report.ok) return report

    const moduleEnabled = await assertModuleEnabled(
      workspaceId,
      report.value.module,
    )
    if (!moduleEnabled.ok) return moduleEnabled

    return ok(toCrmReportDTO(report.value))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateCrmReportDTO,
    module: ModuleKind = 'CRM',
  ): Promise<Result<CrmReportDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, module, {
      resource: 'reports',
      action: 'CREATE',
    })
    if (!membership.ok) return membership

    const result = await CrmReportRepository.create({
      workspaceId,
      createdById: actorId,
      module,
      name: dto.name,
      source: dto.source,
      columns: dto.columns as Prisma.InputJsonValue,
      filters: dto.filters as Prisma.InputJsonValue,
      groupBy: dto.groupBy,
      sort: dto.sort as Prisma.InputJsonValue | undefined,
      query: dto.query as Prisma.InputJsonValue | undefined,
    })

    if (!result.ok) {
      auditMutation({
        entity: 'crm_report',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: result.error.code,
      })
      return result
    }

    auditMutation({
      entity: 'crm_report',
      action: 'create',
      actorId,
      targetId: result.value.id,
    })

    return ok(toCrmReportDTO(result.value))
  },

  async update(
    actorId: string,
    workspaceId: string,
    reportId: string,
    dto: UpdateCrmReportDTO,
  ): Promise<Result<CrmReportDTO>> {
    const membership = await assertMember(actorId, workspaceId, {
      resource: 'reports',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const existing = await CrmReportRepository.findById(reportId, workspaceId)
    if (!existing.ok) return existing

    const moduleEnabled = await assertModuleEnabled(
      workspaceId,
      existing.value.module,
    )
    if (!moduleEnabled.ok) return moduleEnabled

    const result = await CrmReportRepository.update(reportId, {
      name: dto.name,
      columns: dto.columns as Prisma.InputJsonValue | undefined,
      filters: dto.filters as Prisma.InputJsonValue | undefined,
      ...('groupBy' in dto && { groupBy: dto.groupBy ?? null }),
      ...('sort' in dto && {
        sort: (dto.sort ?? null) as Prisma.InputJsonValue | null,
      }),
      ...('query' in dto && {
        query: (dto.query ?? null) as Prisma.InputJsonValue | null,
      }),
      updatedById: actorId,
    })
    if (!result.ok) return result

    auditMutation({
      entity: 'crm_report',
      action: 'update',
      actorId,
      targetId: reportId,
      meta: { fields: Object.keys(dto) },
    })

    return ok(toCrmReportDTO(result.value))
  },

  async remove(
    actorId: string,
    workspaceId: string,
    reportId: string,
  ): Promise<Result<void>> {
    const membership = await assertMember(actorId, workspaceId, {
      resource: 'reports',
      action: 'DELETE',
    })
    if (!membership.ok) return membership

    const existing = await CrmReportRepository.findById(reportId, workspaceId)
    if (!existing.ok) return existing

    const moduleEnabled = await assertModuleEnabled(
      workspaceId,
      existing.value.module,
    )
    if (!moduleEnabled.ok) return moduleEnabled

    const result = await CrmReportRepository.softDelete(reportId)
    if (!result.ok) return result

    auditMutation({
      entity: 'crm_report',
      action: 'delete',
      actorId,
      targetId: reportId,
    })

    return ok(undefined)
  },

  async reorder(
    actorId: string,
    workspaceId: string,
    orderedIds: string[],
    module: ModuleKind = 'CRM',
  ): Promise<Result<void>> {
    const membership = await assertModuleMember(actorId, workspaceId, module, {
      resource: 'reports',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    return CrmReportRepository.reorder(workspaceId, orderedIds)
  },

  /** Processa o relatório (busca de cada dataset + join/union/agrupamento). */
  async runData(
    actorId: string,
    workspaceId: string,
    reportId: string,
  ): Promise<Result<CrmReportData>> {
    const membership = await assertMember(actorId, workspaceId, {
      resource: 'reports',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const found = await CrmReportRepository.findById(reportId, workspaceId)
    if (!found.ok) return found

    const moduleEnabled = await assertModuleEnabled(
      workspaceId,
      found.value.module,
    )
    if (!moduleEnabled.ok) return moduleEnabled

    const report = toCrmReportDTO(found.value)

    // Busca as linhas de cada dataset (uma vez por alias).
    const rowsByAlias: Record<string, CrmReportRow[]> = {}
    for (const dataset of report.query.datasets) {
      if (rowsByAlias[dataset.alias]) continue
      const rows = await fetchSourceRows(actorId, workspaceId, dataset.source)
      if (!rows.ok) return err(rows.error)
      rowsByAlias[dataset.alias] = rows.value
    }

    return ok(runCrmReportQuery(report.query, rowsByAlias))
  },
}
