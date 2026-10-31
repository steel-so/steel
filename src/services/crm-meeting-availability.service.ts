import { auditMutation } from '@/lib/axiom/audit'
import { crmMeetingInvalid } from '@/src/errors'
import {
  fetchIcs,
  ICS_FAILURE_MESSAGES,
  normalizeIcsUrl,
} from '@/src/lib/crm-meetings/ics-fetch'
import {
  decryptConnectionSecret,
  encryptConnectionSecret,
} from '@/src/lib/crypto'
import { err, ok, type Result } from '@/src/lib/result'
import { toCrmMeetingAvailabilityDTO } from '@/src/mappers/crm-meeting.mapper'
import { CrmMeetingRepository } from '@/src/repositories/crm-meeting.repository'
import type { UpdateCrmMeetingAvailabilityDTO } from '@/src/schemas/crm-meeting.schema'
import type { CrmMeetingAvailabilityDTO } from '@/types/crm-meeting'
import { assertModuleMember } from './authz'

const DEFAULT_TIMEZONE = 'America/Sao_Paulo'

/** Each seller's own working hours and calendar feed (C5). */
export const CrmMeetingAvailabilityService = {
  async get(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<CrmMeetingAvailabilityDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'VIEW',
    })
    if (!membership.ok) return membership
    const row = await CrmMeetingRepository.getAvailability(workspaceId, actorId)
    if (!row.ok) return row
    return ok(toCrmMeetingAvailabilityDTO(row.value, DEFAULT_TIMEZONE))
  },

  async update(
    actorId: string,
    workspaceId: string,
    dto: UpdateCrmMeetingAvailabilityDTO,
  ): Promise<Result<CrmMeetingAvailabilityDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'VIEW',
    })
    if (!membership.ok) return membership
    const current = await CrmMeetingRepository.getAvailability(
      workspaceId,
      actorId,
    )
    if (!current.ok) return current

    let icsUrlEnc = current.value?.icsUrlEnc ?? null
    let icsCheckedAt = current.value?.icsCheckedAt ?? null
    let icsLastError = current.value?.icsLastError ?? null

    if (dto.icsUrl === null) {
      icsUrlEnc = null
      icsCheckedAt = null
      icsLastError = null
    } else if (dto.icsUrl) {
      const url = normalizeIcsUrl(dto.icsUrl)
      const sameAsStored =
        icsUrlEnc !== null &&
        (await decryptConnectionSecret(icsUrlEnc).catch(() => null)) === url
      if (!sameAsStored) {
        const probe = await fetchIcs(url)
        if (!probe.ok) {
          return err(crmMeetingInvalid(ICS_FAILURE_MESSAGES[probe.reason]))
        }
        icsUrlEnc = await encryptConnectionSecret(url)
        icsCheckedAt = new Date()
        icsLastError = null
      }
    }

    const saved = await CrmMeetingRepository.upsertAvailability(
      workspaceId,
      actorId,
      {
        timezone: dto.timezone,
        weeklyHours: dto.weeklyHours,
        icsUrlEnc,
        icsCheckedAt,
        icsLastError,
      },
    )
    if (!saved.ok) return saved
    auditMutation({
      entity: 'crm_meeting_availability',
      action: 'update',
      actorId,
      targetId: saved.value.id,
      meta: { workspaceId, calendarFeed: Boolean(icsUrlEnc) },
    })
    return ok(toCrmMeetingAvailabilityDTO(saved.value, DEFAULT_TIMEZONE))
  },
}
