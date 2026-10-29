import { describe, expect, it } from 'vitest'
import {
  createSdInventoryReport,
  seedSdInventoryToken,
} from '@/src/__tests__/factories/nov-s1-asset-inventory.factory'
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
import { BASE_URL } from '@/src/__tests__/setup.e2e'
import { prisma } from '@/src/lib/prisma'

/**
 * Inventário de ativos: contrato HTTP das rotas do workspace. Admin gerencia
 * tokens, alvos SNMP e ajustes; agente só consulta; solicitante e quem é de
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

describe('inventory tokens', () => {
  it('lets an admin create (value shown once), list and revoke', async () => {
    const { owner, workspace } = await setup()

    const created = await postJson(
      `${api(workspace.id)}/tokens`,
      { name: 'Matriz' },
      owner.cookie,
    )
    expect(created.status).toBe(201)
    const token = (await created.json()).data
    expect(token.token).toMatch(/^[A-Za-z0-9_-]{43}$/)

    const listed = (
      await (await getJson(`${api(workspace.id)}/tokens`, owner.cookie)).json()
    ).data
    expect(listed).toHaveLength(1)
    expect(listed[0]).not.toHaveProperty('token')
    expect(listed[0]).not.toHaveProperty('tokenHash')

    // O token criado de verdade autentica o agente.
    const report = await fetch(`${BASE_URL}/api/servicedesk/inventory/report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token.token}`,
      },
      body: JSON.stringify(createSdInventoryReport()),
    })
    expect(report.status).toBe(200)

    expect(
      (
        await deleteJson(
          `${api(workspace.id)}/tokens/${token.id}`,
          owner.cookie,
        )
      ).status,
    ).toBe(200)
    const after = await fetch(`${BASE_URL}/api/servicedesk/inventory/report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token.token}`,
      },
      body: JSON.stringify(createSdInventoryReport()),
    })
    expect(after.status).toBe(401)
  })

  it('denies agents, requesters, strangers and anonymous callers', async () => {
    const { agent, requester, workspace } = await setup()
    const viewer = await addMember(workspace.id, 'VIEWER')
    for (const who of [agent, requester, viewer]) {
      expect(
        (await getJson(`${api(workspace.id)}/tokens`, who.cookie)).status,
      ).toBe(403)
      expect(
        (
          await postJson(
            `${api(workspace.id)}/tokens`,
            { name: 'x' },
            who.cookie,
          )
        ).status,
      ).toBe(403)
    }
    expect((await getJson(`${api(workspace.id)}/tokens`)).status).toBe(401)
  })

  it('validates the name and cannot revoke a token of another workspace', async () => {
    const { owner, workspace } = await setup()
    expect(
      (
        await postJson(
          `${api(workspace.id)}/tokens`,
          { name: '' },
          owner.cookie,
        )
      ).status,
    ).toBe(422)

    const other = await authenticatedOwner()
    const foreign = await seedSdInventoryToken({
      workspaceId: other.workspace.id,
      createdById: other.user.id,
    })
    const res = await deleteJson(
      `${api(workspace.id)}/tokens/${foreign.id}`,
      owner.cookie,
    )
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('SD_INVENTORY_TOKEN_NOT_FOUND')
  })
})

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
    const token = await seedSdInventoryToken({
      workspaceId: ctx.workspace.id,
      createdById: ctx.owner.id,
      token: 'a'.repeat(43),
    })
    const report = await fetch(`${BASE_URL}/api/servicedesk/inventory/report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${'a'.repeat(43)}`,
      },
      body: JSON.stringify(
        createSdInventoryReport({
          disks: [
            { mount: 'C:', label: null, fs: null, totalMb: 1000, usedMb: 990 },
          ],
        }),
      ),
    })
    expect(report.status).toBe(200)
    return {
      ...ctx,
      token,
      deviceId: (await report.json()).data.deviceId as string,
    }
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
    expect(detail.configItemId).not.toBeNull()

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
