import { describe, expect, it } from 'vitest'
import {
  authenticatedOwner,
  createAuthenticatedUser,
  defaultHeaders,
  getJson,
  patchJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

describe('GET /api/workspaces/[id]/crm/email-campaigns', () => {
  it('should return 401 via middleware when unauthenticated', async () => {
    const res = await fetch(
      `${BASE_URL}/api/workspaces/some-id/crm/email-campaigns`,
      { headers: defaultHeaders },
    )
    expect(res.status).toBe(401)
  })

  it('should return 403 when user is not a workspace member', async () => {
    const { workspace } = await authenticatedOwner()
    const stranger = await createAuthenticatedUser()

    const res = await getJson(
      `/api/workspaces/${workspace.id}/crm/email-campaigns`,
      stranger.cookie,
    )
    expect(res.status).toBe(403)
  })
})

describe('POST /api/workspaces/[id]/crm/email-campaigns', () => {
  it('should create a campaign targeting all people and snapshot recipients', async () => {
    const { user, workspace } = await authenticatedOwner()

    await postJson(
      `/api/workspaces/${workspace.id}/crm/people`,
      { name: 'Fulano', emails: ['fulano@example.com'] },
      user.cookie,
    )

    const res = await postJson(
      `/api/workspaces/${workspace.id}/crm/email-campaigns`,
      {
        subject: 'Novidades',
        contentHtml: '<p>Oi</p>',
        fromAddress: 'contato@example.com',
        recipientScope: 'ALL',
      },
      user.cookie,
    )

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.status).toBe('DRAFT')

    const recipients = await getJson(
      `/api/workspaces/${workspace.id}/crm/email-campaigns/${body.data.id}/recipients`,
      user.cookie,
    )
    expect(recipients.status).toBe(200)
    const recipientsBody = await recipients.json()
    expect(
      recipientsBody.data.some(
        (r: { email: string }) => r.email === 'fulano@example.com',
      ),
    ).toBe(true)
  })
})

describe('POST /api/workspaces/[id]/crm/email-campaigns — empty selection', () => {
  // Bug: "Selecionados" sem ninguém marcado ia para todo o workspace.
  it('should reject SELECTED with nobody selected instead of sending to everyone', async () => {
    const { user, workspace } = await authenticatedOwner()
    await postJson(
      `/api/workspaces/${workspace.id}/crm/people`,
      { name: 'Não selecionada', emails: ['nao-selecionada@example.com'] },
      user.cookie,
    )

    const res = await postJson(
      `/api/workspaces/${workspace.id}/crm/email-campaigns`,
      {
        subject: 'Novidades',
        contentHtml: '<p>Oi</p>',
        fromAddress: 'contato@example.com',
        recipientScope: 'SELECTED',
        personIds: [],
        mailingListIds: [],
        extraEmails: [],
      },
      user.cookie,
    )
    expect(res.status).toBe(422)

    const list = await (
      await getJson(
        `/api/workspaces/${workspace.id}/crm/email-campaigns`,
        user.cookie,
      )
    ).json()
    expect(list.data).toHaveLength(0)
  })
})

describe('PATCH /api/workspaces/[id]/crm/email-campaigns/[campaignId]', () => {
  it('should update a draft campaign', async () => {
    const { user, workspace } = await authenticatedOwner()
    const created = await (
      await postJson(
        `/api/workspaces/${workspace.id}/crm/email-campaigns`,
        {
          subject: 'Novidades',
          contentHtml: '<p>Oi</p>',
          fromAddress: 'contato@example.com',
          recipientScope: 'SELECTED',
          extraEmails: ['avulso@example.com'],
        },
        user.cookie,
      )
    ).json()

    const res = await patchJson(
      `/api/workspaces/${workspace.id}/crm/email-campaigns/${created.data.id}`,
      { subject: 'Novidades atualizadas' },
      user.cookie,
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.subject).toBe('Novidades atualizadas')
  })
})

describe('POST /api/workspaces/[id]/crm/email-campaigns/[campaignId]/send', () => {
  it('should send a campaign and mark recipients as sent', async () => {
    const { user, workspace } = await authenticatedOwner()

    await postJson(
      `/api/workspaces/${workspace.id}/crm/people`,
      { name: 'Fulano', emails: ['fulano@example.com'] },
      user.cookie,
    )

    const created = await (
      await postJson(
        `/api/workspaces/${workspace.id}/crm/email-campaigns`,
        {
          subject: 'Novidades',
          contentHtml: '<p>Oi</p>',
          // Platform address: no verified domain needed (ADR 0055).
          fromAddress: 'notificacoes@stratustelecom.com.br',
          recipientScope: 'ALL',
        },
        user.cookie,
      )
    ).json()

    const res = await postJson(
      `/api/workspaces/${workspace.id}/crm/email-campaigns/${created.data.id}/send`,
      {},
      user.cookie,
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.status).toBe('SENT')

    const second = await postJson(
      `/api/workspaces/${workspace.id}/crm/email-campaigns/${created.data.id}/send`,
      {},
      user.cookie,
    )
    expect(second.status).toBe(409)
  })

  it('should refuse a From outside the verified domains (ADR 0055)', async () => {
    const { user, workspace } = await authenticatedOwner()
    await postJson(
      `/api/workspaces/${workspace.id}/crm/people`,
      { name: 'Fulano', emails: ['fulano@example.com'] },
      user.cookie,
    )
    const created = await (
      await postJson(
        `/api/workspaces/${workspace.id}/crm/email-campaigns`,
        {
          subject: 'Novidades',
          contentHtml: '<p>Oi</p>',
          fromAddress: 'contato@example.com',
          recipientScope: 'ALL',
        },
        user.cookie,
      )
    ).json()

    const res = await postJson(
      `/api/workspaces/${workspace.id}/crm/email-campaigns/${created.data.id}/send`,
      {},
      user.cookie,
    )
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error.code).toBe('SENDING_DOMAIN_NOT_VERIFIED')
    expect(body.error.message).toContain('Domínios de e-mail')
  })
})
