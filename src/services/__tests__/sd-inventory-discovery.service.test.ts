import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSdInventoryDiscoveryRange } from '@/src/__tests__/factories/nov-inventory-followups.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { actAs } from '@/src/__tests__/helpers/sd-config.helpers'
import { databaseError, sdInventoryDiscoveryRangeNotFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import type { DiscoveryDeps } from '@/src/lib/servicedesk/discovery'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/sd-access.repository')
vi.mock('@/src/repositories/sd-customer.repository')
vi.mock('@/src/repositories/sd-inventory-device.repository')
vi.mock('@/src/repositories/sd-inventory-discovery-range.repository')
vi.mock('../sd-inventory-sync.service')
vi.mock('@/src/lib/queue/queues', () => ({
  getServicedeskInventoryQueue: vi.fn(),
}))

import { getServicedeskInventoryQueue } from '@/src/lib/queue/queues'
import { SdCustomerRepository } from '@/src/repositories/sd-customer.repository'
import { SdInventoryDeviceRepository } from '@/src/repositories/sd-inventory-device.repository'
import { SdInventoryDiscoveryRangeRepository } from '@/src/repositories/sd-inventory-discovery-range.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import {
  discoveryExternalKey,
  SdInventoryDiscoveryService,
} from '../sd-inventory-discovery.service'
import { syncInventoryDevice } from '../sd-inventory-sync.service'

const ranges = vi.mocked(SdInventoryDiscoveryRangeRepository)
const devices = vi.mocked(SdInventoryDeviceRepository)
const customers = vi.mocked(SdCustomerRepository)
const sync = vi.mocked(syncInventoryDevice)
const moduleEnabled = vi.mocked(WorkspaceModuleAccessRepository.isEnabled)
const add = vi.fn()
const WS = 'ws1'
const NOW = new Date('2026-10-20T12:00:00.000Z')

const createDto = {
  name: 'VLAN de estações',
  cidr: '10.0.1.0/24',
  enabled: true,
  intervalMinutes: 1440,
}

function discovery(found: string[], arp = new Map<string, string>()) {
  return {
    probe: vi.fn(async (ip: string) => found.includes(ip)),
    readArp: vi.fn(async () => arp),
    reverse: vi.fn(async (ip: string) =>
      ip === '10.0.1.1' ? 'gw.local' : null,
    ),
    sleep: vi.fn(async () => {}),
    now: () => 0,
  } satisfies DiscoveryDeps
}

beforeEach(() => {
  actAs('owner')
  add.mockReset()
  vi.mocked(getServicedeskInventoryQueue).mockReturnValue({ add } as never)
  customers.findExistingIds.mockResolvedValue(ok(['cus-1']))
  ranges.list.mockResolvedValue(ok([createFakeSdInventoryDiscoveryRange()]))
  ranges.findById.mockResolvedValue(ok(createFakeSdInventoryDiscoveryRange()))
  ranges.findByIdUnscoped.mockResolvedValue(
    ok(createFakeSdInventoryDiscoveryRange({ cidr: '10.0.1.0/30' })),
  )
  ranges.create.mockResolvedValue(ok(createFakeSdInventoryDiscoveryRange()))
  ranges.update.mockResolvedValue(ok(createFakeSdInventoryDiscoveryRange()))
  ranges.softDelete.mockResolvedValue(ok(undefined))
  ranges.markRun.mockResolvedValue(ok(undefined))
  ranges.listDue.mockResolvedValue(ok([]))
  devices.existsKnownAddress.mockResolvedValue(ok(false))
  moduleEnabled.mockResolvedValue(ok(true))
  sync.mockResolvedValue(ok({} as never))
})

describe('discoveryExternalKey', () => {
  it('prefers the MAC and falls back to the IP', () => {
    expect(
      discoveryExternalKey({
        ip: '10.0.1.9',
        mac: 'aa:bb:cc:dd:ee:ff',
        hostname: null,
      }),
    ).toBe('disc:mac:aa:bb:cc:dd:ee:ff')
    expect(
      discoveryExternalKey({ ip: '10.0.1.9', mac: null, hostname: null }),
    ).toBe('disc:ip:10.0.1.9')
  })
})

describe('admin CRUD', () => {
  it('lists, creates (opt-in kept as sent) and schedules the first run only when enabled', async () => {
    expect(
      expectOk(await SdInventoryDiscoveryService.list('u1', WS)),
    ).toHaveLength(1)

    expectOk(await SdInventoryDiscoveryService.create('u1', WS, createDto))
    expect(ranges.create.mock.calls[0]?.[0]).toMatchObject({
      workspaceId: WS,
      createdById: 'u1',
      cidr: '10.0.1.0/24',
      enabled: true,
      customerId: null,
    })
    expect(ranges.create.mock.calls[0]?.[0].nextRunAt).toBeInstanceOf(Date)

    expectOk(
      await SdInventoryDiscoveryService.create('u1', WS, {
        ...createDto,
        enabled: false,
      }),
    )
    expect(ranges.create.mock.calls[1]?.[0].nextRunAt).toBeNull()
  })

  it('checks the customer, and propagates failures', async () => {
    customers.findExistingIds.mockResolvedValue(ok([]))
    expectErr(
      await SdInventoryDiscoveryService.create('u1', WS, {
        ...createDto,
        customerId: 'cus-x',
      }),
      'SD_CONFIG_NOT_FOUND',
    )
    ranges.create.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdInventoryDiscoveryService.create('u1', WS, createDto),
      'DATABASE_ERROR',
    )
    ranges.list.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdInventoryDiscoveryService.list('u1', WS),
      'DATABASE_ERROR',
    )
  })

  it('schedules a run only when the range is being switched on', async () => {
    ranges.findById.mockResolvedValue(
      ok(createFakeSdInventoryDiscoveryRange({ enabled: false })),
    )
    expectOk(
      await SdInventoryDiscoveryService.update('u1', WS, 'rng-1', {
        enabled: true,
      }),
    )
    expect(ranges.update.mock.calls[0]?.[2].nextRunAt).toBeInstanceOf(Date)

    ranges.findById.mockResolvedValue(ok(createFakeSdInventoryDiscoveryRange()))
    expectOk(
      await SdInventoryDiscoveryService.update('u1', WS, 'rng-1', {
        enabled: true,
      }),
    )
    expect(ranges.update.mock.calls[1]?.[2]).not.toHaveProperty('nextRunAt')
  })

  it('does not touch a range of another workspace', async () => {
    ranges.findById.mockResolvedValue(err(sdInventoryDiscoveryRangeNotFound()))
    expectErr(
      await SdInventoryDiscoveryService.update('u1', WS, 'x', { name: 'a' }),
      'SD_INVENTORY_DISCOVERY_RANGE_NOT_FOUND',
    )
    expectErr(
      await SdInventoryDiscoveryService.remove('u1', WS, 'x'),
      'SD_INVENTORY_DISCOVERY_RANGE_NOT_FOUND',
    )
    expectErr(
      await SdInventoryDiscoveryService.scanNow('u1', WS, 'x'),
      'SD_INVENTORY_DISCOVERY_RANGE_NOT_FOUND',
    )
    expect(ranges.update).not.toHaveBeenCalled()
    expect(ranges.softDelete).not.toHaveBeenCalled()
  })

  it('propagates update failures and checks the customer on update', async () => {
    customers.findExistingIds.mockResolvedValue(ok([]))
    expectErr(
      await SdInventoryDiscoveryService.update('u1', WS, 'rng-1', {
        customerId: 'cus-x',
      }),
      'SD_CONFIG_NOT_FOUND',
    )
    customers.findExistingIds.mockResolvedValue(ok(['cus-1']))
    ranges.update.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdInventoryDiscoveryService.update('u1', WS, 'rng-1', {
        name: 'b',
      }),
      'DATABASE_ERROR',
    )
  })

  it('removes (soft) an existing range', async () => {
    expectOk(await SdInventoryDiscoveryService.remove('u1', WS, 'rng-1'))
    expect(ranges.softDelete).toHaveBeenCalledWith('rng-1', WS)
  })

  it('refuses non-admins', async () => {
    actAs('agent')
    expectErr(await SdInventoryDiscoveryService.list('u1', WS), 'FORBIDDEN')
    expectErr(
      await SdInventoryDiscoveryService.create('u1', WS, createDto),
      'FORBIDDEN',
    )
    expect(ranges.create).not.toHaveBeenCalled()
  })
})

describe('scanNow', () => {
  it('queues the range', async () => {
    expectOk(await SdInventoryDiscoveryService.scanNow('u1', WS, 'rng-1'))
    expect(add).toHaveBeenCalledWith(
      'discovery-range',
      { rangeId: 'rng-1' },
      { jobId: 'discovery-range-rng-1' },
    )
  })

  it('refuses a range whose opt-in is off', async () => {
    ranges.findById.mockResolvedValue(
      ok(createFakeSdInventoryDiscoveryRange({ enabled: false })),
    )
    expectErr(
      await SdInventoryDiscoveryService.scanNow('u1', WS, 'rng-1'),
      'SD_INVENTORY_RANGE_INVALID',
    )
    expect(add).not.toHaveBeenCalled()
  })
})

describe('enqueueDue', () => {
  it('claims and queues each due range', async () => {
    ranges.listDue.mockResolvedValue(
      ok([
        createFakeSdInventoryDiscoveryRange({ id: 'r1' }),
        createFakeSdInventoryDiscoveryRange({ id: 'r2' }),
      ]),
    )
    expect(expectOk(await SdInventoryDiscoveryService.enqueueDue(NOW))).toBe(2)
    expect(ranges.update).toHaveBeenCalledWith('r1', 'ws1', {
      nextRunAt: new Date('2026-10-20T13:00:00.000Z'),
    })
    expect(add).toHaveBeenCalledTimes(2)
  })

  it('skips a range it could not claim', async () => {
    ranges.listDue.mockResolvedValue(
      ok([createFakeSdInventoryDiscoveryRange({ id: 'r1' })]),
    )
    ranges.update.mockResolvedValue(err(databaseError()))
    expect(expectOk(await SdInventoryDiscoveryService.enqueueDue(NOW))).toBe(0)
    expect(add).not.toHaveBeenCalled()
  })

  it('propagates a listing failure and uses the clock by default', async () => {
    ranges.listDue.mockResolvedValue(err(databaseError()))
    expectErr(await SdInventoryDiscoveryService.enqueueDue(), 'DATABASE_ERROR')
  })
})

describe('runScan', () => {
  it('stores the hosts that answered as unmanaged discovered devices', async () => {
    const summary = expectOk(
      await SdInventoryDiscoveryService.runScan('rng-1', {
        now: NOW,
        discovery: discovery(
          ['10.0.1.1', '10.0.1.2'],
          new Map([['10.0.1.1', 'aa:bb:cc:dd:ee:01']]),
        ),
      }),
    )
    expect(summary).toEqual({
      status: 'SUCCESS',
      probed: 2,
      found: 2,
      failed: 0,
    })
    expect(sync).toHaveBeenCalledTimes(2)
    expect(sync.mock.calls[0]?.[2]).toMatchObject({
      source: 'DISCOVERY',
      externalKey: 'disc:mac:aa:bb:cc:dd:ee:01',
      hostname: 'gw.local',
      ipAddresses: ['10.0.1.1'],
      macAddresses: ['aa:bb:cc:dd:ee:01'],
      managed: false,
      discoveryRangeId: 'rng-1',
      software: null,
    })
    expect(sync.mock.calls[1]?.[2]).toMatchObject({
      externalKey: 'disc:ip:10.0.1.2',
      hostname: '10.0.1.2',
      macAddresses: [],
    })
    expect(ranges.markRun).toHaveBeenCalledWith(
      'rng-1',
      expect.objectContaining({
        lastStatus: 'SUCCESS',
        lastFound: 2,
        lastProbed: 2,
        lastError: null,
        nextRunAt: new Date('2026-10-21T12:00:00.000Z'),
      }),
    )
  })

  it('does not rediscover what the agent or SNMP already know', async () => {
    devices.existsKnownAddress.mockResolvedValueOnce(ok(true))
    const summary = expectOk(
      await SdInventoryDiscoveryService.runScan('rng-1', {
        now: NOW,
        discovery: discovery(['10.0.1.1', '10.0.1.2']),
      }),
    )
    expect(summary?.found).toBe(1)
    expect(sync).toHaveBeenCalledTimes(1)
  })

  it('skips ranges that vanished or lost their opt-in', async () => {
    ranges.findByIdUnscoped.mockResolvedValueOnce(ok(null))
    expect(expectOk(await SdInventoryDiscoveryService.runScan('x'))).toBeNull()
    ranges.findByIdUnscoped.mockResolvedValueOnce(
      ok(createFakeSdInventoryDiscoveryRange({ enabled: false })),
    )
    expect(
      expectOk(await SdInventoryDiscoveryService.runScan('rng-1')),
    ).toBeNull()
    expect(ranges.markRun).not.toHaveBeenCalled()
  })

  it('records a failure when the module is off or the range is invalid', async () => {
    moduleEnabled.mockResolvedValue(ok(false))
    let summary = expectOk(
      await SdInventoryDiscoveryService.runScan('rng-1', { now: NOW }),
    )
    expect(summary?.status).toBe('FAILED')
    expect(ranges.markRun).toHaveBeenLastCalledWith(
      'rng-1',
      expect.objectContaining({
        lastError: 'O módulo ServiceDesk está desligado',
      }),
    )

    moduleEnabled.mockResolvedValue(ok(true))
    ranges.findByIdUnscoped.mockResolvedValue(
      ok(createFakeSdInventoryDiscoveryRange({ cidr: 'lixo' })),
    )
    summary = expectOk(
      await SdInventoryDiscoveryService.runScan('rng-1', { now: NOW }),
    )
    expect(summary?.status).toBe('FAILED')
  })

  it('marks the run partial when some hosts fail to store, failed when all do', async () => {
    sync
      .mockResolvedValueOnce(err(databaseError()))
      .mockResolvedValueOnce(ok({} as never))
    let summary = expectOk(
      await SdInventoryDiscoveryService.runScan('rng-1', {
        now: NOW,
        discovery: discovery(['10.0.1.1', '10.0.1.2']),
      }),
    )
    expect(summary).toMatchObject({ status: 'PARTIAL', found: 1, failed: 1 })

    sync.mockResolvedValue(err(databaseError()))
    summary = expectOk(
      await SdInventoryDiscoveryService.runScan('rng-1', {
        now: NOW,
        discovery: discovery(['10.0.1.1']),
      }),
    )
    expect(summary?.status).toBe('FAILED')
  })

  it('counts a host as a failure when the address lookup fails', async () => {
    devices.existsKnownAddress.mockResolvedValue(err(databaseError()))
    const summary = expectOk(
      await SdInventoryDiscoveryService.runScan('rng-1', {
        now: NOW,
        discovery: discovery(['10.0.1.1']),
      }),
    )
    expect(summary?.status).toBe('FAILED')
    expect(sync).not.toHaveBeenCalled()
  })

  it('propagates load and record failures', async () => {
    ranges.findByIdUnscoped.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdInventoryDiscoveryService.runScan('rng-1'),
      'DATABASE_ERROR',
    )
    ranges.markRun.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdInventoryDiscoveryService.runScan('rng-1', {
        now: NOW,
        discovery: discovery([]),
      }),
      'DATABASE_ERROR',
    )
  })
})
