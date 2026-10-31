import { describe, expect, it } from 'vitest'
import { seedSdInventoryDevice } from '@/src/__tests__/factories/nov-s1-asset-inventory.factory'
import {
  seedSdDepartment,
  seedSdDepartmentMember,
} from '@/src/__tests__/factories/sd-ticket-context.factory'
import {
  addMember,
  authenticatedOwner,
  deleteJson,
  getJson,
  patchJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { prisma } from '@/src/lib/prisma'

/**
 * Inventário de ativos: contrato HTTP das rotas do workspace. Admin gerencia
 * alvos SNMP e ajustes; agente só consulta; solicitante e quem é de
 * fora não veem nada.
 */

const api = (ws: string) => `/api/workspaces/${ws}/servicedesk/inventory`

async function setup() {
  const { user: owner, workspace } = await authenticatedOwner()
  const agent = await addMember(workspace.id, 'MEMBER')
  const department = await seedSdDepartment(workspace.id)
  await seedSdDepartmentMember(department.id, agent.id)
  const requester = await addMember(workspace.id, 'MEMBER')
  return { owner, agent, requester, workspace }
}

describe('inventory settings', () => {
  it('returns the defaults, saves for admins and reads back', async () => {
    const { owner, agent, workspace } = await setup()
    const defaults = (
      await (
        await getJson(`${api(workspace.id)}/settings`, agent.cookie)
      ).json()
    ).data
    expect(defaults).toMatchObject({
      diskThresholdPercent: 90,
      staleAfterDays: 7,
    })

    const saved = await patchJson(
      `${api(workspace.id)}/settings`,
      { diskThresholdPercent: 75, syncConfigItems: false },
      owner.cookie,
    )
    expect(saved.status).toBe(200)
    const reread = (
      await (
        await getJson(`${api(workspace.id)}/settings`, agent.cookie)
      ).json()
    ).data
    expect(reread).toMatchObject({
      diskThresholdPercent: 75,
      syncConfigItems: false,
    })
  })

  it('rejects out-of-range values and non-admin writes', async () => {
    const { owner, agent, workspace } = await setup()
    expect(
      (
        await patchJson(
          `${api(workspace.id)}/settings`,
          { diskThresholdPercent: 10 },
          owner.cookie,
        )
      ).status,
    ).toBe(422)
    expect(
      (
        await patchJson(
          `${api(workspace.id)}/settings`,
          { diskThresholdPercent: 80 },
          agent.cookie,
        )
      ).status,
    ).toBe(403)
  })
})

describe('SNMP targets', () => {
  const payload = {
    name: 'Matriz',
    ranges: ['10.0.0.0/30'],
    community: 'segredo-snmp',
  }

  it('creates without echoing the community, edits, scans now and deletes', async () => {
    const { owner, workspace } = await setup()
    const created = await postJson(
      `${api(workspace.id)}/snmp-targets`,
      payload,
      owner.cookie,
    )
    expect(created.status).toBe(201)
    const target = (await created.json()).data
    expect(target).toMatchObject({
      hasCommunity: true,
      port: 161,
      intervalMinutes: 1440,
    })
    expect(JSON.stringify(target)).not.toContain('segredo-snmp')

    const stored = await prisma.sdInventorySnmpTarget.findUniqueOrThrow({
      where: { id: target.id },
    })
    expect(stored.communityEnc).not.toContain('segredo-snmp')

    const edited = await patchJson(
      `${api(workspace.id)}/snmp-targets/${target.id}`,
      { name: 'Filial', intervalMinutes: 60 },
      owner.cookie,
    )
    expect(edited.status).toBe(200)
    expect((await edited.json()).data).toMatchObject({
      name: 'Filial',
      intervalMinutes: 60,
    })

    const scan = await postJson(
      `${api(workspace.id)}/snmp-targets/${target.id}/scan`,
      {},
      owner.cookie,
    )
    expect(scan.status).toBe(200)

    expect(
      (
        await deleteJson(
          `${api(workspace.id)}/snmp-targets/${target.id}`,
          owner.cookie,
        )
      ).status,
    ).toBe(200)
    const listed = (
      await (
        await getJson(`${api(workspace.id)}/snmp-targets`, owner.cookie)
      ).json()
    ).data
    expect(listed).toHaveLength(0)
  })

  it('rejects bad ranges and denies non-admins', async () => {
    const { owner, agent, workspace } = await setup()
    const bad = await postJson(
      `${api(workspace.id)}/snmp-targets`,
      { ...payload, ranges: ['10.0.0.0/8'] },
      owner.cookie,
    )
    expect(bad.status).toBe(422)
    expect(
      (
        await postJson(
          `${api(workspace.id)}/snmp-targets`,
          payload,
          agent.cookie,
        )
      ).status,
    ).toBe(403)
    expect(
      (await getJson(`${api(workspace.id)}/snmp-targets`, agent.cookie)).status,
    ).toBe(403)
  })
})

describe('inventory queries', () => {
  async function withDevice() {
    const ctx = await setup()
    const device = await seedSdInventoryDevice({
      workspaceId: ctx.workspace.id,
      hostname: 'PC-RECEPCAO',
      disks: [
        { mount: 'C:', label: null, fs: null, totalMb: 1000, usedMb: 990 },
      ],
    })
    await prisma.sdInventoryAlert.create({
      data: {
        workspaceId: ctx.workspace.id,
        deviceId: device.id,
        kind: 'DISK',
        mount: 'C:',
        usedPercent: 99,
        threshold: 90,
      },
    })
    await prisma.sdInventorySoftware.create({
      data: { deviceId: device.id, name: 'Firefox', version: '130.0' },
    })
    return { ...ctx, deviceId: device.id }
  }

  it('lets agents list, filter, open the detail and read summary, alerts and software', async () => {
    const { agent, workspace, deviceId } = await withDevice()

    const list = (
      await (
        await getJson(
          `${api(workspace.id)}/devices?hasAlert=true&search=recep`,
          agent.cookie,
        )
      ).json()
    ).data
    expect(list).toMatchObject({ total: 1, page: 1 })
    expect(list.items[0]).toMatchObject({
      hostname: 'PC-RECEPCAO',
      openAlerts: 1,
    })

    const detail = (
      await (
        await getJson(`${api(workspace.id)}/devices/${deviceId}`, agent.cookie)
      ).json()
    ).data
    expect(detail.software).toHaveLength(1)
    expect(detail.alerts).toHaveLength(1)

    const summary = (
      await (await getJson(`${api(workspace.id)}/summary`, agent.cookie)).json()
    ).data
    expect(summary).toMatchObject({ total: 1, agents: 1, openAlerts: 1 })

    const alerts = (
      await (
        await getJson(`${api(workspace.id)}/alerts?status=OPEN`, agent.cookie)
      ).json()
    ).data
    expect(alerts).toHaveLength(1)

    const software = (
      await (
        await getJson(`${api(workspace.id)}/software?search=fire`, agent.cookie)
      ).json()
    ).data
    expect(software.items[0]).toMatchObject({ name: 'Firefox', deviceCount: 1 })
  })

  it('validates the query and hides the device from other workspaces', async () => {
    const { agent, workspace, deviceId } = await withDevice()
    expect(
      (
        await getJson(
          `${api(workspace.id)}/devices?pageSize=1000`,
          agent.cookie,
        )
      ).status,
    ).toBe(422)

    const other = await authenticatedOwner()
    const res = await getJson(
      `${api(other.workspace.id)}/devices/${deviceId}`,
      other.user.cookie,
    )
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('SD_INVENTORY_DEVICE_NOT_FOUND')
  })

  it('denies requesters and anonymous callers', async () => {
    const { requester, workspace } = await withDevice()
    for (const path of [
      'summary',
      'devices',
      'alerts',
      'software',
      'settings',
    ]) {
      expect(
        (await getJson(`${api(workspace.id)}/${path}`, requester.cookie))
          .status,
      ).toBe(403)
      expect((await getJson(`${api(workspace.id)}/${path}`)).status).toBe(401)
    }
  })
})

describe('inventory discovery, adoption and merge', () => {
  it('only lets admins manage discovery ranges (private networks, opt-in)', async () => {
    const { owner, agent, requester, workspace } = await setup()
    const url = `${api(workspace.id)}/discovery-ranges`

    const created = await postJson(
      url,
      { name: 'VLAN', cidr: '10.0.1.0/24' },
      owner.cookie,
    )
    expect(created.status).toBe(201)
    const range = (await created.json()).data
    expect(range.enabled).toBe(false)

    expect(
      (
        await postJson(
          url,
          { name: 'Internet', cidr: '8.8.8.0/24' },
          owner.cookie,
        )
      ).status,
    ).toBe(422)

    // Varredura só com o opt-in ligado.
    expect(
      (await postJson(`${url}/${range.id}/scan`, {}, owner.cookie)).status,
    ).toBe(422)
    const enabled = await patchJson(
      `${url}/${range.id}`,
      { enabled: true },
      owner.cookie,
    )
    expect((await enabled.json()).data.enabled).toBe(true)

    for (const who of [agent, requester]) {
      expect((await getJson(url, who.cookie)).status).toBe(403)
      expect(
        (await postJson(url, { name: 'x', cidr: '10.9.0.0/24' }, who.cookie))
          .status,
      ).toBe(403)
    }

    expect((await deleteJson(`${url}/${range.id}`, owner.cookie)).status).toBe(
      200,
    )
    expect((await (await getJson(url, owner.cookie)).json()).data).toHaveLength(
      0,
    )
  })

  it('adopts a discovered device and dismisses another', async () => {
    const { owner, agent, workspace } = await setup()
    const found = await prisma.sdInventoryDevice.create({
      data: {
        workspaceId: workspace.id,
        source: 'DISCOVERY',
        externalKey: 'disc:ip:10.0.1.9',
        hostname: 'impressora',
        managed: false,
        ipAddresses: ['10.0.1.9'],
      },
    })
    const spare = await prisma.sdInventoryDevice.create({
      data: {
        workspaceId: workspace.id,
        source: 'DISCOVERY',
        externalKey: 'disc:ip:10.0.1.10',
        hostname: 'camera',
        managed: false,
      },
    })
    const devices = `${api(workspace.id)}/devices`

    const listed = (
      await (await getJson(`${devices}?discovered=true`, owner.cookie)).json()
    ).data
    expect(
      listed.items.map((d: { hostname: string }) => d.hostname).sort(),
    ).toEqual(['camera', 'impressora'])

    expect(
      (await postJson(`${devices}/${found.id}/adopt`, {}, agent.cookie)).status,
    ).toBe(403)
    const adopted = await postJson(
      `${devices}/${found.id}/adopt`,
      {},
      owner.cookie,
    )
    expect(adopted.status).toBe(200)
    expect((await adopted.json()).data.configItemId).toBeTruthy()
    // Já adotado: não adota duas vezes.
    expect(
      (await postJson(`${devices}/${found.id}/adopt`, {}, owner.cookie)).status,
    ).toBe(409)

    expect(
      (await deleteJson(`${devices}/${spare.id}`, owner.cookie)).status,
    ).toBe(200)
    const after = (
      await (await getJson(`${devices}?discovered=true`, owner.cookie)).json()
    ).data
    expect(after.items).toHaveLength(0)
  })

  it('merges two devices manually and unmerges them', async () => {
    const { owner, workspace } = await setup()
    const [primary, other] = await Promise.all(
      ['PC-A', 'switch-a'].map((hostname, index) =>
        prisma.sdInventoryDevice.create({
          data: {
            workspaceId: workspace.id,
            source: index === 0 ? 'AGENT' : 'SNMP',
            externalKey: `k:${hostname}`,
            hostname,
          },
        }),
      ),
    )
    const devices = `${api(workspace.id)}/devices`

    expect(
      (
        await postJson(
          `${devices}/${primary.id}/merge`,
          { intoId: primary.id },
          owner.cookie,
        )
      ).status,
    ).toBe(409)
    expect(
      (
        await postJson(
          `${devices}/${other.id}/merge`,
          { intoId: primary.id },
          owner.cookie,
        )
      ).status,
    ).toBe(200)

    const list = (await (await getJson(devices, owner.cookie)).json()).data
    expect(list.items.map((d: { id: string }) => d.id)).toEqual([primary.id])
    const detail = (
      await (await getJson(`${devices}/${primary.id}`, owner.cookie)).json()
    ).data
    expect(detail.mergedSources).toEqual([
      { id: other.id, hostname: 'switch-a', source: 'SNMP' },
    ])

    expect(
      (await postJson(`${devices}/${other.id}/unmerge`, {}, owner.cookie))
        .status,
    ).toBe(200)
    expect(
      (await postJson(`${devices}/${other.id}/unmerge`, {}, owner.cookie))
        .status,
    ).toBe(409)
    const again = (await (await getJson(devices, owner.cookie)).json()).data
    expect(again.items).toHaveLength(2)
  })

  it('stores SNMPv3 targets without ever returning the keys', async () => {
    const { owner, workspace } = await setup()
    const url = `${api(workspace.id)}/snmp-targets`
    const created = await postJson(
      url,
      {
        name: 'Core v3',
        ranges: ['10.0.0.1'],
        snmpVersion: 'V3',
        v3Username: 'monitor',
        v3AuthKey: 'auth-secret-1',
        v3PrivKey: 'priv-secret-1',
      },
      owner.cookie,
    )
    expect(created.status).toBe(201)
    const target = (await created.json()).data
    expect(target).toMatchObject({
      snmpVersion: 'V3',
      hasCommunity: false,
      hasV3AuthKey: true,
      hasV3PrivKey: true,
    })
    expect(JSON.stringify(target)).not.toContain('secret')

    // v3 sem usuário é recusado.
    expect(
      (
        await postJson(
          url,
          { name: 'x', ranges: ['10.0.0.2'], snmpVersion: 'V3' },
          owner.cookie,
        )
      ).status,
    ).toBe(422)
  })
})
