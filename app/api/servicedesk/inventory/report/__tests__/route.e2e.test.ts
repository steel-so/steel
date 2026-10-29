import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  createSdInventoryReport,
  seedSdInventoryToken,
} from '@/src/__tests__/factories/nov-s1-asset-inventory.factory'
import { authenticatedOwner, defaultHeaders } from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'
import { prisma } from '@/src/lib/prisma'

const url = `${BASE_URL}/api/servicedesk/inventory/report`

function send(token: string | null, body: unknown, raw?: string) {
  return fetch(url, {
    method: 'POST',
    headers: {
      ...defaultHeaders,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: raw ?? JSON.stringify(body),
  })
}

async function setup() {
  const { user, workspace } = await authenticatedOwner()
  const token = randomBytes(32).toString('base64url')
  const row = await seedSdInventoryToken({
    workspaceId: workspace.id,
    createdById: user.id,
    token,
  })
  return { user, workspace, token, row }
}

describe('public inventory report', () => {
  it('rejects a missing, malformed, unknown or revoked token', async () => {
    const report = createSdInventoryReport()

    for (const token of [
      null,
      'curto',
      randomBytes(32).toString('base64url'),
    ]) {
      const res = await send(token, report)
      expect(res.status).toBe(401)
      expect((await res.json()).error.code).toBe('SD_INVENTORY_TOKEN_INVALID')
    }

    const { token, row } = await setup()
    await prisma.sdInventoryToken.update({
      where: { id: row.id },
      data: { revokedAt: new Date() },
    })
    const revoked = await send(token, report)
    expect(revoked.status).toBe(401)
    expect((await revoked.json()).error.code).toBe('SD_INVENTORY_TOKEN_INVALID')
  })

  it('rejects a body that is not JSON or does not match the schema', async () => {
    const { token } = await setup()

    const broken = await send(token, null, '{ nao é json')
    expect(broken.status).toBe(422)
    expect((await broken.json()).error.code).toBe(
      'SD_INVENTORY_PAYLOAD_INVALID',
    )

    const invalid = await send(token, { agentId: 'x', hostname: '' })
    expect(invalid.status).toBe(422)
    expect((await invalid.json()).error.code).toBe(
      'SD_INVENTORY_PAYLOAD_INVALID',
    )
  })

  it('records the device, the CMDB item, the software and the disk alert', async () => {
    const { workspace, token, row } = await setup()
    const report = createSdInventoryReport({
      disks: [
        { mount: 'C:', label: null, fs: 'NTFS', totalMb: 1000, usedMb: 970 },
      ],
    })

    const res = await send(token, report)
    expect(res.status).toBe(200)
    const body = (await res.json()).data
    expect(body).toMatchObject({ created: true, openedAlerts: 1 })

    const device = await prisma.sdInventoryDevice.findUniqueOrThrow({
      where: { id: body.deviceId },
      include: { software: true, alerts: true, configItem: true },
    })
    expect(device).toMatchObject({
      workspaceId: workspace.id,
      hostname: 'PC-RECEPCAO',
      externalKey: `agent:${report.agentId}`,
      macAddresses: ['aa:bb:cc:dd:ee:ff'],
    })
    expect(device.software.map((s) => s.name)).toEqual(['Firefox'])
    expect(device.alerts).toMatchObject([
      { kind: 'DISK', status: 'OPEN', usedPercent: 97 },
    ])
    expect(device.configItem).toMatchObject({
      name: 'PC-RECEPCAO',
      serialNumber: 'SN-0001',
      workspaceId: workspace.id,
    })
    expect(
      (
        await prisma.sdInventoryToken.findUniqueOrThrow({
          where: { id: row.id },
        })
      ).lastUsedAt,
    ).not.toBeNull()
  })

  it('is idempotent: a second report updates, resolves the alert and keeps one item', async () => {
    const { workspace, token } = await setup()
    const first = await send(
      token,
      createSdInventoryReport({
        disks: [
          { mount: 'C:', label: null, fs: null, totalMb: 1000, usedMb: 970 },
        ],
      }),
    )
    expect(first.status).toBe(200)

    const second = await send(
      token,
      createSdInventoryReport({
        disks: [
          { mount: 'C:', label: null, fs: null, totalMb: 1000, usedMb: 100 },
        ],
        software: [],
      }),
    )
    expect(second.status).toBe(200)
    expect((await second.json()).data).toMatchObject({
      created: false,
      openedAlerts: 0,
      resolvedAlerts: 1,
    })
    expect(
      await prisma.sdInventoryDevice.count({
        where: { workspaceId: workspace.id },
      }),
    ).toBe(1)
    expect(
      await prisma.sdConfigItem.count({ where: { workspaceId: workspace.id } }),
    ).toBe(1)
    expect(await prisma.sdInventorySoftware.count()).toBe(0)
  })

  it('does not write into another workspace with the same agent id', async () => {
    const a = await setup()
    const b = await setup()
    const report = createSdInventoryReport()
    await send(a.token, report)
    await send(b.token, report)
    expect(
      await prisma.sdInventoryDevice.count({
        where: { workspaceId: a.workspace.id },
      }),
    ).toBe(1)
    expect(
      await prisma.sdInventoryDevice.count({
        where: { workspaceId: b.workspace.id },
      }),
    ).toBe(1)
  })

  it('refuses when the ServiceDesk module is disabled for the workspace', async () => {
    const { workspace, token } = await setup()
    await prisma.workspaceModuleAccess.updateMany({
      where: { workspaceId: workspace.id, module: 'SERVICE_DESK' },
      data: { enabled: false },
    })
    const res = await send(token, createSdInventoryReport())
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('MODULE_DISABLED')
  })
})
