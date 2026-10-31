import { describe, expect, it } from 'vitest'
import { seedCrmProspectDraft } from '@/src/__tests__/factories/nov-prospecting-agent.factory'
import {
  addMember,
  authenticatedOwner,
  createAuthenticatedUser,
  defaultHeaders,
  getJson,
  patchJson,
  postJson,
  putJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

const path = (workspaceId: string, tail = '') =>
  `/api/workspaces/${workspaceId}/crm/prospecting${tail}`

describe('prospecting routes - access', () => {
  it('should return 401 via middleware when unauthenticated', async () => {
    const res = await fetch(`${BASE_URL}${path('some-id', '/settings')}`, {
      headers: defaultHeaders,
    })
    expect(res.status).toBe(401)
  })

  it('should return 403 for a user outside the workspace', async () => {
    const { workspace } = await authenticatedOwner()
    const stranger = await createAuthenticatedUser()
    for (const tail of ['/settings', '/usage', '/drafts']) {
      const res = await getJson(path(workspace.id, tail), stranger.cookie)
      expect(res.status).toBe(403)
    }
  })
})

describe('settings', () => {
  it('should start off with the default limits', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await getJson(path(workspace.id, '/settings'), user.cookie)
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({
      enabled: false,
      monthlyWebLimit: 300,
      monthlyDraftLimit: 100,
      allowedChannels: ['EMAIL', 'WHATSAPP'],
    })
  })

  it('should let the owner turn it on and keep the other fields', async () => {
    const { user, workspace } = await authenticatedOwner()
    const saved = await putJson(
      path(workspace.id, '/settings'),
      {
        enabled: true,
        monthlyWebLimit: 25,
        allowedChannels: ['EMAIL'],
        signalKeywords: ['pabx'],
        valueProposition: 'Telefonia em nuvem',
      },
      user.cookie,
    )
    expect(saved.status).toBe(200)
    expect((await saved.json()).data).toMatchObject({
      enabled: true,
      monthlyWebLimit: 25,
      allowedChannels: ['EMAIL'],
    })

    const patch = await putJson(
      path(workspace.id, '/settings'),
      { monthlyDraftLimit: 5 },
      user.cookie,
    )
    expect((await patch.json()).data).toMatchObject({
      enabled: true,
      monthlyWebLimit: 25,
      monthlyDraftLimit: 5,
    })
  })

  it('should forbid a plain member from changing it and reject bad input', async () => {
    const { user, workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')

    const denied = await putJson(
      path(workspace.id, '/settings'),
      { enabled: true },
      member.cookie,
    )
    expect(denied.status).toBe(403)

    const read = await getJson(path(workspace.id, '/settings'), member.cookie)
    expect(read.status).toBe(200)

    for (const body of [{}, { allowedChannels: [] }, { monthlyWebLimit: -5 }]) {
      const res = await putJson(path(workspace.id, '/settings'), body, user.cookie)
      expect(res.status).toBe(422)
    }
  })
})

describe('usage', () => {
  it('should be zero on a fresh workspace', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await getJson(path(workspace.id, '/usage'), user.cookie)
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({
      searches: 0,
      fetches: 0,
      drafts: 0,
      webLimit: 300,
    })
  })
})

describe('drafts', () => {
  it('should list, filter, read and edit a pending draft', async () => {
    const { user, workspace } = await authenticatedOwner()
    const pending = await seedCrmProspectDraft(workspace.id, user.id)
    await seedCrmProspectDraft(workspace.id, user.id, {
      leadId: null,
      companyId: 'co-1',
      status: 'REJECTED',
      rejectReason: 'Fora do perfil',
    })

    const all = await getJson(path(workspace.id, '/drafts'), user.cookie)
    expect((await all.json()).data).toHaveLength(2)

    const onlyPending = await getJson(
      path(workspace.id, '/drafts?status=PENDING'),
      user.cookie,
    )
    const list = (await onlyPending.json()).data
    expect(list).toHaveLength(1)
    expect(list[0].signals[0]).toMatchObject({ type: 'HIRING', label: 'Contratando' })

    const one = await getJson(path(workspace.id, `/drafts/${pending.id}`), user.cookie)
    expect(one.status).toBe(200)

    const edited = await patchJson(
      path(workspace.id, `/drafts/${pending.id}`),
      { body: 'Texto revisado pelo vendedor, mais direto e curto.' },
      user.cookie,
    )
    expect(edited.status).toBe(200)
    expect((await edited.json()).data.body).toContain('revisado')
  })

  it('should reject a bad status filter and an unknown draft', async () => {
    const { user, workspace } = await authenticatedOwner()
    const bad = await getJson(path(workspace.id, '/drafts?status=NOPE'), user.cookie)
    expect(bad.status).toBe(422)
    const missing = await getJson(path(workspace.id, '/drafts/nope'), user.cookie)
    expect(missing.status).toBe(404)
  })

  it('should not show another workspace\'s draft', async () => {
    const { user, workspace } = await authenticatedOwner()
    const other = await authenticatedOwner()
    const foreign = await seedCrmProspectDraft(other.workspace.id, other.user.id)
    const res = await getJson(path(workspace.id, `/drafts/${foreign.id}`), user.cookie)
    expect(res.status).toBe(404)
  })

  it('should walk approve, mark as sent and then refuse further changes', async () => {
    const { user, workspace } = await authenticatedOwner()
    const draft = await seedCrmProspectDraft(workspace.id, user.id)
    const decision = path(workspace.id, `/drafts/${draft.id}/decision`)

    const early = await postJson(decision, { decision: 'MARK_SENT' }, user.cookie)
    expect(early.status).toBe(409)

    const approved = await postJson(decision, { decision: 'APPROVE' }, user.cookie)
    expect(approved.status).toBe(200)
    expect((await approved.json()).data).toMatchObject({
      status: 'APPROVED',
      decidedById: user.id,
    })

    const again = await postJson(decision, { decision: 'APPROVE' }, user.cookie)
    expect(again.status).toBe(409)
    const edit = await patchJson(
      path(workspace.id, `/drafts/${draft.id}`),
      { body: 'Tentando editar depois de aprovado, sem sucesso.' },
      user.cookie,
    )
    expect(edit.status).toBe(409)

    const sent = await postJson(decision, { decision: 'MARK_SENT' }, user.cookie)
    expect((await sent.json()).data.status).toBe('SENT')
  })

  it('should require a reason to reject and record it', async () => {
    const { user, workspace } = await authenticatedOwner()
    const draft = await seedCrmProspectDraft(workspace.id, user.id)
    const decision = path(workspace.id, `/drafts/${draft.id}/decision`)

    const noReason = await postJson(decision, { decision: 'REJECT' }, user.cookie)
    expect(noReason.status).toBe(422)

    const rejected = await postJson(
      decision,
      { decision: 'REJECT', reason: 'Fora do perfil' },
      user.cookie,
    )
    expect(rejected.status).toBe(200)
    expect((await rejected.json()).data).toMatchObject({
      status: 'REJECTED',
      rejectReason: 'Fora do perfil',
    })
  })

  it('should let a viewer read drafts but not decide on them', async () => {
    const { user, workspace } = await authenticatedOwner()
    const viewer = await addMember(workspace.id, 'VIEWER')
    const draft = await seedCrmProspectDraft(workspace.id, user.id)

    const list = await getJson(path(workspace.id, '/drafts'), viewer.cookie)
    expect(list.status).toBe(200)
    const decide = await postJson(
      path(workspace.id, `/drafts/${draft.id}/decision`),
      { decision: 'APPROVE' },
      viewer.cookie,
    )
    expect(decide.status).toBe(403)
  })
})

describe('agent preset', () => {
  it('should create the agent for an admin and refuse a member', async () => {
    const { user, workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')

    const denied = await postJson(path(workspace.id, '/agent'), {}, member.cookie)
    expect(denied.status).toBe(403)

    const created = await postJson(path(workspace.id, '/agent'), {}, user.cookie)
    expect(created.status).toBe(201)
    const agent = (await created.json()).data
    expect(agent.name).toBe('Prospecção e enriquecimento')
    expect(agent.triggerType).toBe('MANUAL')
    const draftTool = agent.tools.find(
      (tool: { toolName: string }) => tool.toolName === 'crm_prospect_save_draft',
    )
    expect(draftTool.mode).toBe('APPROVAL')

    const bad = await postJson(
      path(workspace.id, '/agent'),
      { trigger: 'CRON' },
      user.cookie,
    )
    expect(bad.status).toBe(422)
  })
})
