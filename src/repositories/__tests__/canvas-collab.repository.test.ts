import { describe, expect, it, vi } from 'vitest'
import { seedCrmEmailBuilderTemplate } from '@/src/__tests__/factories/crm-email-marketing.factory'
import {
  createSiteDocument,
  seedSite,
  seedSiteGlobal,
  seedSitePage,
} from '@/src/__tests__/factories/site.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { CanvasCollabRepository } from '../canvas-collab.repository'

async function fixture() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  const site = await seedSite(workspace.id, user.id)
  return { workspace, user, site }
}

describe('CanvasCollabRepository', () => {
  it('saves, replaces, reads and deletes the Yjs state of a room', async () => {
    const { workspace } = await fixture()
    const name = 'canvas.site-page.p1'
    expect(expectOk(await CanvasCollabRepository.findState(name))).toBeNull()

    expectOk(
      await CanvasCollabRepository.saveState({
        documentName: name,
        workspaceId: workspace.id,
        state: new Uint8Array([1, 2, 3]),
        documentHash: 'h1',
      }),
    )
    expectOk(
      await CanvasCollabRepository.saveState({
        documentName: name,
        workspaceId: workspace.id,
        state: new Uint8Array([4, 5]),
        documentHash: 'h2',
      }),
    )
    const row = expectOk(await CanvasCollabRepository.findState(name))
    expect(row?.documentHash).toBe('h2')
    expect([...(row?.state ?? [])]).toEqual([4, 5])

    expectOk(await CanvasCollabRepository.deleteState(name))
    expect(expectOk(await CanvasCollabRepository.findState(name))).toBeNull()
  })

  it('drops the state rows with the workspace', async () => {
    const { workspace } = await fixture()
    expectOk(
      await CanvasCollabRepository.saveState({
        documentName: 'canvas.site-page.gone',
        workspaceId: workspace.id,
        state: new Uint8Array([1]),
        documentHash: 'h',
      }),
    )
    await prisma.workspace.delete({ where: { id: workspace.id } })
    expect(
      expectOk(await CanvasCollabRepository.findState('canvas.site-page.gone')),
    ).toBeNull()
  })

  it('resolves pages and globals to their site and workspace', async () => {
    const { workspace, site } = await fixture()
    const page = await seedSitePage(site.id)
    const global = await seedSiteGlobal(site.id)
    expect(
      expectOk(await CanvasCollabRepository.findSitePage(page.id)),
    ).toEqual({
      workspaceId: workspace.id,
      siteId: site.id,
      document: createSiteDocument(),
    })
    expect(
      expectOk(await CanvasCollabRepository.findSiteGlobal(global.id)),
    ).toMatchObject({ workspaceId: workspace.id, siteId: site.id })
    expectErr(
      await CanvasCollabRepository.findSitePage('missing'),
      'CANVAS_COLLAB_NOT_FOUND',
    )
    expectErr(
      await CanvasCollabRepository.findSiteGlobal('missing'),
      'CANVAS_COLLAB_NOT_FOUND',
    )
  })

  it('resolves only live visual-builder e-mail templates', async () => {
    const { workspace, user } = await fixture()
    const template = await seedCrmEmailBuilderTemplate(workspace.id, user.id)
    const found = expectOk(
      await CanvasCollabRepository.findEmailTemplate(template.id),
    )
    expect(found).toMatchObject({ workspaceId: workspace.id, siteId: null })
    expect(found.document).toEqual(template.builderDocument)

    await prisma.crmEmailTemplate.update({
      where: { id: template.id },
      data: { deletedAt: new Date() },
    })
    expectErr(
      await CanvasCollabRepository.findEmailTemplate(template.id),
      'CANVAS_COLLAB_NOT_FOUND',
    )
  })

  it('maps database failures', async () => {
    const spies = [
      vi
        .spyOn(prisma.canvasCollabState, 'findUnique')
        .mockRejectedValueOnce(new Error('down')),
      vi
        .spyOn(prisma.canvasCollabState, 'upsert')
        .mockRejectedValueOnce(new Error('down')),
      vi
        .spyOn(prisma.canvasCollabState, 'deleteMany')
        .mockRejectedValueOnce(new Error('down')),
      vi
        .spyOn(prisma.sitePage, 'findUnique')
        .mockRejectedValueOnce(new Error('down')),
      vi
        .spyOn(prisma.siteGlobal, 'findUnique')
        .mockRejectedValueOnce(new Error('down')),
      vi
        .spyOn(prisma.crmEmailTemplate, 'findFirst')
        .mockRejectedValueOnce(new Error('down')),
    ]
    expectErr(await CanvasCollabRepository.findState('x'), 'DATABASE_ERROR')
    expectErr(
      await CanvasCollabRepository.saveState({
        documentName: 'x',
        workspaceId: 'w',
        state: new Uint8Array(),
        documentHash: 'h',
      }),
      'DATABASE_ERROR',
    )
    expectErr(await CanvasCollabRepository.deleteState('x'), 'DATABASE_ERROR')
    expectErr(await CanvasCollabRepository.findSitePage('x'), 'DATABASE_ERROR')
    expectErr(
      await CanvasCollabRepository.findSiteGlobal('x'),
      'DATABASE_ERROR',
    )
    expectErr(
      await CanvasCollabRepository.findEmailTemplate('x'),
      'DATABASE_ERROR',
    )
    for (const spy of spies) spy.mockRestore()
  })
})
