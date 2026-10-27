import { describe, expect, it } from 'vitest'
import {
  createAuthenticatedUser,
  createWorkspaceForUser,
  getJson,
} from '@/src/__tests__/helpers/e2e'
import { prisma } from '@/src/lib/prisma'

async function createPlatformAdmin() {
  const user = await createAuthenticatedUser({
    email: `admin-${Date.now()}@stratustelecom.com.br`,
  })
  await prisma.user.update({
    where: { id: user.id },
    data: { isPlatformAdmin: true },
  })
  return user
}

describe('Admin workspace access log routes', () => {
  it('lists and exports the log of any workspace to the global admin', async () => {
    const admin = await createPlatformAdmin()
    const owner = await createAuthenticatedUser()
    const ws = await createWorkspaceForUser(owner.id)
    await prisma.workspace.update({
      where: { id: ws.id },
      data: { allowedIps: ['10.0.0.0/8'] },
    })
    await prisma.workspaceAccessLog.create({
      data: {
        workspaceId: ws.id,
        userId: owner.id,
        userEmail: 'dono@acme.com.br',
        userName: 'Dono',
        ip: '8.8.4.4',
        outcome: 'BLOCKED',
        surface: 'APP',
        path: '/acme/home',
      },
    })

    const list = await getJson(
      `/api/admin/workspaces/${ws.id}/access-logs`,
      admin.cookie,
    )
    expect(list.status).toBe(200)
    const data = (await list.json()).data
    expect(data.allowedIps).toEqual(['10.0.0.0/8'])
    expect(data.total).toBe(1)
    expect(data.items[0]).toMatchObject({
      userEmail: 'dono@acme.com.br',
      outcome: 'BLOCKED',
      surface: 'APP',
    })

    const csv = await getJson(
      `/api/admin/workspaces/${ws.id}/access-logs/export`,
      admin.cookie,
    )
    expect(csv.status).toBe(200)
    expect(csv.headers.get('content-type')).toContain('text/csv')
    expect(await csv.text()).toContain('dono@acme.com.br')
  })

  it('forbids anyone who is not a platform admin, even the owner', async () => {
    const owner = await createAuthenticatedUser()
    const ws = await createWorkspaceForUser(owner.id)
    const list = await getJson(
      `/api/admin/workspaces/${ws.id}/access-logs`,
      owner.cookie,
    )
    expect(list.status).toBe(403)
    const csv = await getJson(
      `/api/admin/workspaces/${ws.id}/access-logs/export`,
      owner.cookie,
    )
    expect(csv.status).toBe(403)
  })

  it('answers 404 for a missing workspace and 422 for bad filters', async () => {
    const admin = await createPlatformAdmin()
    const missing = await getJson(
      '/api/admin/workspaces/missing-ws/access-logs',
      admin.cookie,
    )
    expect(missing.status).toBe(404)
    const bad = await getJson(
      '/api/admin/workspaces/missing-ws/access-logs?pageSize=500',
      admin.cookie,
    )
    expect(bad.status).toBe(422)
    const badCsv = await getJson(
      '/api/admin/workspaces/missing-ws/access-logs/export?from=x',
      admin.cookie,
    )
    expect(badCsv.status).toBe(422)
  })
})
