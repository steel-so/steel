import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeSdInstalledDeviceRow,
  createFakeSdLicenseDetailRow,
  createFakeSdLicenseRow,
  createFakeSdSoftwareLicense,
} from '@/src/__tests__/factories/nov-sd-licenses.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { actAs } from '@/src/__tests__/helpers/sd-config.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/sd-access.repository')
vi.mock('@/src/repositories/sd-license.repository')
vi.mock('@/src/repositories/sd-ticket-context.repository')
vi.mock('../sd-notification.service', () => ({ notifySdUsers: vi.fn() }))

import { auditMutation } from '@/lib/axiom/audit'
import { SdLicenseRepository } from '@/src/repositories/sd-license.repository'
import { SdTicketContextRepository } from '@/src/repositories/sd-ticket-context.repository'
import { SdLicenseService } from '../sd-license.service'
import { notifySdUsers } from '../sd-notification.service'

const repo = vi.mocked(SdLicenseRepository)
const context = vi.mocked(SdTicketContextRepository)
const notify = vi.mocked(notifySdUsers)
const WS = 'ws1'
const NOW = new Date('2026-10-30T15:00:00Z')

const dto = {
  name: 'Office',
  vendor: null,
  matchPattern: '  Microsoft   Office ',
  seats: 10,
  renewalNoticeDays: 30,
  notes: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  actAs('owner')
  repo.list.mockResolvedValue(ok([createFakeSdLicenseRow()]))
  repo.findById.mockResolvedValue(ok(createFakeSdLicenseDetailRow()))
  repo.countInstalled.mockResolvedValue(ok(8))
  repo.create.mockResolvedValue(ok(createFakeSdSoftwareLicense()))
  repo.update.mockResolvedValue(ok(createFakeSdSoftwareLicense()))
  repo.replaceAssets.mockResolvedValue(ok(undefined))
  repo.countConfigItems.mockResolvedValue(ok(2))
  repo.listInstalledDevices.mockResolvedValue(
    ok([
      createFakeSdInstalledDeviceRow(),
      createFakeSdInstalledDeviceRow({ id: 'dev-2', configItemId: null }),
    ]),
  )
  repo.listForConfigItem.mockResolvedValue(ok([createFakeSdSoftwareLicense()]))
  repo.listWithExpiry.mockResolvedValue(ok([]))
  repo.claimNotice.mockResolvedValue(ok(true))
  repo.listAdminUserIds.mockResolvedValue(ok(['admin-1']))
  context.listEnabledWorkspaceIds.mockResolvedValue(ok([WS]))
  notify.mockResolvedValue(ok({ recipients: 1, inApp: 1 }))
})

describe('SdLicenseService.list', () => {
  it('returns items with compliance and a summary of the whole set', async () => {
    const result = expectOk(
      await SdLicenseService.list('u1', WS, { includeArchived: false }, NOW),
    )
    expect(result.items[0]).toMatchObject({ installed: 8, balance: 2 })
    expect(result.summary.overLicensed).toBe(1)
    expect(repo.countInstalled).toHaveBeenCalledWith(WS, 'Microsoft Office')
  })

  it('filters by status without changing the summary', async () => {
    const result = expectOk(
      await SdLicenseService.list(
        'u1',
        WS,
        { status: 'EXPIRED', includeArchived: false },
        NOW,
      ),
    )
    expect(result.items).toEqual([])
    expect(result.summary.total).toBe(1)
  })

  it('lets agents read and refuses everyone else', async () => {
    actAs('agent')
    expectOk(await SdLicenseService.list('u1', WS, { includeArchived: false }))
    for (const actor of ['requester', 'stranger', 'disabled'] as const) {
      actAs(actor)
      expectErr(
        await SdLicenseService.list('u1', WS, { includeArchived: false }),
      )
    }
  })

  it('propagates repository errors', async () => {
    repo.list.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdLicenseService.list('u1', WS, { includeArchived: false }),
      'DATABASE_ERROR',
    )
    repo.list.mockResolvedValue(ok([createFakeSdLicenseRow()]))
    repo.countInstalled.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdLicenseService.list('u1', WS, { includeArchived: false }),
      'DATABASE_ERROR',
    )
  })
})

describe('SdLicenseService.get', () => {
  it('counts installed devices without a license assigned', async () => {
    repo.findById.mockResolvedValue(
      ok(
        createFakeSdLicenseDetailRow({
          assignments: [
            {
              id: 'a1',
              licenseId: 'lic-1',
              configItemId: 'ci-1',
              createdAt: new Date(),
              configItem: { id: 'ci-1', name: 'PC-01', code: null },
            },
          ],
        }),
      ),
    )
    const detail = expectOk(await SdLicenseService.get('u1', WS, 'lic-1', NOW))
    expect(detail.devices.map((d) => d.assigned)).toEqual([true, false])
    expect(detail.unassignedCount).toBe(7)
  })

  it('propagates not-found, count and device errors; refuses requesters', async () => {
    repo.findById.mockResolvedValue(err(databaseError()))
    expectErr(await SdLicenseService.get('u1', WS, 'x'), 'DATABASE_ERROR')
    repo.findById.mockResolvedValue(ok(createFakeSdLicenseDetailRow()))
    repo.countInstalled.mockResolvedValue(err(databaseError()))
    expectErr(await SdLicenseService.get('u1', WS, 'x'), 'DATABASE_ERROR')
    repo.countInstalled.mockResolvedValue(ok(1))
    repo.listInstalledDevices.mockResolvedValue(err(databaseError()))
    expectErr(await SdLicenseService.get('u1', WS, 'x'), 'DATABASE_ERROR')
    actAs('requester')
    expectErr(await SdLicenseService.get('u1', WS, 'x'))
  })
})

describe('SdLicenseService.forConfigItem', () => {
  it('lists the licenses of an asset', async () => {
    const list = expectOk(
      await SdLicenseService.forConfigItem('u1', WS, 'ci-1', NOW),
    )
    expect(list[0]).toMatchObject({ id: 'lic-1', expiryState: 'OK' })
  })

  it('refuses requesters and propagates errors', async () => {
    repo.listForConfigItem.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdLicenseService.forConfigItem('u1', WS, 'ci-1'),
      'DATABASE_ERROR',
    )
    actAs('requester')
    expectErr(await SdLicenseService.forConfigItem('u1', WS, 'ci-1'))
  })
})

describe('SdLicenseService.create', () => {
  it('normalizes the pattern, audits and returns the DTO', async () => {
    const created = expectOk(await SdLicenseService.create('u1', WS, dto))
    expect(repo.create).toHaveBeenCalledWith(
      WS,
      'u1',
      expect.objectContaining({ matchPattern: 'Microsoft Office' }),
    )
    expect(created.installed).toBe(8)
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'sd_software_license',
        action: 'create',
      }),
    )
  })

  it('refuses an expiry before the purchase', async () => {
    expectErr(
      await SdLicenseService.create('u1', WS, {
        ...dto,
        purchasedAt: new Date('2026-05-01'),
        expiresAt: new Date('2026-04-01'),
      }),
      'SD_LICENSE_INVALID',
    )
    expect(repo.create).not.toHaveBeenCalled()
  })

  it.each(['agent', 'requester', 'stranger', 'viewer'] as const)(
    'refuses %s',
    async (actor) => {
      actAs(actor)
      expectErr(await SdLicenseService.create('u1', WS, dto))
      expect(repo.create).not.toHaveBeenCalled()
    },
  )

  it('propagates create, reload and count errors', async () => {
    repo.create.mockResolvedValue(err(databaseError()))
    expectErr(await SdLicenseService.create('u1', WS, dto), 'DATABASE_ERROR')
    repo.create.mockResolvedValue(ok(createFakeSdSoftwareLicense()))
    repo.findById.mockResolvedValue(err(databaseError()))
    expectErr(await SdLicenseService.create('u1', WS, dto), 'DATABASE_ERROR')
    repo.findById.mockResolvedValue(ok(createFakeSdLicenseDetailRow()))
    repo.countInstalled.mockResolvedValue(err(databaseError()))
    expectErr(await SdLicenseService.create('u1', WS, dto), 'DATABASE_ERROR')
  })
})

describe('SdLicenseService.update', () => {
  it('re-arms the notices when the expiry changes', async () => {
    expectOk(
      await SdLicenseService.update('u1', WS, 'lic-1', {
        expiresAt: new Date('2027-06-01'),
        matchPattern: ' Visio ',
      }),
    )
    expect(repo.update).toHaveBeenCalledWith(
      'lic-1',
      WS,
      expect.objectContaining({
        matchPattern: 'Visio',
        lastNoticeKind: null,
        lastNoticeAt: null,
      }),
    )
  })

  it('leaves the notices alone for other edits', async () => {
    expectOk(await SdLicenseService.update('u1', WS, 'lic-1', { seats: 3 }))
    expect(repo.update).toHaveBeenCalledWith('lic-1', WS, { seats: 3 })
  })

  it('validates the dates against the stored ones', async () => {
    expectErr(
      await SdLicenseService.update('u1', WS, 'lic-1', {
        expiresAt: new Date('2025-01-01'),
      }),
      'SD_LICENSE_INVALID',
    )
    expectErr(
      await SdLicenseService.update('u1', WS, 'lic-1', {
        purchasedAt: new Date('2030-01-01'),
      }),
      'SD_LICENSE_INVALID',
    )
  })

  it('propagates lookup, save and reload errors; refuses agents', async () => {
    repo.findById.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdLicenseService.update('u1', WS, 'lic-1', { seats: 1 }),
      'DATABASE_ERROR',
    )
    repo.update.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdLicenseService.update('u1', WS, 'lic-1', { seats: 1 }),
      'DATABASE_ERROR',
    )
    repo.update.mockResolvedValue(ok(createFakeSdSoftwareLicense()))
    repo.findById
      .mockResolvedValueOnce(ok(createFakeSdLicenseDetailRow()))
      .mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdLicenseService.update('u1', WS, 'lic-1', { seats: 1 }),
      'DATABASE_ERROR',
    )
    actAs('agent')
    expectErr(await SdLicenseService.update('u1', WS, 'lic-1', { seats: 1 }))
  })
})

describe('SdLicenseService.archive', () => {
  it('archives and restores', async () => {
    expectOk(await SdLicenseService.archive('u1', WS, 'lic-1'))
    expect(repo.update).toHaveBeenLastCalledWith('lic-1', WS, {
      archivedAt: expect.any(Date),
    })
    expectOk(await SdLicenseService.archive('u1', WS, 'lic-1', false))
    expect(repo.update).toHaveBeenLastCalledWith('lic-1', WS, {
      archivedAt: null,
    })
    expect(auditMutation).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'restore' }),
    )
  })

  it('propagates errors and refuses agents', async () => {
    repo.findById.mockResolvedValueOnce(err(databaseError()))
    expectErr(await SdLicenseService.archive('u1', WS, 'x'), 'DATABASE_ERROR')
    repo.update.mockResolvedValue(err(databaseError()))
    expectErr(await SdLicenseService.archive('u1', WS, 'x'), 'DATABASE_ERROR')
    repo.update.mockResolvedValue(ok(createFakeSdSoftwareLicense()))
    repo.findById
      .mockResolvedValueOnce(ok(createFakeSdLicenseDetailRow()))
      .mockResolvedValueOnce(err(databaseError()))
    expectErr(await SdLicenseService.archive('u1', WS, 'x'), 'DATABASE_ERROR')
    actAs('agent')
    expectErr(await SdLicenseService.archive('u1', WS, 'x'))
  })
})

describe('SdLicenseService.setAssets', () => {
  it('replaces the assets with unique ids', async () => {
    expectOk(
      await SdLicenseService.setAssets('u1', WS, 'lic-1', {
        configItemIds: ['ci-1', 'ci-2', 'ci-1'],
      }),
    )
    expect(repo.countConfigItems).toHaveBeenCalledWith(WS, ['ci-1', 'ci-2'])
    expect(repo.replaceAssets).toHaveBeenCalledWith('lic-1', ['ci-1', 'ci-2'])
  })

  it('clears the list without checking assets', async () => {
    expectOk(
      await SdLicenseService.setAssets('u1', WS, 'lic-1', {
        configItemIds: [],
      }),
    )
    expect(repo.countConfigItems).not.toHaveBeenCalled()
  })

  it('refuses ids from another workspace', async () => {
    repo.countConfigItems.mockResolvedValue(ok(1))
    expectErr(
      await SdLicenseService.setAssets('u1', WS, 'lic-1', {
        configItemIds: ['ci-1', 'foreign'],
      }),
      'SD_LICENSE_INVALID',
    )
    expect(repo.replaceAssets).not.toHaveBeenCalled()
  })

  it('propagates errors and refuses agents', async () => {
    const input = { configItemIds: ['ci-1'] }
    repo.findById.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdLicenseService.setAssets('u1', WS, 'x', input),
      'DATABASE_ERROR',
    )
    repo.countConfigItems.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdLicenseService.setAssets('u1', WS, 'x', input),
      'DATABASE_ERROR',
    )
    repo.countConfigItems.mockResolvedValue(ok(1))
    repo.replaceAssets.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdLicenseService.setAssets('u1', WS, 'x', input),
      'DATABASE_ERROR',
    )
    repo.findById
      .mockResolvedValueOnce(ok(createFakeSdLicenseDetailRow()))
      .mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdLicenseService.setAssets('u1', WS, 'x', input),
      'DATABASE_ERROR',
    )
    actAs('agent')
    expectErr(await SdLicenseService.setAssets('u1', WS, 'x', input))
  })
})

describe('SdLicenseService.runExpiryTick', () => {
  const lic = (expiresAt: string | null, id = 'l1') =>
    createFakeSdSoftwareLicense({
      id,
      expiresAt: expiresAt ? new Date(`${expiresAt}T00:00:00Z`) : null,
    })

  it('notifies the admins once per renewal window and per expiry', async () => {
    repo.listWithExpiry.mockResolvedValue(
      ok([
        lic('2026-11-10', 'soon'),
        lic('2026-11-12', 'soon2'),
        lic('2026-10-20', 'late'),
        lic('2026-10-29', 'today-1'),
        lic('2028-01-01', 'far'),
        lic('2026-08-01', 'ancient'),
      ]),
    )
    const result = expectOk(await SdLicenseService.runExpiryTick(NOW))
    expect(result).toMatchObject({
      workspaces: 1,
      candidates: 4,
      notices: 2,
      expired: 2,
      skipped: 2,
      errors: 0,
    })
    expect(repo.listAdminUserIds).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'license.expiring',
        userIds: ['admin-1'],
        title: 'Licença perto de vencer: Microsoft Office',
      }),
    )
    expect(notify.mock.calls[0][0].hrefFor('demo')).toBe(
      '/demo/servicedesk/licenses',
    )
  })

  it('words the body for today, tomorrow and expired', async () => {
    repo.listWithExpiry.mockResolvedValue(
      ok([
        lic('2026-10-30', 'a'),
        lic('2026-10-31', 'b'),
        lic('2026-10-01', 'c'),
      ]),
    )
    expectOk(await SdLicenseService.runExpiryTick(NOW))
    const bodies = notify.mock.calls.map((c) => c[0].body)
    expect(bodies[0]).toContain('vence hoje')
    expect(bodies[1]).toContain('vence amanhã')
    expect(bodies[2]).toContain('venceu')
    expect(notify.mock.calls[2][0].title).toBe(
      'Licença vencida: Microsoft Office',
    )
  })

  it('skips what another tick already claimed', async () => {
    repo.listWithExpiry.mockResolvedValue(ok([lic('2026-11-10')]))
    repo.claimNotice.mockResolvedValue(ok(false))
    const result = expectOk(await SdLicenseService.runExpiryTick(NOW))
    expect(result.skipped).toBe(1)
    expect(notify).not.toHaveBeenCalled()
  })

  it('counts claim and notification failures without stopping', async () => {
    repo.listWithExpiry.mockResolvedValue(
      ok([lic('2026-11-10', 'a'), lic('2026-11-11', 'b')]),
    )
    repo.claimNotice
      .mockResolvedValueOnce(err(databaseError()))
      .mockResolvedValueOnce(ok(true))
    notify.mockResolvedValue(err(databaseError()))
    const result = expectOk(await SdLicenseService.runExpiryTick(NOW))
    expect(result.errors).toBe(2)
  })

  it('still notifies nobody when the admin lookup fails', async () => {
    repo.listWithExpiry.mockResolvedValue(ok([lic('2026-11-10')]))
    repo.listAdminUserIds.mockResolvedValue(err(databaseError()))
    expectOk(await SdLicenseService.runExpiryTick(NOW))
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: [] }),
    )
  })

  it('propagates lookup errors', async () => {
    context.listEnabledWorkspaceIds.mockResolvedValue(err(databaseError()))
    expectErr(await SdLicenseService.runExpiryTick(NOW), 'DATABASE_ERROR')
    context.listEnabledWorkspaceIds.mockResolvedValue(ok([WS]))
    repo.listWithExpiry.mockResolvedValue(err(databaseError()))
    expectErr(await SdLicenseService.runExpiryTick(NOW), 'DATABASE_ERROR')
  })
})
