import { describe, expect, it } from 'vitest'
import {
  seedSdInventoryDevice,
} from '@/src/__tests__/factories/nov-s1-asset-inventory.factory'
import {
  seedSdConfigItem,
  seedSdConfigItemType,
} from '@/src/__tests__/factories/sd-config-item.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { SdInventoryAlertRepository } from '../sd-inventory-alert.repository'
import { SdInventoryDeviceRepository } from '../sd-inventory-device.repository'
import { SdInventorySettingsRepository } from '../sd-inventory-settings.repository'
import { SdInventoryTargetRepository } from '../sd-inventory-target.repository'

async function setup() {
  const [workspace, other, user] = await Promise.all([
    seedWorkspace(),
    seedWorkspace(),
    seedUser(),
  ])
  return { workspace, other, user }
}

const writeData = (overrides: Record<string, unknown> = {}) => ({
  source: 'AGENT' as const,
  hostname: 'PC-01',
  osName: 'Windows 11',
  osVersion: '10.0',
  arch: 'amd64',
  manufacturer: 'Dell',
  model: 'OptiPlex',
  serialNumber: 'SN-1',
  cpuModel: null,
  cpuCores: null,
  ramTotalMb: 1000,
  ramUsedMb: 500,
  ipAddresses: ['10.0.0.20'],
  macAddresses: ['aa:bb:cc:dd:ee:ff'],
  disks: [{ mount: 'C:', totalMb: 1000, usedMb: 500 }],
  snmpTargetId: null,
  lastSeenAt: new Date('2026-10-20T00:00:00Z'),
  ...overrides,
})

describe('SdInventorySettingsRepository', () => {
  it('returns null until saved, then upserts', async () => {
    const { workspace } = await setup()
    expect(
      expectOk(await SdInventorySettingsRepository.find(workspace.id)),
    ).toBeNull()

    const created = expectOk(
      await SdInventorySettingsRepository.upsert(workspace.id, {
        diskThresholdPercent: 80,
      }),
    )
    expect(created).toMatchObject({
      diskThresholdPercent: 80,
      ramThresholdPercent: 90,
      staleAfterDays: 7,
    })

    const updated = expectOk(
      await SdInventorySettingsRepository.upsert(workspace.id, {
        staleAfterDays: 14,
        syncConfigItems: false,
      }),
    )
    expect(updated).toMatchObject({
      diskThresholdPercent: 80,
      staleAfterDays: 14,
      syncConfigItems: false,
    })
  })
})

describe('SdInventoryTargetRepository', () => {
  const base = (workspaceId: string, createdById: string, name = 'Rede') => ({
    workspaceId,
    createdById,
    name,
    ranges: ['10.0.0.0/30'],
    communityEnc: 'enc',
  })

  it('creates, lists, finds, updates and soft deletes within the workspace', async () => {
    const { workspace, other, user } = await setup()
    const created = expectOk(
      await SdInventoryTargetRepository.create(base(workspace.id, user.id)),
    )
    expect(created).toMatchObject({
      port: 161,
      intervalMinutes: 1440,
      active: true,
    })

    expect(
      expectOk(await SdInventoryTargetRepository.list(workspace.id)),
    ).toHaveLength(1)
    expect(
      expectOk(await SdInventoryTargetRepository.list(other.id)),
    ).toHaveLength(0)
    expectOk(
      await SdInventoryTargetRepository.findById(created.id, workspace.id),
    )
    expectErr(
      await SdInventoryTargetRepository.findById(created.id, other.id),
      'SD_INVENTORY_TARGET_NOT_FOUND',
    )
    expect(
      expectOk(await SdInventoryTargetRepository.findByIdUnscoped(created.id))
        ?.id,
    ).toBe(created.id)

    const updated = expectOk(
      await SdInventoryTargetRepository.update(created.id, workspace.id, {
        name: 'Matriz',
        port: 1161,
      }),
    )
    expect(updated).toMatchObject({ name: 'Matriz', port: 1161 })
    expectErr(
      await SdInventoryTargetRepository.update(created.id, other.id, {
        name: 'x',
      }),
      'SD_CONFIG_NOT_FOUND',
    )

    expectOk(
      await SdInventoryTargetRepository.softDelete(created.id, workspace.id),
    )
    expect(
      expectOk(await SdInventoryTargetRepository.list(workspace.id)),
    ).toHaveLength(0)
    expect(
      expectOk(await SdInventoryTargetRepository.findByIdUnscoped(created.id)),
    ).toBeNull()
    expectErr(
      await SdInventoryTargetRepository.findById(created.id, workspace.id),
    )
  })

  it('lists only active, undeleted targets that are due', async () => {
    const { workspace, user } = await setup()
    const now = new Date('2026-10-20T12:00:00Z')
    const never = expectOk(
      await SdInventoryTargetRepository.create(
        base(workspace.id, user.id, 'never'),
      ),
    )
    const past = expectOk(
      await SdInventoryTargetRepository.create({
        ...base(workspace.id, user.id, 'past'),
        nextRunAt: new Date('2026-10-20T11:00:00Z'),
      }),
    )
    await SdInventoryTargetRepository.create({
      ...base(workspace.id, user.id, 'future'),
      nextRunAt: new Date('2026-10-20T13:00:00Z'),
    })
    await SdInventoryTargetRepository.create({
      ...base(workspace.id, user.id, 'off'),
      active: false,
    })
    const gone = expectOk(
      await SdInventoryTargetRepository.create(
        base(workspace.id, user.id, 'gone'),
      ),
    )
    await SdInventoryTargetRepository.softDelete(gone.id, workspace.id)

    const due = expectOk(await SdInventoryTargetRepository.listDue(now, 10))
    expect(due.map((t) => t.name).sort()).toEqual(['never', 'past'])
    expect(due.map((t) => t.id)).toEqual(
      expect.arrayContaining([never.id, past.id]),
    )
    expect(
      expectOk(await SdInventoryTargetRepository.listDue(now, 1)),
    ).toHaveLength(1)
  })

  it('records a scan result', async () => {
    const { workspace, user } = await setup()
    const target = expectOk(
      await SdInventoryTargetRepository.create(base(workspace.id, user.id)),
    )
    const lastRunAt = new Date('2026-10-20T12:00:00Z')
    const nextRunAt = new Date('2026-10-21T12:00:00Z')
    expectOk(
      await SdInventoryTargetRepository.markRun(target.id, {
        lastRunAt,
        nextRunAt,
        lastStatus: 'PARTIAL',
        lastFound: 3,
        lastError: '1 falha',
      }),
    )
    const reloaded = expectOk(
      await SdInventoryTargetRepository.findById(target.id, workspace.id),
    )
    expect(reloaded).toMatchObject({
      lastStatus: 'PARTIAL',
      lastFound: 3,
      lastError: '1 falha',
      lastRunAt,
      nextRunAt,
    })
  })
})

describe('SdInventoryDeviceRepository', () => {
  it('upserts by the stable key and finds it back', async () => {
    const { workspace, other } = await setup()
    const first = expectOk(
      await SdInventoryDeviceRepository.upsert(
        workspace.id,
        'agent:a',
        writeData(),
      ),
    )
    expect(first).toMatchObject({
      hostname: 'PC-01',
      configItemId: null,
      _count: { alerts: 0 },
    })

    const again = expectOk(
      await SdInventoryDeviceRepository.upsert(
        workspace.id,
        'agent:a',
        writeData({ hostname: 'PC-RENAMED' }),
      ),
    )
    expect(again.id).toBe(first.id)
    expect(again.hostname).toBe('PC-RENAMED')

    expect(
      expectOk(
        await SdInventoryDeviceRepository.findByKey(workspace.id, 'agent:a'),
      )?.id,
    ).toBe(first.id)
    expect(
      expectOk(
        await SdInventoryDeviceRepository.findByKey(other.id, 'agent:a'),
      ),
    ).toBeNull()
    // Mesma chave em outro workspace é outro equipamento.
    const elsewhere = expectOk(
      await SdInventoryDeviceRepository.upsert(
        other.id,
        'agent:a',
        writeData(),
      ),
    )
    expect(elsewhere.id).not.toBe(first.id)
  })

  it('loads the detail with software, alerts and the CMDB item', async () => {
    const { workspace, other, user } = await setup()
    const item = await seedSdConfigItem(workspace.id, user.id, {
      name: 'PC-01',
    })
    const device = expectOk(
      await SdInventoryDeviceRepository.upsert(
        workspace.id,
        'agent:a',
        writeData(),
      ),
    )
    expectOk(
      await SdInventoryDeviceRepository.linkConfigItem(device.id, item.id),
    )
    expectOk(
      await SdInventoryDeviceRepository.replaceSoftware(device.id, [
        { name: 'Zed', version: '1', publisher: null },
        { name: 'Alpha', version: '2', publisher: 'Acme' },
      ]),
    )
    await SdInventoryAlertRepository.apply(workspace.id, device.id, [
      {
        kind: 'DISK',
        mount: 'C:',
        usedPercent: 95,
        threshold: 90,
        breached: true,
      },
    ])

    const detail = expectOk(
      await SdInventoryDeviceRepository.findById(device.id, workspace.id),
    )
    expect(detail.configItem?.name).toBe('PC-01')
    expect(detail.software.map((s) => s.name)).toEqual(['Alpha', 'Zed'])
    expect(detail.alerts).toHaveLength(1)
    expect(detail._count.alerts).toBe(1)
    expectErr(
      await SdInventoryDeviceRepository.findById(device.id, other.id),
      'SD_INVENTORY_DEVICE_NOT_FOUND',
    )
  })

  it('replaces the software list, skipping duplicates and accepting an empty list', async () => {
    const { workspace } = await setup()
    const device = expectOk(
      await SdInventoryDeviceRepository.upsert(
        workspace.id,
        'agent:a',
        writeData(),
      ),
    )
    const count = expectOk(
      await SdInventoryDeviceRepository.replaceSoftware(device.id, [
        { name: 'A', version: '1', publisher: null },
        { name: 'A', version: '1', publisher: null },
        { name: 'B', version: '', publisher: null },
      ]),
    )
    expect(count).toBe(2)
    expect(
      expectOk(
        await SdInventoryDeviceRepository.replaceSoftware(device.id, []),
      ),
    ).toBe(0)
    expect(
      await prisma.sdInventorySoftware.count({
        where: { deviceId: device.id },
      }),
    ).toBe(0)
  })

  it('filters, searches and paginates the list', async () => {
    const { workspace, other } = await setup()
    const stale = new Date('2026-09-01T00:00:00Z')
    const staleBefore = new Date('2026-10-13T00:00:00Z')
    const a = expectOk(
      await SdInventoryDeviceRepository.upsert(
        workspace.id,
        'agent:a',
        writeData({ hostname: 'alpha', lastSeenAt: stale }),
      ),
    )
    expectOk(
      await SdInventoryDeviceRepository.upsert(
        workspace.id,
        'agent:b',
        writeData({
          hostname: 'beta',
          serialNumber: 'XYZ-9',
          ipAddresses: ['192.168.0.5'],
          osName: 'Ubuntu',
        }),
      ),
    )
    expectOk(
      await SdInventoryDeviceRepository.upsert(
        workspace.id,
        'snmp:c',
        writeData({ hostname: 'gamma', source: 'SNMP' }),
      ),
    )
    expectOk(
      await SdInventoryDeviceRepository.upsert(
        other.id,
        'agent:z',
        writeData({ hostname: 'other-ws' }),
      ),
    )
    await SdInventoryAlertRepository.apply(workspace.id, a.id, [
      {
        kind: 'RAM',
        mount: '',
        usedPercent: 99,
        threshold: 90,
        breached: true,
      },
    ])

    const list = async (filters: Record<string, unknown> = {}) =>
      expectOk(
        await SdInventoryDeviceRepository.list(
          workspace.id,
          { page: 1, pageSize: 25, ...filters },
          staleBefore,
        ),
      )

    const all = await list()
    expect(all.total).toBe(3)
    expect(all.items.map((d) => d.hostname)).toEqual(['alpha', 'beta', 'gamma'])
    expect(
      (await list({ source: 'SNMP' })).items.map((d) => d.hostname),
    ).toEqual(['gamma'])
    expect(
      (await list({ hasAlert: true })).items.map((d) => d.hostname),
    ).toEqual(['alpha'])
    expect((await list({ stale: true })).items.map((d) => d.hostname)).toEqual([
      'alpha',
    ])
    expect(
      (await list({ search: 'BET' })).items.map((d) => d.hostname),
    ).toEqual(['beta'])
    expect(
      (await list({ search: 'xyz-9' })).items.map((d) => d.hostname),
    ).toEqual(['beta'])
    expect(
      (await list({ search: 'ubuntu' })).items.map((d) => d.hostname),
    ).toEqual(['beta'])
    expect(
      (await list({ search: '192.168.0.5' })).items.map((d) => d.hostname),
    ).toEqual(['beta'])
    const page2 = await list({ page: 2, pageSize: 2 })
    expect(page2.items.map((d) => d.hostname)).toEqual(['gamma'])
    expect(page2.total).toBe(3)
  })

  it('summarizes the workspace', async () => {
    const { workspace } = await setup()
    const staleBefore = new Date('2026-10-13T00:00:00Z')
    const a = expectOk(
      await SdInventoryDeviceRepository.upsert(
        workspace.id,
        'agent:a',
        writeData({ lastSeenAt: new Date('2026-09-01T00:00:00Z') }),
      ),
    )
    expectOk(
      await SdInventoryDeviceRepository.upsert(
        workspace.id,
        'snmp:b',
        writeData({ source: 'SNMP' }),
      ),
    )
    await SdInventoryAlertRepository.apply(workspace.id, a.id, [
      {
        kind: 'DISK',
        mount: 'C:',
        usedPercent: 95,
        threshold: 90,
        breached: true,
      },
    ])
    expect(
      expectOk(
        await SdInventoryDeviceRepository.summary(workspace.id, staleBefore),
      ),
    ).toEqual({
      total: 2,
      agents: 1,
      snmp: 1,
      discovered: 0,
      stale: 1,
      openAlerts: 1,
    })
  })

  it('groups the software catalog by name and version', async () => {
    const { workspace, other } = await setup()
    const [d1, d2, d3] = await Promise.all([
      SdInventoryDeviceRepository.upsert(workspace.id, 'agent:a', writeData()),
      SdInventoryDeviceRepository.upsert(workspace.id, 'agent:b', writeData()),
      SdInventoryDeviceRepository.upsert(other.id, 'agent:c', writeData()),
    ])
    const [a, b, c] = [expectOk(d1), expectOk(d2), expectOk(d3)]
    const ff = { name: 'Firefox', version: '130', publisher: 'Mozilla' }
    await SdInventoryDeviceRepository.replaceSoftware(a.id, [
      ff,
      { name: 'Zoom', version: '5', publisher: null },
    ])
    await SdInventoryDeviceRepository.replaceSoftware(b.id, [
      ff,
      { ...ff, version: '131' },
    ])
    await SdInventoryDeviceRepository.replaceSoftware(c.id, [ff])

    const all = expectOk(
      await SdInventoryDeviceRepository.listSoftware(workspace.id, {
        page: 1,
        pageSize: 10,
      }),
    )
    expect(all.total).toBe(3)
    expect(all.items).toEqual([
      { name: 'Firefox', version: '130', publisher: 'Mozilla', deviceCount: 2 },
      { name: 'Firefox', version: '131', publisher: 'Mozilla', deviceCount: 1 },
      { name: 'Zoom', version: '5', publisher: null, deviceCount: 1 },
    ])
    const searched = expectOk(
      await SdInventoryDeviceRepository.listSoftware(workspace.id, {
        search: 'zoo',
        page: 1,
        pageSize: 10,
      }),
    )
    expect(searched.items.map((i) => i.name)).toEqual(['Zoom'])
    const page2 = expectOk(
      await SdInventoryDeviceRepository.listSoftware(workspace.id, {
        page: 2,
        pageSize: 2,
      }),
    )
    expect(page2.items.map((i) => i.name)).toEqual(['Zoom'])
  })

  it('finds adoptable CMDB items by serial only when free, alive and in the workspace', async () => {
    const { workspace, other, user } = await setup()
    const free = await seedSdConfigItem(workspace.id, user.id, {
      serialNumber: 'ABC-123',
    })
    expect(
      expectOk(
        await SdInventoryDeviceRepository.findAdoptableConfigItem(
          workspace.id,
          'abc-123',
        ),
      )?.id,
    ).toBe(free.id)
    expect(
      expectOk(
        await SdInventoryDeviceRepository.findAdoptableConfigItem(
          other.id,
          'abc-123',
        ),
      ),
    ).toBeNull()

    const device = expectOk(
      await SdInventoryDeviceRepository.upsert(
        workspace.id,
        'agent:a',
        writeData(),
      ),
    )
    expectOk(
      await SdInventoryDeviceRepository.linkConfigItem(device.id, free.id),
    )
    expect(
      expectOk(
        await SdInventoryDeviceRepository.findAdoptableConfigItem(
          workspace.id,
          'ABC-123',
        ),
      ),
    ).toBeNull()

    await seedSdConfigItem(workspace.id, user.id, {
      serialNumber: 'DEL-1',
      deletedAt: new Date(),
    })
    expect(
      expectOk(
        await SdInventoryDeviceRepository.findAdoptableConfigItem(
          workspace.id,
          'DEL-1',
        ),
      ),
    ).toBeNull()
  })

  it('finds or creates the CMDB type by exact name, once', async () => {
    const { workspace, other } = await setup()
    const first = expectOk(
      await SdInventoryDeviceRepository.ensureConfigItemType(
        workspace.id,
        'Computador',
      ),
    )
    const second = expectOk(
      await SdInventoryDeviceRepository.ensureConfigItemType(
        workspace.id,
        'Computador',
      ),
    )
    expect(second.id).toBe(first.id)
    const existing = await seedSdConfigItemType(other.id, {
      name: 'Computador',
    })
    expect(
      expectOk(
        await SdInventoryDeviceRepository.ensureConfigItemType(
          other.id,
          'Computador',
        ),
      ).id,
    ).toBe(existing.id)
    expect(
      await prisma.sdConfigItemType.count({
        where: { workspaceId: workspace.id },
      }),
    ).toBe(1)
  })

  it('unlinks the CMDB item when it is hard deleted', async () => {
    const { workspace, user } = await setup()
    const item = await seedSdConfigItem(workspace.id, user.id)
    const device = await seedSdInventoryDevice({
      workspaceId: workspace.id,
      configItemId: item.id,
    })
    await prisma.sdConfigItem.delete({ where: { id: item.id } })
    const reloaded = await prisma.sdInventoryDevice.findUnique({
      where: { id: device.id },
    })
    expect(reloaded?.configItemId).toBeNull()
  })
})

describe('SdInventoryAlertRepository.apply', () => {
  const breached = (mount: string, usedPercent = 95) => ({
    kind: 'DISK' as const,
    mount,
    usedPercent,
    threshold: 90,
    breached: true,
  })
  const ok90 = (mount: string, usedPercent = 40) => ({
    ...breached(mount, usedPercent),
    breached: false,
  })

  async function device() {
    const { workspace } = await setup()
    const d = expectOk(
      await SdInventoryDeviceRepository.upsert(
        workspace.id,
        'agent:a',
        writeData(),
      ),
    )
    return { workspace, d }
  }

  it('opens, updates, resolves and reopens an alert', async () => {
    const { workspace, d } = await device()

    expect(
      expectOk(
        await SdInventoryAlertRepository.apply(workspace.id, d.id, [
          breached('C:'),
        ]),
      ),
    ).toEqual({
      opened: 1,
      resolved: 0,
    })
    // Mesmo estado: só atualiza o percentual, sem "abrir" de novo.
    expect(
      expectOk(
        await SdInventoryAlertRepository.apply(workspace.id, d.id, [
          breached('C:', 97),
        ]),
      ),
    ).toEqual({
      opened: 0,
      resolved: 0,
    })
    expect(
      await prisma.sdInventoryAlert.findFirst({ where: { deviceId: d.id } }),
    ).toMatchObject({
      status: 'OPEN',
      usedPercent: 97,
    })

    expect(
      expectOk(
        await SdInventoryAlertRepository.apply(workspace.id, d.id, [
          ok90('C:'),
        ]),
      ),
    ).toEqual({
      opened: 0,
      resolved: 1,
    })
    const resolved = await prisma.sdInventoryAlert.findFirst({
      where: { deviceId: d.id },
    })
    expect(resolved).toMatchObject({ status: 'RESOLVED', usedPercent: 40 })
    expect(resolved?.resolvedAt).toBeInstanceOf(Date)

    // Normalizado de novo: nada a resolver.
    expect(
      expectOk(
        await SdInventoryAlertRepository.apply(workspace.id, d.id, [
          ok90('C:'),
        ]),
      ),
    ).toEqual({
      opened: 0,
      resolved: 0,
    })

    expect(
      expectOk(
        await SdInventoryAlertRepository.apply(workspace.id, d.id, [
          breached('C:'),
        ]),
      ),
    ).toEqual({
      opened: 1,
      resolved: 0,
    })
    expect(
      await prisma.sdInventoryAlert.findFirst({ where: { deviceId: d.id } }),
    ).toMatchObject({
      status: 'OPEN',
      resolvedAt: null,
    })
  })

  it('does not create an alert for a candidate that never breached', async () => {
    const { workspace, d } = await device()
    expect(
      expectOk(
        await SdInventoryAlertRepository.apply(workspace.id, d.id, [
          ok90('C:'),
        ]),
      ),
    ).toEqual({
      opened: 0,
      resolved: 0,
    })
    expect(
      await prisma.sdInventoryAlert.count({ where: { deviceId: d.id } }),
    ).toBe(0)
  })

  it('resolves an open alert whose volume disappeared, and tracks disk and RAM apart', async () => {
    const { workspace, d } = await device()
    const ram = {
      kind: 'RAM' as const,
      mount: '',
      usedPercent: 99,
      threshold: 90,
      breached: true,
    }
    expectOk(
      await SdInventoryAlertRepository.apply(workspace.id, d.id, [
        breached('C:'),
        breached('D:'),
        ram,
      ]),
    )
    expect(
      await prisma.sdInventoryAlert.count({
        where: { deviceId: d.id, status: 'OPEN' },
      }),
    ).toBe(3)

    const result = expectOk(
      await SdInventoryAlertRepository.apply(workspace.id, d.id, [
        breached('C:'),
      ]),
    )
    expect(result).toEqual({ opened: 0, resolved: 2 })
    const open = await prisma.sdInventoryAlert.findMany({
      where: { deviceId: d.id, status: 'OPEN' },
    })
    expect(open.map((a) => a.mount)).toEqual(['C:'])
  })

  it('lists with filters, newest state first, and the hostname', async () => {
    const { workspace, d } = await device()
    const ram = {
      kind: 'RAM' as const,
      mount: '',
      usedPercent: 99,
      threshold: 90,
      breached: true,
    }
    expectOk(
      await SdInventoryAlertRepository.apply(workspace.id, d.id, [
        breached('C:'),
        ram,
      ]),
    )
    expectOk(
      await SdInventoryAlertRepository.apply(workspace.id, d.id, [
        ok90('C:'),
        ram,
      ]),
    )

    const all = expectOk(
      await SdInventoryAlertRepository.list(workspace.id, { limit: 10 }),
    )
    expect(all).toHaveLength(2)
    expect(all[0]?.device.hostname).toBe('PC-01')
    expect(
      expectOk(
        await SdInventoryAlertRepository.list(workspace.id, {
          status: 'OPEN',
          limit: 10,
        }),
      ),
    ).toHaveLength(1)
    expect(
      expectOk(
        await SdInventoryAlertRepository.list(workspace.id, {
          kind: 'DISK',
          limit: 10,
        }),
      )[0]?.mount,
    ).toBe('C:')
    expect(
      expectOk(
        await SdInventoryAlertRepository.list(workspace.id, {
          deviceId: 'nope',
          limit: 10,
        }),
      ),
    ).toHaveLength(0)
    expect(
      expectOk(
        await SdInventoryAlertRepository.list(workspace.id, { limit: 1 }),
      ),
    ).toHaveLength(1)
  })
})
