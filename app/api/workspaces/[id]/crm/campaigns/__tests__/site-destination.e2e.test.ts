import { createId } from '@paralleldrive/cuid2'
import { describe, expect, it } from 'vitest'
import {
  authenticatedOwner,
  defaultHeaders,
  getJson,
  patchJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { siteDoc } from '@/src/__tests__/helpers/site-canvas'
import { BASE_URL } from '@/src/__tests__/setup.e2e'
import { form as formElement } from '@/src/lib/canvas-site/presets/builder'
import { createCampaignLinkToken } from '@/src/lib/crm-campaign/tokens'
import { prisma } from '@/src/lib/prisma'

/**
 * Campaign → site page (ADR 0025 + Sites): the signed click redirect lands
 * on the published site page with the UTMs and the token, the runtime's
 * view beacon and the `site.form` submission are attributed to the
 * recipient, and the site metrics show the campaign traffic.
 */
async function seedSiteCampaign() {
  const { user, workspace } = await authenticatedOwner()
  const ws = workspace.id
  const form = await prisma.crmForm.create({
    data: {
      workspaceId: ws,
      createdById: user.id,
      name: 'Agendamento',
      publicToken: `e2e-site-form-${ws}`,
      status: 'PUBLISHED',
      action: 'LEAD',
      fields: [
        {
          key: 'name',
          label: 'Nome',
          type: 'text',
          required: true,
          mapping: { target: 'lead', attribute: 'name' },
        },
        {
          key: 'email',
          label: 'E-mail',
          type: 'email',
          required: true,
          mapping: { target: 'lead', attribute: 'email' },
        },
      ],
    },
  })
  const template = await prisma.crmEmailTemplate.create({
    data: {
      workspaceId: ws,
      createdById: user.id,
      name: 'Convite',
      subject: 'Venha nos visitar',
      contentHtml:
        '<html><body><a href="{{campaign_link}}">Agendar</a></body></html>',
    },
  })
  await prisma.crmPerson.create({
    data: {
      workspaceId: ws,
      createdById: user.id,
      name: 'Carla Dias',
      emails: [`carla.${ws}@example.com`],
    },
  })

  // A published site whose "Contato" page embeds the CRM form.
  const sites = `/api/workspaces/${ws}/crm/sites`
  const slug = `e2e-camp-${createId().slice(0, 10)}`
  const site = (
    await (
      await postJson(sites, { name: 'Clínica Campanha', slug }, user.cookie)
    ).json()
  ).data
  const page = (
    await (
      await postJson(
        `${sites}/${site.id}/pages`,
        {
          title: 'Contato',
          document: siteDoc([formElement({ formToken: form.publicToken })]),
        },
        user.cookie,
      )
    ).json()
  ).data
  expect(
    (await postJson(`${sites}/${site.id}/publish`, {}, user.cookie)).status,
  ).toBe(200)

  return { user, ws, form, template, site, page, slug }
}

describe('CRM campaign → site page attribution', () => {
  it('should redirect to the site page and attribute the view and the form', async () => {
    const { user, ws, form, template, site, page, slug } =
      await seedSiteCampaign()
    const base = `/api/workspaces/${ws}/crm/campaigns`

    // The picker lists the site, its live pages and where the form is.
    const options = (
      await (await getJson(`${base}/options`, user.cookie)).json()
    ).data
    const listed = options.sites.find(
      (item: { id: string }) => item.id === site.id,
    )
    expect(listed.published).toBe(true)
    expect(listed.pages.map((p: { id: string }) => p.id)).toContain(page.id)
    const listedForm = options.forms.find(
      (item: { id: string }) => item.id === form.id,
    )
    expect(listedForm.embeds).toEqual([
      expect.objectContaining({ siteId: site.id, pageId: page.id }),
    ])

    const draft = (
      await (await postJson(base, { name: 'Visita' }, user.cookie)).json()
    ).data
    const saved = await patchJson(
      `${base}/${draft.id}`,
      {
        destinationType: 'SITE_PAGE',
        siteId: site.id,
        sitePageId: page.id,
        // Platform address: no verified domain needed (ADR 0055).
        emailFrom: 'notificacoes@stratustelecom.com.br',
        emailSubject: 'Venha nos visitar',
        emailTemplateId: template.id,
        emailLegalBasis: 'CONSENT',
        audience: { mailingListIds: [], allPeople: true, leadStages: [] },
      },
      user.cookie,
    )
    expect(saved.status).toBe(200)
    const ready = (await saved.json()).data
    expect(ready.issues).toEqual([])
    expect(ready.destination).toMatchObject({
      type: 'SITE_PAGE',
      name: 'Clínica Campanha',
      pageTitle: 'Contato',
      published: true,
    })
    expect(ready.links.email).toContain(
      `/s/${slug}/contato?utm_source=email&utm_medium=campanha&utm_campaign=${draft.slug}`,
    )

    expect(
      (
        await postJson(
          `${base}/${draft.id}/launch`,
          { confirmLegalBasis: true },
          user.cookie,
        )
      ).status,
    ).toBe(200)
    const recipient = await prisma.crmCampaignRecipient.findFirstOrThrow({
      where: { campaignId: draft.id },
    })
    const token = createCampaignLinkToken(recipient.id, 'EMAIL')

    // 1. The click lands on the site page with the UTMs and the token.
    const click = await fetch(`${BASE_URL}/api/crm/campaigns/c/${token}`, {
      headers: defaultHeaders,
      redirect: 'manual',
    })
    expect(click.status).toBe(302)
    const location = new URL(click.headers.get('location') as string)
    expect(location.pathname).toBe(`/s/${slug}/contato`)
    expect(location.searchParams.get('utm_campaign')).toBe(draft.slug)
    expect(location.searchParams.get('stc')).toBe(token)

    const html = await (
      await fetch(`${BASE_URL}/s/${slug}/contato${location.search}`)
    ).text()
    expect(html).toContain('data-site-form')
    expect(html).toContain(`/api/crm/forms/${form.publicToken}/submit`)

    // 2. The runtime's view beacon (twice: one view per visitor and day).
    const view = {
      pageId: page.id,
      path: '/contato',
      utmSource: 'email',
      utmMedium: 'campanha',
      utmCampaign: draft.slug,
      ref: token,
    }
    for (let i = 0; i < 2; i += 1) {
      const beacon = await fetch(`${BASE_URL}/api/sites/${slug}/views`, {
        method: 'POST',
        headers: defaultHeaders,
        body: JSON.stringify(view),
      })
      expect(beacon.status).toBe(202)
    }

    // 3. The `site.form` posts to the CRM form endpoint from the page.
    const submit = await fetch(
      `${BASE_URL}/api/crm/forms/${form.publicToken}/submit`,
      {
        method: 'POST',
        headers: defaultHeaders,
        body: JSON.stringify({
          values: { name: 'Carla Dias', email: 'carla.nova@example.com' },
          campaign: {
            ref: token,
            utmCampaign: draft.slug,
            utmSource: 'email',
            siteSlug: slug,
            sitePageId: page.id,
          },
        }),
      },
    )
    expect(submit.status).toBe(201)

    const stats = (
      await (await getJson(`${base}/${draft.id}/stats`, user.cookie)).json()
    ).data
    expect(stats.conversions).toMatchObject({
      total: 2,
      visits: 1,
      submissions: 1,
      byChannel: { email: 2 },
      byDestination: { siteView: 1, siteForm: 1, crmForm: 0, landingView: 0 },
    })
    const clicked = await prisma.crmCampaignRecipient.findUniqueOrThrow({
      where: { id: recipient.id },
    })
    expect(clicked.emailClickedAt).not.toBeNull()
    expect(clicked.convertedAt).not.toBeNull()

    // 4. The site metrics show the campaign traffic.
    const analytics = (
      await (
        await getJson(
          `/api/workspaces/${ws}/crm/sites/${site.id}/analytics`,
          user.cookie,
        )
      ).json()
    ).data
    expect(analytics.campaigns).toEqual([
      {
        campaignId: draft.id,
        name: 'Visita',
        slug: draft.slug,
        views: 1,
        formSubmissions: 1,
      },
    ])
  })

  it('should block a campaign to an unpublished page', async () => {
    const { user, ws, site } = await seedSiteCampaign()
    const draftPage = (
      await (
        await postJson(
          `/api/workspaces/${ws}/crm/sites/${site.id}/pages`,
          { title: 'Promo' },
          user.cookie,
        )
      ).json()
    ).data
    const base = `/api/workspaces/${ws}/crm/campaigns`
    const draft = (
      await (await postJson(base, { name: 'Promo' }, user.cookie)).json()
    ).data
    const saved = (
      await (
        await patchJson(
          `${base}/${draft.id}`,
          {
            destinationType: 'SITE_PAGE',
            siteId: site.id,
            sitePageId: draftPage.id,
          },
          user.cookie,
        )
      ).json()
    ).data
    expect(saved.links.email).toBeNull()
    expect(saved.issues).toContainEqual({
      step: 'destination',
      message:
        'A página escolhida ainda não está no ar: publique o site de novo',
    })

    // A page of another site is refused.
    const foreign = await patchJson(
      `${base}/${draft.id}`,
      { siteId: site.id, sitePageId: 'not-a-page' },
      user.cookie,
    )
    expect(foreign.status).toBe(422)
  })
})
