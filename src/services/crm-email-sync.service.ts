import { auditMutation } from '@/lib/axiom/audit'
import { ok, type Result } from '@/src/lib/result'
import {
  toCrmCalendarEventDTO,
  toCrmEmailAccountDTO,
  toCrmEmailMessageDTO,
} from '@/src/mappers/crm-email-sync.mapper'
import {
  CrmCalendarEventRepository,
  CrmEmailAccountRepository,
  CrmEmailMessageRepository,
} from '@/src/repositories/crm-email-sync.repository'
import type {
  CreateCrmCalendarEventDTO,
  CreateCrmEmailAccountDTO,
  CreateCrmEmailMessageDTO,
  UpdateCrmCalendarEventDTO,
} from '@/src/schemas/crm-email-sync.schema'
import type {
  CrmCalendarEventDTO,
  CrmEmailAccountDTO,
  CrmEmailMessageDTO,
} from '@/types/crm-email-sync'
import { assertModuleMember } from './authz'
import { CrmCadenceReplyService } from './crm-cadence-reply.service'

export const CrmEmailAccountService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<CrmEmailAccountDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const result = await CrmEmailAccountRepository.listByWorkspace(workspaceId)
    if (!result.ok) return result

    return ok(result.value.map(toCrmEmailAccountDTO))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateCrmEmailAccountDTO,
  ): Promise<Result<CrmEmailAccountDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'CREATE',
    })
    if (!membership.ok) return membership

    const result = await CrmEmailAccountRepository.create({
      workspaceId,
      userId: actorId,
      provider: dto.provider,
      email: dto.email,
    })

    if (!result.ok) {
      auditMutation({
        entity: 'crm_email_account',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: result.error.code,
      })
      return result
    }

    auditMutation({
      entity: 'crm_email_account',
      action: 'create',
      actorId,
      targetId: result.value.id,
    })

    return ok(toCrmEmailAccountDTO(result.value))
  },

  async remove(
    actorId: string,
    workspaceId: string,
    accountId: string,
  ): Promise<Result<void>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'DELETE',
    })
    if (!membership.ok) return membership

    const existing = await CrmEmailAccountRepository.findById(
      accountId,
      workspaceId,
    )
    if (!existing.ok) return existing

    const result = await CrmEmailAccountRepository.remove(accountId)
    if (!result.ok) return result

    auditMutation({
      entity: 'crm_email_account',
      action: 'delete',
      actorId,
      targetId: accountId,
    })

    return ok(undefined)
  },
}

export const CrmEmailMessageService = {
  async list(
    actorId: string,
    workspaceId: string,
    filters: { personId?: string; opportunityId?: string },
  ): Promise<Result<CrmEmailMessageDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const result = await CrmEmailMessageRepository.listByWorkspace(
      workspaceId,
      filters,
    )
    if (!result.ok) return result

    return ok(result.value.map(toCrmEmailMessageDTO))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateCrmEmailMessageDTO,
  ): Promise<Result<CrmEmailMessageDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'CREATE',
    })
    if (!membership.ok) return membership

    const result = await CrmEmailMessageRepository.create({
      workspaceId,
      createdById: actorId,
      accountId: dto.accountId,
      direction: dto.direction,
      subject: dto.subject,
      snippet: dto.snippet,
      fromEmail: dto.fromEmail,
      toEmails: dto.toEmails,
      personId: dto.personId,
      opportunityId: dto.opportunityId,
      sentAt: dto.sentAt,
    })

    if (!result.ok) {
      auditMutation({
        entity: 'crm_email_message',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: result.error.code,
      })
      return result
    }

    auditMutation({
      entity: 'crm_email_message',
      action: 'create',
      actorId,
      targetId: result.value.id,
    })

    // An answer from the lead ends the sales cadences it is running.
    if (dto.direction === 'INBOUND') {
      await CrmCadenceReplyService.onEmailReply(workspaceId, dto.fromEmail)
    }

    return ok(toCrmEmailMessageDTO(result.value))
  },

  async remove(
    actorId: string,
    workspaceId: string,
    messageId: string,
  ): Promise<Result<void>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'DELETE',
    })
    if (!membership.ok) return membership

    const existing = await CrmEmailMessageRepository.findById(
      messageId,
      workspaceId,
    )
    if (!existing.ok) return existing

    const result = await CrmEmailMessageRepository.remove(messageId)
    if (!result.ok) return result

    auditMutation({
      entity: 'crm_email_message',
      action: 'delete',
      actorId,
      targetId: messageId,
    })

    return ok(undefined)
  },
}

export const CrmCalendarEventService = {
  async list(
    actorId: string,
    workspaceId: string,
    filters: { personId?: string; opportunityId?: string },
  ): Promise<Result<CrmCalendarEventDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const result = await CrmCalendarEventRepository.listByWorkspace(
      workspaceId,
      filters,
    )
    if (!result.ok) return result

    return ok(result.value.map(toCrmCalendarEventDTO))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateCrmCalendarEventDTO,
  ): Promise<Result<CrmCalendarEventDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'CREATE',
    })
    if (!membership.ok) return membership

    const result = await CrmCalendarEventRepository.create({
      workspaceId,
      createdById: actorId,
      accountId: dto.accountId,
      title: dto.title,
      description: dto.description,
      startsAt: dto.startsAt,
      endsAt: dto.endsAt,
      attendees: dto.attendees,
      personId: dto.personId,
      opportunityId: dto.opportunityId,
    })

    if (!result.ok) {
      auditMutation({
        entity: 'crm_calendar_event',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: result.error.code,
      })
      return result
    }

    auditMutation({
      entity: 'crm_calendar_event',
      action: 'create',
      actorId,
      targetId: result.value.id,
    })

    return ok(toCrmCalendarEventDTO(result.value))
  },

  async update(
    actorId: string,
    workspaceId: string,
    eventId: string,
    dto: UpdateCrmCalendarEventDTO,
  ): Promise<Result<CrmCalendarEventDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const existing = await CrmCalendarEventRepository.findById(
      eventId,
      workspaceId,
    )
    if (!existing.ok) return existing

    const result = await CrmCalendarEventRepository.update(eventId, {
      title: dto.title,
      description: dto.description,
      startsAt: dto.startsAt,
      endsAt: dto.endsAt,
      attendees: dto.attendees,
    })
    if (!result.ok) return result

    auditMutation({
      entity: 'crm_calendar_event',
      action: 'update',
      actorId,
      targetId: eventId,
      meta: { fields: Object.keys(dto) },
    })

    return ok(toCrmCalendarEventDTO(result.value))
  },

  async remove(
    actorId: string,
    workspaceId: string,
    eventId: string,
  ): Promise<Result<void>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'DELETE',
    })
    if (!membership.ok) return membership

    const existing = await CrmCalendarEventRepository.findById(
      eventId,
      workspaceId,
    )
    if (!existing.ok) return existing

    const result = await CrmCalendarEventRepository.remove(eventId)
    if (!result.ok) return result

    auditMutation({
      entity: 'crm_calendar_event',
      action: 'delete',
      actorId,
      targetId: eventId,
    })

    return ok(undefined)
  },
}
