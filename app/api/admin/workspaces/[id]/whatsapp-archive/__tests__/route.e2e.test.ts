import { describe, expect, it } from 'vitest'
import { seedWhatsAppArchive } from '@/src/__tests__/factories/whatsapp-archive.factory'
import {
  authenticatedOwner,
  createAuthenticatedUser,
  getJson,
  patchJson,
  postJson,
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

describe('WhatsApp archive routes (admin)', () => {
  it('are only for the platform admin', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/admin/workspaces/${workspace.id}/whatsapp-archive`
    expect((await getJson(base, user.cookie)).status).toBe(403)
    expect((await patchJson(base, { enabled: true }, user.cookie)).status).toBe(
      403,
    )
    expect(
      (await postJson(`${base}/generate`, { kind: 'WEEKLY' }, user.cookie))
        .status,
    ).toBe(403)
    const archive = await seedWhatsAppArchive(workspace.id)
    expect(
      (await getJson(`${base}/${archive.id}/download`, user.cookie)).status,
    ).toBe(403)
  })

  it('turns the archive on, generates once and refuses a second run', async () => {
    const admin = await createPlatformAdmin()
    const { workspace } = await authenticatedOwner()
    const base = `/api/admin/workspaces/${workspace.id}/whatsapp-archive`

    const off = await postJson(
      `${base}/generate`,
      { kind: 'WEEKLY' },
      admin.cookie,
    )
    expect(off.status).toBe(409)
    expect((await off.json()).error.code).toBe('WHATSAPP_ARCHIVE_DISABLED')

    const enabled = await patchJson(
      base,
      { enabled: true, rootFolderName: 'BANCO_X' },
      admin.cookie,
    )
    expect(enabled.status).toBe(200)
    expect((await enabled.json()).data).toMatchObject({
      enabled: true,
      rootFolderName: 'BANCO_X',
      effectiveRootFolderName: 'BANCO_X',
    })

    const queued = await postJson(
      `${base}/generate`,
      { kind: 'WEEKLY' },
      admin.cookie,
    )
    expect(queued.status).toBe(202)
    const archive = (await queued.json()).data
    expect(archive).toMatchObject({ kind: 'WEEKLY', status: 'QUEUED' })

    // The worker may already have picked it up; while queued or running a
    // second weekly run is refused.
    const row = await prisma.whatsAppArchive.findUniqueOrThrow({
      where: { id: archive.id },
    })
    if (row.status === 'QUEUED' || row.status === 'RUNNING') {
      const again = await postJson(
        `${base}/generate`,
        { kind: 'WEEKLY' },
        admin.cookie,
      )
      expect(again.status).toBe(409)
      expect((await again.json()).error.code).toBe(
        'WHATSAPP_ARCHIVE_IN_PROGRESS',
      )
    }

    const overview = await getJson(base, admin.cookie)
    expect(overview.status).toBe(200)
    const data = (await overview.json()).data
    expect(data.settings.enabled).toBe(true)
    expect(data.archives.map((a: { id: string }) => a.id)).toContain(archive.id)

    const audit = await prisma.adminAuditLog.findMany({
      where: { targetId: workspace.id },
      select: { action: true },
    })
    expect(audit.map((entry) => entry.action)).toEqual(
      expect.arrayContaining([
        'whatsapp_archive.settings',
        'whatsapp_archive.requested',
      ]),
    )
  })

  it('validates the body', async () => {
    const admin = await createPlatformAdmin()
    const { workspace } = await authenticatedOwner()
    const base = `/api/admin/workspaces/${workspace.id}/whatsapp-archive`
    expect((await patchJson(base, {}, admin.cookie)).status).toBe(422)
    expect(
      (await patchJson(base, { rootFolderName: 'con' }, admin.cookie)).status,
    ).toBe(422)
    expect(
      (await postJson(`${base}/generate`, { kind: 'DAILY' }, admin.cookie))
        .status,
    ).toBe(422)
  })

  it('404s an unknown workspace and an unfinished download', async () => {
    const admin = await createPlatformAdmin()
    expect(
      (
        await patchJson(
          '/api/admin/workspaces/nope/whatsapp-archive',
          { enabled: true },
          admin.cookie,
        )
      ).status,
    ).toBe(404)
    const { workspace } = await authenticatedOwner()
    const archive = await seedWhatsAppArchive(workspace.id)
    const res = await getJson(
      `/api/admin/workspaces/${workspace.id}/whatsapp-archive/${archive.id}/download`,
      admin.cookie,
    )
    expect(res.status).toBe(409)
  })
})
