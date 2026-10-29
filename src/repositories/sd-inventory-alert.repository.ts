import type { Prisma, SdInventoryAlert } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type { Result } from '@/src/lib/result'
import type { SdInventoryAlertCandidate } from '../lib/servicedesk/inventory'
import { sdDb } from './sd-config-db'

const include = {
  device: { select: { hostname: true } },
} satisfies Prisma.SdInventoryAlertInclude

export type SdInventoryAlertRow = Prisma.SdInventoryAlertGetPayload<{
  include: typeof include
}>

export interface SdInventoryAlertFilters {
  status?: SdInventoryAlert['status']
  kind?: SdInventoryAlert['kind']
  deviceId?: string
  limit: number
}

export interface SdInventoryAlertApplyResult {
  opened: number
  resolved: number
}

export const SdInventoryAlertRepository = {
  async list(
    workspaceId: string,
    filters: SdInventoryAlertFilters,
  ): Promise<Result<SdInventoryAlertRow[]>> {
    return sdDb('Failed to list ServiceDesk inventory alerts', () =>
      prisma.sdInventoryAlert.findMany({
        where: {
          workspaceId,
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.kind ? { kind: filters.kind } : {}),
          ...(filters.deviceId ? { deviceId: filters.deviceId } : {}),
        },
        include,
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        take: filters.limit,
      }),
    )
  },

  /**
   * Reconcilia os alertas do equipamento com a leitura atual, numa transação:
   * candidato estourado abre (ou reabre, ou só atualiza o percentual),
   * candidato normalizado resolve, e alerta aberto de um volume que sumiu
   * também resolve. `opened` conta só as transições para aberto.
   */
  async apply(
    workspaceId: string,
    deviceId: string,
    candidates: SdInventoryAlertCandidate[],
  ): Promise<Result<SdInventoryAlertApplyResult>> {
    return sdDb('Failed to apply ServiceDesk inventory alerts', () =>
      prisma.$transaction(async (tx) => {
        const existing = await tx.sdInventoryAlert.findMany({
          where: { deviceId },
        })
        const byKey = new Map(
          existing.map((row) => [`${row.kind}|${row.mount}`, row]),
        )
        const seen = new Set<string>()
        let opened = 0
        let resolved = 0
        const now = new Date()

        for (const candidate of candidates) {
          const key = `${candidate.kind}|${candidate.mount}`
          seen.add(key)
          const row = byKey.get(key)
          if (candidate.breached) {
            if (!row) {
              await tx.sdInventoryAlert.create({
                data: {
                  workspaceId,
                  deviceId,
                  kind: candidate.kind,
                  mount: candidate.mount,
                  usedPercent: candidate.usedPercent,
                  threshold: candidate.threshold,
                },
              })
              opened++
            } else {
              const reopen = row.status === 'RESOLVED'
              await tx.sdInventoryAlert.update({
                where: { id: row.id },
                data: {
                  status: 'OPEN',
                  usedPercent: candidate.usedPercent,
                  threshold: candidate.threshold,
                  ...(reopen ? { openedAt: now, resolvedAt: null } : {}),
                },
              })
              if (reopen) opened++
            }
          } else if (row?.status === 'OPEN') {
            await tx.sdInventoryAlert.update({
              where: { id: row.id },
              data: {
                status: 'RESOLVED',
                resolvedAt: now,
                usedPercent: candidate.usedPercent,
              },
            })
            resolved++
          }
        }

        for (const row of existing) {
          if (row.status !== 'OPEN') continue
          if (seen.has(`${row.kind}|${row.mount}`)) continue
          await tx.sdInventoryAlert.update({
            where: { id: row.id },
            data: { status: 'RESOLVED', resolvedAt: now },
          })
          resolved++
        }
        return { opened, resolved }
      }),
    )
  },
}
