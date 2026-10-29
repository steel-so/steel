import { auditMutation } from '@/lib/axiom/audit'
import { crmCadenceInvalid } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { checkCampaignSender } from '@/src/lib/sending-domain/campaign-sender'
import {
  buildCadenceStats,
  EMPTY_CADENCE_STATS,
  toCrmCadenceDTO,
} from '@/src/mappers/crm-cadence.mapper'
import {
  type CadenceFields,
  CrmCadenceEnrollmentRepository,
  CrmCadenceRepository,
  type CrmCadenceWithSteps,
} from '@/src/repositories/crm-cadence.repository'
import { CrmCampaignLookupRepository } from '@/src/repositories/crm-campaign-lookup.repository'
import type {
  CreateCrmCadenceDTO,
  CrmCadenceStepInput,
  UpdateCrmCadenceDTO,
} from '@/src/schemas/crm-cadence.schema'
import type { CrmCadenceDTO } from '@/types/crm-cadence'
import { assertModuleMember } from './authz'

type Setup = Pick<CadenceFields, 'emailFrom' | 'whatsappConnectionId'>

/** The cadence must be runnable as saved: sender, connection and templates. */
async function validateSetup(
  workspaceId: string,
  setup: Setup,
  steps: CrmCadenceStepInput[],
): Promise<Result<void>> {
  if (steps.some((step) => step.type === 'EMAIL')) {
    if (!setup.emailFrom) {
      return err(
        crmCadenceInvalid('Informe o remetente dos e-mails da cadência'),
      )
    }
    const sender = await checkCampaignSender(workspaceId, setup.emailFrom)
    if (!sender.ok) return sender
  }

  const whatsappSteps = steps.filter((step) => step.type === 'WHATSAPP')
  if (whatsappSteps.length > 0) {
    if (!setup.whatsappConnectionId) {
      return err(crmCadenceInvalid('Escolha a conexão de WhatsApp da cadência'))
    }
    const connection = await CrmCampaignLookupRepository.findConnection(
      workspaceId,
      setup.whatsappConnectionId,
    )
    if (!connection.ok) return connection
    if (!connection.value) {
      return err(crmCadenceInvalid('A conexão de WhatsApp não foi encontrada'))
    }
    if (connection.value.provider === 'META') {
      for (const step of whatsappSteps) {
        if (!step.whatsappTemplateId) {
          return err(
            crmCadenceInvalid(
              'Na conexão da Meta, cada passo de WhatsApp precisa de um template aprovado',
            ),
          )
        }
        const template = await CrmCampaignLookupRepository.findWhatsAppTemplate(
          workspaceId,
          connection.value.id,
          step.whatsappTemplateId,
        )
        if (!template.ok) return template
        if (template.value?.status !== 'APPROVED') {
          return err(
            crmCadenceInvalid(
              'Um dos templates escolhidos não existe ou não está aprovado',
            ),
          )
        }
      }
    }
  }
  return ok(undefined)
}

async function withStats(
  cadences: CrmCadenceWithSteps[],
): Promise<Result<CrmCadenceDTO[]>> {
  const ids = cadences.map((cadence) => cadence.id)
  const enrollments = await CrmCadenceRepository.enrollmentCounts(ids)
  if (!enrollments.ok) return enrollments
  const runs = await CrmCadenceRepository.runCounts(ids)
  if (!runs.ok) return runs
  return ok(
    cadences.map((cadence) =>
      toCrmCadenceDTO(
        cadence,
        buildCadenceStats(
          enrollments.value.filter((row) => row.cadenceId === cadence.id),
          runs.value.filter((row) => row.cadenceId === cadence.id),
          cadence.steps.length,
        ),
      ),
    ),
  )
}

export const CrmCadenceService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<CrmCadenceDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const cadences = await CrmCadenceRepository.list(workspaceId)
    if (!cadences.ok) return cadences
    return withStats(cadences.value)
  },

  async get(
    actorId: string,
    workspaceId: string,
    cadenceId: string,
  ): Promise<Result<CrmCadenceDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const cadence = await CrmCadenceRepository.findById(cadenceId, workspaceId)
    if (!cadence.ok) return cadence
    const dtos = await withStats([cadence.value])
    if (!dtos.ok) return dtos
    return ok(
      dtos.value[0] ?? toCrmCadenceDTO(cadence.value, EMPTY_CADENCE_STATS),
    )
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateCrmCadenceDTO,
  ): Promise<Result<CrmCadenceDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'CREATE',
    })
    if (!membership.ok) return membership

    const { steps, ...fields } = dto
    const valid = await validateSetup(workspaceId, fields, steps)
    if (!valid.ok) return valid

    const created = await CrmCadenceRepository.create(
      workspaceId,
      actorId,
      fields,
      steps,
    )
    if (!created.ok) {
      auditMutation({
        entity: 'crm_cadence',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: created.error.code,
      })
      return created
    }
    auditMutation({
      entity: 'crm_cadence',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { workspaceId, steps: steps.length },
    })
    return ok(toCrmCadenceDTO(created.value, EMPTY_CADENCE_STATS))
  },

  async update(
    actorId: string,
    workspaceId: string,
    cadenceId: string,
    dto: UpdateCrmCadenceDTO,
  ): Promise<Result<CrmCadenceDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const existing = await CrmCadenceRepository.findById(cadenceId, workspaceId)
    if (!existing.ok) return existing

    const setup: Setup = {
      emailFrom:
        dto.emailFrom !== undefined ? dto.emailFrom : existing.value.emailFrom,
      whatsappConnectionId:
        dto.whatsappConnectionId !== undefined
          ? dto.whatsappConnectionId
          : existing.value.whatsappConnectionId,
    }
    const start =
      dto.windowStartHour !== undefined
        ? dto.windowStartHour
        : existing.value.windowStartHour
    const end =
      dto.windowEndHour !== undefined
        ? dto.windowEndHour
        : existing.value.windowEndHour
    if ((start === null) !== (end === null)) {
      return err(
        crmCadenceInvalid('Informe o início e o fim da janela de envio'),
      )
    }

    // Re-validate when the sender/connection or the steps change.
    const touchesSetup =
      dto.steps !== undefined ||
      dto.emailFrom !== undefined ||
      dto.whatsappConnectionId !== undefined
    if (touchesSetup) {
      const steps: CrmCadenceStepInput[] =
        dto.steps ??
        existing.value.steps.map((step) => ({
          type: step.type,
          delayValue: step.delayValue,
          delayUnit: step.delayUnit,
          subject: step.subject,
          body: step.body,
          whatsappTemplateId: step.whatsappTemplateId,
          templateVariables: step.templateVariables,
        }))
      const valid = await validateSetup(workspaceId, setup, steps)
      if (!valid.ok) return valid
    }

    const updated = await CrmCadenceRepository.update(
      cadenceId,
      workspaceId,
      actorId,
      {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.emailFrom !== undefined ? { emailFrom: dto.emailFrom } : {}),
        ...(dto.emailReplyTo !== undefined
          ? { emailReplyTo: dto.emailReplyTo }
          : {}),
        ...(dto.whatsappConnectionId !== undefined
          ? { whatsappConnectionId: dto.whatsappConnectionId }
          : {}),
        ...(dto.stopOnReply !== undefined
          ? { stopOnReply: dto.stopOnReply }
          : {}),
        ...(dto.windowStartHour !== undefined
          ? { windowStartHour: dto.windowStartHour }
          : {}),
        ...(dto.windowEndHour !== undefined
          ? { windowEndHour: dto.windowEndHour }
          : {}),
        ...(dto.weekdaysOnly !== undefined
          ? { weekdaysOnly: dto.weekdaysOnly }
          : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
      dto.steps,
    )
    if (!updated.ok) {
      auditMutation({
        entity: 'crm_cadence',
        action: 'update',
        actorId,
        targetId: cadenceId,
        outcome: 'failure',
        reason: updated.error.code,
      })
      return updated
    }
    auditMutation({
      entity: 'crm_cadence',
      action: 'update',
      actorId,
      targetId: cadenceId,
      meta: { workspaceId, status: dto.status, stepsReplaced: !!dto.steps },
    })
    const dtos = await withStats([updated.value])
    if (!dtos.ok) return dtos
    return ok(
      dtos.value[0] ?? toCrmCadenceDTO(updated.value, EMPTY_CADENCE_STATS),
    )
  },

  /** Archives the cadence and stops every lead still running on it. */
  async remove(
    actorId: string,
    workspaceId: string,
    cadenceId: string,
  ): Promise<Result<void>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'DELETE',
    })
    if (!membership.ok) return membership

    const existing = await CrmCadenceRepository.findById(cadenceId, workspaceId)
    if (!existing.ok) return existing

    const open =
      await CrmCadenceEnrollmentRepository.openIdsByCadence(cadenceId)
    if (!open.ok) return open
    const stopped = await CrmCadenceEnrollmentRepository.finish(
      open.value,
      'STOPPED',
      'CADENCE_ARCHIVED',
      null,
      new Date(),
    )
    if (!stopped.ok) return stopped

    const archived = await CrmCadenceRepository.archive(cadenceId, actorId)
    if (!archived.ok) {
      auditMutation({
        entity: 'crm_cadence',
        action: 'delete',
        actorId,
        targetId: cadenceId,
        outcome: 'failure',
        reason: archived.error.code,
      })
      return archived
    }
    auditMutation({
      entity: 'crm_cadence',
      action: 'delete',
      actorId,
      targetId: cadenceId,
      meta: { workspaceId, stoppedEnrollments: stopped.value },
    })
    return ok(undefined)
  },
}
