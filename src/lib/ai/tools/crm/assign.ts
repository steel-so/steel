import { z } from 'zod'
import { validationError } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'
import { toCrmTaskDTO } from '@/src/mappers/crm-task.mapper'
import { CrmTaskRepository } from '@/src/repositories/crm-task.repository'
import { assertModuleMember } from '@/src/services/authz'
import { CrmCompanyService } from '@/src/services/crm-company.service'
import { CrmLeadService } from '@/src/services/crm-lead.service'
import { CrmOpportunityService } from '@/src/services/crm-opportunity.service'
import { CrmTaskService } from '@/src/services/crm-task.service'
import type { AiToolContext, SteelAiTool } from '../types'
import {
  type CrmRecordKind,
  changeFields,
  crmBase,
  memberNames,
  recordHref,
  resolveMember,
  zodParser,
} from './shared'

const RECORD_TYPES = ['lead', 'opportunity', 'company', 'task'] as const
type AssignableType = (typeof RECORD_TYPES)[number]

const TYPE_LABELS: Record<AssignableType, string> = {
  lead: 'o lead',
  opportunity: 'a oportunidade',
  company: 'a empresa',
  task: 'a tarefa',
}

interface Assignable {
  id: string
  label: string
  ownerId: string | null
}

/** Current owner of the record (owner, account owner or task assignee). */
async function loadRecord(
  ctx: AiToolContext,
  type: AssignableType,
  id: string,
): Promise<Result<Assignable>> {
  const { actorId, workspaceId } = ctx
  if (type === 'lead') {
    const lead = await CrmLeadService.getById(actorId, workspaceId, id)
    if (!lead.ok) return lead
    return ok({ id, label: lead.value.name, ownerId: lead.value.ownerId })
  }
  if (type === 'opportunity') {
    const opp = await CrmOpportunityService.getById(actorId, workspaceId, id)
    if (!opp.ok) return opp
    return ok({ id, label: opp.value.name, ownerId: opp.value.ownerId })
  }
  if (type === 'company') {
    const company = await CrmCompanyService.getById(actorId, workspaceId, id)
    if (!company.ok) return company
    return ok({
      id,
      label: company.value.name,
      ownerId: company.value.accountOwnerId,
    })
  }
  const access = await assertModuleMember(actorId, workspaceId, 'CRM', {
    resource: 'tasks',
    action: 'VIEW',
  })
  if (!access.ok) return access
  const task = await CrmTaskRepository.findById(id, workspaceId)
  if (!task.ok) return task
  const dto = toCrmTaskDTO(task.value)
  return ok({ id, label: dto.title, ownerId: dto.assigneeId })
}

async function applyOwner(
  ctx: AiToolContext,
  type: AssignableType,
  id: string,
  ownerId: string | null,
): Promise<Result<unknown>> {
  const { actorId, workspaceId } = ctx
  if (type === 'lead') {
    return CrmLeadService.update(actorId, workspaceId, id, { ownerId })
  }
  if (type === 'opportunity') {
    return CrmOpportunityService.update(actorId, workspaceId, id, { ownerId })
  }
  if (type === 'company') {
    return CrmCompanyService.update(actorId, workspaceId, id, {
      accountOwnerId: ownerId,
      address: undefined,
    })
  }
  return CrmTaskService.update(actorId, workspaceId, id, {
    assigneeId: ownerId,
  })
}

const AssignArgs = z.object({
  recordType: z.enum(RECORD_TYPES),
  recordId: z.string().min(1),
  /** null removes the owner. */
  owner: z.string().trim().min(1).nullable(),
})

async function resolveAssignment(
  ctx: AiToolContext,
  args: z.output<typeof AssignArgs>,
) {
  const record = await loadRecord(ctx, args.recordType, args.recordId)
  if (!record.ok) return record
  if (args.owner === null) return ok({ record: record.value, owner: null })
  const member = await resolveMember(ctx, args.owner)
  if (!member.ok) return member
  return ok({
    record: record.value,
    owner: {
      id: member.value.id,
      name: member.value.name || member.value.email,
    },
  })
}

function target(type: AssignableType, record: Assignable, base: string | null) {
  return {
    type: `crm_${type}`,
    id: record.id,
    label: record.label,
    href: recordHref(base, type as CrmRecordKind, record.id),
  }
}

export const crmAssignOwnerTool: SteelAiTool<z.output<typeof AssignArgs>> = {
  name: 'crm_assign_owner',
  label: 'Atribuindo responsável',
  module: 'CRM',
  kind: 'ACTION',
  annotations: { idempotentHint: true, destructiveHint: false },
  description:
    'Define (ou remove, com owner null) o responsável de um lead, oportunidade, empresa (responsável pela conta) ou tarefa. `owner` aceita "me", nome, e-mail ou id de um membro; nome ambíguo devolve as opções.',
  parameters: {
    type: 'object',
    properties: {
      recordType: { type: 'string', enum: [...RECORD_TYPES] },
      recordId: {
        type: 'string',
        description: 'Id do registro (de uma listagem do CRM ou de ws_search).',
      },
      owner: {
        type: ['string', 'null'],
        description:
          'Novo responsável: "me", nome, e-mail ou id; null remove o responsável.',
      },
    },
    required: ['recordType', 'recordId', 'owner'],
    additionalProperties: false,
  },
  parse: zodParser(AssignArgs),
  async preview(ctx, args) {
    const resolved = await resolveAssignment(ctx, args)
    if (!resolved.ok) return resolved
    const { record, owner } = resolved.value
    if (record.ownerId === (owner?.id ?? null)) {
      return err(
        validationError(
          owner
            ? `${owner.name} já é o responsável`
            : 'O registro já está sem responsável',
        ),
      )
    }
    const [base, names] = await Promise.all([crmBase(ctx), memberNames(ctx)])
    return ok({
      title: owner
        ? `Atribuir ${TYPE_LABELS[args.recordType]} “${record.label}” a ${owner.name}`
        : `Remover o responsável d${TYPE_LABELS[args.recordType]} “${record.label}”`,
      summary: owner
        ? `${owner.name} passa a ser o responsável.`
        : 'O registro fica sem responsável.',
      fields: changeFields([
        [
          'Responsável',
          record.ownerId ? (names.get(record.ownerId) ?? record.ownerId) : null,
          owner?.name ?? null,
        ],
      ]),
      target: target(args.recordType, record, base),
    })
  },
  async execute(ctx, args) {
    const resolved = await resolveAssignment(ctx, args)
    if (!resolved.ok) return resolved
    const { record, owner } = resolved.value
    const updated = await applyOwner(
      ctx,
      args.recordType,
      args.recordId,
      owner?.id ?? null,
    )
    if (!updated.ok) return updated
    const base = await crmBase(ctx)
    return ok({
      data: {
        recordType: args.recordType,
        recordId: args.recordId,
        ownerId: owner?.id ?? null,
        ownerName: owner?.name ?? null,
      },
      summary: owner
        ? `“${record.label}” atribuído a ${owner.name}`
        : `Responsável removido de “${record.label}”`,
      target: target(args.recordType, record, base),
    })
  },
}
