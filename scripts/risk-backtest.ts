import { prisma } from '@/src/lib/prisma'
import {
  formatSdRiskBacktestReport,
  type SdRiskBacktestTicket,
  sdRiskBacktestMetrics,
  sdRiskBacktestSamples,
} from '@/src/lib/servicedesk/risk-backtest'
import { parseSdCalendar } from '@/src/lib/servicedesk/sla'
import { SD_CLOSED_PHASE_CATEGORIES } from '@/src/repositories/sd-ticket.repository'

/**
 * Backtest do risco preditivo (ADR 0016): reproduz a heurística sobre os
 * chamados encerrados com desfecho de SLA conhecido e imprime calibração por
 * faixa, precisão/revocação da faixa alta e antecedência. Só lê o banco —
 * nada é gravado.
 *
 *   pnpm risk:backtest [workspaceIdOuSlug] [--days=90] [--limit=2000]
 *
 * Sem workspace, roda em cada workspace com o ServiceDesk habilitado.
 */

const DAY_MS = 24 * 60 * 60 * 1000

function option(name: string, fallback: number): number {
  const raw = process.argv
    .slice(2)
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.split('=')[1]
  const value = raw === undefined ? Number.NaN : Number(raw)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

async function loadTickets(
  workspaceId: string,
  since: Date,
  limit: number,
): Promise<SdRiskBacktestTicket[]> {
  const rows = await prisma.sdTicket.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      createdAt: { gte: since },
      phase: { category: { in: SD_CLOSED_PHASE_CATEGORIES } },
      OR: [
        { firstResponseDueAt: { not: null } },
        { resolutionDueAt: { not: null } },
      ],
    },
    select: {
      id: true,
      createdAt: true,
      firstResponseDueAt: true,
      resolutionDueAt: true,
      firstRespondedAt: true,
      resolvedAt: true,
      closedAt: true,
      firstResponseBreached: true,
      resolutionBreached: true,
      assigneeId: true,
      departmentId: true,
      customerId: true,
      companyId: true,
      serviceId: true,
      priority: { select: { name: true, level: true } },
      severity: { select: { name: true, level: true } },
      slaPolicy: {
        select: {
          calendar: {
            select: {
              timezone: true,
              schedule: true,
              holidays: true,
              is24x7: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  const events = await prisma.sdTicketEvent.findMany({
    where: {
      workspaceId,
      ticketId: { in: rows.map((r) => r.id) },
      OR: [
        { actorKind: 'AGENT' },
        { action: 'ticket.reopened' },
        { action: 'field.changed', field: 'assigneeId' },
      ],
    },
    select: {
      ticketId: true,
      actorKind: true,
      action: true,
      field: true,
      createdAt: true,
    },
  })
  const byTicket = new Map<string, typeof events>()
  for (const event of events) {
    const list = byTicket.get(event.ticketId) ?? []
    list.push(event)
    byTicket.set(event.ticketId, list)
  }

  return rows.map((row) => {
    const own = byTicket.get(row.id) ?? []
    const assignments = own
      .filter((e) => e.action === 'field.changed' && e.field === 'assigneeId')
      .map((e) => e.createdAt.getTime())
    return {
      id: row.id,
      createdAt: row.createdAt,
      firstResponseDueAt: row.firstResponseDueAt,
      resolutionDueAt: row.resolutionDueAt,
      firstRespondedAt: row.firstRespondedAt,
      resolvedAt: row.resolvedAt,
      closedAt: row.closedAt,
      firstResponseBreached: row.firstResponseBreached,
      resolutionBreached: row.resolutionBreached,
      assigneeId: row.assigneeId,
      assignedAt:
        assignments.length > 0 ? new Date(Math.min(...assignments)) : null,
      departmentId: row.departmentId,
      customerId: row.customerId,
      companyId: row.companyId,
      serviceId: row.serviceId,
      priority: row.priority,
      severity: row.severity,
      teamActivityAt: own
        .filter((e) => e.actorKind === 'AGENT')
        .map((e) => e.createdAt),
      reopenedAt: own
        .filter((e) => e.action === 'ticket.reopened')
        .map((e) => e.createdAt),
      calendar: parseSdCalendar(row.slaPolicy?.calendar ?? null),
    }
  })
}

async function backtest(
  workspace: { id: string; name: string; slug: string },
  since: Date,
  limit: number,
): Promise<void> {
  const [tickets, priority, severity, settings] = await Promise.all([
    loadTickets(workspace.id, since, limit),
    prisma.sdPriority.aggregate({
      where: { workspaceId: workspace.id },
      _max: { level: true },
    }),
    prisma.sdSeverity.aggregate({
      where: { workspaceId: workspace.id },
      _max: { level: true },
    }),
    prisma.sdSettings.findUnique({
      where: { workspaceId: workspace.id },
      select: { slaAtRiskPercent: true },
    }),
  ])
  const run = sdRiskBacktestSamples(tickets, {
    scales: {
      priority: priority._max.level ?? 0,
      severity: severity._max.level ?? 0,
    },
    atRiskPercent: settings?.slaAtRiskPercent,
  })
  console.log(
    formatSdRiskBacktestReport(
      sdRiskBacktestMetrics(run.samples, run.tickets),
      `${workspace.name} (${workspace.slug})`,
    ),
  )
  console.log('')
}

async function main() {
  const identifier = process.argv.slice(2).find((arg) => !arg.startsWith('--'))
  const days = option('days', 90)
  const limit = option('limit', 2000)
  const since = new Date(Date.now() - days * DAY_MS)

  const workspaces = await prisma.workspace.findMany({
    where: identifier
      ? { OR: [{ id: identifier }, { slug: identifier }] }
      : {
          moduleAccess: { some: { module: 'SERVICE_DESK', enabled: true } },
        },
    select: { id: true, name: true, slug: true },
    orderBy: { slug: 'asc' },
  })
  if (workspaces.length === 0) {
    console.error(
      identifier
        ? `Workspace "${identifier}" não encontrado.`
        : 'Nenhum workspace com o ServiceDesk habilitado.',
    )
    process.exitCode = 1
    return
  }

  console.log(
    `Chamados encerrados dos últimos ${days} dias (até ${limit} por workspace).\n`,
  )
  for (const workspace of workspaces) {
    await backtest(workspace, since, limit)
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
