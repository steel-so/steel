import { sdWfmSettingsInvalid } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { resolveSdOnCall } from '@/src/lib/servicedesk/oncall'
import {
  buildWfmProfile,
  isValidWfmTimeZone,
  isWfmShiftValid,
  wfmDailyTotals,
  wfmForecastHours,
  wfmHeatmap,
  wfmShiftDemand,
  wfmStartOfLocalDay,
} from '@/src/lib/servicedesk/wfm-forecast'
import {
  toSdOnCallOverrideSpecs,
  toSdOnCallSpec,
} from '@/src/mappers/sd-oncall.mapper'
import { toSdWfmSettingsDTO } from '@/src/mappers/sd-wfm.mapper'
import { SdOnCallRepository } from '@/src/repositories/sd-oncall.repository'
import { SdWfmRepository } from '@/src/repositories/sd-wfm.repository'
import type {
  SdWfmForecastQueryDTO,
  UpdateSdWfmSettingsDTO,
} from '@/src/schemas/sd-wfm.schema'
import type {
  SdWfmForecastDTO,
  SdWfmSettingsDTO,
  SdWfmStaffingDTO,
} from '@/types/sd-wfm'
import { SdAccess } from './sd-access'
import { assertSdRefs, sdAdminMutation } from './sd-config-support'

const HOUR_MS = 3_600_000
/** Janela de previsão: 14 dias, com um dia a mais para turnos que viram a noite. */
const FORECAST_DAYS = 14
const DEFAULT_TIME_ZONE = 'America/Sao_Paulo'

async function loadSettings(
  workspaceId: string,
): Promise<Result<SdWfmSettingsDTO>> {
  const row = await SdWfmRepository.findSettings(workspaceId)
  if (!row.ok) return row
  return ok(toSdWfmSettingsDTO(row.value))
}

export const SdWfmService = {
  async getSettings(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<SdWfmSettingsDTO>> {
    const ctx = await SdAccess.requireAgent(actorId, workspaceId)
    if (!ctx.ok) return ctx
    return loadSettings(workspaceId)
  },

  async updateSettings(
    actorId: string,
    workspaceId: string,
    dto: UpdateSdWfmSettingsDTO,
  ): Promise<Result<SdWfmSettingsDTO>> {
    return sdAdminMutation({
      actorId,
      workspaceId,
      entity: 'sd_wfm_settings',
      action: 'update',
      targetId: workspaceId,
      meta: { fields: Object.keys(dto) },
      run: async () => {
        if (dto.shifts && !dto.shifts.every(isWfmShiftValid)) {
          return err(sdWfmSettingsInvalid('Turno inválido'))
        }
        const saved = await SdWfmRepository.upsertSettings(workspaceId, dto)
        if (!saved.ok) return saved
        return ok(toSdWfmSettingsDTO(saved.value))
      },
    })
  },

  /**
   * Previsão de volume (por hora na semana, por dia em duas semanas) e
   * dimensionamento por turno, comparado com o plantão e com o time.
   */
  async forecast(
    actorId: string,
    workspaceId: string,
    query: SdWfmForecastQueryDTO,
    now: Date = new Date(),
  ): Promise<Result<SdWfmForecastDTO>> {
    const ctx = await SdAccess.requireAgent(actorId, workspaceId)
    if (!ctx.ok) return ctx
    const departmentId = query.departmentId ?? null
    if (departmentId) {
      const refs = await assertSdRefs(workspaceId, {
        departmentIds: [departmentId],
      })
      if (!refs.ok) return refs
    }

    const settings = await loadSettings(workspaceId)
    if (!settings.ok) return settings
    const zone = await SdWfmRepository.findTimeZone(workspaceId)
    if (!zone.ok) return zone
    const timeZone =
      zone.value && isValidWfmTimeZone(zone.value)
        ? zone.value
        : DEFAULT_TIME_ZONE

    const hourNow = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS)
    const since = new Date(
      hourNow.getTime() - settings.value.historyWeeks * 7 * 24 * HOUR_MS,
    )
    const counts = await SdWfmRepository.hourlyCounts(
      workspaceId,
      since,
      now,
      departmentId ?? undefined,
    )
    if (!counts.ok) return counts

    const profile = buildWfmProfile(
      counts.value,
      now,
      settings.value.historyWeeks,
      timeZone,
    )
    const start = wfmStartOfLocalDay(now, timeZone)
    const points = wfmForecastHours(
      profile,
      start,
      (FORECAST_DAYS + 1) * 24,
      timeZone,
    )
    const windowPoints = wfmForecastHours(
      profile,
      start,
      FORECAST_DAYS * 24,
      timeZone,
    )
    const demand = wfmShiftDemand(
      points,
      settings.value.shifts,
      settings.value,
      FORECAST_DAYS,
    )

    const team = await SdWfmRepository.countTeam(
      workspaceId,
      departmentId ?? undefined,
    )
    if (!team.ok) return team

    const schedule = await SdOnCallRepository.findActiveForDepartment(
      workspaceId,
      departmentId,
    )
    if (!schedule.ok) return schedule
    let overrides: Parameters<typeof toSdOnCallOverrideSpecs>[0] = []
    if (schedule.value) {
      const found = await SdOnCallRepository.listOverridesInRange(
        schedule.value.id,
        start,
        new Date(start.getTime() + (FORECAST_DAYS + 1) * 24 * HOUR_MS),
      )
      if (!found.ok) return found
      overrides = found.value
    }
    const spec = schedule.value ? toSdOnCallSpec(schedule.value) : null
    const overrideSpecs = toSdOnCallOverrideSpecs(overrides)

    const staffing: SdWfmStaffingDTO[] = demand.map((row) => {
      const shift = settings.value.shifts.find((s) => s.name === row.shift)
      let onCallAgents: number | null = null
      if (spec && shift) {
        const first = points.find(
          (p) => p.dateKey === row.dateKey && p.hour === shift.startHour,
        )
        if (first) {
          const resolved = resolveSdOnCall(
            new Date(first.at),
            spec,
            overrideSpecs,
          )
          onCallAgents = new Set(
            resolved.layers.map((l) => l.userId).filter(Boolean),
          ).size
        }
      }
      return {
        ...row,
        onCallAgents,
        understaffed: (onCallAgents ?? team.value) < row.suggestedAgents,
        exceedsTeam: row.suggestedAgents > team.value,
      }
    })

    return ok({
      generatedAt: now.toISOString(),
      timeZone,
      departmentId,
      insufficientData: profile.insufficient,
      historyTickets: profile.totalTickets,
      historyWeeksWithData: profile.weeksWithData,
      trend: profile.trend,
      teamSize: team.value,
      hasOnCallSchedule: spec !== null,
      settings: settings.value,
      heatmap: wfmHeatmap(profile),
      hourly: windowPoints.slice(0, 7 * 24),
      daily: wfmDailyTotals(windowPoints),
      staffing,
    })
  },
}
