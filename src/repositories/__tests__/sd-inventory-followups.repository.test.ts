import { describe, expect, it } from 'vitest'
import { seedSdInventoryDevice } from '@/src/__tests__/factories/nov-s1-asset-inventory.factory'
import { seedSdConfigItem } from '@/src/__tests__/factories/sd-config-item.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { SdInventoryAlertRepository } from '../sd-inventory-alert.repository'
import { SdInventoryDeviceRepository } from '../sd-inventory-device.repository'
import { SdInventoryDiscoveryRangeRepository } from '../sd-inventory-discovery-range.repository'
import { SdInventoryReleaseRepository } from '../sd-inventory-release.repository'
import { SdInventorySettingsRepository } from '../sd-inventory-settings.repository'

async function setup() {
  const [workspace, other, user] = await Promise.all([
    seedWorkspace(),
    seedWorkspace(),
    seedUser(),
  ])
  return { workspace, other, user }
}

const staleBefore = new Date('2026-10-13T00:00:00Z')

describe('device listing, discovery and summary', () => {
  it('lists only managed, primary devices and the discovered ones on demand', async () => {
    const { workspace } = await setup()
    const main = await seedSdInventoryDevice({
      workspaceId: workspace.id,
      hostname: 'main',
    })
    await seedSdInventoryDevice({
      workspaceId: workspace.id,
      hostname: 'secondary',
      source: 'SNMP',
      mergedIntoId: main.id,
    })
    await seedSdInventoryDevice({
      workspaceId: workspace.id,
      hostname: 'found',
      source: 'DISCOVERY',
      managed: false,
    })
    await seedSdInventoryDevice({
      workspaceId: workspace.id,
      hostname: 'dismissed',
      source: 'DISCOVERY',
      managed: false,
      ignored: true,
    })

    const managed = expectOk(
      await SdInventoryDeviceRepository.list(
        workspace.id,
        { page: 1, pageSize: 10 },
        staleBefore,
      ),
    )
    expect(managed.items.map((d) => d.hostname)).toEqual(['main'])

    const discovered = expectOk(
      await SdInventoryDeviceRepository.list(
        workspace.id,
        { page: 1, pageSize: 10, discovered: true },
        staleBefore,
      ),
    )
    expect(discovered.items.map((d) => d.hostname)).toEqual(['found'])

    expect(
      expectOk(
        await SdInventoryDeviceRepository.summary(workspace.id, staleBefore),
      ),
    ).toMatchObject({ total: 1, agents: 1, snmp: 0, discovered: 1 })
  })

  it('does not count secondary devices in alerts, and the detail carries the merge', async () => {
    const { workspace } = await setup()
    const main = await seedSdInventoryDevice({ workspaceId: workspace.id })
    const secondary = await seedSdInventoryDevice({
      workspaceId: workspace.id,
      source: 'SNMP',
      mergedIntoId: main.id,
      hostname: 'sw',
    })
    await SdInventoryAlertRepository.apply(workspace.id, secondary.id, [
      {
        kind: 'RAM',
        mount: '',
        usedPercent: 99,
        threshold: 90,
        breached: true,
      },
    ])
    expect(
      expectOk(
        await SdInventoryDeviceRepository.summary(workspace.id, staleBefore),
      ).openAlerts,
    ).toBe(0)

    const detail = expectOk(
      await SdInventoryDeviceRepository.findById(main.id, workspace.id),
    )
    expect(detail.mergedFrom).toEqual([
      { id: secondary.id, hostname: 'sw', source: 'SNMP' },
    ])
    const child = expectOk(
      await SdInventoryDeviceRepository.findById(secondary.id, workspace.id),
    )
    expect(child.mergedInto?.hostname).toBe(main.hostname)
  })

  it('keeps unmanaged devices out of the software catalog', async () => {
    const { workspace } = await setup()
    const found = await seedSdInventoryDevice({
      workspaceId: workspace.id,
      source: 'DISCOVERY',
      managed: false,
    })
    await SdInventoryDeviceRepository.replaceSoftware(found.id, [
      { name: 'Hidden', version: '1', publisher: null },
    ])
    expect(
      expectOk(
        await SdInventoryDeviceRepository.listSoftware(workspace.id, {
          page: 1,
          pageSize: 10,
        }),
      ).total,
    ).toBe(0)
  })

  it('creates a device unmanaged only on creation, never flipping it back on update', async () => {
    const { workspace } = await setup()
    const data = {
      source: 'DISCOVERY' as const,
      hostname: 'host',
      osName: null,
      osVersion: null,
      arch: null,
      manufacturer: null,
      model: null,
      serialNumber: null,
      cpuModel: null,
      cpuCores: null,
      ramTotalMb: null,
      ramUsedMb: null,
      ipAddresses: ['10.0.1.5'],
      macAddresses: [],
      disks: [],
      agentVersion: null,
      snmpTargetId: null,
      tokenId: null,
      lastSeenAt: new Date(),
    }
    const created = expectOk(
      await SdInventoryDeviceRepository.upsert(
        workspace.id,
        'disc:ip:10.0.1.5',
        data,
        {
          managed: false,
          discoveryRangeId: null,
        },
      ),
    )
    expect(created.managed).toBe(false)

    expectOk(await SdInventoryDeviceRepository.markManaged(created.id))
    const again = expectOk(
      await SdInventoryDeviceRepository.upsert(
        workspace.id,
        'disc:ip:10.0.1.5',
        data,
        {
          managed: false,
          discoveryRangeId: null,
        },
      ),
    )
    expect(again.managed).toBe(true)

    const defaults = expectOk(
      await SdInventoryDeviceRepository.upsert(workspace.id, 'agent:new', {
        ...data,
        source: 'AGENT',
      }),
    )
    expect(defaults.managed).toBe(true)
  })

  it('dismisses a device in its own workspace only', async () => {
    const { workspace, other } = await setup()
    const found = await seedSdInventoryDevice({
      workspaceId: workspace.id,
      source: 'DISCOVERY',
      managed: false,
    })
    expectErr(
      await SdInventoryDeviceRepository.markIgnored(found.id, other.id),
      'SD_CONFIG_NOT_FOUND',
    )
    expectOk(
      await SdInventoryDeviceRepository.markIgnored(found.id, workspace.id),
    )
    expect(
      (await prisma.sdInventoryDevice.findUnique({ where: { id: found.id } }))
        ?.ignored,
    ).toBe(true)
  })

  it('finds a device in any state by id, scoped to the workspace', async () => {
    const { workspace, other } = await setup()
    const found = await seedSdInventoryDevice({
      workspaceId: workspace.id,
      source: 'DISCOVERY',
      managed: false,
    })
    expectOk(
      await SdInventoryDeviceRepository.findRowById(found.id, workspace.id),
    )
    expectErr(
      await SdInventoryDeviceRepository.findRowById(found.id, other.id),
      'SD_INVENTORY_DEVICE_NOT_FOUND',
    )
  })

  it('updates the facts of a primary', async () => {
    const { workspace } = await setup()
    const device = await seedSdInventoryDevice({ workspaceId: workspace.id })
    expectOk(
      await SdInventoryDeviceRepository.updateFacts(device.id, {
        serialNumber: 'SN-9',
        ipAddresses: ['10.0.0.1', '10.0.0.2'],
      }),
    )
    const row = await prisma.sdInventoryDevice.findUniqueOrThrow({
      where: { id: device.id },
    })
    expect(row.serialNumber).toBe('SN-9')
    expect(row.ipAddresses).toEqual(['10.0.0.1', '10.0.0.2'])
  })
})

describe('known addresses', () => {
  it('knows IPs and MACs of agent or SNMP devices, not of discovered ones', async () => {
    const { workspace, other } = await setup()
    await seedSdInventoryDevice({
      workspaceId: workspace.id,
      ipAddresses: ['10.0.0.20'],
      macAddresses: ['aa:bb:cc:dd:ee:ff'],
    })
    await seedSdInventoryDevice({
      workspaceId: workspace.id,
      source: 'DISCOVERY',
      managed: false,
      ipAddresses: ['10.0.0.99'],
    })
    const known = (ip: string, mac: string | null, ws = workspace.id) =>
      SdInventoryDeviceRepository.existsKnownAddress(ws, { ip, mac }).then(
        expectOk,
      )
    expect(await known('10.0.0.20', null)).toBe(true)
    expect(await known('10.0.0.77', 'aa:bb:cc:dd:ee:ff')).toBe(true)
    expect(await known('10.0.0.99', null)).toBe(false)
    expect(await known('10.0.0.77', null)).toBe(false)
    expect(await known('10.0.0.20', null, other.id)).toBe(false)
  })
})

describe('merge candidates and merging', () => {
  it('finds principals by serial, MAC or hostname prefix, ignoring itself and secondaries', async () => {
    const { workspace, other } = await setup()
    const me = await seedSdInventoryDevice({
      workspaceId: workspace.id,
      hostname: 'me',
    })
    const bySerial = await seedSdInventoryDevice({
      workspaceId: workspace.id,
      source: 'SNMP',
      serialNumber: 'sn-777',
    })
    const byMac = await seedSdInventoryDevice({
      workspaceId: workspace.id,
      source: 'SNMP',
      macAddresses: ['11:22:33:44:55:66'],
    })
    const byName = await seedSdInventoryDevice({
      workspaceId: workspace.id,
      source: 'SNMP',
      hostname: 'PC-RECEPCAO.empresa.local',
    })
    await seedSdInventoryDevice({
      workspaceId: workspace.id,
      source: 'SNMP',
      serialNumber: 'sn-777',
      mergedIntoId: bySerial.id,
    })
    await seedSdInventoryDevice({
      workspaceId: other.id,
      source: 'SNMP',
      serialNumber: 'SN-777',
    })

    const found = expectOk(
      await SdInventoryDeviceRepository.findMergeCandidates(workspace.id, {
        id: me.id,
        serialNumber: 'SN-777',
        macAddresses: ['11:22:33:44:55:66'],
        hostnameLabel: 'pc-recepcao',
      }),
    )
    expect(found.map((d) => d.id).sort()).toEqual(
      [bySerial.id, byMac.id, byName.id].sort(),
    )
  })

  it('returns nothing without any key to search on', async () => {
    const { workspace } = await setup()
    expect(
      expectOk(
        await SdInventoryDeviceRepository.findMergeCandidates(workspace.id, {
          id: 'x',
          serialNumber: null,
          macAddresses: [],
          hostnameLabel: null,
        }),
      ),
    ).toEqual([])
  })

  it('moves the CMDB item to the primary and re-points the secondary children', async () => {
    const { workspace, user } = await setup()
    const item = await seedSdConfigItem(workspace.id, user.id)
    const primary = await seedSdInventoryDevice({ workspaceId: workspace.id })
    const secondary = await seedSdInventoryDevice({
      workspaceId: workspace.id,
      source: 'SNMP',
      configItemId: item.id,
    })
    const child = await seedSdInventoryDevice({
      workspaceId: workspace.id,
      source: 'DISCOVERY',
      mergedIntoId: secondary.id,
    })

    const result = expectOk(
      await SdInventoryDeviceRepository.mergeInto(
        workspace.id,
        secondary.id,
        primary.id,
        { lock: false },
      ),
    )
    expect(result).toEqual({
      movedConfigItemId: item.id,
      orphanedConfigItemId: null,
    })
    const rows = await prisma.sdInventoryDevice.findMany({
      where: { workspaceId: workspace.id },
    })
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]))
    expect(byId[primary.id]?.configItemId).toBe(item.id)
    expect(byId[secondary.id]).toMatchObject({
      configItemId: null,
      mergedIntoId: primary.id,
    })
    expect(byId[child.id]?.mergedIntoId).toBe(primary.id)
  })

  it('leaves the secondary item orphaned when the primary already has one', async () => {
    const { workspace, user } = await setup()
    const [keep, spare] = await Promise.all([
      seedSdConfigItem(workspace.id, user.id),
      seedSdConfigItem(workspace.id, user.id),
    ])
    const primary = await seedSdInventoryDevice({
      workspaceId: workspace.id,
      configItemId: keep.id,
    })
    const secondary = await seedSdInventoryDevice({
      workspaceId: workspace.id,
      source: 'SNMP',
      configItemId: spare.id,
    })
    expect(
      expectOk(
        await SdInventoryDeviceRepository.mergeInto(
          workspace.id,
          secondary.id,
          primary.id,
          { lock: false },
        ),
      ),
    ).toEqual({ movedConfigItemId: null, orphanedConfigItemId: spare.id })
    expect(
      (
        await prisma.sdInventoryDevice.findUniqueOrThrow({
          where: { id: primary.id },
        })
      ).configItemId,
    ).toBe(keep.id)
  })

  it('merges devices that have no CMDB item', async () => {
    const { workspace } = await setup()
    const primary = await seedSdInventoryDevice({ workspaceId: workspace.id })
    const secondary = await seedSdInventoryDevice({
      workspaceId: workspace.id,
      source: 'SNMP',
    })
    expect(
      expectOk(
        await SdInventoryDeviceRepository.mergeInto(
          workspace.id,
          secondary.id,
          primary.id,
          { lock: true },
        ),
      ),
    ).toEqual({ movedConfigItemId: null, orphanedConfigItemId: null })
    expect(
      expectOk(
        await SdInventoryDeviceRepository.listMergedInto(
          workspace.id,
          primary.id,
        ),
      ),
    ).toHaveLength(1)
  })

  it('unmerges and locks automatic merging', async () => {
    const { workspace, other } = await setup()
    const primary = await seedSdInventoryDevice({ workspaceId: workspace.id })
    const secondary = await seedSdInventoryDevice({
      workspaceId: workspace.id,
      source: 'SNMP',
      mergedIntoId: primary.id,
    })
    expectErr(
      await SdInventoryDeviceRepository.unmerge(other.id, secondary.id),
      'SD_CONFIG_NOT_FOUND',
    )
    const freed = expectOk(
      await SdInventoryDeviceRepository.unmerge(workspace.id, secondary.id),
    )
    expect(freed).toMatchObject({ mergedIntoId: null, mergeLocked: true })
  })

  it('an item whose primary is deleted reappears as its own device', async () => {
    const { workspace } = await setup()
    const primary = await seedSdInventoryDevice({ workspaceId: workspace.id })
    const secondary = await seedSdInventoryDevice({
      workspaceId: workspace.id,
      source: 'SNMP',
      mergedIntoId: primary.id,
    })
    await prisma.sdInventoryDevice.delete({ where: { id: primary.id } })
    expect(
      (
        await prisma.sdInventoryDevice.findUniqueOrThrow({
          where: { id: secondary.id },
        })
      ).mergedIntoId,
    ).toBeNull()
  })
})

describe('SdInventoryDiscoveryRangeRepository', () => {
  it('creates, lists, finds and soft deletes within the workspace', async () => {
    const { workspace, other, user } = await setup()
    const range = expectOk(
      await SdInventoryDiscoveryRangeRepository.create({
        workspaceId: workspace.id,
        createdById: user.id,
        name: 'VLAN',
        cidr: '10.0.1.0/24',
      }),
    )
    expect(range.enabled).toBe(false)
    expect(
      expectOk(await SdInventoryDiscoveryRangeRepository.list(workspace.id)),
    ).toHaveLength(1)
    expect(
      expectOk(await SdInventoryDiscoveryRangeRepository.list(other.id)),
    ).toHaveLength(0)
    expectOk(
      await SdInventoryDiscoveryRangeRepository.findById(
        range.id,
        workspace.id,
      ),
    )
    expectErr(
      await SdInventoryDiscoveryRangeRepository.findById(range.id, other.id),
      'SD_INVENTORY_DISCOVERY_RANGE_NOT_FOUND',
    )
    expect(
      expectOk(
        await SdInventoryDiscoveryRangeRepository.findByIdUnscoped(range.id),
      ),
    ).not.toBeNull()

    const updated = expectOk(
      await SdInventoryDiscoveryRangeRepository.update(range.id, workspace.id, {
        enabled: true,
        name: 'VLAN 2',
      }),
    )
    expect(updated).toMatchObject({ enabled: true, name: 'VLAN 2' })
    expectErr(
      await SdInventoryDiscoveryRangeRepository.update(range.id, other.id, {
        name: 'x',
      }),
      'SD_CONFIG_NOT_FOUND',
    )

    expectOk(
      await SdInventoryDiscoveryRangeRepository.softDelete(
        range.id,
        workspace.id,
      ),
    )
    expect(
      expectOk(await SdInventoryDiscoveryRangeRepository.list(workspace.id)),
    ).toHaveLength(0)
    expect(
      expectOk(
        await SdInventoryDiscoveryRangeRepository.findByIdUnscoped(range.id),
      ),
    ).toBeNull()
    const deleted = await prisma.sdInventoryDiscoveryRange.findUniqueOrThrow({
      where: { id: range.id },
    })
    expect(deleted.enabled).toBe(false)
  })

  it('lists as due only enabled ranges whose time has come', async () => {
    const { workspace, user } = await setup()
    const base = {
      workspaceId: workspace.id,
      createdById: user.id,
      cidr: '10.0.1.0/24',
    }
    const now = new Date('2026-10-20T12:00:00Z')
    const make = (name: string, data: object) =>
      SdInventoryDiscoveryRangeRepository.create({ ...base, name, ...data })
    await make('never-run', { enabled: true })
    await make('due', {
      enabled: true,
      nextRunAt: new Date('2026-10-20T11:00:00Z'),
    })
    await make('later', {
      enabled: true,
      nextRunAt: new Date('2026-10-21T00:00:00Z'),
    })
    await make('opted-out', { enabled: false })

    const due = expectOk(
      await SdInventoryDiscoveryRangeRepository.listDue(now, 10),
    )
    expect(due.map((r) => r.name).sort()).toEqual(['due', 'never-run'])
    expect(
      expectOk(await SdInventoryDiscoveryRangeRepository.listDue(now, 1)),
    ).toHaveLength(1)
  })

  it('records the outcome of a run', async () => {
    const { workspace, user } = await setup()
    const range = expectOk(
      await SdInventoryDiscoveryRangeRepository.create({
        workspaceId: workspace.id,
        createdById: user.id,
        name: 'VLAN',
        cidr: '10.0.1.0/24',
      }),
    )
    const runAt = new Date('2026-10-20T12:00:00Z')
    expectOk(
      await SdInventoryDiscoveryRangeRepository.markRun(range.id, {
        lastRunAt: runAt,
        nextRunAt: new Date('2026-10-21T12:00:00Z'),
        lastStatus: 'PARTIAL',
        lastProbed: 254,
        lastFound: 7,
        lastError: '1 falha',
      }),
    )
    expect(
      await prisma.sdInventoryDiscoveryRange.findUniqueOrThrow({
        where: { id: range.id },
      }),
    ).toMatchObject({
      lastStatus: 'PARTIAL',
      lastProbed: 254,
      lastFound: 7,
      lastError: '1 falha',
    })
  })
})

describe('SdInventoryReleaseRepository', () => {
  const release = (version: string, os = 'linux', arch = 'amd64') => ({
    version,
    os,
    arch,
    sha256: 'a'.repeat(64),
    sizeBytes: 10,
    storageKey: `${version}/agent-${os}-${arch}`,
  })

  it('serves the most recent active release per platform', async () => {
    const first = expectOk(
      await SdInventoryReleaseRepository.upsert(release('1.0.0')),
    )
    await new Promise((resolve) => setTimeout(resolve, 5))
    expectOk(await SdInventoryReleaseRepository.upsert(release('1.1.0')))
    expectOk(
      await SdInventoryReleaseRepository.upsert(release('1.1.0', 'windows')),
    )

    expect(
      expectOk(await SdInventoryReleaseRepository.findLatest('linux', 'amd64'))
        ?.version,
    ).toBe('1.1.0')
    expect(
      expectOk(await SdInventoryReleaseRepository.findLatest('linux', 'arm64')),
    ).toBeNull()
    expect(
      expectOk(
        await SdInventoryReleaseRepository.findExact('1.0.0', 'linux', 'amd64'),
      )?.id,
    ).toBe(first.id)
    expect(
      expectOk(
        await SdInventoryReleaseRepository.findExact('9.9.9', 'linux', 'amd64'),
      ),
    ).toBeNull()

    const latest = expectOk(
      await SdInventoryReleaseRepository.listLatestPerTarget(),
    )
    expect(latest.map((r) => `${r.os}:${r.version}`).sort()).toEqual([
      'linux:1.1.0',
      'windows:1.1.0',
    ])
  })

  it('republishing the same version replaces it and reactivates it', async () => {
    const original = expectOk(
      await SdInventoryReleaseRepository.upsert(release('2.0.0')),
    )
    await prisma.sdInventoryAgentRelease.update({
      where: { id: original.id },
      data: { active: false },
    })
    expect(
      expectOk(
        await SdInventoryReleaseRepository.findExact('2.0.0', 'linux', 'amd64'),
      ),
    ).toBeNull()
    const again = expectOk(
      await SdInventoryReleaseRepository.upsert({
        ...release('2.0.0'),
        sizeBytes: 99,
      }),
    )
    expect(again).toMatchObject({
      id: original.id,
      active: true,
      sizeBytes: 99,
    })
  })
})

describe('SdInventorySettingsRepository', () => {
  it('stores the agent auto update opt-in, off by default', async () => {
    const { workspace } = await setup()
    expect(
      expectOk(
        await SdInventorySettingsRepository.upsert(workspace.id, {
          staleAfterDays: 5,
        }),
      ).agentAutoUpdate,
    ).toBe(false)
    expect(
      expectOk(
        await SdInventorySettingsRepository.upsert(workspace.id, {
          agentAutoUpdate: true,
        }),
      ).agentAutoUpdate,
    ).toBe(true)
  })
})
