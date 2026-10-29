import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { seedSdConfigItem } from '@/src/__tests__/factories/sd-config-item.factory'
import { sdMonitorToken } from '@/src/__tests__/factories/sd-monitor.factory'
import {
  addMember,
  authenticatedOwner,
  getJson,
  patchJson,
} from '@/src/__tests__/helpers/e2e'
import { prisma } from '@/src/lib/prisma'

const api = (workspaceId: string, path: string) =>
  `/api/workspaces/${workspaceId}/servicedesk/${path}`

async function setup() {
  const { user, workspace } = await authenticatedOwner()
  const source = await prisma.sdMonitorSource.create({
    data: {
      workspaceId: workspace.id,
      createdById: user.id,
      name: 'Zabbix',
      tokenHash: sdMonitorToken(randomBytes(16).toString('hex')).hash,
    },
  })
  const alert = await prisma.sdMonitorAlert.create({
    data: {
      workspaceId: workspace.id,
      sourceId: source.id,
      externalId: '1',
      subject: 'CPU alta',
      host: 'srv-novo.lan',
    },
  })
  const ci = await seedSdConfigItem(workspace.id, user.id, { name: 'SRV-NOVO' })
  return { user, workspace, alert, ci }
}

describe('/api/workspaces/[id]/servicedesk/monitor-alerts', () => {
  it('lists the alerts without a CI and links one, remembering the host', async () => {
    const { user, workspace, alert, ci } = await setup()

    const unmatched = await getJson(
      `${api(workspace.id, 'monitor-alerts')}?unmatched=true`,
      user.cookie,
    )
    expect(unmatched.status).toBe(200)
    expect(
      (await unmatched.json()).data.map((a: { id: string }) => a.id),
    ).toEqual([alert.id])

    const linked = await patchJson(
      api(workspace.id, `monitor-alerts/${alert.id}`),
      { configItemId: ci.id, remember: true },
      user.cookie,
    )
    expect(linked.status).toBe(200)
    const body = (await linked.json()).data
    expect(body.configItem).toEqual({ id: ci.id, name: 'SRV-NOVO' })

    const alias = await prisma.sdMonitorHostAlias.findFirstOrThrow({
      where: { workspaceId: workspace.id },
    })
    expect(alias.host).toBe('srv-novo.lan')
    expect(alias.configItemId).toBe(ci.id)

    const byCi = await getJson(
      `${api(workspace.id, 'monitor-alerts')}?configItemId=${ci.id}`,
      user.cookie,
    )
    expect((await byCi.json()).data).toHaveLength(1)
    const empty = await getJson(
      `${api(workspace.id, 'monitor-alerts')}?unmatched=true`,
      user.cookie,
    )
    expect((await empty.json()).data).toHaveLength(0)
  })

  it('validates the body and refuses unknown ids', async () => {
    const { user, workspace, alert } = await setup()
    const invalid = await patchJson(
      api(workspace.id, `monitor-alerts/${alert.id}`),
      { remember: true },
      user.cookie,
    )
    expect(invalid.status).toBe(422)

    const missingCi = await patchJson(
      api(workspace.id, `monitor-alerts/${alert.id}`),
      { configItemId: 'nao-existe' },
      user.cookie,
    )
    expect((await missingCi.json()).error.code).toBe('SD_CONFIG_NOT_FOUND')

    const missingAlert = await patchJson(
      api(workspace.id, 'monitor-alerts/nao-existe'),
      { configItemId: null },
      user.cookie,
    )
    expect(missingAlert.status).toBe(404)
    expect((await missingAlert.json()).error.code).toBe(
      'SD_MONITOR_ALERT_NOT_FOUND',
    )
  })

  it('refuses outsiders and unauthenticated calls', async () => {
    const { workspace, alert, ci } = await setup()
    const outsider = await addMember(workspace.id, 'VIEWER')
    const denied = await patchJson(
      api(workspace.id, `monitor-alerts/${alert.id}`),
      { configItemId: ci.id },
      outsider.cookie,
    )
    expect(denied.status).toBe(403)

    const anonymous = await patchJson(
      api(workspace.id, `monitor-alerts/${alert.id}`),
      { configItemId: ci.id },
    )
    expect(anonymous.status).toBe(401)
  })
})
