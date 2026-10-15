import { describe, expect, it, vi } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { CrmCampaignLookupRepository as R } from '../crm-campaign-lookup.repository'

async function seed() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  const page = await prisma.crmLandingPage.create({
    data: {
      workspaceId: workspace.id,
      createdById: user.id,
      title: 'LP',
      templateKey: 'consultation',
      shareToken: `lp-${workspace.id}`,
      status: 'PUBLISHED',
    },
  })
  const form = await prisma.crmForm.create({
    data: {
      workspaceId: workspace.id,
      createdById: user.id,
      name: 'Form',
      publicToken: `f-${workspace.id}`,
    },
  })
  const template = await prisma.crmEmailTemplate.create({
    data: {
      workspaceId: workspace.id,
      createdById: user.id,
      name: 'T',
      subject: 'S',
      contentHtml: '<p/>',
    },
  })
  const list = await prisma.crmMailingList.create({
    data: { workspaceId: workspace.id, createdById: user.id, name: 'Lista' },
  })
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId: workspace.id,
      createdById: user.id,
      provider: 'META',
      label: 'Meta',
      phoneNumber: `55119${Date.now() % 100000000}`,
      status: 'CONNECTED',
    },
  })
  const sdConnection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId: workspace.id,
      createdById: user.id,
      provider: 'ZAPI',
      module: 'SERVICE_DESK',
      label: 'SD',
      phoneNumber: '5511000000000',
      status: 'CONNECTED',
    },
  })
  const waTemplate = await prisma.whatsAppTemplate.create({
    data: {
      workspaceId: workspace.id,
      connectionId: connection.id,
      name: 'promo',
      language: 'pt_BR',
      category: 'MARKETING',
      status: 'APPROVED',
      components: [],
    },
  })
  await prisma.whatsAppTemplate.create({
    data: {
      workspaceId: workspace.id,
      connectionId: connection.id,
      name: 'pending',
      language: 'pt_BR',
      category: 'MARKETING',
      status: 'PENDING',
      components: [],
    },
  })
  return {
    workspace,
    page,
    form,
    template,
    list,
    connection,
    sdConnection,
    waTemplate,
  }
}

describe('CrmCampaignLookupRepository', () => {
  it('should find destinations, templates and connections in scope', async () => {
    const s = await seed()
    const ws = s.workspace.id
    expect(expectOk(await R.findLandingPage(ws, s.page.id))).toEqual({
      id: s.page.id,
      token: s.page.shareToken,
      published: true,
      name: 'LP',
    })
    expect(expectOk(await R.findForm(ws, s.form.id))).toEqual({
      id: s.form.id,
      token: s.form.publicToken,
      published: false,
      name: 'Form',
    })
    expect(
      expectOk(await R.findEmailTemplate(ws, s.template.id))?.subject,
    ).toBe('S')
    expect(expectOk(await R.findConnection(ws, s.connection.id))?.id).toBe(
      s.connection.id,
    )
    expect(expectOk(await R.findConnection(ws, s.sdConnection.id))).toBeNull()
    expect(
      expectOk(
        await R.findWhatsAppTemplate(ws, s.connection.id, s.waTemplate.id),
      )?.name,
    ).toBe('promo')

    const other = await seedWorkspace()
    expect(expectOk(await R.findLandingPage(other.id, s.page.id))).toBeNull()
    expect(expectOk(await R.findForm(other.id, s.form.id))).toBeNull()
    expect(
      expectOk(await R.findEmailTemplate(other.id, s.template.id)),
    ).toBeNull()
  })

  it('should map destination tokens and list the picker options', async () => {
    const s = await seed()
    const ws = s.workspace.id
    const tokens = expectOk(
      await R.destinationTokens(ws, {
        landingPageIds: [s.page.id],
        formIds: [s.form.id],
      }),
    )
    expect(tokens.get(s.page.id)).toBe(s.page.shareToken)
    expect(tokens.get(s.form.id)).toBe(s.form.publicToken)
    expect(
      expectOk(
        await R.destinationTokens(ws, { landingPageIds: [], formIds: [] }),
      ).size,
    ).toBe(0)

    const options = expectOk(await R.listOptions(ws))
    expect(options.landingPages.map((p) => p.id)).toEqual([s.page.id])
    expect(options.forms.map((f) => f.id)).toEqual([s.form.id])
    expect(options.emailTemplates.map((t) => t.id)).toEqual([s.template.id])
    expect(options.mailingLists).toEqual([{ id: s.list.id, name: 'Lista' }])
    expect(options.connections.map((c) => c.id)).toEqual([s.connection.id])
    expect(options.connections[0].templates.map((t) => t.name)).toEqual([
      'promo',
    ])
  })

  it('should check mailing list ownership', async () => {
    const s = await seed()
    expect(expectOk(await R.mailingListsExist(s.workspace.id, []))).toBe(true)
    expect(
      expectOk(
        await R.mailingListsExist(s.workspace.id, [s.list.id, s.list.id]),
      ),
    ).toBe(true)
    expect(
      expectOk(await R.mailingListsExist(s.workspace.id, [s.list.id, 'x'])),
    ).toBe(false)
  })

  it('should map database failures to DATABASE_ERROR', async () => {
    const boom = () => Promise.reject(new Error('x'))
    const spies = [
      vi
        .spyOn(prisma.crmLandingPage, 'findFirst')
        .mockImplementation(boom as never),
      vi.spyOn(prisma.crmForm, 'findFirst').mockImplementation(boom as never),
      vi
        .spyOn(prisma.crmEmailTemplate, 'findFirst')
        .mockImplementation(boom as never),
      vi
        .spyOn(prisma.whatsAppConnection, 'findFirst')
        .mockImplementation(boom as never),
      vi
        .spyOn(prisma.whatsAppTemplate, 'findFirst')
        .mockImplementation(boom as never),
      vi
        .spyOn(prisma.crmLandingPage, 'findMany')
        .mockImplementation(boom as never),
      vi
        .spyOn(prisma.crmMailingList, 'count')
        .mockImplementation(boom as never),
    ]
    const results = await Promise.all([
      R.findLandingPage('w', 'x'),
      R.findForm('w', 'x'),
      R.findEmailTemplate('w', 'x'),
      R.findConnection('w', 'x'),
      R.findWhatsAppTemplate('w', 'c', 'x'),
      R.destinationTokens('w', { landingPageIds: ['x'], formIds: [] }),
      R.listOptions('w'),
      R.mailingListsExist('w', ['x']),
    ])
    for (const result of results) {
      expect(expectErr(result).code).toBe('DATABASE_ERROR')
    }
    for (const spy of spies) spy.mockRestore()
  })
})
