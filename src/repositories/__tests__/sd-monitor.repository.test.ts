import { describe, expect, it } from 'vitest'
import { seedSdConfigItem } from '@/src/__tests__/factories/sd-config-item.factory'
import {
  seedSdMonitorAlert,
  seedSdMonitorSource,
} from '@/src/__tests__/factories/sd-monitor.factory'
import { seedSdTicket } from '@/src/__tests__/factories/sd-ticket.factory'
import { seedSdPhaseFlow } from '@/src/__tests__/factories/sd-ticket-context.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { hashSdMonitorToken } from '@/src/services/sd-monitor-source.service'
import { SdMonitorAlertRepository } from '../sd-monitor-alert.repository'
import { SdMonitorSourceRepository } from '../sd-monitor-source.repository'

async function setup() {
  const [workspace, other, user] = await Promise.all([
    seedWorkspace(),
    seedWorkspace(),
    seedUser(),
  ])
  return { workspace, other, user }
}

describe('SdMonitorSourceRepository', () => {
  it('creates, lists, finds, updates and soft deletes within the workspace', async () => {
    const { workspace, other, user } = await setup()
    const created = expectOk(
      await SdMonitorSourceRepository.create(workspace.id, {
        name: 'Zabbix matriz',
        tokenHash: hashSdMonitorToken('tok-a'),
        createdById: user.id,
        severityMap: [{ from: 'Disaster', priorityId: 'p1' }],
        flappingWindowMinutes: 15,
      }),
    )
    expect(created.kind).toBe('ZABBIX')
    expect(created.autoResolve).toBe(true)
    expect(created.flappingWindowMinutes).toBe(15)
    expect(created.correlationMode).toBe('HOST')
    expect(created.correlationWindowMinutes).toBe(60)

    await seedSdMonitorSource(workspace.id, user.id, {
      name: 'Webhook inativo',
      kind: 'WEBHOOK',
      active: false,
    })
    await seedSdMonitorSource(workspace.id, user.id, {
      name: 'Excluída',
      deletedAt: new Date(),
    })
    await seedSdMonitorSource(other.id, user.id, { name: 'De outra' })

    const active = expectOk(await SdMonitorSourceRepository.list(workspace.id))
    expect(active.map((s) => s.name)).toEqual(['Zabbix matriz'])
    const all = expectOk(
      await SdMonitorSourceRepository.list(workspace.id, {
        includeInactive: true,
      }),
    )
    expect(all.map((s) => s.name)).toEqual(['Webhook inativo', 'Zabbix matriz'])

    expectOk(await SdMonitorSourceRepository.findById(created.id, workspace.id))
    expectErr(
      await SdMonitorSourceRepository.findById(created.id, other.id),
      'SD_MONITOR_SOURCE_NOT_FOUND',
    )

    const updated = expectOk(
      await SdMonitorSourceRepository.update(created.id, workspace.id, {
        name: 'Zabbix DC',
        autoResolve: false,
        departmentId: null,
      }),
    )
    expect(updated.name).toBe('Zabbix DC')
    expect(updated.autoResolve).toBe(false)

    expectOk(
      await SdMonitorSourceRepository.softDelete(created.id, workspace.id),
    )
    const row = await prisma.sdMonitorSource.findUnique({
      where: { id: created.id },
    })
    expect(row?.deletedAt).toBeInstanceOf(Date)
    expect(row?.active).toBe(false)
    expectErr(
      await SdMonitorSourceRepository.findById(created.id, workspace.id),
      'SD_MONITOR_SOURCE_NOT_FOUND',
    )
  })

  it('refuses a duplicated token hash and a missing update target', async () => {
    const { workspace, user } = await setup()
    await SdMonitorSourceRepository.create(workspace.id, {
      name: 'A',
      tokenHash: hashSdMonitorToken('mesmo'),
      createdById: user.id,
    })
    expectErr(
      await SdMonitorSourceRepository.create(workspace.id, {
        name: 'B',
        tokenHash: hashSdMonitorToken('mesmo'),
        createdById: user.id,
      }),
      'SD_CONFIG_CONFLICT',
    )
    expectErr(
      await SdMonitorSourceRepository.update('nao-existe', workspace.id, {
        name: 'x',
      }),
      'SD_CONFIG_NOT_FOUND',
    )
    expectErr(
      await SdMonitorSourceRepository.softDelete('nao-existe', workspace.id),
      'SD_CONFIG_NOT_FOUND',
    )
  })

  it('finds only an active, undeleted source by its token hash', async () => {
    const { workspace, user } = await setup()
    const live = await seedSdMonitorSource(workspace.id, user.id, {
      tokenHash: hashSdMonitorToken('viva'),
    })
    await seedSdMonitorSource(workspace.id, user.id, {
      name: 'Inativa',
      tokenHash: hashSdMonitorToken('inativa'),
      active: false,
    })
    await seedSdMonitorSource(workspace.id, user.id, {
      name: 'Excluída',
      tokenHash: hashSdMonitorToken('excluida'),
      deletedAt: new Date(),
    })

    const found = expectOk(
      await SdMonitorSourceRepository.findByTokenHash(
        hashSdMonitorToken('viva'),
      ),
    )
    expect(found?.id).toBe(live.id)
    expect(
      expectOk(
        await SdMonitorSourceRepository.findByTokenHash(
          hashSdMonitorToken('inativa'),
        ),
      ),
    ).toBeNull()
    expect(
      expectOk(
        await SdMonitorSourceRepository.findByTokenHash(
          hashSdMonitorToken('excluida'),
        ),
      ),
    ).toBeNull()
    expect(
      expectOk(await SdMonitorSourceRepository.findByTokenHash('desconhecido')),
    ).toBeNull()
  })

  it('stamps the last event and fails loudly for a missing source', async () => {
    const { workspace, user } = await setup()
    const source = await seedSdMonitorSource(workspace.id, user.id)
    const at = new Date('2026-10-01T15:00:00.000Z')
    expectOk(await SdMonitorSourceRepository.touchLastEvent(source.id, at))
    const row = await prisma.sdMonitorSource.findUnique({
      where: { id: source.id },
    })
    expect(row?.lastEventAt?.toISOString()).toBe(at.toISOString())
    expectErr(
      await SdMonitorSourceRepository.touchLastEvent('nao-existe', at),
      'SD_CONFIG_NOT_FOUND',
    )
  })
})

describe('SdMonitorAlertRepository', () => {
  it('creates, deduplicates by external id and updates with relations', async () => {
    const { workspace, user } = await setup()
    const source = await seedSdMonitorSource(workspace.id, user.id)
    const flow = await seedSdPhaseFlow(workspace.id, 'INCIDENT')
    const ticket = await seedSdTicket(workspace.id, flow.initial.id)
    const ci = await seedSdConfigItem(workspace.id, user.id, { name: 'SRV-01' })

    const created = expectOk(
      await SdMonitorAlertRepository.create({
        workspaceId: workspace.id,
        sourceId: source.id,
        externalId: '31415',
        subject: 'Sem resposta do agente',
        severity: 'Disaster',
        host: 'SRV-01',
        configItemId: ci.id,
        ticketId: ticket.id,
        payload: { eventId: '31415' },
      }),
    )
    expect(created.status).toBe('OPEN')
    expect(created.source.name).toBe('Zabbix matriz')
    expect(created.configItem?.name).toBe('SRV-01')
    expect(created.ticket?.number).toBe(ticket.number)
    expect(created.ticket?.phase.name).toBe('Novo')

    // `(sourceId, externalId)` é único: o mesmo evento não entra duas vezes.
    expectErr(
      await SdMonitorAlertRepository.create({
        workspaceId: workspace.id,
        sourceId: source.id,
        externalId: '31415',
        subject: 'Repetido',
      }),
      'SD_CONFIG_CONFLICT',
    )

    const found = expectOk(
      await SdMonitorAlertRepository.findByExternalId(source.id, '31415'),
    )
    expect(found?.id).toBe(created.id)
    expect(
      expectOk(
        await SdMonitorAlertRepository.findByExternalId(source.id, 'outro'),
      ),
    ).toBeNull()

    const resolvedAt = new Date('2026-10-01T16:00:00.000Z')
    const updated = expectOk(
      await SdMonitorAlertRepository.update(created.id, {
        status: 'RESOLVED',
        resolvedAt,
        severity: 'High',
      }),
    )
    expect(updated.status).toBe('RESOLVED')
    expect(updated.resolvedAt?.toISOString()).toBe(resolvedAt.toISOString())
    expectErr(
      await SdMonitorAlertRepository.update('nao-existe', { status: 'OPEN' }),
      'SD_CONFIG_NOT_FOUND',
    )
  })

  it('lists newest first and filters by source, ticket, status and limit', async () => {
    const { workspace, other, user } = await setup()
    const source = await seedSdMonitorSource(workspace.id, user.id)
    const second = await seedSdMonitorSource(workspace.id, user.id, {
      name: 'Webhook',
      kind: 'WEBHOOK',
    })
    const flow = await seedSdPhaseFlow(workspace.id, 'INCIDENT')
    const ticket = await seedSdTicket(workspace.id, flow.initial.id)

    await seedSdMonitorAlert(workspace.id, source.id, {
      externalId: 'a',
      subject: 'Primeiro',
      ticketId: ticket.id,
    })
    await seedSdMonitorAlert(workspace.id, source.id, {
      externalId: 'b',
      subject: 'Segundo',
      status: 'RESOLVED',
    })
    await seedSdMonitorAlert(workspace.id, second.id, {
      externalId: 'c',
      subject: 'Terceiro',
    })
    const otherSource = await seedSdMonitorSource(other.id, user.id)
    await seedSdMonitorAlert(other.id, otherSource.id, { subject: 'De outra' })

    const all = expectOk(await SdMonitorAlertRepository.list(workspace.id))
    expect(all).toHaveLength(3)
    expect(all[0].subject).toBe('Terceiro')

    expect(
      expectOk(
        await SdMonitorAlertRepository.list(workspace.id, {
          sourceId: source.id,
        }),
      ).map((a) => a.subject),
    ).toEqual(['Segundo', 'Primeiro'])
    expect(
      expectOk(
        await SdMonitorAlertRepository.list(workspace.id, {
          ticketId: ticket.id,
        }),
      ).map((a) => a.subject),
    ).toEqual(['Primeiro'])
    expect(
      expectOk(
        await SdMonitorAlertRepository.list(workspace.id, {
          status: 'RESOLVED',
        }),
      ).map((a) => a.subject),
    ).toEqual(['Segundo'])
    expect(
      expectOk(await SdMonitorAlertRepository.list(workspace.id, { limit: 1 })),
    ).toHaveLength(1)
  })

  it('matches the config item by name, code or ip, ignoring case and deleted ones', async () => {
    const { workspace, other, user } = await setup()
    await seedSdConfigItem(workspace.id, user.id, {
      name: 'SRV-01',
      code: 'PAT-900',
      ipAddress: '10.0.0.4',
    })
    await seedSdConfigItem(workspace.id, user.id, {
      name: 'SRV-DEL',
      deletedAt: new Date(),
    })
    await seedSdConfigItem(other.id, user.id, { name: 'SRV-OUTRA' })

    const byName = expectOk(
      await SdMonitorAlertRepository.findConfigItemByHosts(workspace.id, [
        'srv-01',
      ]),
    )
    expect(byName?.name).toBe('SRV-01')
    expect(
      expectOk(
        await SdMonitorAlertRepository.findConfigItemByHosts(workspace.id, [
          'pat-900',
        ]),
      )?.name,
    ).toBe('SRV-01')
    expect(
      expectOk(
        await SdMonitorAlertRepository.findConfigItemByHosts(workspace.id, [
          '10.0.0.4',
        ]),
      )?.name,
    ).toBe('SRV-01')
    expect(
      expectOk(
        await SdMonitorAlertRepository.findConfigItemByHosts(workspace.id, [
          'SRV-DEL',
        ]),
      ),
    ).toBeNull()
    expect(
      expectOk(
        await SdMonitorAlertRepository.findConfigItemByHosts(workspace.id, [
          'SRV-OUTRA',
        ]),
      ),
    ).toBeNull()
  })

  it('picks the initial phase first and then by position', async () => {
    const { workspace } = await setup()
    const flow = await seedSdPhaseFlow(workspace.id, 'INCIDENT')
    expect(
      expectOk(
        await SdMonitorAlertRepository.findPhaseIdByCategory(
          workspace.id,
          'INCIDENT',
          'RESOLVED',
        ),
      ),
    ).toBe(flow.resolved.id)
    expect(
      expectOk(
        await SdMonitorAlertRepository.findPhaseIdByCategory(
          workspace.id,
          'INCIDENT',
          'NEW',
        ),
      ),
    ).toBe(flow.initial.id)
    expect(
      expectOk(
        await SdMonitorAlertRepository.findPhaseIdByCategory(
          workspace.id,
          'PROBLEM',
          'RESOLVED',
        ),
      ),
    ).toBeNull()

    await prisma.sdPhase.update({
      where: { id: flow.resolved.id },
      data: { active: false },
    })
    expect(
      expectOk(
        await SdMonitorAlertRepository.findPhaseIdByCategory(
          workspace.id,
          'INCIDENT',
          'RESOLVED',
        ),
      ),
    ).toBeNull()
  })

  it('keeps the dedupe counters and the correlation key', async () => {
    const { workspace, user } = await setup()
    const source = await seedSdMonitorSource(workspace.id, user.id)
    const created = expectOk(
      await SdMonitorAlertRepository.create({
        workspaceId: workspace.id,
        sourceId: source.id,
        externalId: 'cnt',
        subject: 'CPU',
        correlationKey: 'host:srv-01',
        correlated: true,
      }),
    )
    expect(created.occurrences).toBe(1)
    expect(created.correlated).toBe(true)
    expect(created.source.kind).toBe('ZABBIX')

    const bumped = expectOk(
      await SdMonitorAlertRepository.update(created.id, {
        occurrences: { increment: 2 },
        lastSeenAt: new Date('2026-10-02T00:00:00.000Z'),
      }),
    )
    expect(bumped.occurrences).toBe(3)
    expect(bumped.lastSeenAt.toISOString()).toBe('2026-10-02T00:00:00.000Z')
    expect(
      expectOk(
        await SdMonitorAlertRepository.update(created.id, { occurrences: 1 }),
      ).occurrences,
    ).toBe(1)
  })

  it('finds an alert by id only inside its workspace', async () => {
    const { workspace, other, user } = await setup()
    const source = await seedSdMonitorSource(workspace.id, user.id)
    const alert = await seedSdMonitorAlert(workspace.id, source.id)
    expect(
      expectOk(await SdMonitorAlertRepository.findById(alert.id, workspace.id))
        .id,
    ).toBe(alert.id)
    expectErr(
      await SdMonitorAlertRepository.findById(alert.id, other.id),
      'SD_MONITOR_ALERT_NOT_FOUND',
    )
  })

  it('lists by config item and the ones with no config item', async () => {
    const { workspace, user } = await setup()
    const source = await seedSdMonitorSource(workspace.id, user.id)
    const ci = await seedSdConfigItem(workspace.id, user.id, { name: 'SRV-01' })
    await seedSdMonitorAlert(workspace.id, source.id, {
      externalId: 'com-ci',
      subject: 'Com CI',
      configItemId: ci.id,
    })
    await seedSdMonitorAlert(workspace.id, source.id, {
      externalId: 'sem-ci',
      subject: 'Sem CI',
    })
    expect(
      expectOk(
        await SdMonitorAlertRepository.list(workspace.id, {
          configItemId: ci.id,
        }),
      ).map((a) => a.subject),
    ).toEqual(['Com CI'])
    expect(
      expectOk(
        await SdMonitorAlertRepository.list(workspace.id, { unmatched: true }),
      ).map((a) => a.subject),
    ).toEqual(['Sem CI'])
  })

  it('matches by the saved alias first, then by any candidate, then by the short name', async () => {
    const { workspace, other, user } = await setup()
    const byName = await seedSdConfigItem(workspace.id, user.id, {
      name: 'SRV-02',
    })
    const byIp = await seedSdConfigItem(workspace.id, user.id, {
      name: 'Switch',
      ipAddress: '10.0.0.9',
    })
    const aliased = await seedSdConfigItem(workspace.id, user.id, {
      name: 'Banco principal',
    })
    const foreign = await seedSdConfigItem(other.id, user.id, { name: 'X' })
    const find = async (hosts: string[]) =>
      expectOk(
        await SdMonitorAlertRepository.findConfigItemByHosts(
          workspace.id,
          hosts,
        ),
      )

    expect(await find([])).toBeNull()
    expect(await find(['  '])).toBeNull()
    // a ordem dos candidatos manda
    expect((await find(['10.0.0.9', 'srv-02']))?.id).toBe(byIp.id)
    expect((await find(['desconhecido', 'SRV-02']))?.id).toBe(byName.id)
    // primeiro rótulo de um FQDN
    expect((await find(['srv-02.lan.exemplo']))?.id).toBe(byName.id)
    expect(await find(['10.0.0.200'])).toBeNull()

    // apelido guardado vence o casamento por nome
    expectOk(
      await SdMonitorAlertRepository.upsertHostAlias(
        workspace.id,
        'SRV-02',
        aliased.id,
        user.id,
      ),
    )
    expect((await find(['srv-02']))?.id).toBe(aliased.id)

    // o mesmo host de novo troca o item em vez de duplicar
    expectOk(
      await SdMonitorAlertRepository.upsertHostAlias(
        workspace.id,
        ' srv-02 ',
        byIp.id,
        user.id,
      ),
    )
    expect((await find(['srv-02']))?.id).toBe(byIp.id)
    expect(await prisma.sdMonitorHostAlias.count()).toBe(1)

    // item excluído deixa o apelido de lado
    await prisma.sdConfigItem.update({
      where: { id: byIp.id },
      data: { deletedAt: new Date() },
    })
    expect((await find(['srv-02']))?.id).toBe(byName.id)
    // apelido de outra workspace não vaza
    expectOk(
      await SdMonitorAlertRepository.upsertHostAlias(
        other.id,
        'banco',
        foreign.id,
        user.id,
      ),
    )
    expect(await find(['banco'])).toBeNull()
  })

  it('checks that a config item exists in the workspace', async () => {
    const { workspace, other, user } = await setup()
    const ci = await seedSdConfigItem(workspace.id, user.id, { name: 'A' })
    const gone = await seedSdConfigItem(workspace.id, user.id, {
      name: 'B',
      deletedAt: new Date(),
    })
    const exists = async (ws: string, id: string) =>
      expectOk(await SdMonitorAlertRepository.configItemExists(ws, id))
    expect(await exists(workspace.id, ci.id)).toBe(true)
    expect(await exists(other.id, ci.id)).toBe(false)
    expect(await exists(workspace.id, gone.id)).toBe(false)
  })

  it('finds the oldest open alert of the machine with an active ticket inside the window', async () => {
    const { workspace, other, user } = await setup()
    const source = await seedSdMonitorSource(workspace.id, user.id)
    const flow = await seedSdPhaseFlow(workspace.id, 'INCIDENT')
    const open = await seedSdTicket(workspace.id, flow.initial.id)
    const done = await seedSdTicket(workspace.id, flow.resolved.id)
    const deleted = await seedSdTicket(workspace.id, flow.initial.id, {
      deletedAt: new Date(),
    })
    const now = Date.now()
    const key = 'host:srv-01'
    const base = { correlationKey: key, status: 'OPEN' as const }
    await seedSdMonitorAlert(workspace.id, source.id, {
      ...base,
      externalId: 'newer',
      ticketId: open.id,
      startedAt: new Date(now - 5 * 60_000),
      lastSeenAt: new Date(now - 1 * 60_000),
    })
    const root = await seedSdMonitorAlert(workspace.id, source.id, {
      ...base,
      externalId: 'root',
      ticketId: open.id,
      startedAt: new Date(now - 20 * 60_000),
      lastSeenAt: new Date(now - 2 * 60_000),
    })
    // ruído que não pode ser escolhido
    await seedSdMonitorAlert(workspace.id, source.id, {
      ...base,
      externalId: 'stale',
      ticketId: open.id,
      startedAt: new Date(now - 90 * 60_000),
      lastSeenAt: new Date(now - 90 * 60_000),
    })
    await seedSdMonitorAlert(workspace.id, source.id, {
      ...base,
      externalId: 'closed-ticket',
      ticketId: done.id,
    })
    await seedSdMonitorAlert(workspace.id, source.id, {
      ...base,
      externalId: 'deleted-ticket',
      ticketId: deleted.id,
    })
    await seedSdMonitorAlert(workspace.id, source.id, {
      ...base,
      externalId: 'no-ticket',
    })
    await seedSdMonitorAlert(workspace.id, source.id, {
      correlationKey: key,
      status: 'RESOLVED',
      externalId: 'resolved',
      ticketId: open.id,
    })
    const otherSource = await seedSdMonitorSource(other.id, user.id)
    await seedSdMonitorAlert(other.id, otherSource.id, {
      ...base,
      externalId: 'foreign',
    })

    const since = new Date(now - 30 * 60_000)
    const found = expectOk(
      await SdMonitorAlertRepository.findCorrelationTarget(
        workspace.id,
        key,
        since,
      ),
    )
    expect(found?.id).toBe(root.id)
    expect(found?.ticket?.number).toBe(open.number)
    expect(
      expectOk(
        await SdMonitorAlertRepository.findCorrelationTarget(
          workspace.id,
          'host:outro',
          since,
        ),
      ),
    ).toBeNull()
    expect(
      expectOk(
        await SdMonitorAlertRepository.findCorrelationTarget(
          workspace.id,
          key,
          new Date(now + 60_000),
        ),
      ),
    ).toBeNull()
  })

  it('counts the other open alerts of a ticket', async () => {
    const { workspace, user } = await setup()
    const source = await seedSdMonitorSource(workspace.id, user.id)
    const flow = await seedSdPhaseFlow(workspace.id, 'INCIDENT')
    const ticket = await seedSdTicket(workspace.id, flow.initial.id)
    const a = await seedSdMonitorAlert(workspace.id, source.id, {
      externalId: 'a',
      ticketId: ticket.id,
    })
    await seedSdMonitorAlert(workspace.id, source.id, {
      externalId: 'b',
      ticketId: ticket.id,
    })
    await seedSdMonitorAlert(workspace.id, source.id, {
      externalId: 'c',
      ticketId: ticket.id,
      status: 'RESOLVED',
    })
    expect(
      expectOk(
        await SdMonitorAlertRepository.countOpenByTicket(ticket.id, a.id),
      ),
    ).toBe(1)
    expect(
      expectOk(
        await SdMonitorAlertRepository.countOpenByTicket(ticket.id, 'x'),
      ),
    ).toBe(2)
  })

  it('links the unmatched alerts with the same host, ignoring case and others', async () => {
    const { workspace, other, user } = await setup()
    const source = await seedSdMonitorSource(workspace.id, user.id)
    const ci = await seedSdConfigItem(workspace.id, user.id, { name: 'A' })
    const otherSource = await seedSdMonitorSource(other.id, user.id)
    await seedSdMonitorAlert(workspace.id, source.id, {
      externalId: '1',
      host: 'SRV-01',
    })
    await seedSdMonitorAlert(workspace.id, source.id, {
      externalId: '2',
      host: 'srv-01',
    })
    await seedSdMonitorAlert(workspace.id, source.id, {
      externalId: '3',
      host: 'srv-99',
    })
    await seedSdMonitorAlert(workspace.id, source.id, {
      externalId: '4',
      host: 'srv-01',
      configItemId: (
        await seedSdConfigItem(workspace.id, user.id, { name: 'B' })
      ).id,
    })
    await seedSdMonitorAlert(other.id, otherSource.id, {
      externalId: '5',
      host: 'srv-01',
    })
    expect(
      expectOk(
        await SdMonitorAlertRepository.linkUnmatchedByHost(
          workspace.id,
          'Srv-01',
          ci.id,
        ),
      ),
    ).toBe(2)
    expect(
      await prisma.sdMonitorAlert.count({ where: { configItemId: ci.id } }),
    ).toBe(2)
  })
})
