import { describe, expect, it } from 'vitest'
import { seedSendingDomain } from '@/src/__tests__/factories/newsletter-nl-domains.factory'
import {
  addMember,
  authenticatedOwner,
  createAuthenticatedUser,
  defaultHeaders,
  deleteJson,
  getJson,
  patchJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'
import { prisma } from '@/src/lib/prisma'

async function seedDestination(workspaceId: string, userId: string) {
  const form = await prisma.crmForm.create({
    data: {
      workspaceId,
      createdById: userId,
      name: 'Inscrição',
      publicToken: `e2e-form-${workspaceId}`,
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
      workspaceId,
      createdById: userId,
      name: 'Oferta',
      subject: 'Oferta especial',
      contentHtml:
        '<html><body><p>Oi {{primeiro_nome}}</p><a href="{{campaign_link}}">Quero</a></body></html>',
    },
  })
  await prisma.crmPerson.create({
    data: {
      workspaceId,
      createdById: userId,
      name: 'Ana Souza',
      emails: ['ana.campanha@example.com'],
      phones: ['11999990000'],
    },
  })
  return { form, template }
}

describe('/api/workspaces/[id]/crm/campaigns — access', () => {
  it('should return 401 via middleware when unauthenticated', async () => {
    const res = await fetch(`${BASE_URL}/api/workspaces/x/crm/campaigns`, {
      headers: defaultHeaders,
    })
    expect(res.status).toBe(401)
  })

  it('should return 403 for a non-member and for a VIEWER creating', async () => {
    const { workspace } = await authenticatedOwner()
    const stranger = await createAuthenticatedUser()
    expect(
      (
        await getJson(
          `/api/workspaces/${workspace.id}/crm/campaigns`,
          stranger.cookie,
        )
      ).status,
    ).toBe(403)

    const viewer = await addMember(workspace.id, 'VIEWER')
    expect(
      (
        await postJson(
          `/api/workspaces/${workspace.id}/crm/campaigns`,
          { name: 'X' },
          viewer.cookie,
        )
      ).status,
    ).toBe(403)
  })
})

describe('/api/workspaces/[id]/crm/campaigns — wizard to results', () => {
  it('should run the draft → launch → click → conversion flow', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/crm/campaigns`
    const { form, template } = await seedDestination(workspace.id, user.id)

    // Create the draft.
    const created = await postJson(base, { name: 'Black Friday' }, user.cookie)
    expect(created.status).toBe(201)
    const draft = (await created.json()).data
    expect(draft.slug).toBe('black-friday')
    expect(draft.issues.length).toBeGreaterThan(0)

    // Launch is refused while incomplete.
    const early = await postJson(
      `${base}/${draft.id}/launch`,
      { confirmLegalBasis: true },
      user.cookie,
    )
    expect(early.status).toBe(422)
    expect((await early.json()).error.code).toBe('CRM_CAMPAIGN_INCOMPLETE')

    // Options for the pickers.
    const options = (
      await (await getJson(`${base}/options`, user.cookie)).json()
    ).data
    expect(options.forms.map((f: { id: string }) => f.id)).toContain(form.id)

    // Fill the steps.
    const saved = await patchJson(
      `${base}/${draft.id}`,
      {
        destinationType: 'FORM',
        formId: form.id,
        emailFrom: 'marketing@example.com',
        emailSubject: 'Oferta da Black Friday',
        emailPreheader: 'Só até domingo',
        emailTemplateId: template.id,
        emailLegalBasis: 'CONSENT',
        audience: { mailingListIds: [], allPeople: true, leadStages: [] },
      },
      user.cookie,
    )
    expect(saved.status).toBe(200)
    // ADR 0055: example.com is not a verified domain of the workspace.
    expect((await saved.json()).data.issues).toEqual([
      expect.objectContaining({ step: 'content', fix: 'SENDING_DOMAINS' }),
    ])
    const domain = await seedSendingDomain({
      workspaceId: workspace.id,
      createdById: user.id,
      status: 'VERIFIED',
    })
    const verified = await patchJson(
      `${base}/${draft.id}`,
      { emailFrom: `marketing@${domain.name}` },
      user.cookie,
    )
    const ready = (await verified.json()).data
    expect(ready.issues).toEqual([])
    expect(ready.links.email).toContain(
      `/f/${form.publicToken}?utm_source=email`,
    )

    // Reach + preview.
    const reach = await postJson(
      `${base}/audience-preview`,
      {
        audience: { mailingListIds: [], allPeople: true, leadStages: [] },
        whatsappEnabled: true,
      },
      user.cookie,
    )
    expect((await reach.json()).data).toMatchObject({
      total: 1,
      email: { reachable: 1 },
      whatsapp: { reachable: 1 },
    })
    const preview = (
      await (await getJson(`${base}/${draft.id}/preview`, user.cookie)).json()
    ).data
    expect(preview.subject).toBe('Oferta da Black Friday')
    expect(preview.html).toContain('Oi Maria')

    // Test send (dry-run mailer in e2e).
    const test = await postJson(
      `${base}/${draft.id}/test-send`,
      { email: 'teste@example.com' },
      user.cookie,
    )
    expect((await test.json()).data.email).toBe('sent')

    // Launch.
    const launched = await postJson(
      `${base}/${draft.id}/launch`,
      { confirmLegalBasis: true },
      user.cookie,
    )
    expect(launched.status).toBe(200)
    expect((await launched.json()).data.status).toBe('SENDING')

    // Locked once launched.
    const locked = await patchJson(
      `${base}/${draft.id}`,
      { name: 'x' },
      user.cookie,
    )
    expect(locked.status).toBe(409)

    // Recipients snapshot.
    const page = (
      await (
        await getJson(`${base}/${draft.id}/recipients?page=1`, user.cookie)
      ).json()
    ).data
    expect(page.total).toBe(1)
    expect(page.items[0]).toMatchObject({
      name: 'Ana Souza',
      emailStatus: 'PENDING',
    })

    // Pause / resume.
    const paused = await postJson(
      `${base}/${draft.id}/control`,
      { action: 'pause' },
      user.cookie,
    )
    expect((await paused.json()).data.status).toBe('PAUSED')
    const resumed = await postJson(
      `${base}/${draft.id}/control`,
      { action: 'resume' },
      user.cookie,
    )
    expect((await resumed.json()).data.status).toBe('SENDING')

    // A forwarded link (utm only) converts on the form.
    const submit = await fetch(
      `${BASE_URL}/api/crm/forms/${form.publicToken}/submit`,
      {
        method: 'POST',
        headers: defaultHeaders,
        body: JSON.stringify({
          values: { name: 'Bruno Lima', email: 'bruno.campanha@example.com' },
          campaign: { utmCampaign: 'black-friday', utmSource: 'whatsapp' },
        }),
      },
    )
    expect(submit.status).toBe(201)

    const stats = (
      await (await getJson(`${base}/${draft.id}/stats`, user.cookie)).json()
    ).data
    expect(stats.recipients).toBe(1)
    expect(stats.conversions).toMatchObject({
      total: 1,
      submissions: 1,
      byChannel: { whatsapp: 1 },
    })
    expect(stats.convertedContacts[0].leadId).toBeTruthy()

    // Running campaigns cannot be deleted; canceled ones can.
    expect((await deleteJson(`${base}/${draft.id}`, user.cookie)).status).toBe(
      409,
    )
    await postJson(
      `${base}/${draft.id}/control`,
      { action: 'cancel' },
      user.cookie,
    )
    expect((await deleteJson(`${base}/${draft.id}`, user.cookie)).status).toBe(
      200,
    )

    const list = (await (await getJson(base, user.cookie)).json()).data
    expect(list).toHaveLength(0)
  })

  it('should reject invalid input', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/crm/campaigns`
    expect((await postJson(base, { name: '' }, user.cookie)).status).toBe(422)
    const draft = (
      await (await postJson(base, { name: 'X' }, user.cookie)).json()
    ).data
    expect(
      (
        await patchJson(
          `${base}/${draft.id}`,
          { emailFrom: 'nope' },
          user.cookie,
        )
      ).status,
    ).toBe(422)
    expect(
      (await postJson(`${base}/${draft.id}/launch`, {}, user.cookie)).status,
    ).toBe(422)
    expect(
      (
        await postJson(
          `${base}/${draft.id}/control`,
          { action: 'x' },
          user.cookie,
        )
      ).status,
    ).toBe(422)
    expect(
      (await postJson(`${base}/${draft.id}/test-send`, {}, user.cookie)).status,
    ).toBe(422)
    expect(
      (await getJson(`${base}/${draft.id}/recipients?page=0`, user.cookie))
        .status,
    ).toBe(422)
    expect(
      (await postJson(`${base}/audience-preview`, { audience: 1 }, user.cookie))
        .status,
    ).toBe(422)
    expect((await getJson(`${base}/missing`, user.cookie)).status).toBe(404)
  })
})

describe('/api/crm/campaigns — public tracking', () => {
  it('should reject invalid link tokens and always serve the pixel', async () => {
    const click = await fetch(`${BASE_URL}/api/crm/campaigns/c/nope.bad`, {
      headers: defaultHeaders,
      redirect: 'manual',
    })
    expect(click.status).toBe(404)

    const pixel = await fetch(`${BASE_URL}/api/crm/campaigns/o/nope.bad`)
    expect(pixel.status).toBe(200)
    expect(pixel.headers.get('content-type')).toBe('image/gif')
  })

  it('should refuse unsigned Resend webhooks', async () => {
    const res = await fetch(`${BASE_URL}/api/crm/campaigns/resend-webhook`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        type: 'email.delivered',
        data: { email_id: 'x' },
      }),
    })
    // 503 when the secret is not configured, 401 when it is.
    expect([401, 503]).toContain(res.status)
  })
})
