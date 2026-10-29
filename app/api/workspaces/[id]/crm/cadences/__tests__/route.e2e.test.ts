import { describe, expect, it } from 'vitest'
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

const taskSteps = [
  {
    type: 'TASK',
    delayValue: 0,
    delayUnit: 'DAYS',
    subject: 'Ligar para {{nome}}',
  },
  {
    type: 'TASK',
    delayValue: 2,
    delayUnit: 'DAYS',
    subject: 'Retomar contato',
  },
]

describe('GET /api/workspaces/[id]/crm/cadences', () => {
  it('should return 401 via middleware when unauthenticated', async () => {
    const res = await fetch(`${BASE_URL}/api/workspaces/some-id/crm/cadences`, {
      headers: defaultHeaders,
    })
    expect(res.status).toBe(401)
  })

  it('should return 403 when the user is not a workspace member', async () => {
    const { workspace } = await authenticatedOwner()
    const stranger = await createAuthenticatedUser()

    const res = await getJson(
      `/api/workspaces/${workspace.id}/crm/cadences`,
      stranger.cookie,
    )
    expect(res.status).toBe(403)
  })
})

describe('cadence lifecycle', () => {
  it('should create, pause, enroll a lead, stop it and archive', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/crm`

    const created = await postJson(
      `${base}/cadences`,
      { name: 'Outbound', steps: taskSteps },
      user.cookie,
    )
    expect(created.status).toBe(201)
    const cadence = (await created.json()).data
    expect(cadence.steps).toHaveLength(2)

    const listed = await (await getJson(`${base}/cadences`, user.cookie)).json()
    expect(listed.data.map((item: { id: string }) => item.id)).toEqual([
      cadence.id,
    ])

    const leadRes = await postJson(
      `${base}/leads`,
      { name: 'Ana Souza', emails: ['ana@empresa.com.br'], source: 'Teste' },
      user.cookie,
    )
    expect(leadRes.status).toBe(201)
    const lead = (await leadRes.json()).data

    const enrolled = await postJson(
      `${base}/cadence-enrollments`,
      { cadenceId: cadence.id, leadIds: [lead.id, 'missing'] },
      user.cookie,
    )
    expect(enrolled.status).toBe(201)
    const result = (await enrolled.json()).data
    expect(result.enrolled).toHaveLength(1)
    expect(result.skipped).toEqual([
      { leadId: 'missing', reason: 'Lead não encontrado' },
    ])

    const again = await postJson(
      `${base}/cadence-enrollments`,
      { cadenceId: cadence.id, leadIds: [lead.id] },
      user.cookie,
    )
    expect((await again.json()).data.skipped[0].reason).toBe(
      'O lead já está nesta cadência',
    )

    const enrollmentId = result.enrolled[0].id
    const paused = await patchJson(
      `${base}/cadence-enrollments/${enrollmentId}`,
      { action: 'pause' },
      user.cookie,
    )
    expect(paused.status).toBe(200)
    expect((await paused.json()).data.status).toBe('PAUSED')

    const forLead = await getJson(
      `${base}/cadence-enrollments?leadId=${lead.id}`,
      user.cookie,
    )
    expect((await forLead.json()).data).toHaveLength(1)

    const stopped = await patchJson(
      `${base}/cadence-enrollments/${enrollmentId}`,
      { action: 'stop' },
      user.cookie,
    )
    expect((await stopped.json()).data.stopReason).toBe('MANUAL')
    const tooLate = await patchJson(
      `${base}/cadence-enrollments/${enrollmentId}`,
      { action: 'pause' },
      user.cookie,
    )
    expect(tooLate.status).toBe(409)

    const pausedCadence = await patchJson(
      `${base}/cadences/${cadence.id}`,
      { status: 'PAUSED' },
      user.cookie,
    )
    expect((await pausedCadence.json()).data.status).toBe('PAUSED')
    const refused = await postJson(
      `${base}/cadence-enrollments`,
      { cadenceId: cadence.id, leadIds: [lead.id] },
      user.cookie,
    )
    expect(refused.status).toBe(409)

    const archived = await deleteJson(
      `${base}/cadences/${cadence.id}`,
      user.cookie,
    )
    expect(archived.status).toBe(200)
    const gone = await getJson(`${base}/cadences/${cadence.id}`, user.cookie)
    expect(gone.status).toBe(404)
  })

  it('should validate the body and the e-mail sender', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/crm/cadences`

    const empty = await postJson(base, { name: 'x', steps: [] }, user.cookie)
    expect(empty.status).toBe(422)

    const noSender = await postJson(
      base,
      {
        name: 'x',
        steps: [{ type: 'EMAIL', subject: 'Oi', body: 'Texto' }],
      },
      user.cookie,
    )
    expect(noSender.status).toBe(422)
    expect((await noSender.json()).error.code).toBe('CRM_CADENCE_INVALID')
  })

  it('should let a member write but only an admin archive', async () => {
    const { user, workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')
    const base = `/api/workspaces/${workspace.id}/crm/cadences`

    const created = await postJson(
      base,
      { name: 'Do membro', steps: taskSteps },
      member.cookie,
    )
    expect(created.status).toBe(201)
    const id = (await created.json()).data.id

    const denied = await deleteJson(`${base}/${id}`, member.cookie)
    expect(denied.status).toBe(403)
    const allowed = await deleteJson(`${base}/${id}`, user.cookie)
    expect(allowed.status).toBe(200)
  })
})
