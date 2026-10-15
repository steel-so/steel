import { describe, expect, it, vi } from 'vitest'
import {
  createFakeSnapshot,
  seedSite,
  seedSitePage,
} from '@/src/__tests__/factories/site.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { createBlankEmailDocument } from '@/src/lib/canvas-email/presets'
import { prisma } from '@/src/lib/prisma'
import { CrmCampaignLookupRepository as R } from '../crm-campaign-lookup.repository'

/** Workspace with a published site (2 pages), a draft site, a deleted
 * site, a landing page migrated into the published one, a v2 and a legacy
 * e-mail template and a quick reply. */
async function seed() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  const ws = workspace.id
  const landing = await prisma.crmLandingPage.create({
    data: {
      workspaceId: ws,
      createdById: user.id,
      title: 'Antiga',
      templateKey: 'consultation',
      shareToken: `lp-${ws}`,
    },
  })
  const live = await seedSite(ws, user.id, {
    name: 'Clínica',
    status: 'PUBLISHED',
    sourceLandingPageId: landing.id,
  })
  const home = await seedSitePage(live.id, {
    title: 'Início',
    isHome: true,
    position: 0,
  })
  await seedSitePage(live.id, { title: 'Contato', position: 1 })
  const version = await prisma.siteVersion.create({
    data: {
      siteId: live.id,
      number: 1,
      snapshot: createFakeSnapshot() as never,
    },
  })
  await prisma.site.update({
    where: { id: live.id },
    data: { publishedVersionId: version.id },
  })
  const draft = await seedSite(ws, user.id, { name: 'Rascunho' })
  const gone = await seedSite(ws, user.id, { deletedAt: new Date() })
  const canvas = await prisma.crmEmailTemplate.create({
    data: {
      workspaceId: ws,
      createdById: user.id,
      name: 'Novo',
      subject: 'Oi',
      contentHtml: '<p/>',
      kind: 'BUILDER',
      builderDocument: createBlankEmailDocument() as never,
    },
  })
  const legacy = await prisma.crmEmailTemplate.create({
    data: {
      workspaceId: ws,
      createdById: user.id,
      name: 'HTML',
      subject: 'Oi',
      contentHtml: '<p/>',
    },
  })
  const reply = await prisma.whatsAppQuickReply.create({
    data: { workspaceId: ws, shortcut: 'promo', title: 'Promo', body: 'Oi' },
  })
  return { ws, user, live, home, draft, gone, canvas, legacy, reply, landing }
}

describe('CrmCampaignLookupRepository — sites and content', () => {
  it('should read a site with its live snapshot and draft pages', async () => {
    const s = await seed()
    const site = expectOk(await R.findSite(s.ws, s.live.id))
    expect(site).toMatchObject({
      id: s.live.id,
      name: 'Clínica',
      slug: s.live.slug,
      status: 'PUBLISHED',
    })
    expect(site?.snapshot).toMatchObject({ name: 'Clínica' })
    expect(site?.pages.map((page) => page.title)).toEqual(['Início', 'Contato'])

    // A draft site exposes no snapshot; deleted and foreign ones are absent.
    expect(expectOk(await R.findSite(s.ws, s.draft.id))?.snapshot).toBeNull()
    expect(expectOk(await R.findSite(s.ws, s.gone.id))).toBeNull()
    const other = await seedWorkspace()
    expect(expectOk(await R.findSite(other.id, s.live.id))).toBeNull()

    const many = expectOk(
      await R.findSites(s.ws, [s.live.id, s.draft.id, s.gone.id]),
    )
    expect(many.map((item) => item.id).sort()).toEqual(
      [s.live.id, s.draft.id].sort(),
    )
    expect(expectOk(await R.findSites(s.ws, []))).toEqual([])
  })

  it('should resolve a site by slug and quick replies in scope', async () => {
    const s = await seed()
    expect(expectOk(await R.findSiteIdBySlug(s.ws, s.live.slug))).toBe(
      s.live.id,
    )
    expect(expectOk(await R.findSiteIdBySlug(s.ws, 'nope'))).toBeNull()
    const other = await seedWorkspace()
    expect(expectOk(await R.findSiteIdBySlug(other.id, s.live.slug))).toBeNull()

    expect(expectOk(await R.findQuickReply(s.ws, s.reply.id))?.title).toBe(
      'Promo',
    )
    expect(expectOk(await R.findQuickReply(other.id, s.reply.id))).toBeNull()
  })

  it('should read the template content for the checklist', async () => {
    const s = await seed()
    const content = expectOk(
      await R.findEmailTemplateContent(s.ws, s.canvas.id),
    )
    expect(content).toMatchObject({ subject: 'Oi', kind: 'BUILDER' })
    expect(content?.builderDocument).toMatchObject({ catalog: 'email' })
    const other = await seedWorkspace()
    expect(
      expectOk(await R.findEmailTemplateContent(other.id, s.canvas.id)),
    ).toBeNull()
  })

  it('should list sites, migrated landing pages, editor versions and quick replies', async () => {
    const s = await seed()
    const options = expectOk(await R.listOptions(s.ws))
    expect(options.sites.map((site) => site.id).sort()).toEqual(
      [s.live.id, s.draft.id].sort(),
    )
    expect(options.landingPages).toEqual([
      expect.objectContaining({ id: s.landing.id, migratedSiteId: s.live.id }),
    ])
    const editors = Object.fromEntries(
      options.emailTemplates.map((t) => [t.id, [t.kind, t.canvas]]),
    )
    expect(editors).toEqual({
      [s.canvas.id]: ['BUILDER', true],
      [s.legacy.id]: ['LEGACY', false],
    })
    expect(options.quickReplies.map((reply) => reply.id)).toEqual([s.reply.id])
  })

  it('should map database failures to DATABASE_ERROR', async () => {
    const boom = () => Promise.reject(new Error('x'))
    const spies = [
      vi.spyOn(prisma.site, 'findFirst').mockImplementation(boom as never),
      vi.spyOn(prisma.site, 'findMany').mockImplementation(boom as never),
      vi
        .spyOn(prisma.whatsAppQuickReply, 'findFirst')
        .mockImplementation(boom as never),
      vi
        .spyOn(prisma.crmEmailTemplate, 'findFirst')
        .mockImplementation(boom as never),
    ]
    const results = await Promise.all([
      R.findSite('w', 'x'),
      R.findSites('w', ['x']),
      R.findSiteIdBySlug('w', 'x'),
      R.findQuickReply('w', 'x'),
      R.findEmailTemplateContent('w', 'x'),
    ])
    for (const result of results) {
      expect(expectErr(result).code).toBe('DATABASE_ERROR')
    }
    for (const spy of spies) spy.mockRestore()
  })
})
