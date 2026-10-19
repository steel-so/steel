import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  getJson,
  patchJson,
} from '@/src/__tests__/helpers/e2e'

describe('Workspace AI guardrails (ADR 0041)', () => {
  it('should return the defaults to a member, read-only', async () => {
    const { workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')

    const res = await getJson(
      `/api/workspaces/${workspace.id}/ai-guardrails`,
      member.cookie,
    )
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({
      workspaceId: workspace.id,
      piiMaskingPolicy: 'AUTO_REPLIES',
      injectionClassifierEnabled: false,
      forbiddenTopics: [],
      maxDiscountPercent: null,
      maxRefundAmount: null,
      maxDeadlineDays: null,
      updatedAt: null,
      canManage: false,
    })
  })

  it('should let the owner save, forbid a member and validate the body', async () => {
    const { user, workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')
    const url = `/api/workspaces/${workspace.id}/ai-guardrails`

    const forbidden = await patchJson(
      url,
      { piiMaskingPolicy: 'OFF' },
      member.cookie,
    )
    expect(forbidden.status).toBe(403)

    const invalid = await patchJson(
      url,
      { maxDiscountPercent: 150 },
      user.cookie,
    )
    expect(invalid.status).toBe(422)

    const saved = await patchJson(
      url,
      {
        piiMaskingPolicy: 'EVERYWHERE',
        forbiddenTopics: ['processo judicial'],
        maxDiscountPercent: 10,
        maxRefundAmount: 99.9,
      },
      user.cookie,
    )
    expect(saved.status).toBe(200)
    expect((await saved.json()).data).toMatchObject({
      piiMaskingPolicy: 'EVERYWHERE',
      forbiddenTopics: ['processo judicial'],
      maxDiscountPercent: 10,
      maxRefundAmount: 99.9,
      canManage: true,
    })

    const cleared = await patchJson(
      url,
      { maxDiscountPercent: null },
      user.cookie,
    )
    expect((await cleared.json()).data).toMatchObject({
      piiMaskingPolicy: 'EVERYWHERE',
      maxDiscountPercent: null,
      maxRefundAmount: 99.9,
    })
  })

  it('should refuse a non-member and an anonymous caller', async () => {
    const { workspace } = await authenticatedOwner()
    const outsider = await authenticatedOwner()
    const res = await getJson(
      `/api/workspaces/${workspace.id}/ai-guardrails`,
      outsider.user.cookie,
    )
    expect(res.status).toBe(403)
    const anonymous = await getJson(
      `/api/workspaces/${workspace.id}/ai-guardrails`,
    )
    expect(anonymous.status).toBe(401)
  })
})
