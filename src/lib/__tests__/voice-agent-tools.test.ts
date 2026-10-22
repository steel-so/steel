import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseError, forbidden, validationError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

const mocks = vi.hoisted(() => ({
  findTool: vi.fn(),
  hasToolAccess: vi.fn(),
  resolveToolAccess: vi.fn(),
  runTool: vi.fn(),
  logCreate: vi.fn(),
  findTickets: vi.fn(),
  ticketGet: vi.fn(),
  audit: vi.fn(),
}))

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: mocks.audit }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/lib/ai/tools/registry', () => ({
  findTool: mocks.findTool,
  hasToolAccess: mocks.hasToolAccess,
  resolveToolAccess: mocks.resolveToolAccess,
  runTool: mocks.runTool,
  aiActionSource: () => 'VOICE',
}))
vi.mock('@/src/repositories/ai-action-log.repository', () => ({
  AiActionLogRepository: { create: mocks.logCreate },
}))
vi.mock('@/src/repositories/voice-agent.repository', () => ({
  VoiceAgentRepository: { findTicketIdsForCaller: mocks.findTickets },
}))
vi.mock('@/src/services/sd-ticket.service', () => ({
  SdTicketService: { get: mocks.ticketGet },
}))

import { createVoiceTools, type VoiceToolsInput } from '../voice-agent/tools'

const ACCESS = { aiEnabled: true, modules: ['COMMUNICATION', 'SERVICE_DESK'] }

const createTool = {
  name: 'sd_create_ticket',
  kind: 'CREATE',
  module: 'SERVICE_DESK',
  parse: vi.fn(),
  preview: vi.fn(),
}
const searchTool = { name: 'zap_contacts_search', kind: 'READ', module: null }

const INPUT: VoiceToolsInput = {
  workspaceId: 'ws1',
  runAsUserId: 'user1',
  callId: 'call1',
  callerNumber: '5511999998888',
  canOpenTickets: true,
  canLookupTickets: true,
  transferTarget: '200',
}

function call(name: string, args: Record<string, unknown> = {}) {
  return { id: `id-${name}`, name, args }
}

async function build(overrides: Partial<VoiceToolsInput> = {}) {
  return createVoiceTools({ ...INPUT, ...overrides })
}

function parsed(run: { output: string }) {
  return JSON.parse(run.output)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveToolAccess.mockResolvedValue(ok(ACCESS))
  mocks.hasToolAccess.mockReturnValue(true)
  mocks.findTool.mockImplementation((name: string) =>
    name === 'sd_create_ticket'
      ? createTool
      : name === 'zap_contacts_search'
        ? searchTool
        : undefined,
  )
  createTool.parse.mockImplementation((args: unknown) => ok(args))
  createTool.preview.mockResolvedValue(
    ok({
      title: 'Abrir incidente “Sem internet”',
      summary: 's',
      fields: [{ label: 'Título', after: 'Sem internet' }],
    }),
  )
  mocks.logCreate.mockResolvedValue(ok({}))
})

describe('createVoiceTools() — what the model is offered', () => {
  it('offers the four tools to an identity that may use them', async () => {
    const { definitions } = await build()
    expect(definitions.map((tool) => tool.name)).toEqual([
      'identify_contact',
      'open_ticket',
      'ticket_status',
      'transfer_to_human',
    ])
  })

  it('offers only the hand-off when the identity cannot be resolved', async () => {
    mocks.resolveToolAccess.mockResolvedValue(err(forbidden()))
    const { definitions } = await build()
    expect(definitions.map((tool) => tool.name)).toEqual(['transfer_to_human'])
  })

  it('offers only the hand-off when Steel AI is off in the workspace', async () => {
    mocks.resolveToolAccess.mockResolvedValue(
      ok({ ...ACCESS, aiEnabled: false }),
    )
    const { definitions } = await build()
    expect(definitions.map((tool) => tool.name)).toEqual(['transfer_to_human'])
  })

  it('drops tools the permissions or the workspace switches rule out', async () => {
    mocks.hasToolAccess.mockReturnValue(false)
    const { definitions } = await build({ canLookupTickets: false })
    expect(definitions.map((tool) => tool.name)).toEqual(['transfer_to_human'])
  })

  it('respects the per-workspace switches for opening and looking up', async () => {
    const { definitions } = await build({
      canOpenTickets: false,
      canLookupTickets: false,
    })
    expect(definitions.map((tool) => tool.name)).toEqual([
      'identify_contact',
      'transfer_to_human',
    ])
  })

  it('works when the registry lacks a tool', async () => {
    mocks.findTool.mockReturnValue(undefined)
    const { definitions } = await build()
    expect(definitions.map((tool) => tool.name)).toEqual([
      'ticket_status',
      'transfer_to_human',
    ])
  })
})

describe('identify_contact', () => {
  it('names a known caller, matching the number with or without the ninth digit', async () => {
    mocks.runTool.mockResolvedValue({
      ok: true,
      output: {
        data: {
          items: [
            { name: 'Outra Pessoa', waId: '5521988887777' },
            { name: 'Maria', waId: '551199998888' },
          ],
        },
      },
    })
    const { executor, state } = await build()
    const run = await executor.execute(call('identify_contact'), {
      tainted: false,
    })
    expect(parsed(run)).toEqual({ known: true, name: 'Maria' })
    expect(state.contactName).toBe('Maria')
    expect(mocks.runTool).toHaveBeenCalledWith(
      searchTool,
      { workspaceId: 'ws1', actorId: 'user1', source: 'voice' },
      { query: '99998888' },
    )
  })

  it('answers unknown for a stranger, a failed search or a number without a key', async () => {
    mocks.runTool.mockResolvedValue({
      ok: true,
      output: { data: { items: [{ name: 'X', waId: '5521988887777' }] } },
    })
    const stranger = await build()
    expect(
      parsed(
        await stranger.executor.execute(call('identify_contact'), {
          tainted: false,
        }),
      ),
    ).toEqual({ known: false, name: null })

    mocks.runTool.mockResolvedValue({ ok: true, output: { data: {} } })
    expect(
      parsed(
        await stranger.executor.execute(call('identify_contact'), {
          tainted: false,
        }),
      ),
    ).toEqual({ known: false, name: null })

    mocks.runTool.mockResolvedValue({ ok: false, error: forbidden() })
    expect(
      parsed(
        await stranger.executor.execute(call('identify_contact'), {
          tainted: false,
        }),
      ),
    ).toEqual({ known: false })

    const short = await build({ callerNumber: '123' })
    expect(
      parsed(
        await short.executor.execute(call('identify_contact'), {
          tainted: false,
        }),
      ),
    ).toEqual({ known: false })
  })

  it('answers unknown when the tool is not allowed', async () => {
    mocks.hasToolAccess.mockReturnValue(false)
    const { executor } = await build()
    expect(
      parsed(
        await executor.execute(call('identify_contact'), { tainted: false }),
      ),
    ).toEqual({ known: false })
    expect(mocks.runTool).not.toHaveBeenCalled()
  })
})

describe('open_ticket', () => {
  const args = {
    practice: 'incident',
    title: 'Sem internet',
    description: 'Desde cedo',
  }

  async function confirmFlow() {
    const tools = await build()
    const preview = await tools.executor.execute(call('open_ticket', args), {
      tainted: false,
    })
    return { ...tools, preview }
  }

  it('previews first and never creates without a confirmation', async () => {
    const { preview } = await confirmFlow()
    expect(parsed(preview)).toMatchObject({
      status: 'needs_confirmation',
      preview: {
        title: 'Abrir incidente “Sem internet”',
        fields: [{ label: 'Título', value: 'Sem internet' }],
      },
    })
    expect(mocks.runTool).not.toHaveBeenCalled()
  })

  it('does not trust confirmed=true without a preview of the same title', async () => {
    const { executor } = await build()
    const run = await executor.execute(
      call('open_ticket', { ...args, confirmed: true }),
      { tainted: false },
    )
    expect(parsed(run).status).toBe('needs_confirmation')
    expect(mocks.runTool).not.toHaveBeenCalled()
  })

  it('does not accept a confirmation for a different title', async () => {
    const { executor } = await confirmFlow()
    const run = await executor.execute(
      call('open_ticket', { ...args, title: 'Outro assunto', confirmed: true }),
      { tainted: false },
    )
    expect(parsed(run).status).toBe('needs_confirmation')
  })

  it('creates the ticket after the confirmed second step and records it', async () => {
    mocks.runTool.mockResolvedValue({
      ok: true,
      output: {
        summary: 'Chamado INC-1 aberto',
        target: { type: 'sd_ticket', id: 'tk1', label: 'INC-1' },
      },
    })
    const { executor, state } = await confirmFlow()
    const run = await executor.execute(
      call('open_ticket', {
        ...args,
        title: ' sem  internet ',
        confirmed: true,
      }),
      { tainted: false },
    )
    expect(parsed(run)).toEqual({ status: 'done', ticket: 'INC-1' })
    expect(state.ticket).toEqual({ id: 'tk1', code: 'INC-1' })

    const created = mocks.runTool.mock.calls[0][2]
    expect(created.practice).toBe('incident')
    expect(created.description).toContain('Desde cedo')
    expect(created.description).toContain('5511999998888')
    expect(mocks.logCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'VOICE',
        actorId: 'user1',
        toolName: 'sd_create_ticket',
        targetId: 'tk1',
        outcome: 'success',
      }),
    )
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'whatsapp_phone_call',
        action: 'voice_ticket',
        targetId: 'call1',
        outcome: 'success',
      }),
    )

    const again = await executor.execute(call('open_ticket', args), {
      tainted: false,
    })
    expect(parsed(again).message).toContain('INC-1')
  })

  it('uses the ticket id when the registry gives no label', async () => {
    mocks.runTool.mockResolvedValue({
      ok: true,
      output: { summary: 's', target: { type: 'sd_ticket', id: 'tk9' } },
    })
    const { executor, state } = await confirmFlow()
    await executor.execute(call('open_ticket', { ...args, confirmed: true }), {
      tainted: false,
    })
    expect(state.ticket?.code).toBe('tk9')
  })

  it('sends the caller to a person when the registry refuses', async () => {
    mocks.runTool.mockResolvedValue({ ok: false, error: forbidden() })
    const { executor, state } = await confirmFlow()
    const run = await executor.execute(
      call('open_ticket', { ...args, confirmed: true }),
      { tainted: false },
    )
    expect(parsed(run).status).toBe('error')
    expect(state.ticket).toBeNull()
    expect(mocks.logCreate).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failure' }),
    )
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failure', reason: 'FORBIDDEN' }),
    )
  })

  it('treats a creation without a target as a failure', async () => {
    mocks.runTool.mockResolvedValue({
      ok: true,
      output: { summary: 's', target: undefined },
    })
    const { executor, state } = await confirmFlow()
    const run = await executor.execute(
      call('open_ticket', { ...args, confirmed: true }),
      { tainted: false },
    )
    expect(parsed(run).status).toBe('error')
    expect(state.ticket).toBeNull()
  })

  it('refuses when the call is tainted by an injection attempt', async () => {
    const { executor } = await build()
    const run = await executor.execute(call('open_ticket', args), {
      tainted: true,
    })
    expect(parsed(run).message).toMatch(/pessoa/)
    expect(createTool.preview).not.toHaveBeenCalled()
  })

  it('refuses without a title and with invalid data', async () => {
    const { executor } = await build()
    expect(
      parsed(
        await executor.execute(call('open_ticket', { practice: 'incident' }), {
          tainted: false,
        }),
      ).message,
    ).toMatch(/título/)

    createTool.parse.mockReturnValue(err(validationError('bad')))
    expect(
      parsed(
        await executor.execute(call('open_ticket', args), { tainted: false }),
      ).message,
    ).toMatch(/incompletos/)
  })

  it('reports a preview that cannot be prepared and tolerates tools without preview', async () => {
    createTool.preview.mockResolvedValueOnce(err(forbidden()))
    const { executor } = await build()
    expect(
      parsed(
        await executor.execute(call('open_ticket', args), { tainted: false }),
      ).message,
    ).toMatch(/Transfira/)

    const previewFn = createTool.preview
    ;(createTool as any).preview = undefined
    const run = await executor.execute(call('open_ticket', args), {
      tainted: false,
    })
    expect(parsed(run)).toMatchObject({
      status: 'needs_confirmation',
      preview: { title: 'Sem internet' },
    })
    createTool.preview = previewFn
  })

  it('is not available when disabled or not allowed', async () => {
    const off = await build({ canOpenTickets: false })
    expect(
      parsed(
        await off.executor.execute(call('open_ticket', args), {
          tainted: false,
        }),
      ).message,
    ).toMatch(/não está disponível/)
  })

  it('treats a missing description as empty', async () => {
    const { executor } = await build()
    const run = await executor.execute(
      call('open_ticket', {
        practice: 'request',
        title: 'Pedido',
        description: 7,
      }),
      { tainted: false },
    )
    expect(parsed(run).status).toBe('needs_confirmation')
    expect(createTool.parse.mock.calls[0][0].description).toMatch(
      /^Chamado aberto pelo atendente/,
    )
  })
})

describe('ticket_status', () => {
  const owned = [
    { id: 't3', number: 3 },
    { id: 't2', number: 2 },
    { id: 't1', number: 1 },
    { id: 't0', number: 10 },
  ]

  function ticket(code: string) {
    return {
      code,
      title: `Título ${code}`,
      phase: { name: 'Em andamento' },
      priority: { name: 'Alta' },
      resolutionDueAt: '2026-10-25T12:00:00.000Z',
      description: 'segredo',
      requester: { email: 'x@y.z' },
    }
  }

  it('answers about the ticket the caller asked for, nothing more', async () => {
    mocks.findTickets.mockResolvedValue(ok(owned))
    mocks.ticketGet.mockResolvedValue(ok(ticket('INC-000002')))
    const { executor } = await build()
    const run = await executor.execute(
      call('ticket_status', { ticket: 'INC-000002' }),
      { tainted: false },
    )
    expect(parsed(run)).toEqual({
      status: 'found',
      tickets: [
        {
          code: 'INC-000002',
          title: 'Título INC-000002',
          phase: 'Em andamento',
          priority: 'Alta',
          resolutionDueAt: '2026-10-25T12:00:00.000Z',
        },
      ],
    })
    expect(mocks.findTickets).toHaveBeenCalledWith('ws1', '1199998888')
    expect(mocks.ticketGet).toHaveBeenCalledWith('user1', 'ws1', 't2')
  })

  it('lists the most recent tickets when no number was said', async () => {
    mocks.findTickets.mockResolvedValue(ok(owned))
    mocks.ticketGet.mockImplementation(async (_u, _w, id: string) =>
      ok({ ...ticket(id), priority: null }),
    )
    const { executor } = await build()
    const run = await executor.execute(call('ticket_status'), {
      tainted: false,
    })
    expect(parsed(run).tickets).toHaveLength(3)
    expect(parsed(run).tickets[0].priority).toBeNull()
  })

  it('says not found for a ticket that is not the caller’s', async () => {
    mocks.findTickets.mockResolvedValue(ok(owned))
    const { executor } = await build()
    const run = await executor.execute(
      call('ticket_status', { ticket: '999' }),
      {
        tainted: false,
      },
    )
    expect(parsed(run)).toEqual({ status: 'not_found' })
    expect(mocks.ticketGet).not.toHaveBeenCalled()
  })

  it('says not found when the caller has no tickets or none can be read', async () => {
    mocks.findTickets.mockResolvedValue(ok([]))
    const { executor } = await build()
    expect(
      parsed(await executor.execute(call('ticket_status'), { tainted: false })),
    ).toEqual({ status: 'not_found' })

    mocks.findTickets.mockResolvedValue(ok(owned))
    mocks.ticketGet.mockResolvedValue(err(forbidden()))
    expect(
      parsed(await executor.execute(call('ticket_status'), { tainted: false })),
    ).toEqual({ status: 'not_found' })
  })

  it('does not look anything up for a number without a key', async () => {
    const { executor } = await build({ callerNumber: '123' })
    expect(
      parsed(await executor.execute(call('ticket_status'), { tainted: false })),
    ).toEqual({ status: 'not_found' })
    expect(mocks.findTickets).not.toHaveBeenCalled()
  })

  it('reports a database failure without leaking it', async () => {
    mocks.findTickets.mockResolvedValue(err(databaseError('db down')))
    const { executor } = await build()
    const run = await executor.execute(call('ticket_status'), {
      tainted: false,
    })
    expect(parsed(run)).toEqual({
      status: 'error',
      message: 'Não consegui consultar agora.',
    })
  })

  it('limits the lookups of one call', async () => {
    mocks.findTickets.mockResolvedValue(ok([]))
    const { executor } = await build({ maxLookups: 2 })
    await executor.execute(call('ticket_status'), { tainted: false })
    await executor.execute(call('ticket_status'), { tainted: false })
    const third = await executor.execute(call('ticket_status'), {
      tainted: false,
    })
    expect(parsed(third).message).toMatch(/Muitas consultas/)
    expect(mocks.findTickets).toHaveBeenCalledTimes(2)
  })

  it('is not available when switched off', async () => {
    const { executor } = await build({ canLookupTickets: false })
    expect(
      parsed(await executor.execute(call('ticket_status'), { tainted: false }))
        .message,
    ).toMatch(/não está disponível/)
  })
})

describe('transfer_to_human', () => {
  it('asks for the hand-off with the route target and keeps the summary', async () => {
    const { executor, state } = await build()
    const run = await executor.execute(
      call('transfer_to_human', { reason: 'cobrança', summary: 'Quer 2ª via' }),
      { tainted: false },
    )
    expect(run.transfer).toEqual({ reason: 'cobrança', target: '200' })
    expect(state.handoffSummary).toBe('Quer 2ª via')
  })

  it('has defaults for a bare request', async () => {
    const { executor, state } = await build({ transferTarget: null })
    const run = await executor.execute(call('transfer_to_human'), {
      tainted: false,
    })
    expect(run.transfer).toEqual({ reason: 'pedido do cliente', target: null })
    expect(state.handoffSummary).toBeNull()
  })
})

it('rejects an unknown tool', async () => {
  const { executor } = await build()
  const run = await executor.execute(call('format_disk'), { tainted: false })
  expect(parsed(run).status).toBe('error')
})
