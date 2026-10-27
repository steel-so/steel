import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  getJson,
} from '@/src/__tests__/helpers/e2e'
import { prisma } from '@/src/lib/prisma'

const INSIDE = { 'x-forwarded-for': '10.20.30.40' }
const OUTSIDE = { 'x-forwarded-for': '8.8.4.4' }

async function restrictedWorkspace() {
  const { user, workspace } = await authenticatedOwner()
  await prisma.workspace.update({
    where: { id: workspace.id },
    data: { allowedIps: ['10.0.0.0/8'] },
  })
  return { user, workspace }
}

/** The log is written fire-and-forget: poll until the row lands. */
async function waitForEntries(
  path: string,
  cookie: string,
  predicate: (items: Array<Record<string, unknown>>) => boolean,
) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = await getJson(path, { cookie, extraHeaders: INSIDE })
    expect(res.status).toBe(200)
    const data = (await res.json()).data
    if (predicate(data.items)) return data
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error('access log entry never appeared')
}

describe('Workspace access log routes', () => {
  it('records a blocked attempt and lists it to the owner', async () => {
    const { user, workspace } = await restrictedWorkspace()

    const blocked = await getJson(`/api/workspaces/${workspace.id}/members`, {
      cookie: user.cookie,
      extraHeaders: OUTSIDE,
    })
    expect(blocked.status).toBe(403)
    expect((await blocked.json()).error.code).toBe('WORKSPACE_IP_NOT_ALLOWED')

    const data = await waitForEntries(
      `/api/workspaces/${workspace.id}/access-logs?outcome=BLOCKED`,
      user.cookie,
      (items) => items.length > 0,
    )
    expect(data.allowedIps).toEqual(['10.0.0.0/8'])
    expect(data.period.timezone).toBe('America/Sao_Paulo')
    expect(data.items[0]).toMatchObject({
      userId: user.id,
      ip: '8.8.4.4',
      outcome: 'BLOCKED',
      surface: 'API',
      path: `/api/workspaces/${workspace.id}/members`,
    })
    expect(data.items[0].userEmail).toBeTruthy()

    // The owner's own reads from inside are logged as allowed, once.
    const allowed = await waitForEntries(
      `/api/workspaces/${workspace.id}/access-logs?outcome=ALLOWED`,
      user.cookie,
      (items) => items.length > 0,
    )
    expect(allowed.items).toHaveLength(1)
    expect(allowed.items[0]).toMatchObject({ ip: '10.20.30.40' })
  })

  it('exports the filtered log as CSV', async () => {
    const { user, workspace } = await restrictedWorkspace()
    await getJson(`/api/workspaces/${workspace.id}/members`, {
      cookie: user.cookie,
      extraHeaders: OUTSIDE,
    })
    await waitForEntries(
      `/api/workspaces/${workspace.id}/access-logs?outcome=BLOCKED`,
      user.cookie,
      (items) => items.length > 0,
    )

    const res = await getJson(
      `/api/workspaces/${workspace.id}/access-logs/export?outcome=BLOCKED`,
      { cookie: user.cookie, extraHeaders: INSIDE },
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/csv')
    expect(res.headers.get('content-disposition')).toMatch(
      /attachment; filename="acessos-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv"/,
    )
    const csv = await res.text()
    expect(csv).toContain('Data e hora (São Paulo),Resultado,Canal')
    expect(csv).toContain('Bloqueado,API')
    expect(csv).toContain('8.8.4.4')
  })

  it('forbids members who are not OWNER/ADMIN and other workspaces', async () => {
    const { workspace } = await restrictedWorkspace()
    const member = await addMember(workspace.id, 'MEMBER')
    const list = await getJson(`/api/workspaces/${workspace.id}/access-logs`, {
      cookie: member.cookie,
      extraHeaders: INSIDE,
    })
    expect(list.status).toBe(403)
    const csv = await getJson(
      `/api/workspaces/${workspace.id}/access-logs/export`,
      { cookie: member.cookie, extraHeaders: INSIDE },
    )
    expect(csv.status).toBe(403)

    const { user: stranger } = await authenticatedOwner()
    const other = await getJson(`/api/workspaces/${workspace.id}/access-logs`, {
      cookie: stranger.cookie,
      extraHeaders: INSIDE,
    })
    expect(other.status).toBe(403)
  })

  it('lists nothing for a workspace without an allowlist', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await getJson(
      `/api/workspaces/${workspace.id}/access-logs`,
      user.cookie,
    )
    expect(res.status).toBe(200)
    const data = (await res.json()).data
    expect(data).toMatchObject({ allowedIps: [], total: 0, items: [] })
  })

  it('validates the filters and requires a session', async () => {
    const { user, workspace } = await authenticatedOwner()
    const bad = await getJson(
      `/api/workspaces/${workspace.id}/access-logs?from=2026-10-27&to=2026-10-01`,
      user.cookie,
    )
    expect(bad.status).toBe(422)
    const badCsv = await getJson(
      `/api/workspaces/${workspace.id}/access-logs/export?outcome=DENIED`,
      user.cookie,
    )
    expect(badCsv.status).toBe(422)

    const anonymous = await getJson(
      `/api/workspaces/${workspace.id}/access-logs`,
    )
    expect(anonymous.status).toBe(401)
  })
})
