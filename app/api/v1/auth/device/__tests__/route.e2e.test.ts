import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  getJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'
import { hashApiToken } from '@/src/lib/api/token'
import { prisma } from '@/src/lib/prisma'

/**
 * Device flow of `steel login` (ADR 0035, docs/cli/README.md): start, poll,
 * confirm on /device, receive the token once.
 */

function ip(): string {
  const n = () => Math.floor(Math.random() * 200) + 10
  return `${n()}.${n()}.${n()}.${n()}`
}

async function start(deviceName?: string) {
  const res = await postJson(
    '/api/v1/auth/device',
    deviceName ? { deviceName } : {},
    { extraHeaders: { 'x-forwarded-for': ip() } },
  )
  expect(res.status).toBe(200)
  expect(res.headers.get('cache-control')).toContain('no-store')
  const { data } = await res.json()
  return data as {
    deviceCode: string
    userCode: string
    verificationUri: string
    verificationUriComplete: string
    interval: number
    expiresIn: number
  }
}

async function poll(deviceCode: string) {
  const res = await postJson(
    '/api/v1/auth/device/token',
    { deviceCode },
    { extraHeaders: { 'x-forwarded-for': ip() } },
  )
  return { status: res.status, body: await res.json() }
}

describe('/api/v1/auth/device', () => {
  it('starts a login without a session or a token', async () => {
    const started = await start('notebook')
    expect(started.userCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    expect(started.verificationUri).toMatch(/\/device$/)
    expect(started.verificationUriComplete).toContain(
      `/device?code=${started.userCode}`,
    )
    expect(started.interval).toBe(5)
    expect(started.expiresIn).toBe(600)
  })

  it('accepts an empty body', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/auth/device`, {
      method: 'POST',
      headers: { 'x-forwarded-for': ip() },
    })
    expect(res.status).toBe(200)
  })

  it('rejects an invalid body', async () => {
    const res = await postJson(
      '/api/v1/auth/device',
      { deviceName: 'x'.repeat(101) },
      { extraHeaders: { 'x-forwarded-for': ip() } },
    )
    expect(res.status).toBe(422)
  })
})

describe('/api/v1/auth/device/token', () => {
  it('runs the whole flow: pending, approval on /device, token once', async () => {
    const { user, workspace } = await authenticatedOwner()
    const started = await start('notebook')

    const pending = await poll(started.deviceCode)
    expect(pending.status).toBe(428)
    expect(pending.body.error.code).toBe('AUTHORIZATION_PENDING')

    const approve = await postJson(
      '/api/device/authorize',
      {
        accept: true,
        userCode: started.userCode.toLowerCase(),
        workspaceId: workspace.id,
        modules: ['CRM', 'SERVICE_DESK'],
        scopes: ['api:read', 'api:write'],
        expiresInDays: 30,
      },
      user.cookie,
    )
    expect(approve.status).toBe(200)
    expect((await approve.json()).data).toEqual({ status: 'approved' })

    const granted = await poll(started.deviceCode)
    expect(granted.status).toBe(200)
    const token = granted.body.data
    expect(token).toMatchObject({
      workspace: { id: workspace.id, slug: workspace.slug },
      scopes: ['api:read', 'api:write'],
      modules: ['SERVICE_DESK', 'CRM'],
    })
    expect(token.token).toMatch(/^stl_pat_/)

    const row = await prisma.apiToken.findUnique({
      where: { id: token.tokenId },
    })
    expect(row).toMatchObject({
      userId: user.id,
      workspaceId: workspace.id,
      name: 'Steel CLI — notebook',
      createdVia: 'DEVICE',
      deviceName: 'notebook',
      tokenHash: hashApiToken(token.token),
    })

    // The approval is consumed: the token never comes back.
    const again = await poll(started.deviceCode)
    expect(again.status).toBe(410)
    expect(again.body.error.code).toBe('EXPIRED_TOKEN')

    // `steel logout`: the token revokes itself, then stops working.
    const logout = await fetch(`${BASE_URL}/api/v1/auth/token`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token.token}` },
    })
    expect(logout.status).toBe(204)
    expect(
      (await prisma.apiToken.findUnique({ where: { id: token.tokenId } }))
        ?.revokedAt,
    ).not.toBeNull()
    const after = await fetch(`${BASE_URL}/api/v1/auth/token`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token.token}` },
    })
    expect(after.status).toBe(401)
  })

  it('answers SLOW_DOWN when polled faster than the interval', async () => {
    const started = await start()
    expect((await poll(started.deviceCode)).status).toBe(428)
    const fast = await poll(started.deviceCode)
    expect(fast.status).toBe(429)
    expect(fast.body.error.code).toBe('SLOW_DOWN')
    expect(fast.body.error.details).toEqual({ interval: 10 })
  })

  it('answers ACCESS_DENIED once the user refuses', async () => {
    const { user } = await authenticatedOwner()
    const started = await start()
    const refuse = await postJson(
      '/api/device/authorize',
      { accept: false, userCode: started.userCode },
      user.cookie,
    )
    expect(refuse.status).toBe(200)
    expect((await refuse.json()).data).toEqual({ status: 'denied' })

    const denied = await poll(started.deviceCode)
    expect(denied.status).toBe(403)
    expect(denied.body.error.code).toBe('ACCESS_DENIED')
    expect((await poll(started.deviceCode)).status).toBe(410)
  })

  it('answers EXPIRED_TOKEN for an unknown device code', async () => {
    const unknown = await poll('x'.repeat(43))
    expect(unknown.status).toBe(410)
    expect(unknown.body.error.code).toBe('EXPIRED_TOKEN')
  })
})

describe('DELETE /api/v1/auth/token', () => {
  it('ignores the session cookie and requires a bearer token', async () => {
    const { user } = await authenticatedOwner()
    const res = await fetch(`${BASE_URL}/api/v1/auth/token`, {
      method: 'DELETE',
      headers: { Cookie: user.cookie },
    })
    expect(res.status).toBe(401)
  })

  it('rejects an unknown token', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/auth/token`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer stl_pat_${'x'.repeat(43)}` },
    })
    expect(res.status).toBe(401)
  })
})

describe('/api/device/authorize', () => {
  it('requires a session', async () => {
    const res = await postJson('/api/device/authorize', {
      accept: false,
      userCode: 'BCDFGH23',
    })
    expect(res.status).toBe(401)
  })

  it('answers each code once', async () => {
    const { user } = await authenticatedOwner()
    const started = await start()
    const first = await postJson(
      '/api/device/authorize',
      { accept: false, userCode: started.userCode },
      user.cookie,
    )
    expect(first.status).toBe(200)
    const second = await postJson(
      '/api/device/authorize',
      { accept: false, userCode: started.userCode },
      user.cookie,
    )
    expect(second.status).toBe(404)
    expect((await second.json()).error.code).toBe('DEVICE_CODE_INVALID')
  })

  it("refuses a workspace the user doesn't belong to", async () => {
    const { user } = await authenticatedOwner()
    const { workspace: foreign } = await authenticatedOwner()
    const started = await start()
    const res = await postJson(
      '/api/device/authorize',
      {
        accept: true,
        userCode: started.userCode,
        workspaceId: foreign.id,
        modules: ['CRM'],
        scopes: ['api:read'],
      },
      user.cookie,
    )
    expect(res.status).toBe(403)
    expect((await poll(started.deviceCode)).status).toBe(428)
  })

  it('refuses a module disabled in the workspace', async () => {
    const { user, workspace } = await authenticatedOwner()
    await prisma.workspaceModuleAccess.updateMany({
      where: { workspaceId: workspace.id, module: 'COMMUNICATION' },
      data: { enabled: false },
    })
    const started = await start()
    const res = await postJson(
      '/api/device/authorize',
      {
        accept: true,
        userCode: started.userCode,
        workspaceId: workspace.id,
        modules: ['COMMUNICATION'],
        scopes: ['api:read'],
      },
      user.cookie,
    )
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('MODULE_DISABLED')
  })

  it('lets a plain member approve for their own workspace', async () => {
    const { workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')
    const started = await start()
    const res = await postJson(
      '/api/device/authorize',
      {
        accept: true,
        userCode: started.userCode,
        workspaceId: workspace.id,
        modules: ['CRM'],
        scopes: ['api:read'],
      },
      member.cookie,
    )
    expect(res.status).toBe(200)
    const granted = await poll(started.deviceCode)
    expect(granted.status).toBe(200)
    expect(granted.body.data.scopes).toEqual(['api:read'])
  })
})

describe('/device', () => {
  it('sends a visitor without a session to sign in and back', async () => {
    const res = await getJson('/device?code=BCDF-GH23')
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain(
      `/sign-in?redirect=${encodeURIComponent('/device?code=BCDF-GH23')}`,
    )
  })
})
