import { Prisma, type SdWfmSettings } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type { Result } from '@/src/lib/result'
import type { WfmHourlyCount } from '@/src/lib/servicedesk/wfm-forecast'
import { sdDb } from './sd-config-db'

export interface SdWfmSettingsData {
  historyWeeks?: number
  ticketsPerAgentHour?: number
  targetOccupancyPercent?: number
  minAgentsPerShift?: number
  shifts?: { name: string; startHour: number; endHour: number }[]
}

export const SdWfmRepository = {
  async findSettings(
    workspaceId: string,
  ): Promise<Result<SdWfmSettings | null>> {
    return sdDb('Failed to find ServiceDesk WFM settings', () =>
      prisma.sdWfmSettings.findUnique({ where: { workspaceId } }),
    )
  },

  async upsertSettings(
    workspaceId: string,
    data: SdWfmSettingsData,
  ): Promise<Result<SdWfmSettings>> {
    return sdDb('Failed to save ServiceDesk WFM settings', () =>
      prisma.sdWfmSettings.upsert({
        where: { workspaceId },
        create: { workspaceId, ...data },
        update: data,
      }),
    )
  },

  /**
   * Chamados criados por hora (UTC) na janela `[since, until)`: uma consulta
   * agrupada, sem carregar chamado por chamado.
   */
  async hourlyCounts(
    workspaceId: string,
    since: Date,
    until: Date,
    departmentId?: string,
  ): Promise<Result<WfmHourlyCount[]>> {
    return sdDb('Failed to aggregate ServiceDesk ticket history', async () => {
      const department = departmentId
        ? Prisma.sql`AND department_id = ${departmentId}`
        : Prisma.empty
      const rows = await prisma.$queryRaw<{ bucket: Date; count: number }[]>`
        SELECT date_trunc('hour', created_at) AS bucket, count(*)::int AS count
        FROM sd_tickets
        WHERE workspace_id = ${workspaceId}
          AND deleted_at IS NULL
          AND created_at >= ${since}
          AND created_at < ${until}
          ${department}
        GROUP BY 1
        ORDER BY 1`
      return rows.map((r) => ({ bucket: r.bucket, count: Number(r.count) }))
    })
  },

  /** Fuso do calendário padrão (ou de qualquer calendário) do workspace. */
  async findTimeZone(workspaceId: string): Promise<Result<string | null>> {
    return sdDb('Failed to resolve the ServiceDesk time zone', async () => {
      const calendar = await prisma.sdBusinessCalendar.findFirst({
        where: { workspaceId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        select: { timezone: true },
      })
      return calendar?.timezone ?? null
    })
  },

  /** Pessoas distintas nos departamentos ativos (ou num departamento). */
  async countTeam(
    workspaceId: string,
    departmentId?: string,
  ): Promise<Result<number>> {
    return sdDb('Failed to count the ServiceDesk team', async () => {
      const rows = await prisma.sdDepartmentMember.findMany({
        where: {
          department: {
            workspaceId,
            deletedAt: null,
            active: true,
            ...(departmentId ? { id: departmentId } : {}),
          },
        },
        select: { userId: true },
        distinct: ['userId'],
      })
      return rows.length
    })
  },
}
