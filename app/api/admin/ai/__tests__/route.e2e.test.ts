import { describe, expect, it } from 'vitest'
import {
  createAuthenticatedUser,
  defaultHeaders,
  getJson,
  patchJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'
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

describe('/api/admin/ai', () => {
  it('should return 401 via middleware when unauthenticated', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/ai`, {
      headers: defaultHeaders,
    })
    expect(res.status).toBe(401)
  })

  it('should return 403 for a non-platform-admin', async () => {
    const user = await createAuthenticatedUser()
    expect((await getJson('/api/admin/ai', user.cookie)).status).toBe(403)
    const res = await patchJson('/api/admin/ai', { costMargin: 2 }, user.cookie)
    expect(res.status).toBe(403)
  })

  it('should return the margin and the model prices', async () => {
    const admin = await createPlatformAdmin()
    const res = await getJson('/api/admin/ai', admin.cookie)
    expect(res.status).toBe(200)
    const body = await res.json()
    // Another run may have saved a margin already (single platform row).
    expect(typeof body.data.costMargin).toBe('number')
    expect(body.data.models.length).toBeGreaterThan(0)
  })

  it('should reject a margin out of bounds', async () => {
    const admin = await createPlatformAdmin()
    const res = await patchJson(
      '/api/admin/ai',
      { costMargin: 0 },
      admin.cookie,
    )
    expect(res.status).toBe(422)
  })

  it('should save the margin and log it in the admin audit trail', async () => {
    const admin = await createPlatformAdmin()
    const res = await patchJson(
      '/api/admin/ai',
      { costMargin: 1.4, reason: 'e2e' },
      admin.cookie,
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.costMargin).toBe(1.4)
    // Back to at-cost so other suites price AI calls at the default.
    await prisma.platformAiSettings.deleteMany()

    const audit = await prisma.adminAuditLog.findFirst({
      where: { action: 'ai.cost_margin_update', actorId: admin.id },
    })
    expect(audit?.reason).toBe('e2e')
  })

  it('should switch the knowledge search embeddings and report the mode', async () => {
    const admin = await createPlatformAdmin()
    const res = await patchJson(
      '/api/admin/ai',
      { costMargin: 1, embeddingsEnabled: false },
      admin.cookie,
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.embeddingsEnabled).toBe(false)
    expect(body.data.knowledgeSearch).toMatchObject({ mode: 'text' })
    await prisma.platformAiSettings.deleteMany()
  })
})
