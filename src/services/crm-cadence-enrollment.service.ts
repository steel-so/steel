import { auditMutation } from '@/lib/axiom/audit'
import {
  crmCadenceEnrollmentNotFound,
  crmCadenceStateConflict,
} from '@/src/errors'
import { cadenceDelayMs } from '@/src/lib/crm-cadence/merge'
import { err, ok, type Result } from '@/src/lib/result'
import { toCrmCadenceEnrollmentDTO } from '@/src/mappers/crm-cadence.mapper'
import {
  CrmCadenceEnrollmentRepository,
  CrmCadenceLookupRepository,
  CrmCadenceRepository,
} from '@/src/repositories/crm-cadence.repository'
import type {
  CrmCadenceEnrollmentActionDTO,
  EnrollCrmCadenceDTO,
  ListCrmCadenceEnrollmentsDTO,
} from '@/src/schemas/crm-cadence.schema'
import type {
  CrmCadenceEnrollmentDTO,
  CrmCadenceEnrollResultDTO,
} from '@/types/crm-cadence'
import { assertModuleMember } from './authz'

export const CrmCadenceEnrollmentService = {
  async list(
    actorId: string,
    workspaceId: string,
    filters: ListCrmCadenceEnrollmentsDTO,
  ): Promise<Result<CrmCadenceEnrollmentDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const rows = await CrmCadenceEnrollmentRepository.list(workspaceId, filters)
    if (!rows.ok) return rows
    return ok(rows.value.map(toCrmCadenceEnrollmentDTO))
  },

  /** Puts the leads on the cadence; the ones that cannot join come back with the reason. */
  async enroll(
    actorId: string,
    workspaceId: string,
    dto: EnrollCrmCadenceDTO,
    now: Date = new Date(),
  ): Promise<Result<CrmCadenceEnrollResultDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const cadence = await CrmCadenceRepository.findById(
      dto.cadenceId,
      workspaceId,
    )
    if (!cadence.ok) return cadence
    if (cadence.value.status !== 'ACTIVE') {
      return err(
        crmCadenceStateConflict(
          'A cadência está pausada. Ative-a para inscrever leads.',
        ),
      )
    }
    const first = cadence.value.steps[0]
    if (!first) {
      return err(crmCadenceStateConflict('A cadência não tem passos'))
    }

    const leadIds = [...new Set(dto.leadIds)]
    const leads = await CrmCadenceLookupRepository.findLeads(
      workspaceId,
      leadIds,
    )
    if (!leads.ok) return leads
    const byId = new Map(leads.value.map((lead) => [lead.id, lead]))

    const result: CrmCadenceEnrollResultDTO = { enrolled: [], skipped: [] }
    const firstRunAt = new Date(
      now.getTime() + cadenceDelayMs(first.delayValue, first.delayUnit),
    )
    for (const leadId of leadIds) {
      const lead = byId.get(leadId)
      if (!lead) {
        result.skipped.push({ leadId, reason: 'Lead não encontrado' })
        continue
      }
      if (lead.stage === 'CLOSED') {
        result.skipped.push({ leadId, reason: 'O lead já foi fechado' })
        continue
      }
      if (lead.emails.length === 0 && lead.phones.length === 0) {
        result.skipped.push({
          leadId,
          reason: 'O lead não tem e-mail nem telefone',
        })
        continue
      }
      const enrolled = await CrmCadenceEnrollmentRepository.enroll({
        workspaceId,
        cadenceId: cadence.value.id,
        leadId,
        enrolledById: actorId,
        firstRunAt,
      })
      if (!enrolled.ok) return enrolled
      if (enrolled.value.running) {
        result.skipped.push({
          leadId,
          reason: 'O lead já está nesta cadência',
        })
        continue
      }
      const view = await CrmCadenceEnrollmentRepository.findById(
        enrolled.value.id,
        workspaceId,
      )
      if (!view.ok) return view
      if (view.value)
        result.enrolled.push(toCrmCadenceEnrollmentDTO(view.value))
    }

    auditMutation({
      entity: 'crm_cadence_enrollment',
      action: 'create',
      actorId,
      targetId: cadence.value.id,
      meta: {
        workspaceId,
        enrolled: result.enrolled.length,
        skipped: result.skipped.length,
      },
    })
    return ok(result)
  },

  async act(
    actorId: string,
    workspaceId: string,
    enrollmentId: string,
    dto: CrmCadenceEnrollmentActionDTO,
    now: Date = new Date(),
  ): Promise<Result<CrmCadenceEnrollmentDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const existing = await CrmCadenceEnrollmentRepository.findById(
      enrollmentId,
      workspaceId,
    )
    if (!existing.ok) return existing
    if (!existing.value) return err(crmCadenceEnrollmentNotFound())

    const R = CrmCadenceEnrollmentRepository
    let changed: Result<boolean | number>
    if (dto.action === 'pause') {
      changed = await R.pause(enrollmentId)
    } else if (dto.action === 'resume') {
      changed = await R.resume(enrollmentId, now)
    } else if (dto.action === 'replied') {
      changed = await R.finish(
        [enrollmentId],
        'REPLIED',
        'REPLIED',
        'MANUAL',
        now,
      )
    } else {
      changed = await R.finish([enrollmentId], 'STOPPED', 'MANUAL', null, now)
    }
    if (!changed.ok) return changed
    if (!changed.value) {
      return err(
        crmCadenceStateConflict(
          'Esta inscrição não pode mais receber essa ação',
        ),
      )
    }

    auditMutation({
      entity: 'crm_cadence_enrollment',
      action: 'update',
      actorId,
      targetId: enrollmentId,
      meta: { workspaceId, action: dto.action },
    })
    const fresh = await R.findById(enrollmentId, workspaceId)
    if (!fresh.ok) return fresh
    if (!fresh.value) return err(crmCadenceEnrollmentNotFound())
    return ok(toCrmCadenceEnrollmentDTO(fresh.value))
  },
}
