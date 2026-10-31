import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  createAuthenticatedUser,
  defaultHeaders,
  getJson,
  postJson,
  putJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

const criterion = {
  key: 'tone',
  name: 'Tom',
  description: 'Linguagem cordial e clara',
  weight: 2,
}

describe('QA routes authentication', () => {
  it('should return 401 via middleware when unauthenticated', async () => {
    for (const path of ['config', 'reviews', 'coaching']) {
      const res = await fetch(`${BASE_URL}/api/workspaces/some-id/qa/${path}`, {
        headers: defaultHeaders,
      })
      expect(res.status).toBe(401)
    }
  })

  it('should return 403 when the user is not a workspace member', async () => {
    const { workspace } = await authenticatedOwner()
    const stranger = await createAuthenticatedUser()
    for (const path of ['config', 'reviews', 'coaching']) {
      const res = await getJson(
        `/api/workspaces/${workspace.id}/qa/${path}`,
        stranger.cookie,
      )
      expect(res.status).toBe(403)
    }
  })
})

describe('QA settings', () => {
  it('should default to off with the four seeded criteria', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await getJson(
      `/api/workspaces/${workspace.id}/qa/config`,
      user.cookie,
    )
    expect(res.status).toBe(200)
    const config = (await res.json()).data
    expect(config.enabled).toBe(false)
    expect(config.criteria.map((c: { key: string }) => c.key)).toEqual([
      'tone',
      'resolution',
      'compliance',
      'empathy',
    ])
  })

  it('should let the owner turn it on and replace the criteria', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await putJson(
      `/api/workspaces/${workspace.id}/qa/config`,
      { enabled: true, lowScoreThreshold: 70, criteria: [criterion] },
      user.cookie,
    )
    expect(res.status).toBe(200)
    const config = (await res.json()).data
    expect(config).toMatchObject({ enabled: true, lowScoreThreshold: 70 })
    expect(config.criteria).toHaveLength(1)
    expect(config.criteria[0]).toMatchObject({ key: 'tone', weight: 2 })
  })

  it('should reject invalid settings with 422', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await putJson(
      `/api/workspaces/${workspace.id}/qa/config`,
      { lowScoreThreshold: 500 },
      user.cookie,
    )
    expect(res.status).toBe(422)
  })

  it('should not let a plain member change the settings', async () => {
    const { workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')
    const res = await putJson(
      `/api/workspaces/${workspace.id}/qa/config`,
      { enabled: true },
      member.cookie,
    )
    expect(res.status).toBe(403)
  })
})

describe('QA reviews and coaching', () => {
  it('should list nothing yet and return an empty coaching panel', async () => {
    const { user, workspace } = await authenticatedOwner()
    const list = await getJson(
      `/api/workspaces/${workspace.id}/qa/reviews?lowOnly=true`,
      user.cookie,
    )
    expect(list.status).toBe(200)
    expect((await list.json()).data).toEqual({ items: [], nextCursor: null })

    const coaching = await getJson(
      `/api/workspaces/${workspace.id}/qa/coaching`,
      user.cookie,
    )
    expect(coaching.status).toBe(200)
    expect((await coaching.json()).data).toMatchObject({
      reviews: 0,
      agents: [],
    })
  })

  it('should reject a bad query with 422', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await getJson(
      `/api/workspaces/${workspace.id}/qa/reviews?status=NOPE`,
      user.cookie,
    )
    expect(res.status).toBe(422)
  })

  it('should return 404 for an unknown review', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await getJson(
      `/api/workspaces/${workspace.id}/qa/reviews/nope`,
      user.cookie,
    )
    expect(res.status).toBe(404)
  })

  it('should refuse a manual review while the QA is off, then 404 for an unknown subject', async () => {
    const { user, workspace } = await authenticatedOwner()
    const url = `/api/workspaces/${workspace.id}/qa/reviews`
    const body = { subjectType: 'CONVERSATION', subjectId: 'nope' }

    const off = await postJson(url, body, user.cookie)
    expect(off.status).toBe(409)

    await putJson(
      `/api/workspaces/${workspace.id}/qa/config`,
      { enabled: true },
      user.cookie,
    )
    const unknown = await postJson(url, body, user.cookie)
    expect(unknown.status).toBe(404)

    const invalid = await postJson(url, { subjectType: 'X' }, user.cookie)
    expect(invalid.status).toBe(422)
  })
})
