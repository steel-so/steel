import { describe, expect, it } from 'vitest'
import {
  createAuthenticatedUser,
  defaultHeaders,
  getJson,
  postJson,
  putJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'
import { prisma } from '@/src/lib/prisma'

async function createPlatformAdmin() {
  const user = await createAuthenticatedUser({
    email: `zapi-line-${Date.now()}@stratustelecom.com.br`,
  })
  await prisma.user.update({
    where: { id: user.id },
    data: { isPlatformAdmin: true },
  })
  return user
}

const PATHS = ['', '/status', '/qr-code']

describe('/api/admin/zapi-line', () => {
  it('should return 401 via middleware when unauthenticated', async () => {
    for (const path of PATHS) {
      const res = await fetch(`${BASE_URL}/api/admin/zapi-line${path}`, {
        headers: defaultHeaders,
      })
      expect(res.status).toBe(401)
    }
  })

  it('should return 403 on every operation for a non-platform-admin', async () => {
    const user = await createAuthenticatedUser()
    for (const path of PATHS) {
      expect(
        (await getJson(`/api/admin/zapi-line${path}`, user.cookie)).status,
      ).toBe(403)
    }
    const save = await putJson(
      '/api/admin/zapi-line',
      { instanceId: 'abc', token: 'def' },
      user.cookie,
    )
    expect(save.status).toBe(403)
    const reason = { reason: 'tentativa sem permissão' }
    expect(
      (await postJson('/api/admin/zapi-line/restart', reason, user.cookie))
        .status,
    ).toBe(403)
    expect(
      (await postJson('/api/admin/zapi-line/disconnect', reason, user.cookie))
        .status,
    ).toBe(403)
    expect(await prisma.platformZapiLine.count()).toBe(0)
  })

  it('should report a not configured line to an admin', async () => {
    const admin = await createPlatformAdmin()
    await prisma.platformZapiLine.deleteMany()
    const res = await getJson('/api/admin/zapi-line', admin.cookie)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.configured).toBe(false)
  })

  it('should reject invalid credentials', async () => {
    const admin = await createPlatformAdmin()
    const res = await putJson(
      '/api/admin/zapi-line',
      { instanceId: '', token: '' },
      admin.cookie,
    )
    expect(res.status).toBe(422)
  })

  it('should store the credentials encrypted, never return them and audit it', async () => {
    const admin = await createPlatformAdmin()
    const res = await putJson(
      '/api/admin/zapi-line',
      {
        instanceId: 'E2EINSTANCE0001',
        token: 'e2e-secret-token',
        clientToken: 'e2e-secret-client',
        label: 'e2e',
      },
      admin.cookie,
    )
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain('e2e-secret-token')
    expect(text).not.toContain('e2e-secret-client')
    expect(text).not.toContain('E2EINSTANCE0001')
    const body = JSON.parse(text)
    expect(body.data.configured).toBe(true)
    expect(body.data.status).toBe('DISCONNECTED')

    const row = await prisma.platformZapiLine.findUnique({
      where: { id: 'default' },
    })
    expect(row?.instanceId).toBe('E2EINSTANCE0001')
    expect(row?.encryptedToken).not.toContain('e2e-secret-token')
    expect(row?.encryptedClientToken).not.toContain('e2e-secret-client')

    const audit = await prisma.adminAuditLog.findFirst({
      where: { action: 'zapi_line.configure', actorId: admin.id },
    })
    expect(audit).not.toBeNull()

    // Removing needs a reason and forgets the credentials.
    const bad = await fetch(`${BASE_URL}/api/admin/zapi-line`, {
      method: 'DELETE',
      headers: { ...defaultHeaders, Cookie: admin.cookie },
      body: JSON.stringify({}),
    })
    expect(bad.status).toBe(422)
    const removed = await fetch(`${BASE_URL}/api/admin/zapi-line`, {
      method: 'DELETE',
      headers: { ...defaultHeaders, Cookie: admin.cookie },
      body: JSON.stringify({ reason: 'fim do teste e2e' }),
    })
    expect(removed.status).toBe(200)
    expect(await prisma.platformZapiLine.count()).toBe(0)
  })

  it('should answer 404 for status, QR code and actions without a line', async () => {
    const admin = await createPlatformAdmin()
    await prisma.platformZapiLine.deleteMany()
    expect(
      (await getJson('/api/admin/zapi-line/qr-code', admin.cookie)).status,
    ).toBe(404)
    expect(
      (
        await postJson(
          '/api/admin/zapi-line/disconnect',
          { reason: 'sem linha nenhuma' },
          admin.cookie,
        )
      ).status,
    ).toBe(404)
  })
})
