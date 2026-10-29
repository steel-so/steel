import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { seedSdConfigItem } from '@/src/__tests__/factories/sd-config-item.factory'
import { sdMonitorToken } from '@/src/__tests__/factories/sd-monitor.factory'
import { seedSdPhaseFlow } from '@/src/__tests__/factories/sd-ticket-context.factory'
import { authenticatedOwner, defaultHeaders } from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'
import { prisma } from '@/src/lib/prisma'

const url = (token: string) => `${BASE_URL}/api/servicedesk/monitoring/${token}`

function send(token: string, body: unknown, raw?: string) {
  return fetch(url(token), {
    method: 'POST',
    headers: defaultHeaders,
    body: raw ?? JSON.stringify(body),
  })
}

/** Workspace com fluxo de incidente, um CI "SRV-01" e a origem pronta. */
async function setup(
  overrides: Record<string, unknown> = {},
  token = randomBytes(32).toString('base64url'),
) {
  const { user, workspace } = await authenticatedOwner()
  const flow = await seedSdPhaseFlow(workspace.id, 'INCIDENT')
  const ci = await seedSdConfigItem(workspace.id, user.id, { name: 'SRV-01' })
  const source = await prisma.sdMonitorSource.create({
    data: {
      workspaceId: workspace.id,
      createdById: user.id,
      name: 'Zabbix matriz',
      tokenHash: sdMonitorToken(token).hash,
      ...overrides,
    },
  })
  return { user, workspace, flow, ci, source, token }
}

const problem = {
  eventId: '31415',
  eventStatus: 'PROBLEM',
  eventName: 'Sem resposta do agente no SRV-01',
  eventSeverity: 'Disaster',
  hostName: 'SRV-01',
  message: 'ICMP ping falhou',
}

describe('public monitoring webhook', () => {
  it('rejects a malformed token, an unknown one and an inactive source', async () => {
    const malformed = await send('curto', problem)
    expect(malformed.status).toBe(401)
    expect((await malformed.json()).error.code).toBe('SD_MONITOR_TOKEN_INVALID')

    const unknown = await send(randomBytes(32).toString('base64url'), problem)
    expect(unknown.status).toBe(401)
    expect((await unknown.json()).error.code).toBe('SD_MONITOR_TOKEN_INVALID')

    const { token } = await setup({ active: false })
    const inactive = await send(token, problem)
    expect(inactive.status).toBe(401)
    expect((await inactive.json()).error.code).toBe('SD_MONITOR_TOKEN_INVALID')
  })

  it('rejects a payload it cannot read and a body over the cap', async () => {
    const { token } = await setup()

    const broken = await send(token, null, '{ nao é json')
    expect(broken.status).toBe(422)
    expect((await broken.json()).error.code).toBe('SD_MONITOR_PAYLOAD_INVALID')

    const empty = await send(token, { nada: 'aqui' })
    expect(empty.status).toBe(422)
    expect((await empty.json()).error.code).toBe('SD_MONITOR_PAYLOAD_INVALID')

    const huge = await send(
      token,
      null,
      JSON.stringify({ body: 'x'.repeat(70_000) }),
    )
    expect(huge.status).toBe(422)
    expect((await huge.json()).error.code).toBe('SD_MONITOR_PAYLOAD_INVALID')
  })

  it('opens a ticket, links the CI, deduplicates and resolves it', async () => {
    const { workspace, token, ci } = await setup()

    const opened = await send(token, problem)
    expect(opened.status).toBe(200)
    const first = (await opened.json()).data
    expect(first.outcome).toBe('ticket_created')
    expect(first.status).toBe('OPEN')
    expect(first.ticket.code).toMatch(/^INC-\d{6}$/)

    const ticket = await prisma.sdTicket.findUniqueOrThrow({
      where: { id: first.ticket.id },
      include: { phase: true },
    })
    expect(ticket.workspaceId).toBe(workspace.id)
    expect(ticket.channel).toBe('API')
    expect(ticket.title).toBe('Sem resposta do agente no SRV-01')
    expect(ticket.configItemId).toBe(ci.id)
    expect(ticket.description).toContain('SRV-01')

    const alert = await prisma.sdMonitorAlert.findFirstOrThrow({
      where: { workspaceId: workspace.id },
    })
    expect(alert.externalId).toBe('31415')
    expect(alert.configItemId).toBe(ci.id)

    // Mesmo alerta de novo: só atualiza, não abre um segundo chamado.
    const again = await send(token, { ...problem, eventSeverity: 'High' })
    expect((await again.json()).data.outcome).toBe('alert_updated')
    expect(await prisma.sdTicket.count()).toBe(1)
    expect(await prisma.sdMonitorAlert.count()).toBe(1)
    const updated = await prisma.sdMonitorAlert.findUniqueOrThrow({
      where: { id: alert.id },
    })
    expect(updated.severity).toBe('High')

    // Normalização: fecha o alerta e resolve o chamado.
    const recovery = await send(token, {
      ...problem,
      eventStatus: 'RESOLVED',
    })
    const resolved = (await recovery.json()).data
    expect(resolved.outcome).toBe('ticket_resolved')
    expect(resolved.status).toBe('RESOLVED')

    const closed = await prisma.sdTicket.findUniqueOrThrow({
      where: { id: first.ticket.id },
      include: { phase: true },
    })
    expect(closed.phase.category).toBe('RESOLVED')
    expect(closed.resolvedAt).not.toBeNull()
    expect(closed.solution).toContain('normalizado')

    const after = await prisma.sdMonitorAlert.findUniqueOrThrow({
      where: { id: alert.id },
    })
    expect(after.status).toBe('RESOLVED')
    expect(after.resolvedAt).not.toBeNull()

    const events = await prisma.sdTicketEvent.findMany({
      where: { ticketId: first.ticket.id },
      select: { action: true },
    })
    expect(events.map((e) => e.action)).toEqual(
      expect.arrayContaining([
        'monitor.alert_opened',
        'monitor.alert_repeated',
        'monitor.alert_resolved',
      ]),
    )

    const source = await prisma.sdMonitorSource.findFirstOrThrow({
      where: { workspaceId: workspace.id },
    })
    expect(source.lastEventAt).not.toBeNull()
  })

  it('reopens the previous ticket when the alert flaps back', async () => {
    const { token } = await setup({ flappingWindowMinutes: 60 })
    const opened = (await (await send(token, problem)).json()).data
    await send(token, { ...problem, eventStatus: 'RESOLVED' })

    const back = await send(token, problem)
    const result = (await back.json()).data
    expect(result.outcome).toBe('ticket_reopened')
    expect(result.ticket.id).toBe(opened.ticket.id)
    expect(await prisma.sdTicket.count()).toBe(1)

    const ticket = await prisma.sdTicket.findUniqueOrThrow({
      where: { id: opened.ticket.id },
      include: { phase: true },
    })
    expect(ticket.phase.category).not.toBe('RESOLVED')
    expect(ticket.reopenCount).toBe(1)
    const message = await prisma.sdTicketMessage.findFirstOrThrow({
      where: { ticketId: ticket.id },
    })
    expect(message.authorKind).toBe('SYSTEM')
    expect(message.body).toContain('instabilidade')
  })

  it('opens a second ticket when the alert comes back outside the window', async () => {
    const { token } = await setup({ flappingWindowMinutes: 0 })
    await send(token, problem)
    await send(token, { ...problem, eventStatus: 'RESOLVED' })
    const back = (await (await send(token, problem)).json()).data
    expect(back.outcome).toBe('ticket_created')
    expect(await prisma.sdTicket.count()).toBe(2)
    expect(await prisma.sdMonitorAlert.count()).toBe(1)
  })

  it('accepts the generic shape and keeps the ticket open without autoResolve', async () => {
    const { token } = await setup({ autoResolve: false })
    const opened = (
      await (
        await send(token, {
          externalId: 'cpu-srv2',
          status: 'PROBLEM',
          severity: 'high',
          host: 'srv-02',
          subject: 'CPU acima de 90%',
          body: 'Média de 5 minutos em 94%',
          tags: ['infra', 'cpu'],
        })
      ).json()
    ).data
    expect(opened.outcome).toBe('ticket_created')

    const ticket = await prisma.sdTicket.findUniqueOrThrow({
      where: { id: opened.ticket.id },
    })
    expect(ticket.title).toBe('CPU acima de 90%')
    expect(ticket.tags).toEqual(['infra', 'cpu'])
    // Host sem CI correspondente: o chamado abre sem vínculo.
    expect(ticket.configItemId).toBeNull()

    const recovery = (
      await (
        await send(token, {
          externalId: 'cpu-srv2',
          status: 'OK',
          subject: 'CPU normal',
        })
      ).json()
    ).data
    expect(recovery.outcome).toBe('alert_resolved')

    const after = await prisma.sdTicket.findUniqueOrThrow({
      where: { id: opened.ticket.id },
      include: { phase: true },
    })
    expect(after.phase.category).toBe('NEW')
    const message = await prisma.sdTicketMessage.findFirstOrThrow({
      where: { ticketId: after.id },
    })
    expect(message.body).toContain('normalizou')
  })

  it('records a recovery that never arrived as a problem', async () => {
    const { workspace, token } = await setup()
    const result = (
      await (
        await send(token, {
          externalId: 'nunca-abriu',
          status: 'RESOLVED',
          subject: 'Já normalizado',
        })
      ).json()
    ).data
    expect(result.outcome).toBe('alert_resolved')
    expect(result.ticket).toBeNull()
    expect(await prisma.sdTicket.count()).toBe(0)
    const alert = await prisma.sdMonitorAlert.findFirstOrThrow({
      where: { workspaceId: workspace.id },
    })
    expect(alert.status).toBe('RESOLVED')
    expect(alert.ticketId).toBeNull()
  })

  it('refuses the alert when the ServiceDesk module is off', async () => {
    const { workspace, token } = await setup()
    await prisma.workspaceModuleAccess.updateMany({
      where: { workspaceId: workspace.id, module: 'SERVICE_DESK' },
      data: { enabled: false },
    })
    const res = await send(token, problem)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('MODULE_DISABLED')
  })

  it('maps the severity to the configured priority', async () => {
    const { user, workspace } = await authenticatedOwner()
    await seedSdPhaseFlow(workspace.id, 'INCIDENT')
    const priority = await prisma.sdPriority.create({
      data: { workspaceId: workspace.id, name: 'Crítica', level: 1 },
    })
    const token = randomBytes(32).toString('base64url')
    await prisma.sdMonitorSource.create({
      data: {
        workspaceId: workspace.id,
        createdById: user.id,
        name: 'Zabbix',
        tokenHash: sdMonitorToken(token).hash,
        severityMap: [{ from: 'disaster', priorityId: priority.id }],
      },
    })

    const opened = (await (await send(token, problem)).json()).data
    const ticket = await prisma.sdTicket.findUniqueOrThrow({
      where: { id: opened.ticket.id },
    })
    expect(ticket.priorityId).toBe(priority.id)
  })

  it('reads a Grafana batch: dedupes by fingerprint and joins alerts of one machine', async () => {
    const { token, ci } = await setup({ kind: 'GRAFANA' })
    const batch = {
      status: 'firing',
      alerts: [
        {
          status: 'firing',
          fingerprint: 'fp-cpu',
          labels: {
            alertname: 'CPU alta',
            host: 'SRV-01',
            severity: 'critical',
          },
          annotations: { summary: 'CPU acima de 90%' },
        },
        {
          status: 'firing',
          fingerprint: 'fp-disk',
          labels: { alertname: 'Disco cheio', instance: 'srv-01:9100' },
          annotations: { summary: 'Disco em 95%' },
        },
      ],
    }
    const res = await send(token, batch)
    expect(res.status).toBe(200)
    const data = (await res.json()).data
    expect(data.outcome).toBe('ticket_created')
    expect(data.alerts.map((a: { outcome: string }) => a.outcome)).toEqual([
      'ticket_created',
      'alert_correlated',
    ])
    expect(await prisma.sdTicket.count()).toBe(1)
    const alerts = await prisma.sdMonitorAlert.findMany({
      orderBy: { createdAt: 'asc' },
    })
    expect(alerts.map((a) => a.configItemId)).toEqual([ci.id, ci.id])
    expect(alerts.map((a) => a.correlated)).toEqual([false, true])
    expect(new Set(alerts.map((a) => a.ticketId)).size).toBe(1)

    // O mesmo envio de novo: nada novo, só contadores.
    const again = (await (await send(token, batch)).json()).data
    expect(again.alerts.map((a: { outcome: string }) => a.outcome)).toEqual([
      'alert_updated',
      'alert_updated',
    ])
    const counted = await prisma.sdMonitorAlert.findMany({
      orderBy: { createdAt: 'asc' },
    })
    expect(counted.map((a) => a.occurrences)).toEqual([2, 2])

    // O chamado só resolve quando o último alerta normaliza.
    const first = await send(token, {
      alerts: [{ ...batch.alerts[0], status: 'resolved' }],
    })
    expect((await first.json()).data.outcome).toBe('alert_resolved')
    const stillOpen = await prisma.sdTicket.findFirstOrThrow({
      include: { phase: true },
    })
    expect(stillOpen.phase.category).not.toBe('RESOLVED')

    const last = await send(token, {
      alerts: [{ ...batch.alerts[1], status: 'resolved' }],
    })
    expect((await last.json()).data.outcome).toBe('ticket_resolved')
    const closed = await prisma.sdTicket.findFirstOrThrow({
      include: { phase: true },
    })
    expect(closed.phase.category).toBe('RESOLVED')
  })

  it('does not correlate when the source turned it off', async () => {
    const { token } = await setup({ kind: 'GRAFANA', correlationMode: 'OFF' })
    const res = await send(token, {
      alerts: [
        { fingerprint: 'a', labels: { alertname: 'A', host: 'SRV-01' } },
        { fingerprint: 'b', labels: { alertname: 'B', host: 'SRV-01' } },
      ],
    })
    const data = (await res.json()).data
    expect(data.alerts.map((a: { outcome: string }) => a.outcome)).toEqual([
      'ticket_created',
      'ticket_created',
    ])
    expect(await prisma.sdTicket.count()).toBe(2)
  })

  it('reads a PRTG sensor and resolves it on Up', async () => {
    const { token, ci } = await setup({ kind: 'PRTG' })
    const down = {
      sensorId: '2001',
      device: 'SRV-01',
      host: '10.0.0.4',
      sensor: 'Ping',
      status: 'Down',
      message: 'Timeout',
    }
    const opened = (await (await send(token, down)).json()).data
    expect(opened.outcome).toBe('ticket_created')
    const ticket = await prisma.sdTicket.findUniqueOrThrow({
      where: { id: opened.ticket.id },
    })
    expect(ticket.title).toBe('Ping em SRV-01')
    expect(ticket.configItemId).toBe(ci.id)

    const up = (await (await send(token, { ...down, status: 'Up' })).json())
      .data
    expect(up.outcome).toBe('ticket_resolved')
  })

  it('links the CI through the host alias learned from a manual link', async () => {
    const { token, user, workspace, ci } = await setup()
    await prisma.sdMonitorHostAlias.create({
      data: {
        workspaceId: workspace.id,
        host: 'db-principal',
        configItemId: ci.id,
        createdById: user.id,
      },
    })
    const opened = (
      await (
        await send(token, {
          externalId: 'db-1',
          status: 'PROBLEM',
          host: 'DB-PRINCIPAL',
          subject: 'Replicação atrasada',
        })
      ).json()
    ).data
    const ticket = await prisma.sdTicket.findUniqueOrThrow({
      where: { id: opened.ticket.id },
    })
    expect(ticket.configItemId).toBe(ci.id)
  })
})
