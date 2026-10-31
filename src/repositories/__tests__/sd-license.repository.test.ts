import { describe, expect, it } from 'vitest'
import { seedSdInventoryDevice } from '@/src/__tests__/factories/nov-s1-asset-inventory.factory'
import { seedSdSoftwareLicense } from '@/src/__tests__/factories/nov-sd-licenses.factory'
import { seedSdConfigItem } from '@/src/__tests__/factories/sd-config-item.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { SdLicenseRepository } from '../sd-license.repository'

async function setup() {
  const [workspace, other, user] = await Promise.all([
    seedWorkspace(),
    seedWorkspace(),
    seedUser(),
  ])
  return { workspace, other, user }
}

async function installOffice(
  workspaceId: string,
  hostname: string,
  extra: Record<string, unknown> = {},
  name = 'Microsoft Office Professional',
) {
  const device = await seedSdInventoryDevice({
    workspaceId,
    hostname,
    ...extra,
  })
  await prisma.sdInventorySoftware.create({
    data: { deviceId: device.id, name, version: '16.0' },
  })
  return device
}

describe('SdLicenseRepository CRUD', () => {
  it('creates, lists, filters and archives within the workspace', async () => {
    const { workspace, other, user } = await setup()
    const created = expectOk(
      await SdLicenseRepository.create(workspace.id, user.id, {
        name: 'Office',
        vendor: 'Microsoft',
        matchPattern: 'Office',
        seats: 3,
      }),
    )
    await seedSdSoftwareLicense({
      workspaceId: other.id,
      createdById: user.id,
      name: 'Other',
    })
    await seedSdSoftwareLicense({
      workspaceId: workspace.id,
      createdById: user.id,
      name: 'Old',
      archivedAt: new Date(),
    })

    const live = expectOk(await SdLicenseRepository.list(workspace.id, {}))
    expect(live.map((l) => l.name)).toEqual(['Office'])
    const all = expectOk(
      await SdLicenseRepository.list(workspace.id, { includeArchived: true }),
    )
    expect(all).toHaveLength(2)
    const found = expectOk(
      await SdLicenseRepository.list(workspace.id, { search: 'microsoft' }),
    )
    expect(found).toHaveLength(1)

    const saved = expectOk(
      await SdLicenseRepository.update(created.id, workspace.id, { seats: 9 }),
    )
    expect(saved.seats).toBe(9)
    expectErr(
      await SdLicenseRepository.update(created.id, other.id, { seats: 1 }),
      'SD_CONFIG_NOT_FOUND',
    )
    expectErr(
      await SdLicenseRepository.findById(created.id, other.id),
      'SD_LICENSE_NOT_FOUND',
    )
    expect(
      expectOk(await SdLicenseRepository.findById(created.id, workspace.id))
        .assignments,
    ).toEqual([])
  })
})

describe('SdLicenseRepository assets', () => {
  it('replaces the assigned set and finds licenses by asset', async () => {
    const { workspace, other, user } = await setup()
    const license = await seedSdSoftwareLicense({
      workspaceId: workspace.id,
      createdById: user.id,
    })
    const [a, b] = await Promise.all([
      seedSdConfigItem(workspace.id, user.id, { name: 'A' }),
      seedSdConfigItem(workspace.id, user.id, { name: 'B' }),
    ])
    const foreign = await seedSdConfigItem(other.id, user.id)

    expectOk(await SdLicenseRepository.replaceAssets(license.id, [a.id, b.id]))
    expectOk(await SdLicenseRepository.replaceAssets(license.id, [b.id]))
    const detail = expectOk(
      await SdLicenseRepository.findById(license.id, workspace.id),
    )
    expect(detail.assignments.map((x) => x.configItem.name)).toEqual(['B'])
    expect(
      expectOk(await SdLicenseRepository.listForConfigItem(workspace.id, b.id)),
    ).toHaveLength(1)
    expect(
      expectOk(await SdLicenseRepository.listForConfigItem(workspace.id, a.id)),
    ).toHaveLength(0)

    expect(
      expectOk(
        await SdLicenseRepository.countConfigItems(workspace.id, [
          a.id,
          b.id,
          foreign.id,
        ]),
      ),
    ).toBe(2)
  })
})

describe('SdLicenseRepository installed software', () => {
  it('counts managed, live devices matching the pattern in this workspace', async () => {
    const { workspace, other } = await setup()
    await installOffice(workspace.id, 'PC-01')
    await installOffice(workspace.id, 'PC-02', {}, 'office 2019')
    await installOffice(workspace.id, 'PC-03', { managed: false })
    await installOffice(workspace.id, 'PC-04', { ignored: true })
    const main = await installOffice(workspace.id, 'PC-05')
    await installOffice(workspace.id, 'PC-06', { mergedIntoId: main.id })
    await installOffice(workspace.id, 'PC-07', {}, 'Firefox')
    await installOffice(other.id, 'PC-X')

    expect(
      expectOk(
        await SdLicenseRepository.countInstalled(workspace.id, 'Office'),
      ),
    ).toBe(3)
    const devices = expectOk(
      await SdLicenseRepository.listInstalledDevices(workspace.id, 'Office', 2),
    )
    expect(devices.map((d) => d.hostname)).toEqual(['PC-01', 'PC-02'])
    expect(devices[0].software).toEqual([
      { name: 'Microsoft Office Professional', version: '16.0' },
    ])
  })
})

describe('SdLicenseRepository notices', () => {
  it('lists expiring licenses and claims each notice kind once', async () => {
    const { workspace, other, user } = await setup()
    const withDate = await seedSdSoftwareLicense({
      workspaceId: workspace.id,
      createdById: user.id,
      expiresAt: new Date('2026-12-01T00:00:00Z'),
    })
    await seedSdSoftwareLicense({
      workspaceId: workspace.id,
      createdById: user.id,
      expiresAt: null,
    })
    await seedSdSoftwareLicense({
      workspaceId: workspace.id,
      createdById: user.id,
      expiresAt: new Date('2026-12-01T00:00:00Z'),
      archivedAt: new Date(),
    })
    await seedSdSoftwareLicense({
      workspaceId: other.id,
      createdById: user.id,
      expiresAt: new Date('2026-12-01T00:00:00Z'),
    })

    const rows = expectOk(
      await SdLicenseRepository.listWithExpiry([workspace.id]),
    )
    expect(rows.map((r) => r.id)).toEqual([withDate.id])
    expect(expectOk(await SdLicenseRepository.listWithExpiry([]))).toEqual([])

    const at = new Date()
    expect(
      expectOk(
        await SdLicenseRepository.claimNotice(withDate.id, 'NOTICE', at),
      ),
    ).toBe(true)
    expect(
      expectOk(
        await SdLicenseRepository.claimNotice(withDate.id, 'NOTICE', at),
      ),
    ).toBe(false)
    expect(
      expectOk(
        await SdLicenseRepository.claimNotice(withDate.id, 'EXPIRED', at),
      ),
    ).toBe(true)
  })

  it('lists owners and admins only', async () => {
    const { workspace } = await setup()
    const [owner, admin, member] = await Promise.all([
      seedUser(),
      seedUser(),
      seedUser(),
    ])
    await prisma.membership.createMany({
      data: [
        { userId: owner.id, workspaceId: workspace.id, role: 'OWNER' },
        { userId: admin.id, workspaceId: workspace.id, role: 'ADMIN' },
        { userId: member.id, workspaceId: workspace.id, role: 'MEMBER' },
      ],
    })
    const ids = expectOk(
      await SdLicenseRepository.listAdminUserIds(workspace.id),
    )
    expect(ids.sort()).toEqual([owner.id, admin.id].sort())
  })
})
