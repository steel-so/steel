import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  getJson,
  patchJson,
  putJson,
} from '@/src/__tests__/helpers/e2e'
import { prisma } from '@/src/lib/prisma'

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/ai`

async function seedInsight(
  workspaceId: string,
  userId: string,
  data: {
    dedupeKey: string
    module?: 'SERVICE_DESK' | 'CRM' | 'COMMUNICATION'
    severity?: 'INFO' | 'WARNING' | 'CRITICAL'
  },
) {
  return prisma.aiInsight.create({
    data: {
      workspaceId,
      userId,
      kind:
        data.module === 'SERVICE_DESK'
          ? 'SD_SLA_BREACH_FORECAST'
          : 'CRM_STALE_OPPORTUNITIES',
      module: data.module ?? 'CRM',
      severity: data.severity ?? 'INFO',
      dedupeKey: data.dedupeKey,
      title: `Alerta ${data.dedupeKey}`,
      body: 'Somam R$ 1.000,00.',
      facts: [{ label: 'Oportunidades', value: '2' }],
      href: '/acme/crm/opportunities',
      prompt: 'Liste minhas oportunidades paradas.',
    },
  })
}

describe('GET /api/workspaces/[id]/ai/insights', () => {
  it('lists only the caller own insights, most severe first', async () => {
    const { user, workspace } = await authenticatedOwner()
    const other = await addMember(workspace.id)
    await seedInsight(workspace.id, user.id, { dedupeKey: 'crm-stale:all' })
    const critical = await seedInsight(workspace.id, user.id, {
      dedupeKey: 'sd-breach:dept:d1',
      module: 'SERVICE_DESK',
      severity: 'CRITICAL',
    })
    await seedInsight(workspace.id, other.id, { dedupeKey: 'crm-stale:all' })

    const res = await getJson(`${base(workspace.id)}/insights`, user.cookie)
    expect(res.status).toBe(200)
    const data = (await res.json()).data
    expect(data.enabled).toBe(true)
    expect(data.counts).toEqual({ active: 2, snoozed: 0, dismissed: 0 })
    expect(data.items).toHaveLength(2)
    expect(data.items[0]).toEqual(
      expect.objectContaining({
        id: critical.id,
        module: 'SERVICE_DESK',
        severity: 'CRITICAL',
        state: 'active',
        facts: [{ label: 'Oportunidades', value: '2' }],
      }),
    )

    const crm = await getJson(
      `${base(workspace.id)}/insights?module=CRM&limit=5`,
      user.cookie,
    )
    expect((await crm.json()).data.items).toHaveLength(1)
  })

  it('answers enabled false with the proactive AI off', async () => {
    const { user, workspace } = await authenticatedOwner()
    await seedInsight(workspace.id, user.id, { dedupeKey: 'crm-stale:all' })
    await prisma.workspaceAiSettings.create({
      data: {
        workspaceId: workspace.id,
        enabledModels: ['openai:gpt-4o-mini'],
        crmAssistantModel: 'openai:gpt-4o-mini',
        whatsappReplyModel: 'openai:gpt-4o-mini',
        whatsappSentimentModel: 'openai:gpt-4o-mini',
        proactiveEnabled: false,
      },
    })
    const res = await getJson(`${base(workspace.id)}/insights`, user.cookie)
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({
      enabled: false,
      items: [],
      counts: { active: 0, snoozed: 0, dismissed: 0 },
    })
  })

  it('hides the insights of a module the workspace disabled', async () => {
    const { user, workspace } = await authenticatedOwner()
    await seedInsight(workspace.id, user.id, { dedupeKey: 'crm-stale:all' })
    await prisma.workspaceModuleAccess.updateMany({
      where: { workspaceId: workspace.id, module: 'CRM' },
      data: { enabled: false },
    })
    const res = await getJson(`${base(workspace.id)}/insights`, user.cookie)
    expect((await res.json()).data.items).toEqual([])
  })

  it('validates the query and refuses non-members and anonymous calls', async () => {
    const { user, workspace } = await authenticatedOwner()
    const bad = await getJson(
      `${base(workspace.id)}/insights?state=gone`,
      user.cookie,
    )
    expect(bad.status).toBe(422)

    const outsider = await authenticatedOwner()
    const forbidden = await getJson(
      `${base(workspace.id)}/insights`,
      outsider.user.cookie,
    )
    expect(forbidden.status).toBe(403)

    const anonymous = await getJson(`${base(workspace.id)}/insights`)
    expect(anonymous.status).toBe(401)
  })
})

describe('PATCH /api/workspaces/[id]/ai/insights/[insightId]', () => {
  it('snoozes, dismisses and restores the caller own insight', async () => {
    const { user, workspace } = await authenticatedOwner()
    const row = await seedInsight(workspace.id, user.id, {
      dedupeKey: 'crm-stale:all',
    })
    const url = `${base(workspace.id)}/insights/${row.id}`

    const snoozed = await patchJson(
      url,
      { action: 'snooze', hours: 4 },
      user.cookie,
    )
    expect(snoozed.status).toBe(200)
    expect((await snoozed.json()).data.state).toBe('snoozed')

    const list = await getJson(
      `${base(workspace.id)}/insights?state=snoozed`,
      user.cookie,
    )
    expect(
      (await list.json()).data.items.map((i: { id: string }) => i.id),
    ).toEqual([row.id])

    const dismissed = await patchJson(url, { action: 'dismiss' }, user.cookie)
    expect((await dismissed.json()).data.state).toBe('dismissed')

    const restored = await patchJson(url, { action: 'restore' }, user.cookie)
    expect((await restored.json()).data.state).toBe('active')
  })

  it("answers 404 for someone else's insight and 422 for a bad body", async () => {
    const { user, workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id)
    const row = await seedInsight(workspace.id, user.id, {
      dedupeKey: 'crm-stale:all',
    })
    const url = `${base(workspace.id)}/insights/${row.id}`

    const notYours = await patchJson(url, { action: 'dismiss' }, member.cookie)
    expect(notYours.status).toBe(404)
    expect((await notYours.json()).error.code).toBe('AI_INSIGHT_NOT_FOUND')

    const bad = await patchJson(
      url,
      { action: 'snooze', hours: 500 },
      user.cookie,
    )
    expect(bad.status).toBe(422)
  })
})

describe('/api/workspaces/[id]/ai/digest-settings', () => {
  it('reads the defaults and saves the caller channels', async () => {
    const { user, workspace } = await authenticatedOwner()
    const url = `${base(workspace.id)}/digest-settings`

    const initial = await getJson(url, user.cookie)
    expect(initial.status).toBe(200)
    expect((await initial.json()).data).toEqual({
      inApp: true,
      email: true,
      workspaceEnabled: true,
    })

    const saved = await putJson(url, { email: false }, user.cookie)
    expect(saved.status).toBe(200)
    expect((await saved.json()).data).toEqual({
      inApp: true,
      email: false,
      workspaceEnabled: true,
    })

    const empty = await putJson(url, {}, user.cookie)
    expect(empty.status).toBe(422)

    const outsider = await authenticatedOwner()
    const forbidden = await getJson(url, outsider.user.cookie)
    expect(forbidden.status).toBe(403)
  })
})
