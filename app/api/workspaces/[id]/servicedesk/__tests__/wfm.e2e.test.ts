import { describe, expect, it } from 'vitest'
import { seedSdTicket } from '@/src/__tests__/factories/sd-ticket.factory'
import {
  seedSdDepartment,
  seedSdDepartmentMember,
  seedSdPhaseFlow,
  seedSdSettings,
} from '@/src/__tests__/factories/sd-ticket-context.factory'
import {
  addMember,
  authenticatedOwner,
  createAuthenticatedUser,
  getJson,
  patchJson,
} from '@/src/__tests__/helpers/e2e'

const wfm = (workspaceId: string, path: string) =>
  `/api/workspaces/${workspaceId}/servicedesk/wfm/${path}`

async function setup() {
  const { user: owner, workspace } = await authenticatedOwner()
  await seedSdSettings(workspace.id)
  const flow = await seedSdPhaseFlow(workspace.id)
  const department = await seedSdDepartment(workspace.id)
  await seedSdDepartmentMember(department.id, owner.id)
  const requester = await addMember(workspace.id)
  return { owner, requester, workspace, flow, department }
}

describe('ServiceDesk demand forecast (WFM)', () => {
  it('is agent-only', async () => {
    const { workspace, requester } = await setup()
    const stranger = await createAuthenticatedUser()
    expect(
      (await getJson(wfm(workspace.id, 'forecast'), stranger.cookie)).status,
    ).toBe(403)
    const res = await getJson(wfm(workspace.id, 'forecast'), requester.cookie)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('SD_NOT_AGENT')
  })

  it('forecasts from the ticket history', async () => {
    const { owner, workspace, flow } = await setup()
    await seedSdTicket(workspace.id, flow.initial.id)
    const res = await getJson(wfm(workspace.id, 'forecast'), owner.cookie)
    expect(res.status).toBe(200)
    const data = (await res.json()).data
    expect(data.heatmap).toHaveLength(7)
    expect(data.daily).toHaveLength(14)
    expect(data.insufficientData).toBe(true)
  })

  it('filters by department and rejects a foreign one', async () => {
    const { owner, workspace, department } = await setup()
    const ok = await getJson(
      `${wfm(workspace.id, 'forecast')}?departmentId=${department.id}`,
      owner.cookie,
    )
    expect(ok.status).toBe(200)
    const missing = await getJson(
      `${wfm(workspace.id, 'forecast')}?departmentId=nope`,
      owner.cookie,
    )
    expect(missing.status).toBe(404)
  })

  it('lets the admin change the settings and validates them', async () => {
    const { owner, workspace } = await setup()
    const saved = await patchJson(
      wfm(workspace.id, 'settings'),
      {
        minAgentsPerShift: 2,
        shifts: [{ name: 'Noite', startHour: 22, endHour: 6 }],
      },
      owner.cookie,
    )
    expect(saved.status).toBe(200)
    const read = await getJson(wfm(workspace.id, 'settings'), owner.cookie)
    expect((await read.json()).data).toMatchObject({ minAgentsPerShift: 2 })

    const invalid = await patchJson(
      wfm(workspace.id, 'settings'),
      { historyWeeks: 1 },
      owner.cookie,
    )
    expect(invalid.status).toBe(400)
  })
})
