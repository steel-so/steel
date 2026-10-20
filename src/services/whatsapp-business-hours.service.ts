import { whatsappOutsideBusinessHours } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  formatBusinessOpening,
  isWithinBusinessHours,
  nextBusinessOpening,
  type WhatsAppBusinessHours,
} from '@/src/lib/whatsapp/business-hours'
import type { WhatsAppBusinessHoursStatusDTO } from '@/types/whatsapp-business-hours'
import { assertModuleMember } from './authz'
import { WhatsAppSettingsService } from './whatsapp-settings.service'

export interface WhatsAppBusinessHoursCheck {
  open: boolean
  /** Next opening when closed; `null` when open or never opens. */
  nextOpeningAt: Date | null
  hours: WhatsAppBusinessHours
}

export const WhatsAppBusinessHoursService = {
  /** Window state of the workspace at `now` (system use). */
  async check(
    workspaceId: string,
    now: Date = new Date(),
  ): Promise<Result<WhatsAppBusinessHoursCheck>> {
    const settings = await WhatsAppSettingsService.getEffective(workspaceId)
    if (!settings.ok) return settings
    const hours: WhatsAppBusinessHours = {
      enabled: settings.value.businessHoursEnabled,
      start: settings.value.businessHoursStart,
      end: settings.value.businessHoursEnd,
      days: settings.value.businessHoursDays,
    }
    const open = isWithinBusinessHours(hours, now)
    return ok({
      open,
      nextOpeningAt: open ? null : nextBusinessOpening(hours, now),
      hours,
    })
  },

  /** `err(WHATSAPP_OUTSIDE_BUSINESS_HOURS)` when sending is locked now. */
  async assertOpen(
    workspaceId: string,
    now: Date = new Date(),
  ): Promise<Result<void>> {
    const checked = await WhatsAppBusinessHoursService.check(workspaceId, now)
    if (!checked.ok) return checked
    if (checked.value.open) return ok(undefined)
    const { start, end } = checked.value.hours
    const next = checked.value.nextOpeningAt
    return err(
      whatsappOutsideBusinessHours(
        `Fora do horário de atendimento (${start}–${end}): os envios estão travados${
          next ? ` até ${formatBusinessOpening(next)}` : ''
        }`,
      ),
    )
  },

  /** The window, for agents (conversation banner). */
  async getStatus(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppBusinessHoursStatusDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'VIEW' },
    )
    if (!membership.ok) return membership

    const checked = await WhatsAppBusinessHoursService.check(workspaceId)
    if (!checked.ok) return checked
    return ok({
      ...checked.value.hours,
      open: checked.value.open,
      nextOpeningAt: checked.value.nextOpeningAt?.toISOString() ?? null,
    })
  },
}
