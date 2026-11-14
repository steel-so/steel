import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  getJson,
  patchJson,
} from '@/src/__tests__/helpers/e2e'

describe('GET & PATCH /api/workspaces/[id]/crm/retention', () => {
  it('should serve the defaults and let the owner customize them', async () => {
    const { user, workspace } = await authenticatedOwner()
    const url = `/api/workspaces/${workspace.id}/crm/retention`

    const initial = await getJson(url, user.cookie)
    expect(initial.status).toBe(200)
    expect((await initial.json()).data).toMatchObject({
      onDetractor: true,
      onHealthDrop: true,
      createOpportunity: false,
      taskDueDays: 2,
      isDefault: true,
    })

    const updated = await patchJson(
      url,
      { createOpportunity: true, taskDueDays: 5 },
      user.cookie,
    )
    expect(updated.status).toBe(200)
    expect((await updated.json()).data).toMatchObject({
      createOpportunity: true,
      taskDueDays: 5,
      isDefault: false,
    })
  })

  it('should let a member read but not change the rules', async () => {
    const { workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')
    const url = `/api/workspaces/${workspace.id}/crm/retention`

    expect((await getJson(url, member.cookie)).status).toBe(200)
    expect(
      (await patchJson(url, { onDetractor: false }, member.cookie)).status,
    ).toBe(403)
  })

  it('should reject invalid values', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await patchJson(
      `/api/workspaces/${workspace.id}/crm/retention`,
      { taskDueDays: 0 },
      user.cookie,
    )
    expect(res.status).toBe(422)
  })
})
