import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeSdInventoryDevice,
  createFakeSdInventoryTarget,
} from '@/src/__tests__/factories/nov-s1-asset-inventory.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { actAs } from '@/src/__tests__/helpers/sd-config.helpers'
import { databaseError, sdInventoryTargetNotFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import type { SnmpHostInfo } from '@/src/lib/servicedesk/snmp'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/sd-access.repository')
vi.mock('@/src/repositories/sd-customer.repository')
vi.mock('@/src/repositories/sd-inventory-target.repository')
vi.mock('../sd-inventory-sync.service')
vi.mock('@/src/lib/crypto', () => ({
  encryptConnectionSecret: vi.fn(async (plain: string) => `enc(${plain})`),
  decryptConnectionSecret: vi.fn(async (env: string) =>
    env.replace(/^enc\((.*)\)$/, '$1'),
  ),
}))
vi.mock('@/src/lib/queue/queues', () => ({
  getServicedeskInventoryQueue: vi.fn(),
}))
vi.mock('@/src/lib/servicedesk/snmp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/servicedesk/snmp')>()),
  scanSnmpHosts: vi.fn(),
}))

import { decryptConnectionSecret } from '@/src/lib/crypto'
import { getServicedeskInventoryQueue } from '@/src/lib/queue/queues'
import { scanSnmpHosts } from '@/src/lib/servicedesk/snmp'
import { SdCustomerRepository } from '@/src/repositories/sd-customer.repository'
import { SdInventoryTargetRepository } from '@/src/repositories/sd-inventory-target.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { syncInventoryDevice } from '../sd-inventory-sync.service'
import {
  SdInventoryTargetService,
  snmpExternalKey,
} from '../sd-inventory-target.service'

const targets = vi.mocked(SdInventoryTargetRepository)
const customers = vi.mocked(SdCustomerRepository)
const scan = vi.mocked(scanSnmpHosts)
const sync = vi.mocked(syncInventoryDevice)
const moduleEnabled = vi.mocked(WorkspaceModuleAccessRepository.isEnabled)
const add = vi.fn()
const WS = 'ws1'
const NOW = new Date('2026-10-20T12:00:00.000Z')

const createDto = {
  name: 'Rede da matriz',
  ranges: ['10.0.0.0/30'],
  snmpVersion: 'V2C' as const,
  community: 'public',
  port: 161,
  intervalMinutes: 60,
  active: true,
}

function host(overrides?: Partial<SnmpHostInfo>): SnmpHostInfo {
  return {
    ip: '10.0.0.1',
    hostname: 'sw-core',
    description: 'Cisco IOS',
    manufacturer: 'Cisco',
    model: 'C9200',
    serialNumber: null,
    ramTotalMb: 2048,
    ramUsedMb: 1024,
    macAddresses: [],
    disks: [],
    software: [],
    ...overrides,
  }
}

beforeEach(() => {
  actAs('owner')
  add.mockReset()
  vi.mocked(getServicedeskInventoryQueue).mockReturnValue({ add } as never)
  customers.findExistingIds.mockResolvedValue(ok(['cus-1']))
  targets.list.mockResolvedValue(ok([createFakeSdInventoryTarget()]))
  targets.findById.mockResolvedValue(ok(createFakeSdInventoryTarget()))
  targets.findByIdUnscoped.mockResolvedValue(ok(createFakeSdInventoryTarget()))
  targets.create.mockResolvedValue(ok(createFakeSdInventoryTarget()))
  targets.update.mockResolvedValue(ok(createFakeSdInventoryTarget()))
  targets.softDelete.mockResolvedValue(ok(undefined))
  targets.markRun.mockResolvedValue(ok(undefined))
  targets.listDue.mockResolvedValue(ok([]))
  moduleEnabled.mockResolvedValue(ok(true))
  scan.mockResolvedValue({ found: [host()], probed: 2, failed: 0 })
  sync.mockResolvedValue(ok({ device: createFakeSdInventoryDevice() } as never))
})

describe('admin CRUD', () => {
  it('lists without leaking the community', async () => {
    const list = expectOk(await SdInventoryTargetService.list('u1', WS))
    expect(list[0]).not.toHaveProperty('communityEnc')
    expect(list[0]?.hasCommunity).toBe(true)
  })

  it('encrypts the community on create and schedules the first scan', async () => {
    const created = expectOk(
      await SdInventoryTargetService.create('u1', WS, createDto),
    )
    expect(created).not.toHaveProperty('communityEnc')
    const stored = targets.create.mock.calls[0]?.[0]
    expect(stored).toMatchObject({
      workspaceId: WS,
      createdById: 'u1',
      communityEnc: 'enc(public)',
      customerId: null,
    })
    expect(stored?.nextRunAt).toBeInstanceOf(Date)
  })

  it('checks that the customer belongs to the workspace', async () => {
    expectOk(
      await SdInventoryTargetService.create('u1', WS, {
        ...createDto,
        customerId: 'cus-1',
      }),
    )
    customers.findExistingIds.mockResolvedValue(ok([]))
    expectErr(
      await SdInventoryTargetService.create('u1', WS, {
        ...createDto,
        customerId: 'cus-x',
      }),
      'SD_CONFIG_NOT_FOUND',
    )
    customers.findExistingIds.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdInventoryTargetService.create('u1', WS, {
        ...createDto,
        customerId: 'cus-1',
      }),
      'DATABASE_ERROR',
    )
  })

  it('updates keeping or replacing the community', async () => {
    expectOk(
      await SdInventoryTargetService.update('u1', WS, 'tgt-1', {
        active: false,
      }),
    )
    expect(targets.update).toHaveBeenLastCalledWith('tgt-1', WS, {
      active: false,
    })

    expectOk(
      await SdInventoryTargetService.update('u1', WS, 'tgt-1', {
        community: 'novo',
      }),
    )
    expect(targets.update).toHaveBeenLastCalledWith('tgt-1', WS, {
      snmpVersion: 'V2C',
      communityEnc: 'enc(novo)',
      v3Username: null,
      v3AuthProtocol: null,
      v3AuthKeyEnc: null,
      v3PrivProtocol: null,
      v3PrivKeyEnc: null,
    })
  })

  it('creates an SNMPv3 target with encrypted keys and an empty community', async () => {
    expectOk(
      await SdInventoryTargetService.create('u1', WS, {
        ...createDto,
        snmpVersion: 'V3',
        community: undefined,
        v3Username: 'monitor',
        v3AuthKey: 'auth-secret-1',
        v3PrivKey: 'priv-secret-1',
        v3PrivProtocol: 'AES256B',
      }),
    )
    expect(targets.create.mock.calls[0]?.[0]).toMatchObject({
      snmpVersion: 'V3',
      communityEnc: '',
      v3Username: 'monitor',
      v3AuthProtocol: 'SHA',
      v3AuthKeyEnc: 'enc(auth-secret-1)',
      v3PrivProtocol: 'AES256B',
      v3PrivKeyEnc: 'enc(priv-secret-1)',
    })
  })

  it('creates an SNMPv3 noAuthNoPriv target without keys', async () => {
    expectOk(
      await SdInventoryTargetService.create('u1', WS, {
        ...createDto,
        snmpVersion: 'V3',
        community: undefined,
        v3Username: 'monitor',
      }),
    )
    expect(targets.create.mock.calls[0]?.[0]).toMatchObject({
      v3AuthProtocol: null,
      v3AuthKeyEnc: null,
      v3PrivProtocol: null,
      v3PrivKeyEnc: null,
    })
  })

  it('rejects credentials that do not fit the chosen version', async () => {
    expectErr(
      await SdInventoryTargetService.create('u1', WS, {
        ...createDto,
        community: undefined,
      }),
      'SD_INVENTORY_SNMP_CREDENTIALS_INVALID',
    )
    expectErr(
      await SdInventoryTargetService.create('u1', WS, {
        ...createDto,
        snmpVersion: 'V3',
        community: undefined,
      }),
      'SD_INVENTORY_SNMP_CREDENTIALS_INVALID',
    )
    expectErr(
      await SdInventoryTargetService.create('u1', WS, {
        ...createDto,
        snmpVersion: 'V3',
        community: undefined,
        v3Username: 'monitor',
        v3PrivKey: 'priv-secret-1',
      }),
      'SD_INVENTORY_SNMP_CREDENTIALS_INVALID',
    )
    expect(targets.create).not.toHaveBeenCalled()
  })

  it('switches a v2c target to v3 and back, keeping stored keys when omitted', async () => {
    expectOk(
      await SdInventoryTargetService.update('u1', WS, 'tgt-1', {
        snmpVersion: 'V3',
        v3Username: 'monitor',
        v3AuthKey: 'auth-secret-1',
      }),
    )
    expect(targets.update).toHaveBeenLastCalledWith(
      'tgt-1',
      WS,
      expect.objectContaining({
        snmpVersion: 'V3',
        communityEnc: '',
        v3AuthKeyEnc: 'enc(auth-secret-1)',
      }),
    )

    // Alvo v3 já guardado: editar só o usuário mantém as chaves e protocolos.
    const stored = createFakeSdInventoryTarget({
      snmpVersion: 'V3',
      communityEnc: '',
      v3Username: 'monitor',
      v3AuthProtocol: 'SHA256',
      v3AuthKeyEnc: 'enc(a)',
      v3PrivProtocol: 'AES',
      v3PrivKeyEnc: 'enc(p)',
    })
    targets.findById.mockResolvedValue(ok(stored))
    expectOk(
      await SdInventoryTargetService.update('u1', WS, 'tgt-1', {
        v3Username: 'outro',
      }),
    )
    expect(targets.update).toHaveBeenLastCalledWith(
      'tgt-1',
      WS,
      expect.objectContaining({
        v3Username: 'outro',
        v3AuthProtocol: 'SHA256',
        v3AuthKeyEnc: 'enc(a)',
        v3PrivProtocol: 'AES',
        v3PrivKeyEnc: 'enc(p)',
      }),
    )

    // De volta ao v2c sem community nova: recusa; com ela, limpa o v3.
    expectErr(
      await SdInventoryTargetService.update('u1', WS, 'tgt-1', {
        snmpVersion: 'V2C',
      }),
      'SD_INVENTORY_SNMP_CREDENTIALS_INVALID',
    )
    expectOk(
      await SdInventoryTargetService.update('u1', WS, 'tgt-1', {
        snmpVersion: 'V2C',
        community: 'public',
      }),
    )
    expect(targets.update).toHaveBeenLastCalledWith(
      'tgt-1',
      WS,
      expect.objectContaining({
        communityEnc: 'enc(public)',
        v3Username: null,
        v3AuthKeyEnc: null,
      }),
    )
  })

  it('refuses to switch to v3 without a username', async () => {
    expectErr(
      await SdInventoryTargetService.update('u1', WS, 'tgt-1', {
        snmpVersion: 'V3',
      }),
      'SD_INVENTORY_SNMP_CREDENTIALS_INVALID',
    )
  })

  it('refuses privacy without authentication on an existing v3 target', async () => {
    targets.findById.mockResolvedValue(
      ok(
        createFakeSdInventoryTarget({
          snmpVersion: 'V3',
          communityEnc: '',
          v3Username: 'monitor',
        }),
      ),
    )
    expectErr(
      await SdInventoryTargetService.update('u1', WS, 'tgt-1', {
        v3PrivKey: 'priv-secret-1',
      }),
      'SD_INVENTORY_SNMP_CREDENTIALS_INVALID',
    )
  })

  it('does not update or delete a target of another workspace', async () => {
    targets.findById.mockResolvedValue(err(sdInventoryTargetNotFound()))
    expectErr(
      await SdInventoryTargetService.update('u1', WS, 'tgt-x', {
        active: false,
      }),
      'SD_INVENTORY_TARGET_NOT_FOUND',
    )
    expectErr(
      await SdInventoryTargetService.remove('u1', WS, 'tgt-x'),
      'SD_INVENTORY_TARGET_NOT_FOUND',
    )
    expect(targets.update).not.toHaveBeenCalled()
    expect(targets.softDelete).not.toHaveBeenCalled()
  })

  it('propagates repository failures', async () => {
    targets.list.mockResolvedValue(err(databaseError()))
    expectErr(await SdInventoryTargetService.list('u1', WS), 'DATABASE_ERROR')
    targets.create.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdInventoryTargetService.create('u1', WS, createDto),
      'DATABASE_ERROR',
    )
    targets.update.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdInventoryTargetService.update('u1', WS, 'tgt-1', {
        active: true,
      }),
      'DATABASE_ERROR',
    )
  })

  it('removes (soft) an existing target', async () => {
    expectOk(await SdInventoryTargetService.remove('u1', WS, 'tgt-1'))
    expect(targets.softDelete).toHaveBeenCalledWith('tgt-1', WS)
  })

  it.each(['agent', 'requester', 'viewer', 'stranger', 'disabled'] as const)(
    'denies %s',
    async (actor) => {
      actAs(actor)
      expectErr(await SdInventoryTargetService.list('u1', WS))
      expectErr(await SdInventoryTargetService.create('u1', WS, createDto))
      expectErr(
        await SdInventoryTargetService.update('u1', WS, 'tgt-1', {
          active: true,
        }),
      )
      expectErr(await SdInventoryTargetService.remove('u1', WS, 'tgt-1'))
      expectErr(await SdInventoryTargetService.scanNow('u1', WS, 'tgt-1'))
      expect(targets.create).not.toHaveBeenCalled()
      expect(add).not.toHaveBeenCalled()
    },
  )
})

describe('scanNow', () => {
  it('enqueues the scan with a per-target job id', async () => {
    expectOk(await SdInventoryTargetService.scanNow('u1', WS, 'tgt-1'))
    expect(add).toHaveBeenCalledWith(
      'scan-target',
      { targetId: 'tgt-1' },
      { jobId: 'scan-target-tgt-1' },
    )
  })

  it('does not enqueue a target of another workspace', async () => {
    targets.findById.mockResolvedValue(err(sdInventoryTargetNotFound()))
    expectErr(await SdInventoryTargetService.scanNow('u1', WS, 'tgt-x'))
    expect(add).not.toHaveBeenCalled()
  })
})

describe('enqueueDue', () => {
  it('claims and enqueues each due target', async () => {
    targets.listDue.mockResolvedValue(
      ok([
        createFakeSdInventoryTarget({ id: 'a' }),
        createFakeSdInventoryTarget({ id: 'b' }),
      ]),
    )
    expect(expectOk(await SdInventoryTargetService.enqueueDue(NOW))).toBe(2)
    expect(targets.update).toHaveBeenCalledWith('a', WS, {
      nextRunAt: new Date('2026-10-20T12:30:00.000Z'),
    })
    expect(add).toHaveBeenCalledWith(
      'scan-target',
      { targetId: 'a' },
      { jobId: 'scan-target-a' },
    )
  })

  it('skips a target whose claim failed', async () => {
    targets.listDue.mockResolvedValue(
      ok([createFakeSdInventoryTarget({ id: 'a' })]),
    )
    targets.update.mockResolvedValue(err(databaseError()))
    expect(expectOk(await SdInventoryTargetService.enqueueDue(NOW))).toBe(0)
    expect(add).not.toHaveBeenCalled()
  })

  it('propagates a listing failure and uses the real clock by default', async () => {
    expect(expectOk(await SdInventoryTargetService.enqueueDue())).toBe(0)
    targets.listDue.mockResolvedValue(err(databaseError()))
    expectErr(await SdInventoryTargetService.enqueueDue(NOW), 'DATABASE_ERROR')
  })
})

describe('snmpExternalKey', () => {
  it('prefers serial, then MAC, then IP', () => {
    expect(
      snmpExternalKey(host({ serialNumber: 'FOC1', macAddresses: ['aa:bb'] })),
    ).toBe('snmp:sn:foc1')
    expect(snmpExternalKey(host({ macAddresses: ['aa:bb'] }))).toBe(
      'snmp:mac:aa:bb',
    )
    expect(snmpExternalKey(host())).toBe('snmp:ip:10.0.0.1')
  })
})

describe('runScan', () => {
  const factory = vi.fn()

  it('skips a missing or inactive target', async () => {
    targets.findByIdUnscoped.mockResolvedValue(ok(null))
    expect(
      expectOk(await SdInventoryTargetService.runScan('tgt-1', { now: NOW })),
    ).toBeNull()
    targets.findByIdUnscoped.mockResolvedValue(
      ok(createFakeSdInventoryTarget({ active: false })),
    )
    expect(
      expectOk(await SdInventoryTargetService.runScan('tgt-1', { now: NOW })),
    ).toBeNull()
    expect(scan).not.toHaveBeenCalled()
  })

  it('propagates a target lookup failure', async () => {
    targets.findByIdUnscoped.mockResolvedValue(err(databaseError()))
    expectErr(await SdInventoryTargetService.runScan('tgt-1'), 'DATABASE_ERROR')
  })

  it('scans, syncs each host and records a successful run', async () => {
    const summary = expectOk(
      await SdInventoryTargetService.runScan('tgt-1', { now: NOW, factory }),
    )
    expect(summary).toEqual({
      status: 'SUCCESS',
      probed: 2,
      found: 1,
      failed: 0,
    })
    expect(scan).toHaveBeenCalledWith(['10.0.0.1', '10.0.0.2'], factory, {
      community: 'public',
      port: 161,
      timeoutMs: 1500,
    })
    expect(sync).toHaveBeenCalledWith(
      WS,
      'u1',
      expect.objectContaining({
        source: 'SNMP',
        externalKey: 'snmp:ip:10.0.0.1',
        hostname: 'sw-core',
        osName: 'Cisco IOS',
        ipAddresses: ['10.0.0.1'],
        snmpTargetId: 'tgt-1',
        software: null,
      }),
      NOW,
    )
    expect(targets.markRun).toHaveBeenCalledWith('tgt-1', {
      lastRunAt: NOW,
      nextRunAt: new Date('2026-10-21T12:00:00.000Z'),
      lastStatus: 'SUCCESS',
      lastFound: 1,
      lastError: null,
    })
  })

  it('sends the software names when the device exposes them', async () => {
    scan.mockResolvedValue({
      found: [
        host({ software: ['nginx', 'x'.repeat(300)], description: null }),
      ],
      probed: 1,
      failed: 0,
    })
    expectOk(await SdInventoryTargetService.runScan('tgt-1', { now: NOW }))
    const payload = sync.mock.calls[0]?.[2]
    expect(payload?.software?.[0]).toEqual({
      name: 'nginx',
      version: '',
      publisher: null,
    })
    expect(payload?.software?.[1]?.name).toHaveLength(255)
    expect(payload?.osName).toBeNull()
  })

  it('marks a partial run when some addresses failed', async () => {
    scan.mockResolvedValue({ found: [host()], probed: 4, failed: 2 })
    const summary = expectOk(
      await SdInventoryTargetService.runScan('tgt-1', { now: NOW }),
    )
    expect(summary).toMatchObject({ status: 'PARTIAL', failed: 2 })
    expect(targets.markRun).toHaveBeenCalledWith(
      'tgt-1',
      expect.objectContaining({
        lastStatus: 'PARTIAL',
        lastError: '2 endereço(s) com falha na varredura',
      }),
    )
  })

  it('counts sync failures against the found total', async () => {
    scan.mockResolvedValue({
      found: [host({ ip: '10.0.0.1' }), host({ ip: '10.0.0.2' })],
      probed: 2,
      failed: 0,
    })
    sync.mockResolvedValueOnce(err(databaseError()))
    const summary = expectOk(
      await SdInventoryTargetService.runScan('tgt-1', { now: NOW }),
    )
    expect(summary).toEqual({
      status: 'PARTIAL',
      probed: 2,
      found: 1,
      failed: 1,
    })
  })

  it('fails when nothing was found and something went wrong', async () => {
    scan.mockResolvedValue({ found: [], probed: 2, failed: 2 })
    expect(
      expectOk(await SdInventoryTargetService.runScan('tgt-1', { now: NOW }))
        ?.status,
    ).toBe('FAILED')
  })

  it('succeeds with zero hosts when the network is simply empty', async () => {
    scan.mockResolvedValue({ found: [], probed: 2, failed: 0 })
    expect(
      expectOk(await SdInventoryTargetService.runScan('tgt-1', { now: NOW })),
    ).toEqual({
      status: 'SUCCESS',
      probed: 2,
      found: 0,
      failed: 0,
    })
  })

  it('records a failure when the module is off, without scanning', async () => {
    moduleEnabled.mockResolvedValue(ok(false))
    const summary = expectOk(
      await SdInventoryTargetService.runScan('tgt-1', { now: NOW }),
    )
    expect(summary?.status).toBe('FAILED')
    expect(targets.markRun).toHaveBeenCalledWith(
      'tgt-1',
      expect.objectContaining({
        lastError: 'O módulo ServiceDesk está desligado',
      }),
    )
    expect(scan).not.toHaveBeenCalled()
  })

  it('records a failure for ranges that no longer parse', async () => {
    targets.findByIdUnscoped.mockResolvedValue(
      ok(createFakeSdInventoryTarget({ ranges: ['not-an-ip'] })),
    )
    const summary = expectOk(
      await SdInventoryTargetService.runScan('tgt-1', { now: NOW }),
    )
    expect(summary?.status).toBe('FAILED')
    expect(targets.markRun).toHaveBeenCalledWith(
      'tgt-1',
      expect.objectContaining({
        lastError: expect.stringContaining('Faixa inválida'),
      }),
    )
    expect(scan).not.toHaveBeenCalled()
  })

  it('records a failure when the stored credentials cannot be decrypted', async () => {
    vi.mocked(decryptConnectionSecret).mockRejectedValueOnce(
      new Error('bad key'),
    )
    const summary = expectOk(
      await SdInventoryTargetService.runScan('tgt-1', { now: NOW }),
    )
    expect(summary?.status).toBe('FAILED')
    expect(targets.markRun).toHaveBeenCalledWith(
      'tgt-1',
      expect.objectContaining({
        lastError: 'Não foi possível ler as credenciais SNMP guardadas',
      }),
    )
  })

  it('opens a v3 session with the decrypted keys', async () => {
    targets.findByIdUnscoped.mockResolvedValue(
      ok(
        createFakeSdInventoryTarget({
          snmpVersion: 'V3',
          communityEnc: '',
          v3Username: 'monitor',
          v3AuthProtocol: 'SHA256',
          v3AuthKeyEnc: 'enc(auth-secret-1)',
          v3PrivProtocol: 'AES',
          v3PrivKeyEnc: 'enc(priv-secret-1)',
        }),
      ),
    )
    expectOk(await SdInventoryTargetService.runScan('tgt-1', { now: NOW }))
    expect(scan.mock.calls[0]?.[2]).toMatchObject({
      v3: {
        username: 'monitor',
        authProtocol: 'SHA256',
        authKey: 'auth-secret-1',
        privProtocol: 'AES',
        privKey: 'priv-secret-1',
      },
    })
  })

  it('opens a v3 session without keys (noAuthNoPriv)', async () => {
    targets.findByIdUnscoped.mockResolvedValue(
      ok(
        createFakeSdInventoryTarget({
          snmpVersion: 'V3',
          communityEnc: '',
          v3Username: 'monitor',
        }),
      ),
    )
    expectOk(await SdInventoryTargetService.runScan('tgt-1', { now: NOW }))
    expect(scan.mock.calls[0]?.[2]).toMatchObject({
      v3: { username: 'monitor', authKey: null, privKey: null },
    })
  })

  it('propagates a failure to record the run', async () => {
    targets.markRun.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdInventoryTargetService.runScan('tgt-1', { now: NOW }),
      'DATABASE_ERROR',
    )
  })

  it('uses the real clock and the real SNMP factory by default', async () => {
    expectOk(await SdInventoryTargetService.runScan('tgt-1'))
    expect(scan.mock.calls[0]?.[1]).toBeTypeOf('function')
  })
})
