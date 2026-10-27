import { describe, expect, it } from 'vitest'
import {
  seedWhatsAppArchive,
  seedWhatsAppArchiveSettings,
} from '@/src/__tests__/factories/whatsapp-archive.factory'
import {
  addMember,
  authenticatedOwner,
  defaultHeaders,
  getJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'
import { prisma } from '@/src/lib/prisma'

describe('WhatsApp archive routes (workspace)', () => {
  it('requires a session', async () => {
    const res = await fetch(`${BASE_URL}/api/workspaces/x/whatsapp/archives`, {
      headers: defaultHeaders,
    })
    expect(res.status).toBe(401)
  })

  it('is off by default and shows the default root folder', async () => {
    const { user, workspace } = await authenticatedOwner({
      slug: `fidelizza-${Date.now()}`,
    })
    const res = await getJson(
      `/api/workspaces/${workspace.id}/whatsapp/archives`,
      user.cookie,
    )
    expect(res.status).toBe(200)
    const data = (await res.json()).data
    expect(data.settings.enabled).toBe(false)
    expect(data.settings.effectiveRootFolderName).toMatch(/^FIDELIZZA\d+$/)
    expect(data.archives).toEqual([])
    expect(data.retention).toEqual({ weeklyDays: 90, monthlyMonths: 12 })
  })

  it('lists the packages to an ADMIN', async () => {
    const { workspace } = await authenticatedOwner()
    const admin = await addMember(workspace.id, 'ADMIN')
    await seedWhatsAppArchiveSettings(workspace.id, {
      rootFolderName: 'BANCO',
    })
    const archive = await seedWhatsAppArchive(workspace.id, {
      status: 'DONE',
      objectKey: `${workspace.id}/x.zip`,
      rootFolderName: 'BANCO',
      sha256: 'ab'.repeat(32),
      sizeBytes: BigInt(10),
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    const res = await getJson(
      `/api/workspaces/${workspace.id}/whatsapp/archives`,
      admin.cookie,
    )
    expect(res.status).toBe(200)
    const data = (await res.json()).data
    expect(data.settings).toMatchObject({
      enabled: true,
      rootFolderName: 'BANCO',
    })
    expect(data.archives).toHaveLength(1)
    expect(data.archives[0]).toMatchObject({
      id: archive.id,
      status: 'DONE',
      sizeBytes: 10,
      downloadUrl: `/api/workspaces/${workspace.id}/whatsapp/archives/${archive.id}/download`,
    })
  })

  it('is only for OWNER and ADMIN with Comunicação enabled', async () => {
    const { user, workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')
    const list = await getJson(
      `/api/workspaces/${workspace.id}/whatsapp/archives`,
      member.cookie,
    )
    expect(list.status).toBe(403)

    await prisma.workspaceModuleAccess.updateMany({
      where: { workspaceId: workspace.id, module: 'COMMUNICATION' },
      data: { enabled: false },
    })
    const disabled = await getJson(
      `/api/workspaces/${workspace.id}/whatsapp/archives`,
      user.cookie,
    )
    expect(disabled.status).toBe(403)
    expect((await disabled.json()).error.code).toBe('MODULE_DISABLED')
  })

  it('downloads only finished packages of the workspace', async () => {
    const { user, workspace } = await authenticatedOwner()
    const queued = await seedWhatsAppArchive(workspace.id)
    const notReady = await getJson(
      `/api/workspaces/${workspace.id}/whatsapp/archives/${queued.id}/download`,
      user.cookie,
    )
    expect(notReady.status).toBe(409)
    expect((await notReady.json()).error.code).toBe(
      'WHATSAPP_ARCHIVE_NOT_READY',
    )

    const missing = await getJson(
      `/api/workspaces/${workspace.id}/whatsapp/archives/nope/download`,
      user.cookie,
    )
    expect(missing.status).toBe(404)

    // A package of another workspace is not found here.
    const other = await authenticatedOwner()
    const foreign = await seedWhatsAppArchive(other.workspace.id)
    const cross = await getJson(
      `/api/workspaces/${workspace.id}/whatsapp/archives/${foreign.id}/download`,
      user.cookie,
    )
    expect(cross.status).toBe(404)

    const member = await addMember(workspace.id, 'MEMBER')
    const denied = await getJson(
      `/api/workspaces/${workspace.id}/whatsapp/archives/${queued.id}/download`,
      member.cookie,
    )
    expect(denied.status).toBe(403)
  })
})
