import { describe, expect, it } from 'vitest'
import {
  authenticatedOwner,
  createAuthenticatedUser,
  getJson,
  putJson,
} from '@/src/__tests__/helpers/e2e'
import { prisma } from '@/src/lib/prisma'

async function createPlatformAdmin() {
  const user = await createAuthenticatedUser({
    email: `admin-nl-${Date.now()}@stratustelecom.com.br`,
  })
  await prisma.user.update({
    where: { id: user.id },
    data: { isPlatformAdmin: true },
  })
  return user
}

describe('/api/admin/workspaces/[id]/newsletter-settings', () => {
  it('is only for the platform admin', async () => {
    const { user, workspace } = await authenticatedOwner()
    const path = `/api/admin/workspaces/${workspace.id}/newsletter-settings`
    expect((await getJson(path, user.cookie)).status).toBe(403)
    expect(
      (await putJson(path, { monthlyEmailLimitOverride: 10 }, user.cookie))
        .status,
    ).toBe(403)
  })

  it('reads, overrides and clears the monthly limit', async () => {
    const admin = await createPlatformAdmin()
    const { workspace } = await authenticatedOwner()
    const path = `/api/admin/workspaces/${workspace.id}/newsletter-settings`

    const initial = (await (await getJson(path, admin.cookie)).json()).data
    expect(initial).toMatchObject({ limit: 3000, limitSource: 'PLAN' })

    const invalid = await putJson(
      path,
      { monthlyEmailLimitOverride: -1 },
      admin.cookie,
    )
    expect(invalid.status).toBe(422)

    const set = await putJson(
      path,
      { monthlyEmailLimitOverride: 50_000 },
      admin.cookie,
    )
    expect((await set.json()).data).toMatchObject({
      limit: 50_000,
      limitSource: 'OVERRIDE',
    })
    const cleared = await putJson(
      path,
      { monthlyEmailLimitOverride: null },
      admin.cookie,
    )
    expect((await cleared.json()).data.limitSource).toBe('PLAN')
  })
})
