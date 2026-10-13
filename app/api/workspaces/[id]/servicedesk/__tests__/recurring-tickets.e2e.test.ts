import { describe, expect, it } from 'vitest'
import { seedSdCustomer } from '@/src/__tests__/factories/sd-customer.factory'
import { seedSdPhaseFlow } from '@/src/__tests__/factories/sd-ticket-context.factory'
import {
  addMember,
  authenticatedOwner,
  createAuthenticatedUser,
  deleteJson,
  getJson,
  patchJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'

/**
 * Rotas dos chamados recorrentes. O worker é que abre os chamados na hora
 * marcada; aqui se verifica o contrato: acesso (agente lê, admin escreve),
 * a agenda (recusa fuso/vigência inválidos), o cálculo do próximo disparo,
 * pausar/retomar, o "gerar agora" e o histórico de ocorrências.
 */

const api = (ws: string) => `/api/workspaces/${ws}/servicedesk`
const rules = (ws: string) => `${api(ws)}/recurring-tickets`

async function setup() {
  const { user: owner, workspace } = await authenticatedOwner()
  await seedSdPhaseFlow(workspace.id, 'SERVICE_REQUEST')
  return { owner, workspace }
}

// Validity starts in the future so the expected next run never depends on
// the day the suite runs (a fixed past date broke once "now" passed it).
const ROUTINE = {
  name: 'Vistoria mensal do nobreak',
  description: 'Checar baterias e registrar',
  ticketType: 'SERVICE_REQUEST',
  frequency: 'MONTHLY',
  byMonthday: 10,
  atTime: '08:00',
  timezone: 'America/Sao_Paulo',
  startsAt: '2030-01-01T03:00:00.000Z',
}

async function createRoutine(
  workspaceId: string,
  cookie: string,
  overrides: Record<string, unknown> = {},
) {
  const res = await postJson(
    rules(workspaceId),
    { ...ROUTINE, ...overrides },
    cookie,
  )
  expect(res.status).toBe(201)
  return (await res.json()).data as {
    id: string
    nextRunAt: string | null
    upcoming: string[]
    active: boolean
    runCount: number
  }
}

describe('/api/workspaces/[id]/servicedesk/recurring-tickets', () => {
  it('refuses an anonymous request, a non-member and a requester', async () => {
    const { workspace } = await setup()

    expect((await getJson(rules(workspace.id))).status).toBe(401)

    const stranger = await createAuthenticatedUser()
    expect((await getJson(rules(workspace.id), stranger.cookie)).status).toBe(
      403,
    )

    const requester = await addMember(workspace.id, 'MEMBER')
    const asRequester = await getJson(rules(workspace.id), requester.cookie)
    expect(asRequester.status).toBe(403)
    expect((await asRequester.json()).error.code).toBe('SD_NOT_AGENT')
  })

  it('creates a routine with the next run already scheduled', async () => {
    const { owner, workspace } = await setup()
    const customer = await seedSdCustomer(workspace.id, owner.id, {
      name: 'ACME',
    })

    const routine = await createRoutine(workspace.id, owner.cookie, {
      customerId: customer.id,
      leadTimeMinutes: 60,
      defaults: { title: 'Vistoria preventiva' },
    })

    expect(routine).toMatchObject({
      active: true,
      runCount: 0,
      // Dia 10 às 08:00 em São Paulo, menos 1 h de antecedência.
      nextRunAt: '2030-01-10T10:00:00.000Z',
    })
    expect(routine.upcoming.slice(0, 2)).toEqual([
      '2030-01-10T11:00:00.000Z',
      '2030-02-10T11:00:00.000Z',
    ])

    const list = await getJson(rules(workspace.id), owner.cookie)
    expect(list.status).toBe(200)
    const rows = (await list.json()).data as { id: string }[]
    expect(rows.map((r) => r.id)).toEqual([routine.id])
  })

  it.each([
    ['an unknown timezone', { timezone: 'Mars/Olympus' }],
    [
      'a validity window that never fires',
      { endsAt: '2030-01-05T03:00:00.000Z' },
    ],
  ])('refuses %s with SD_RECURRING_SCHEDULE_INVALID', async (_label, patch) => {
    const { owner, workspace } = await setup()
    const res = await postJson(
      rules(workspace.id),
      { ...ROUTINE, ...patch },
      owner.cookie,
    )
    expect(res.status).toBe(422)
    expect((await res.json()).error.code).toBe('SD_RECURRING_SCHEDULE_INVALID')
  })

  it('refuses a malformed payload and a reference of another workspace', async () => {
    const { owner, workspace } = await setup()

    const invalid = await postJson(
      rules(workspace.id),
      { ...ROUTINE, atTime: '25:00' },
      owner.cookie,
    )
    expect(invalid.status).toBe(422)
    expect((await invalid.json()).error.code).toBe('VALIDATION_ERROR')

    const foreign = await postJson(
      rules(workspace.id),
      { ...ROUTINE, customerId: 'nope' },
      owner.cookie,
    )
    expect(foreign.status).toBe(404)
    expect((await foreign.json()).error.code).toBe('SD_CONFIG_NOT_FOUND')
  })

  it('pauses, resumes and edits the schedule', async () => {
    const { owner, workspace } = await setup()
    const routine = await createRoutine(workspace.id, owner.cookie)

    const paused = await patchJson(
      `${rules(workspace.id)}/${routine.id}`,
      { active: false },
      owner.cookie,
    )
    expect(paused.status).toBe(200)
    expect((await paused.json()).data).toMatchObject({
      active: false,
      nextRunAt: null,
      upcoming: [],
    })

    const resumed = await patchJson(
      `${rules(workspace.id)}/${routine.id}`,
      { active: true, atTime: '07:00', byMonthday: 20 },
      owner.cookie,
    )
    expect(resumed.status).toBe(200)
    const data = (await resumed.json()).data as { nextRunAt: string }
    expect(data.nextRunAt.endsWith('10:00:00.000Z')).toBe(true)

    const broken = await patchJson(
      `${rules(workspace.id)}/${routine.id}`,
      { timezone: 'Mars/Olympus' },
      owner.cookie,
    )
    expect(broken.status).toBe(422)
  })

  it('generates the ticket now and records the occurrence', async () => {
    const { owner, workspace } = await setup()
    const routine = await createRoutine(workspace.id, owner.cookie, {
      defaults: { title: 'Vistoria preventiva de outubro' },
    })

    const run = await postJson(
      `${rules(workspace.id)}/${routine.id}/run-now`,
      {},
      owner.cookie,
    )
    expect(run.status).toBe(201)
    const created = (await run.json()).data as {
      status: string
      ticket: { number: number; title: string } | null
    }
    expect(created.status).toBe('CREATED')
    expect(created.ticket?.title).toBe('Vistoria preventiva de outubro')

    const history = await getJson(
      `${rules(workspace.id)}/${routine.id}/runs`,
      owner.cookie,
    )
    expect(history.status).toBe(200)
    const runs = (await history.json()).data as { status: string }[]
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('CREATED')

    // O "gerar agora" carimba lastRunAt sem consumir a agenda.
    const detail = await getJson(
      `${rules(workspace.id)}/${routine.id}`,
      owner.cookie,
    )
    expect((await detail.json()).data).toMatchObject({
      nextRunAt: routine.nextRunAt,
      runCount: 1,
    })
  })

  it('soft-deletes the routine and 404s afterwards', async () => {
    const { owner, workspace } = await setup()
    const routine = await createRoutine(workspace.id, owner.cookie)

    const removed = await deleteJson(
      `${rules(workspace.id)}/${routine.id}`,
      owner.cookie,
    )
    expect(removed.status).toBe(200)

    const gone = await getJson(
      `${rules(workspace.id)}/${routine.id}`,
      owner.cookie,
    )
    expect(gone.status).toBe(404)
    expect((await gone.json()).error.code).toBe('SD_RECURRING_NOT_FOUND')

    const list = await getJson(rules(workspace.id), owner.cookie)
    expect((await list.json()).data).toEqual([])
  })

  it('lets an agent read but not write', async () => {
    const { owner, workspace } = await setup()
    const routine = await createRoutine(workspace.id, owner.cookie)

    const agent = await addMember(workspace.id, 'MEMBER')
    const department = await postJson(
      `${api(workspace.id)}/departments`,
      { name: 'Infra' },
      owner.cookie,
    )
    expect(department.status).toBe(201)
    const departmentId = (await department.json()).data.id as string
    expect(
      (
        await postJson(
          `${api(workspace.id)}/departments/${departmentId}/members`,
          { userId: agent.id },
          owner.cookie,
        )
      ).status,
    ).toBe(201)

    const list = await getJson(rules(workspace.id), agent.cookie)
    expect(list.status).toBe(200)
    expect((await list.json()).data).toHaveLength(1)

    const write = await patchJson(
      `${rules(workspace.id)}/${routine.id}`,
      { active: false },
      agent.cookie,
    )
    expect(write.status).toBe(403)
    expect((await write.json()).error.code).toBe('FORBIDDEN')
  })

  it('filters the routines of a config item', async () => {
    const { owner, workspace } = await setup()
    const configItem = await postJson(
      `${api(workspace.id)}/config-items`,
      { name: 'Nobreak da sala' },
      owner.cookie,
    )
    expect(configItem.status).toBe(201)
    const configItemId = (await configItem.json()).data.id as string

    const covering = await createRoutine(workspace.id, owner.cookie, {
      configItemId,
    })
    await createRoutine(workspace.id, owner.cookie, { name: 'Outra rotina' })

    const filtered = await getJson(
      `${rules(workspace.id)}?configItemId=${configItemId}`,
      owner.cookie,
    )
    expect(filtered.status).toBe(200)
    const rows = (await filtered.json()).data as { id: string }[]
    expect(rows.map((r) => r.id)).toEqual([covering.id])
  })
})
