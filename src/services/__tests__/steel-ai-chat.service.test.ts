import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeAiMemory } from '@/src/__tests__/factories/ai-skill-memory.factory'
import {
  createFakeAiConversation,
  createFakeAiMessage,
  createFakeAiPendingAction,
} from '@/src/__tests__/factories/steel-ai.factory'
import { createFakeUser } from '@/src/__tests__/factories/user.factory'
import { createFakeUserPreference } from '@/src/__tests__/factories/user-preference.factory'
import { createFakeWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  aiQuotaExceeded,
  databaseError,
  forbidden,
  notFound,
} from '@/src/errors'
import { aiConversationNotFound, validationError } from '@/src/errors/app-error'
import type { AnySteelAiTool } from '@/src/lib/ai/tools/types'
import type {
  AiChatRequest,
  AiChatResponse,
  AiProvider,
  AiStreamChunk,
  AiToolCall,
} from '@/src/lib/ai/types'
import { err, ok } from '@/src/lib/result'
import type { SteelAiStreamEvent } from '@/types/steel-ai'

const tools = vi.hoisted(() => ({ list: [] as unknown[] }))

vi.mock('@/src/lib/ai/tools/registry', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/src/lib/ai/tools/registry')>()
  type Tools = Parameters<typeof actual.availableTools>[2]
  return {
    ...actual,
    resolveToolAccess: vi.fn(),
    availableTools: vi.fn(
      (
        access: Parameters<typeof actual.availableTools>[0],
        mode: 'EXPLORE' | 'AGENT',
      ) => actual.availableTools(access, mode, tools.list as Tools),
    ),
    toolMeta: vi.fn((name: string) =>
      actual.toolMeta(name, tools.list as Tools),
    ),
  }
})
vi.mock('@/src/repositories/ai-conversation.repository')
vi.mock('@/src/repositories/ai-pending-action.repository')
vi.mock('@/src/repositories/ai-settings.repository')
vi.mock('@/src/repositories/user.repository')
vi.mock('@/src/repositories/user-preference.repository')
vi.mock('@/src/repositories/workspace.repository')
vi.mock('@/src/services/ai-usage.service')
vi.mock('@/src/services/ai-attachment.service')
vi.mock('@/src/repositories/ai-attachment.repository')
vi.mock('@/src/repositories/ai-action-log.repository')
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/lib/ai/context/skills', () => ({
  resolveSkillInvocation: vi.fn(async (_ctx: unknown, content: string) => ({
    skill: null,
    content,
  })),
  skillsCatalogForPrompt: vi.fn(async () => ''),
}))
vi.mock('@/src/lib/ai/context/memory', () => ({
  memoryForPrompt: vi.fn(async () => ''),
}))
vi.mock('@/src/services/ai-memory.service')
vi.mock('@/src/services/platform-ai-settings.service', () => ({
  PlatformAiSettingsService: {
    getCostMargin: vi.fn(async () => 2),
    getRoutingDefaults: vi.fn(async () => ({
      taskModels: {
        CLASSIFICATION: null,
        CONVERSATION: null,
        ASSISTANT: null,
        AGENT: null,
      },
      failoverEnabled: true,
    })),
  },
}))
vi.mock('@/src/services/ai-settings.service', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/src/services/ai-settings.service')
  >()),
  // Provider keys are not set in unit tests: usable = enabled.
  isModelUsable: vi.fn((settings: { enabledModels: string[] }, key: string) =>
    settings.enabledModels.includes(key),
  ),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { memoryForPrompt } from '@/src/lib/ai/context/memory'
import {
  resolveSkillInvocation,
  skillsCatalogForPrompt,
} from '@/src/lib/ai/context/skills'
import { resolveToolAccess } from '@/src/lib/ai/tools/registry'
import { AiActionLogRepository } from '@/src/repositories/ai-action-log.repository'
import { AiAttachmentRepository } from '@/src/repositories/ai-attachment.repository'
import {
  AiConversationRepository,
  AiMessageRepository,
} from '@/src/repositories/ai-conversation.repository'
import { AiPendingActionRepository } from '@/src/repositories/ai-pending-action.repository'
import { AiUsageRepository } from '@/src/repositories/ai-settings.repository'
import { UserRepository } from '@/src/repositories/user.repository'
import { UserPreferenceRepository } from '@/src/repositories/user-preference.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import { AiAttachmentService } from '@/src/services/ai-attachment.service'
import { AiMemoryService } from '@/src/services/ai-memory.service'
import {
  AiUsageService,
  type PreparedAiCall,
} from '@/src/services/ai-usage.service'
import {
  dominantModule,
  STEEL_AI_MAX_TOOL_ROUNDS,
  SteelAiChatService,
} from '../steel-ai-chat.service'

const attachmentService = vi.mocked(AiAttachmentService)
const attachmentRepo = vi.mocked(AiAttachmentRepository)
const actionLogs = vi.mocked(AiActionLogRepository)
const audit = vi.mocked(auditMutation)

const mockedAccess = vi.mocked(resolveToolAccess)
const conversations = vi.mocked(AiConversationRepository)
const messages = vi.mocked(AiMessageRepository)
const pendingRepo = vi.mocked(AiPendingActionRepository)
const usageRepo = vi.mocked(AiUsageRepository)
const users = vi.mocked(UserRepository)
const preferences = vi.mocked(UserPreferenceRepository)
const workspaces = vi.mocked(WorkspaceRepository)
const aiUsage = vi.mocked(AiUsageService)

const ACCESS = {
  modules: ['SERVICE_DESK' as const],
  isPrivileged: true,
  permissions: null,
  agentModeEnabled: true,
  aiEnabled: true,
  agentsEnabled: true,
  autopilotEnabled: false,
}

const readExecute = vi.fn()
const writePreview = vi.fn()

const readTool: AnySteelAiTool = {
  name: 'sd_list_tickets',
  label: 'Consultando chamados',
  module: 'SERVICE_DESK',
  kind: 'READ',
  description: 'Lista chamados',
  parameters: { type: 'object', properties: {} },
  parse: (args) =>
    args.bad ? err(validationError('Argumentos inválidos')) : ok(args),
  execute: readExecute,
}

const writeTool: AnySteelAiTool = {
  name: 'sd_create_ticket',
  label: 'Criando chamado',
  module: 'SERVICE_DESK',
  kind: 'CREATE',
  description: 'Cria chamado',
  parameters: { type: 'object', properties: {} },
  parse: (args) => ok(args),
  preview: writePreview,
  execute: vi.fn(),
}

interface Round {
  deltas?: string[]
  response?: Partial<AiChatResponse>
  throws?: Error
}

function response(overrides: Partial<AiChatResponse> = {}): AiChatResponse {
  const toolCalls = overrides.toolCalls ?? []
  const text = overrides.text ?? ''
  return {
    text,
    toolCalls,
    message: {
      role: 'assistant',
      content: text,
      ...(toolCalls.length > 0 && { toolCalls }),
      raw: { provider: 'openai', content: [] },
    },
    usage: { inputTokens: 10, outputTokens: 5 },
    stopReason: toolCalls.length > 0 ? 'tool_use' : 'end',
    ...overrides,
  }
}

function fakeProvider(rounds: Round[], title: Partial<AiChatResponse> = {}) {
  const requests: AiChatRequest[] = []
  const chatStream = vi.fn((request: AiChatRequest) => {
    requests.push(structuredClone(request))
    const round = rounds.shift() ?? { response: { text: 'fim' } }
    return (async function* (): AsyncGenerator<AiStreamChunk> {
      if (round.throws) throw round.throws
      for (const delta of round.deltas ?? []) yield { type: 'text', delta }
      if (round.response) {
        yield { type: 'done', response: response(round.response) }
      }
    })()
  })
  const chat = vi.fn(async () => response({ text: 'Título', ...title }))
  const provider = { id: 'openai', chat, chatStream } as unknown as AiProvider
  return { provider, chatStream, chat, requests }
}

function prepared(provider: AiProvider): PreparedAiCall {
  return {
    feature: 'STEEL_ASSISTANT',
    provider,
    model: {
      key: 'openai:gpt-4o-mini',
      provider: 'openai',
      model: 'gpt-4o-mini',
      label: 'GPT-4o mini',
    },
    usdPer1kTokens: 4,
  }
}

const conversation = createFakeAiConversation({
  id: 'conv1',
  workspaceId: 'ws1',
  userId: 'u1',
  title: null,
})

function setup(
  options: {
    rounds?: Round[]
    title?: Partial<AiChatResponse>
    history?: ReturnType<typeof createFakeAiMessage>[]
    conversationOverrides?: Partial<typeof conversation>
  } = {},
) {
  const fake = fakeProvider(options.rounds ?? [], options.title)
  mockedAccess.mockResolvedValue(ok(ACCESS))
  conversations.findById.mockResolvedValue(
    ok({ ...conversation, ...options.conversationOverrides }),
  )
  conversations.update.mockImplementation(async (id, data) =>
    ok({ ...conversation, id, ...data } as typeof conversation),
  )
  conversations.setTitleIfEmpty.mockResolvedValue(ok(true))
  aiUsage.prepare.mockResolvedValue(ok(prepared(fake.provider)))
  aiUsage.record.mockResolvedValue(undefined)
  users.findById.mockResolvedValue(ok(createFakeUser({ name: 'Ana' })))
  workspaces.findById.mockResolvedValue(
    ok(createFakeWorkspace({ name: 'Acme' })),
  )
  preferences.findByUserId.mockResolvedValue(
    ok(createFakeUserPreference({ timezone: 'America/Manaus' })),
  )
  messages.listRecent.mockResolvedValue(ok(options.history ?? []))
  messages.createMany.mockImplementation(async (rows) =>
    ok(rows.map((row) => createFakeAiMessage({ ...(row as object) }) as never)),
  )
  pendingRepo.create.mockImplementation(async (data) =>
    ok(
      createFakeAiPendingAction({
        id: 'act1',
        ...data,
        args: data.args as never,
        preview: data.preview as never,
      }),
    ),
  )
  pendingRepo.complete.mockImplementation(async (id, data) =>
    ok(
      createFakeAiPendingAction({
        id,
        conversationId: 'conv1',
        toolCallId: 'c1',
        status: data.status,
        result: (data.result ?? null) as never,
        error: data.error ?? null,
        autoExecuted: true,
        preview: { title: 'Criar chamado “Impressora”', summary: 'x' },
      }),
    ),
  )
  actionLogs.create.mockResolvedValue(ok({} as never))
  attachmentService.loadForSend.mockResolvedValue(ok([]))
  attachmentService.historyNotes.mockResolvedValue(new Map())
  attachmentRepo.attachToMessage.mockResolvedValue(ok(1))
  return fake
}

async function send(input: {
  content: string
  mode?: 'EXPLORE' | 'AGENT' | 'AUTOPILOT' | 'TEST'
  modelKey?: string
  attachmentIds?: string[]
}) {
  const result = await SteelAiChatService.sendMessage(
    'u1',
    'ws1',
    'conv1',
    input,
  )
  const iterable = expectOk(result)
  const events: SteelAiStreamEvent[] = []
  for await (const event of iterable) events.push(event)
  return events
}

const types = (events: SteelAiStreamEvent[]) => events.map((e) => e.type)
const textOf = (events: SteelAiStreamEvent[]) =>
  events
    .filter((e) => e.type === 'text.delta')
    .map((e) => (e as { delta: string }).delta)
    .join('')
const endOf = (events: SteelAiStreamEvent[]) => {
  const end = events.find((e) => e.type === 'message.end')
  if (end?.type !== 'message.end') throw new Error('no message.end')
  return end
}

const call = (id: string, name: string, args = {}): AiToolCall => ({
  id,
  name,
  arguments: args,
})

beforeEach(() => {
  tools.list = [readTool, writeTool]
  readExecute.mockResolvedValue(
    ok({ data: { total: 3 }, summary: '3 chamados' }),
  )
  writePreview.mockResolvedValue(
    ok({ title: 'Criar chamado “Impressora”', summary: 'Novo incidente' }),
  )
})

describe('SteelAiChatService.sendMessage() — before the stream', () => {
  it('should propagate a membership failure', async () => {
    setup()
    mockedAccess.mockResolvedValue(err(forbidden()))
    expectErr(
      await SteelAiChatService.sendMessage('u1', 'ws1', 'conv1', {
        content: 'Oi',
      }),
      'FORBIDDEN',
    )
  })

  it('should answer 404 for a conversation of someone else', async () => {
    setup()
    conversations.findById.mockResolvedValue(err(aiConversationNotFound()))
    expectErr(
      await SteelAiChatService.sendMessage('u1', 'ws1', 'conv1', {
        content: 'Oi',
      }),
      'AI_CONVERSATION_NOT_FOUND',
    )
  })

  it('should refuse the agent mode when the workspace switched it off', async () => {
    setup()
    mockedAccess.mockResolvedValue(ok({ ...ACCESS, agentModeEnabled: false }))
    expectErr(
      await SteelAiChatService.sendMessage('u1', 'ws1', 'conv1', {
        content: 'Oi',
        mode: 'AGENT',
      }),
      'AI_AGENT_MODE_DISABLED',
    )
    expect(aiUsage.prepare).not.toHaveBeenCalled()
  })

  it('should refuse when the quota is exhausted, before saving anything', async () => {
    setup()
    aiUsage.prepare.mockResolvedValue(err(aiQuotaExceeded(50, 50)))
    expectErr(
      await SteelAiChatService.sendMessage('u1', 'ws1', 'conv1', {
        content: 'Oi',
      }),
      'AI_QUOTA_EXCEEDED',
    )
    expect(messages.createMany).not.toHaveBeenCalled()
  })

  it.each([
    ['user', () => users.findById.mockResolvedValue(err(notFound('User')))],
    [
      'workspace',
      () => workspaces.findById.mockResolvedValue(err(notFound('Workspace'))),
    ],
    [
      'history',
      () => messages.listRecent.mockResolvedValue(err(databaseError())),
    ],
    [
      'mode switch',
      () => conversations.update.mockResolvedValue(err(databaseError())),
    ],
    [
      'user message',
      () => messages.createMany.mockResolvedValue(err(databaseError())),
    ],
  ])('should propagate a %s failure', async (_name, breakIt) => {
    setup()
    breakIt()
    const result = await SteelAiChatService.sendMessage('u1', 'ws1', 'conv1', {
      content: 'Oi',
      mode: 'AGENT',
    })
    expect(result.ok).toBe(false)
  })
})

describe('SteelAiChatService.sendMessage() — the turn', () => {
  it('should stream a text answer, persist it and auto-title the first exchange', async () => {
    const fake = setup({
      rounds: [{ deltas: ['Olá', ', Ana!'], response: { text: 'Olá, Ana!' } }],
    })

    const events = await send({ content: 'Oi, tudo bem?' })

    expect(types(events)).toEqual([
      'message.start',
      'text.delta',
      'text.delta',
      'conversation.title',
      'message.end',
    ])
    const start = events[0] as { messageId: string; conversationId: string }
    expect(start.conversationId).toBe('conv1')
    expect(textOf(events)).toBe('Olá, Ana!')

    const request = fake.requests[0]
    expect(request.system).toContain('Usuário: Ana')
    expect(request.system).toContain('Workspace: Acme')
    expect(request.system).toContain('America/Manaus')
    expect(request.system).toContain('EXPLORAR')
    expect(request.messages).toEqual([
      { role: 'user', content: 'Oi, tudo bem?' },
    ])
    // A greeting mentions no module: only the meta-tool is offered (the
    // write tool is not even allowed in EXPLORE).
    expect(request.tools?.map((t) => t.name)).toEqual(['steel_find_tools'])
    expect(request.toolChoice).toBe('auto')

    // User row before the stream; the assistant row carries the message id.
    expect(messages.createMany.mock.calls[0][0]).toEqual([
      { conversationId: 'conv1', role: 'USER', content: 'Oi, tudo bem?' },
    ])
    const assistantRow = messages.createMany.mock.calls[1][0][0]
    expect(assistantRow).toEqual(
      expect.objectContaining({
        id: start.messageId,
        role: 'ASSISTANT',
        content: 'Olá, Ana!',
        modelKey: 'openai:gpt-4o-mini',
      }),
    )

    expect(conversations.setTitleIfEmpty).toHaveBeenCalledWith(
      'conv1',
      'Título',
    )
    const end = endOf(events)
    expect(end.message).toEqual(
      expect.objectContaining({
        id: start.messageId,
        role: 'ASSISTANT',
        content: 'Olá, Ana!',
        toolCalls: [],
        pendingActions: [],
      }),
    )
    // Turn (10/5) + title (10/5).
    expect(end.usage).toEqual({ inputTokens: 20, outputTokens: 10 })
    expect(aiUsage.record).toHaveBeenCalledWith(expect.anything(), {
      workspaceId: 'ws1',
      userId: 'u1',
      usage: { inputTokens: 20, outputTokens: 10 },
      scope: { module: null, conversationId: 'conv1' },
    })
    expect(conversations.update).toHaveBeenCalledWith('conv1', {
      modelKey: 'openai:gpt-4o-mini',
    })
  })

  it('should run a read tool, feed the result back and separate round texts', async () => {
    const fake = setup({
      rounds: [
        {
          deltas: ['Vou consultar.'],
          response: {
            text: 'Vou consultar.',
            toolCalls: [call('c1', 'sd_list_tickets', { limit: 5 })],
          },
        },
        { deltas: ['São 3.'], response: { text: 'São 3.' } },
      ],
      history: [createFakeAiMessage({ role: 'USER', content: 'antes' })],
    })

    const events = await send({ content: 'Quantos chamados?' })

    expect(types(events)).toEqual([
      'message.start',
      'text.delta',
      'tool.start',
      'tool.end',
      'text.delta',
      'text.delta',
      'message.end',
    ])
    expect(textOf(events)).toBe('Vou consultar.\n\nSão 3.')
    expect(readExecute).toHaveBeenCalledWith(
      {
        workspaceId: 'ws1',
        actorId: 'u1',
        source: 'assistant',
        conversationId: 'conv1',
      },
      { limit: 5 },
    )
    const toolEnd = events[3] as Extract<
      SteelAiStreamEvent,
      { type: 'tool.end' }
    >
    expect(toolEnd.call).toEqual({
      id: 'c1',
      name: 'sd_list_tickets',
      label: 'Consultando chamados',
      module: 'SERVICE_DESK',
      status: 'done',
      summary: '3 chamados',
    })

    // Round 1 rows: ASSISTANT with the call + TOOL with the JSON result.
    const roundRows = messages.createMany.mock.calls[1][0]
    expect(roundRows.map((r) => r.role)).toEqual(['ASSISTANT', 'TOOL'])
    expect(JSON.parse(roundRows[1].content)).toEqual({
      status: 'done',
      summary: '3 chamados',
      data: { total: 3 },
    })
    // Round 2 sees the tool result.
    expect(fake.requests[1].messages.at(-1)).toEqual(
      expect.objectContaining({ role: 'tool', toolCallId: 'c1' }),
    )
    // History had a previous USER row: not the first exchange.
    expect(types(events)).not.toContain('conversation.title')
    expect(endOf(events).message.content).toBe('Vou consultar.\n\nSão 3.')
  })

  it('should attach the steel_search sources to the tool call as citations', async () => {
    const searchExecute = vi.fn()
    searchExecute.mockResolvedValueOnce(
      ok({
        data: {
          mode: 'text',
          results: [
            {
              ref: 1,
              sourceType: 'wiki-page',
              source: 'Página da Wiki',
              title: 'Política de férias',
              snippet: '30 dias',
              href: '/demo/wiki/p1',
            },
          ],
        },
        summary: '1 fonte(s) para "férias"',
      }),
    )
    searchExecute.mockResolvedValueOnce(
      ok({ data: { mode: 'text', results: [] }, summary: 'Nada' }),
    )
    tools.list = [
      {
        ...readTool,
        name: 'steel_search',
        module: null,
        execute: searchExecute,
      },
    ]
    setup({
      rounds: [
        {
          response: {
            toolCalls: [
              call('c1', 'steel_search', { query: 'férias' }),
              call('c2', 'steel_search', { query: 'licença' }),
              call('c3', 'sd_list_tickets'),
            ],
          },
        },
        { response: { text: '30 dias [Política de férias](/demo/wiki/p1).' } },
      ],
      conversationOverrides: { title: 'x' },
    })
    tools.list.push(readTool)

    const events = await send({ content: 'Quantos dias de férias?' })
    const ends = events.filter(
      (e): e is Extract<SteelAiStreamEvent, { type: 'tool.end' }> =>
        e.type === 'tool.end',
    )
    expect(ends[0].call.citations).toEqual([
      {
        sourceType: 'wiki-page',
        label: 'Página da Wiki',
        title: 'Política de férias',
        href: '/demo/wiki/p1',
      },
    ])
    expect(ends[1].call.citations).toBeUndefined()
    expect(ends[2].call.citations).toBeUndefined()
  })

  it('should report read tool errors and unavailable tools to the model', async () => {
    readExecute.mockResolvedValue(err(forbidden()))
    setup({
      rounds: [
        {
          response: {
            toolCalls: [
              call('c1', 'sd_list_tickets'),
              call('c2', 'sd_create_ticket'),
              call('c3', 'sd_list_tickets', { bad: true }),
            ],
          },
        },
        { response: { text: 'Não consegui.' } },
      ],
      conversationOverrides: { title: 'Já tem' },
    })

    const events = await send({ content: 'Abra um chamado' })

    const ends = events.filter(
      (e): e is Extract<SteelAiStreamEvent, { type: 'tool.end' }> =>
        e.type === 'tool.end',
    )
    expect(ends.map((e) => e.call.status)).toEqual(['error', 'error', 'error'])
    expect(ends[1].call.summary).toBe(
      'Ferramenta indisponível neste modo ou para o seu perfil',
    )
    expect(writePreview).not.toHaveBeenCalled()
    expect(conversations.setTitleIfEmpty).not.toHaveBeenCalled()
  })

  it('should turn a write into a pending action and end after the short reply', async () => {
    const fake = setup({
      rounds: [
        {
          response: {
            toolCalls: [
              call('c1', 'sd_create_ticket', { title: 'Impressora' }),
            ],
          },
        },
        {
          deltas: ['Propus o chamado.'],
          response: { text: 'Propus o chamado.' },
        },
      ],
      conversationOverrides: { mode: 'AGENT', title: 'x' },
    })

    const events = await send({ content: 'Abra um chamado' })

    expect(types(events)).toEqual([
      'message.start',
      'tool.start',
      'action.pending',
      'tool.end',
      'text.delta',
      'message.end',
    ])
    expect(fake.requests[0].system).toContain('Modo atual: BUILD')
    expect(fake.requests[0].tools?.map((t) => t.name)).toEqual([
      'sd_list_tickets',
      'sd_create_ticket',
    ])
    expect(pendingRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws1',
        requestedById: 'u1',
        conversationId: 'conv1',
        toolCallId: 'c1',
        toolName: 'sd_create_ticket',
        kind: 'CREATE',
        requiresDoubleConfirm: false,
      }),
    )
    const toolEnd = events[3] as Extract<
      SteelAiStreamEvent,
      { type: 'tool.end' }
    >
    expect(toolEnd.call.status).toBe('pending_confirmation')
    expect(toolEnd.call.summary).toBe('Criar chamado “Impressora”')
    // The reply round is forced to text.
    expect(fake.requests[1].toolChoice).toBe('none')
    expect(fake.chatStream).toHaveBeenCalledTimes(2)
    const toolRow = messages.createMany.mock.calls[1][0][1]
    expect(JSON.parse(toolRow.content)).toEqual(
      expect.objectContaining({
        status: 'pending_confirmation',
        actionId: 'act1',
      }),
    )
    expect(endOf(events).message.pendingActions).toHaveLength(1)
    expect(endOf(events).message.toolCalls[0].status).toBe(
      'pending_confirmation',
    )
  })

  it('should switch the conversation mode when the message asks for it', async () => {
    setup({ rounds: [{ response: { text: 'ok' } }] })
    await send({ content: 'Oi', mode: 'AGENT' })
    expect(conversations.update).toHaveBeenCalledWith('conv1', {
      mode: 'AGENT',
    })
  })

  it('should surface a failed preview as a tool error', async () => {
    writePreview.mockResolvedValue(err(forbidden('Sem permissão')))
    setup({
      rounds: [
        { response: { toolCalls: [call('c1', 'sd_create_ticket')] } },
        { response: { text: 'Não deu.' } },
      ],
      conversationOverrides: { mode: 'AGENT', title: 'x' },
    })

    const events = await send({ content: 'Abra' })
    const end = events.find((e) => e.type === 'tool.end') as Extract<
      SteelAiStreamEvent,
      { type: 'tool.end' }
    >
    expect(end.call).toEqual(
      expect.objectContaining({ status: 'error', summary: 'Sem permissão' }),
    )
    expect(types(events)).not.toContain('action.pending')
  })

  it('should answer a refusal with the standard reply', async () => {
    setup({
      rounds: [{ response: { text: '', stopReason: 'refusal' } }],
      conversationOverrides: { title: 'x' },
    })
    const events = await send({ content: '???' })
    expect(textOf(events)).toBe(
      'Não posso ajudar com esse pedido. Tente reformular a pergunta.',
    )
  })

  it('should separate a refusal from earlier text', async () => {
    setup({
      rounds: [
        {
          deltas: ['Vou ver.'],
          response: {
            text: 'Vou ver.',
            toolCalls: [call('c1', 'sd_list_tickets')],
          },
        },
        { response: { text: '', stopReason: 'refusal' } },
      ],
      conversationOverrides: { title: 'x' },
    })
    const events = await send({ content: '???' })
    expect(textOf(events)).toBe(
      'Vou ver.\n\nNão posso ajudar com esse pedido. Tente reformular a pergunta.',
    )
  })

  it('should fall back to a default reply when the model says nothing', async () => {
    setup({
      rounds: [{ response: { text: '' } }],
      conversationOverrides: { title: 'x' },
    })
    const events = await send({ content: 'Oi' })
    expect(textOf(events)).toBe('Não consegui gerar uma resposta agora.')
    const lastRows = messages.createMany.mock.calls.at(-1)?.[0]
    expect(lastRows?.[0]).toEqual(
      expect.objectContaining({
        role: 'ASSISTANT',
        content: 'Não consegui gerar uma resposta agora.',
      }),
    )
  })

  it('should stop at the round limit forcing a text answer', async () => {
    const rounds: Round[] = Array.from(
      { length: STEEL_AI_MAX_TOOL_ROUNDS },
      (_, i) => ({
        response: { toolCalls: [call(`c${i}`, 'sd_list_tickets')] },
      }),
    )
    const fake = setup({ rounds, conversationOverrides: { title: 'x' } })

    const events = await send({ content: 'Loop' })

    expect(fake.chatStream).toHaveBeenCalledTimes(STEEL_AI_MAX_TOOL_ROUNDS)
    expect(fake.requests.at(-1)?.toolChoice).toBe('none')
    expect(readExecute).toHaveBeenCalledTimes(STEEL_AI_MAX_TOOL_ROUNDS - 1)
    const lastEnd = events
      .filter((e) => e.type === 'tool.end')
      .at(-1) as Extract<SteelAiStreamEvent, { type: 'tool.end' }>
    expect(lastEnd.call).toEqual(
      expect.objectContaining({ status: 'error', summary: 'Não executada' }),
    )
  })

  it('should not send tools when none is available', async () => {
    tools.list = []
    const fake = setup({
      rounds: [{ response: { text: 'ok' } }],
      conversationOverrides: { title: 'x' },
    })
    await send({ content: 'Oi' })
    expect(fake.requests[0].tools).toBeUndefined()
    expect(fake.requests[0].toolChoice).toBeUndefined()
  })

  it('should use the default timezone when the user has no preference', async () => {
    const fake = setup({
      rounds: [{ response: { text: 'ok' } }],
      conversationOverrides: { title: 'x' },
    })
    preferences.findByUserId.mockResolvedValue(err(notFound('UserPreference')))
    await send({ content: 'Oi' })
    expect(fake.requests[0].system).toContain('America/Sao_Paulo')
  })

  it('should emit an error event and record usage when the provider fails', async () => {
    setup({
      rounds: [
        { response: { toolCalls: [call('c1', 'sd_list_tickets')] } },
        { throws: new Error('boom') },
      ],
    })

    const events = await send({ content: 'Oi' })

    expect(events.at(-1)).toEqual({
      type: 'error',
      code: 'AI_PROVIDER_UNAVAILABLE',
      message:
        'Não foi possível falar com o provedor de IA agora. Tente novamente em instantes.',
    })
    expect(aiUsage.record).toHaveBeenCalledWith(expect.anything(), {
      workspaceId: 'ws1',
      userId: 'u1',
      usage: { inputTokens: 10, outputTokens: 5 },
      // The read tool ran before the failure: billed to its module.
      scope: { module: 'SERVICE_DESK', conversationId: 'conv1' },
    })
    expect(types(events)).not.toContain('message.end')
  })

  it('should emit an error event when the stream ends without a response', async () => {
    setup({ rounds: [{ deltas: ['meio'] }] })
    const events = await send({ content: 'Oi' })
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: 'error',
        code: 'AI_PROVIDER_UNAVAILABLE',
      }),
    )
  })

  it('should emit a DATABASE_ERROR event when a round cannot be saved', async () => {
    setup({ rounds: [{ response: { text: 'ok' } }] })
    messages.createMany
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(err(databaseError()))
    const events = await send({ content: 'Oi' })
    expect(events.at(-1)).toEqual(
      expect.objectContaining({ type: 'error', code: 'DATABASE_ERROR' }),
    )
  })

  it('should fall back to the user message as title when titling fails', async () => {
    const fake = setup({ rounds: [{ response: { text: 'ok' } }] })
    fake.chat.mockRejectedValue(new Error('down'))
    const long = `Preciso de um relatório ${'muito '.repeat(20)}detalhado`
    const events = await send({ content: long })
    const title = events.find((e) => e.type === 'conversation.title') as {
      title: string
    }
    expect(title.title.length).toBeLessThanOrEqual(60)
    expect(title.title.endsWith('…')).toBe(true)
  })

  it('should fall back when the model returns an empty title', async () => {
    setup({ rounds: [{ response: { text: 'ok' } }], title: { text: '""' } })
    const events = await send({ content: 'Oi' })
    expect(events).toContainEqual({ type: 'conversation.title', title: 'Oi' })
  })

  it('should clean quotes from the generated title', async () => {
    setup({
      rounds: [{ response: { text: 'ok' } }],
      title: { text: '"Chamados abertos."' },
    })
    const events = await send({ content: 'Oi' })
    expect(events).toContainEqual({
      type: 'conversation.title',
      title: 'Chamados abertos',
    })
  })

  it('should not announce a title someone else already set', async () => {
    setup({ rounds: [{ response: { text: 'ok' } }] })
    conversations.setTitleIfEmpty.mockResolvedValue(ok(false))
    const events = await send({ content: 'Oi' })
    expect(types(events)).not.toContain('conversation.title')
  })

  it('should still finish the turn when touching the conversation fails', async () => {
    setup({
      rounds: [{ response: { text: 'ok' } }],
      conversationOverrides: { title: 'x' },
    })
    conversations.update.mockResolvedValue(err(databaseError()))
    const events = await send({ content: 'Oi' })
    expect(types(events).at(-1)).toBe('message.end')
  })
})

describe('SteelAiChatService.capabilities()', () => {
  function setupCapabilities() {
    mockedAccess.mockResolvedValue(
      ok({ ...ACCESS, modules: ['COMMUNICATION', 'SERVICE_DESK'] }),
    )
    aiUsage.resolveModel.mockResolvedValue(
      ok({
        settings: {
          enabledModels: ['openai:gpt-4o-mini'],
          crmAssistantModel: 'openai:gpt-4o-mini',
          whatsappReplyModel: 'openai:gpt-4o-mini',
          whatsappSentimentModel: 'openai:gpt-4o-mini',
          monthlyQuotaUsd: 50,
          usdPer1kTokens: 4,
          agentModeEnabled: true,
          aiEnabled: true,
          agentsEnabled: true,
          memoryEnabled: true,
          autopilotEnabled: false,
          usageWeeklyEmailEnabled: true,
          mcpWriteEnabled: false,
          agentModel: null,
          failoverEnabled: true,
        },
        model: {
          key: 'openai:gpt-4o-mini',
          provider: 'openai',
          model: 'gpt-4o-mini',
          label: 'GPT-4o mini',
        },
      }),
    )
    usageRepo.sumSince.mockResolvedValue(
      ok({ inputTokens: 1, outputTokens: 1, costUsd: 12.345 }),
    )
  }

  it('should return agent mode, ordered modules, model and quota', async () => {
    setupCapabilities()
    expect(
      expectOk(await SteelAiChatService.capabilities('u1', 'ws1')),
    ).toEqual({
      aiEnabled: true,
      agentModeEnabled: true,
      autopilotEnabled: false,
      modules: ['SERVICE_DESK', 'COMMUNICATION'],
      modelKey: 'openai:gpt-4o-mini',
      models: [
        {
          key: 'openai:gpt-4o-mini',
          provider: 'openai',
          providerLabel: 'OpenAI',
          label: 'GPT-4o mini',
          // Provider price × platform margin (2).
          inputUsdPer1M: 0.3,
          outputUsdPer1M: 1.2,
        },
      ],
      attachments: expect.objectContaining({ maxPerMessage: 5 }),
      quota: { usedUsd: 12.35, quotaUsd: 50 },
    })
    expect(aiUsage.resolveModel).toHaveBeenCalledWith(
      'ws1',
      'STEEL_ASSISTANT',
      'u1',
    )
  })

  it('should return a null model when none is usable', async () => {
    setupCapabilities()
    const resolved = await aiUsage.resolveModel('ws1', 'STEEL_ASSISTANT')
    if (!resolved.ok) throw new Error('setup')
    aiUsage.resolveModel.mockResolvedValue(
      ok({ ...resolved.value, model: null }),
    )
    expect(
      expectOk(await SteelAiChatService.capabilities('u1', 'ws1')).modelKey,
    ).toBeNull()
  })

  it.each([
    ['access', () => mockedAccess.mockResolvedValue(err(forbidden()))],
    [
      'model',
      () => aiUsage.resolveModel.mockResolvedValue(err(databaseError())),
    ],
    ['usage', () => usageRepo.sumSince.mockResolvedValue(err(databaseError()))],
  ])('should propagate a %s failure', async (_name, breakIt) => {
    setupCapabilities()
    breakIt()
    expect((await SteelAiChatService.capabilities('u1', 'ws1')).ok).toBe(false)
  })
})

describe('SteelAiChatService.sendMessage() — tool selection', () => {
  const crmTool: AnySteelAiTool = {
    ...readTool,
    name: 'crm_list_leads',
    label: 'Consultando leads',
    module: 'CRM',
    description: 'Lista leads do CRM',
    execute: vi.fn(async () => ok({ data: { total: 1 }, summary: '1 lead' })),
  }
  const multiModule = {
    ...ACCESS,
    modules: ['SERVICE_DESK' as const, 'CRM' as const],
  }

  beforeEach(() => {
    tools.list = [readTool, writeTool, crmTool]
  })

  it('should show only the tools of the module the message is about', async () => {
    const fake = setup({ rounds: [{ response: { text: 'Há 3.' } }] })
    mockedAccess.mockResolvedValue(ok(multiModule))

    await send({ content: 'Quantos chamados abertos eu tenho?' })

    expect(fake.requests[0].tools?.map((t) => t.name)).toEqual([
      'sd_list_tickets',
      'steel_find_tools',
    ])
  })

  it('should offer write tools of the module in agent mode', async () => {
    const fake = setup({ rounds: [{ response: { text: 'Ok.' } }] })
    mockedAccess.mockResolvedValue(ok(multiModule))

    await send({ content: 'Crie um chamado para a impressora', mode: 'AGENT' })

    expect(fake.requests[0].tools?.map((t) => t.name)).toEqual([
      'sd_list_tickets',
      'sd_create_ticket',
      'steel_find_tools',
    ])
  })

  it('should activate the tools steel_find_tools returns on the next round', async () => {
    const fake = setup({
      rounds: [
        {
          response: {
            toolCalls: [call('c1', 'steel_find_tools', { module: 'CRM' })],
          },
        },
        { response: { toolCalls: [call('c2', 'crm_list_leads')] } },
        { response: { text: 'Você tem 1 lead.' } },
      ],
    })
    mockedAccess.mockResolvedValue(ok(multiModule))

    const events = await send({ content: 'Oi! O que tenho para hoje?' })

    expect(fake.requests[0].tools?.map((t) => t.name)).toEqual([
      'steel_find_tools',
    ])
    expect(fake.requests[1].tools?.map((t) => t.name)).toEqual([
      'crm_list_leads',
      'steel_find_tools',
    ])
    const ends = events.filter((e) => e.type === 'tool.end') as {
      call: { name: string; status: string; summary?: string; label: string }
    }[]
    expect(ends[0].call).toEqual(
      expect.objectContaining({
        name: 'steel_find_tools',
        status: 'done',
        summary: '1 ferramenta(s) encontrada(s)',
        label: 'Procurando ferramentas',
      }),
    )
    expect(ends[1].call.status).toBe('done')
    const toolRow = messages.createMany.mock.calls[1][0][1] as {
      toolName: string
      content: string
    }
    expect(toolRow.toolName).toBe('steel_find_tools')
    expect(JSON.parse(toolRow.content).data.tools[0].name).toBe(
      'crm_list_leads',
    )
  })

  it('should keep offering the tools used earlier in the conversation', async () => {
    const fake = setup({
      rounds: [{ response: { text: 'Ontem foram 2.' } }],
      history: [
        createFakeAiMessage({ role: 'USER', content: 'Liste os leads' }),
        createFakeAiMessage({
          role: 'ASSISTANT',
          content: '',
          toolCalls: [{ id: 'c0', name: 'crm_list_leads', arguments: {} }],
        }),
        createFakeAiMessage({
          role: 'TOOL',
          toolCallId: 'c0',
          toolName: 'crm_list_leads',
          content: '{"status":"done"}',
        }),
      ],
    })
    mockedAccess.mockResolvedValue(ok(multiModule))

    await send({ content: 'E os de ontem?' })

    expect(fake.requests[0].tools?.map((t) => t.name)).toEqual([
      'crm_list_leads',
      'steel_find_tools',
    ])
  })
})

describe('dominantModule()', () => {
  it('should be null without domain tools', () => {
    expect(dominantModule([])).toBeNull()
    expect(dominantModule([null, null])).toBeNull()
  })

  it('should pick the module with most calls, ties to the first used', () => {
    expect(dominantModule(['CRM', 'SERVICE_DESK', 'SERVICE_DESK'])).toBe(
      'SERVICE_DESK',
    )
    expect(dominantModule(['CRM', null, 'SERVICE_DESK'])).toBe('CRM')
  })
})

describe('SteelAiChatService.sendMessage() — Steel AI 2', () => {
  const AUTOPILOT_ACCESS = { ...ACCESS, autopilotEnabled: true }

  it('should refuse everything when the AI master switch is off', async () => {
    setup()
    mockedAccess.mockResolvedValue(ok({ ...ACCESS, aiEnabled: false }))
    expectErr(
      await SteelAiChatService.sendMessage('u1', 'ws1', 'conv1', {
        content: 'Oi',
      }),
      'AI_DISABLED',
    )
    expect(conversations.findById).not.toHaveBeenCalled()
  })

  it('should refuse AUTOPILOT when the workspace did not enable it', async () => {
    setup()
    expectErr(
      await SteelAiChatService.sendMessage('u1', 'ws1', 'conv1', {
        content: 'Oi',
        mode: 'AUTOPILOT',
      }),
      'AI_AUTOPILOT_DISABLED',
    )
    mockedAccess.mockResolvedValue(
      ok({ ...AUTOPILOT_ACCESS, agentModeEnabled: false }),
    )
    expectErr(
      await SteelAiChatService.sendMessage('u1', 'ws1', 'conv1', {
        content: 'Oi',
        mode: 'AUTOPILOT',
      }),
      'AI_AGENT_MODE_DISABLED',
    )
    expect(aiUsage.prepare).not.toHaveBeenCalled()
  })

  it('should execute writes at once in AUTOPILOT and keep the loop going', async () => {
    const fake = setup({
      rounds: [
        {
          response: {
            toolCalls: [
              call('c1', 'sd_create_ticket', { title: 'Impressora' }),
            ],
          },
        },
        { deltas: ['Chamado criado.'], response: { text: 'Chamado criado.' } },
      ],
      conversationOverrides: { mode: 'AUTOPILOT', title: 'x' },
    })
    mockedAccess.mockResolvedValue(ok(AUTOPILOT_ACCESS))
    vi.mocked(writeTool.execute).mockResolvedValue(
      ok({
        data: { id: 't1' },
        summary: 'Chamado #12 criado',
        target: { type: 'sd_ticket', id: 't1' },
      }),
    )

    const events = await send({ content: 'Abra um chamado' })

    expect(types(events)).toEqual([
      'message.start',
      'tool.start',
      'action.executed',
      'tool.end',
      'text.delta',
      'message.end',
    ])
    expect(fake.requests[0].system).toContain('Modo atual: AUTOPILOT')
    // Not forced to text: the model may chain further steps.
    expect(fake.requests[1].toolChoice).toBe('auto')
    expect(pendingRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'EXECUTED',
        decidedById: 'u1',
        autoExecuted: true,
      }),
    )
    expect(writeTool.execute).toHaveBeenCalled()
    expect(actionLogs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'ASSISTANT',
        actorId: 'u1',
        outcome: 'success',
        summary: 'Chamado #12 criado',
      }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'ai_pending_action',
        action: 'auto_execute',
        actorId: 'u1',
      }),
    )
    const toolEnd = events[3] as Extract<
      SteelAiStreamEvent,
      { type: 'tool.end' }
    >
    expect(toolEnd.call.status).toBe('done')
    expect(toolEnd.call.summary).toBe('Chamado #12 criado')
    const toolRow = messages.createMany.mock.calls[1][0][1]
    expect(JSON.parse(toolRow.content)).toEqual(
      expect.objectContaining({ status: 'executed', actionId: 'act1' }),
    )
    // No decision note: the TOOL row already carries the result.
    expect(
      messages.createMany.mock.calls.some((c) =>
        c[0].some((row) => row.toolCallId?.startsWith('action:')),
      ),
    ).toBe(false)
    const end = endOf(events)
    expect(end.message.pendingActions).toEqual([
      expect.objectContaining({ status: 'EXECUTED', autoExecuted: true }),
    ])
    expect(aiUsage.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        scope: { module: 'SERVICE_DESK', conversationId: 'conv1' },
      }),
    )
  })

  it('should run deletes in AUTOPILOT too, without a double confirmation', async () => {
    const deleteExecute = vi.fn(async () =>
      ok({ data: null, summary: 'Chamado excluído' }),
    )
    const deleteTool: AnySteelAiTool = {
      ...writeTool,
      name: 'sd_delete_ticket',
      kind: 'DELETE',
      execute: deleteExecute,
    }
    tools.list = [readTool, deleteTool]
    setup({
      rounds: [
        { response: { toolCalls: [call('c1', 'sd_delete_ticket', {})] } },
        { response: { text: 'Excluído.' } },
      ],
      conversationOverrides: { title: 'x' },
    })
    mockedAccess.mockResolvedValue(ok(AUTOPILOT_ACCESS))

    const events = await send({
      content: 'Exclua o chamado',
      mode: 'AUTOPILOT',
    })

    expect(deleteExecute).toHaveBeenCalled()
    expect(pendingRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'DELETE', autoExecuted: true }),
    )
    expect(types(events)).toContain('action.executed')
    expect(conversations.update).toHaveBeenCalledWith('conv1', {
      mode: 'AUTOPILOT',
    })
  })

  it('should report a failed autopilot execution as a tool error', async () => {
    setup({
      rounds: [
        { response: { toolCalls: [call('c1', 'sd_create_ticket', {})] } },
        { response: { text: 'Falhou.' } },
      ],
      conversationOverrides: { mode: 'AUTOPILOT', title: 'x' },
    })
    mockedAccess.mockResolvedValue(ok(AUTOPILOT_ACCESS))
    vi.mocked(writeTool.execute).mockResolvedValue(
      err(forbidden('Sem permissão')),
    )

    const events = await send({ content: 'Abra' })
    const toolEnd = events.find((e) => e.type === 'tool.end') as Extract<
      SteelAiStreamEvent,
      { type: 'tool.end' }
    >
    expect(toolEnd.call.status).toBe('error')
    expect(toolEnd.call.summary).toBe('Sem permissão')
    expect(endOf(events).message.pendingActions[0].status).toBe('FAILED')
  })

  it('should surface an autopilot preview failure without creating anything', async () => {
    setup({
      rounds: [
        { response: { toolCalls: [call('c1', 'sd_create_ticket', {})] } },
        { response: { text: 'Não deu.' } },
      ],
      conversationOverrides: { mode: 'AUTOPILOT', title: 'x' },
    })
    mockedAccess.mockResolvedValue(ok(AUTOPILOT_ACCESS))
    writePreview.mockResolvedValue(err(forbidden('Sem permissão')))

    const events = await send({ content: 'Abra' })
    expect(pendingRepo.create).not.toHaveBeenCalled()
    expect(types(events)).not.toContain('action.executed')
    const toolEnd = events.find((e) => e.type === 'tool.end') as Extract<
      SteelAiStreamEvent,
      { type: 'tool.end' }
    >
    expect(toolEnd.call.status).toBe('error')
  })

  it('should use and keep the model picked for the conversation', async () => {
    setup({
      rounds: [{ response: { text: 'ok' } }],
      conversationOverrides: { title: 'x', modelKey: 'openai:gpt-5' },
    })
    await send({ content: 'Oi', modelKey: 'anthropic:claude-sonnet-5' })
    expect(aiUsage.prepare).toHaveBeenCalledWith(
      'ws1',
      'STEEL_ASSISTANT',
      'u1',
      ['anthropic:claude-sonnet-5', 'openai:gpt-5'],
    )
    expect(conversations.update).toHaveBeenCalledWith('conv1', {
      modelKey: 'anthropic:claude-sonnet-5',
    })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'ai_conversation',
        meta: expect.objectContaining({ fields: ['modelKey'] }),
      }),
    )
    // The prepared call fell back to gpt-4o-mini; the pick is kept.
    expect(conversations.update).toHaveBeenLastCalledWith('conv1', {
      modelKey: 'anthropic:claude-sonnet-5',
    })
  })

  it('should ignore a model key outside the catalog and keep the stored pick', async () => {
    setup({
      rounds: [{ response: { text: 'ok' } }],
      conversationOverrides: { title: 'x', modelKey: 'openai:gpt-5' },
    })
    await send({ content: 'Oi', modelKey: 'acme:nope' })
    expect(conversations.update).toHaveBeenCalledTimes(1)
    expect(conversations.update).toHaveBeenCalledWith('conv1', {
      modelKey: 'openai:gpt-5',
    })
  })

  it('should send images as vision parts and documents as text', async () => {
    const fake = setup({
      rounds: [{ response: { text: 'Vi a foto.' } }],
      conversationOverrides: { title: 'x' },
    })
    attachmentService.loadForSend.mockResolvedValue(
      ok([
        {
          id: 'a1',
          kind: 'IMAGE',
          filename: 'foto.png',
          contentType: 'image/png',
          extractedText: null,
          data: Buffer.from('png'),
        },
        {
          id: 'a2',
          kind: 'DOCUMENT',
          filename: 'notas.txt',
          contentType: 'text/plain',
          extractedText: 'Prazo: sexta',
        },
      ]),
    )

    await send({ content: '', attachmentIds: ['a1', 'a2'] })

    expect(attachmentService.loadForSend).toHaveBeenCalledWith('u1', 'conv1', [
      'a1',
      'a2',
    ])
    expect(attachmentRepo.attachToMessage).toHaveBeenCalledWith(
      ['a1', 'a2'],
      expect.any(String),
    )
    const last = fake.requests[0].messages.at(-1)
    expect(last?.role).toBe('user')
    const parts = last?.content as {
      type: string
      text?: string
      url?: string
    }[]
    expect(parts[0].text).toContain('notas.txt')
    expect(parts[0].text).toContain('Prazo: sexta')
    expect(parts[1]).toEqual({
      type: 'image',
      url: `data:image/png;base64,${Buffer.from('png').toString('base64')}`,
    })
  })

  it('should refuse unknown attachments before saving the message', async () => {
    setup()
    attachmentService.loadForSend.mockResolvedValue(
      err(aiConversationNotFound()),
    )
    expectErr(
      await SteelAiChatService.sendMessage('u1', 'ws1', 'conv1', {
        content: 'Oi',
        attachmentIds: ['x'],
      }),
      'AI_CONVERSATION_NOT_FOUND',
    )
    expect(messages.createMany).not.toHaveBeenCalled()
  })

  it('should fail the send when binding attachments fails', async () => {
    setup()
    attachmentService.loadForSend.mockResolvedValue(
      ok([
        {
          id: 'a2',
          kind: 'DOCUMENT',
          filename: 'n.txt',
          contentType: 'text/plain',
          extractedText: 'x',
        },
      ]),
    )
    attachmentRepo.attachToMessage.mockResolvedValue(err(databaseError()))
    expectErr(
      await SteelAiChatService.sendMessage('u1', 'ws1', 'conv1', {
        content: 'Oi',
        attachmentIds: ['a2'],
      }),
      'DATABASE_ERROR',
    )
  })

  it('should call the skills and memory extension points every turn', async () => {
    const fake = setup({
      rounds: [{ response: { text: 'ok' } }],
      conversationOverrides: { title: 'x' },
    })
    vi.mocked(resolveSkillInvocation).mockResolvedValueOnce({
      skill: {
        id: 's1',
        slug: 'my-work',
        name: 'Meu trabalho',
        instructions: 'Liste meus chamados abertos.',
      },
      content: '',
    })
    vi.mocked(skillsCatalogForPrompt).mockResolvedValueOnce('Skills: /my-work')
    vi.mocked(memoryForPrompt).mockResolvedValueOnce('Memória: prefere tabelas')

    await send({ content: '/my-work' })

    const system = fake.requests[0].system ?? ''
    expect(system).toContain('Skill invocada pelo usuário: /my-work')
    expect(system).toContain('Liste meus chamados abertos.')
    expect(system).toContain('Skills: /my-work')
    expect(system).toContain('Memória: prefere tabelas')
    expect(fake.requests[0].messages.at(-1)).toEqual({
      role: 'user',
      content: 'Execute a skill /my-work.',
    })
    // The transcript keeps what the user typed.
    expect(messages.createMany.mock.calls[0][0][0].content).toBe('/my-work')
  })
})

describe('SteelAiChatService.capabilities() — switches', () => {
  it('should report the AI off with no models and autopilot only with agent mode', async () => {
    mockedAccess.mockResolvedValue(
      ok({ ...ACCESS, aiEnabled: false, autopilotEnabled: true }),
    )
    aiUsage.resolveModel.mockResolvedValue(
      ok({
        settings: {
          enabledModels: ['openai:gpt-4o-mini'],
          crmAssistantModel: 'openai:gpt-4o-mini',
          whatsappReplyModel: 'openai:gpt-4o-mini',
          whatsappSentimentModel: 'openai:gpt-4o-mini',
          monthlyQuotaUsd: 50,
          agentModeEnabled: true,
          aiEnabled: true,
          agentsEnabled: true,
          memoryEnabled: true,
          autopilotEnabled: false,
          usageWeeklyEmailEnabled: true,
          mcpWriteEnabled: false,
          agentModel: null,
          failoverEnabled: true,
        },
        model: null,
      }),
    )
    usageRepo.sumSince.mockResolvedValue(
      ok({ inputTokens: 0, outputTokens: 0, costUsd: 0 }),
    )
    const caps = expectOk(await SteelAiChatService.capabilities('u1', 'ws1'))
    expect(caps).toEqual(
      expect.objectContaining({
        aiEnabled: false,
        autopilotEnabled: true,
        models: [],
        modelKey: null,
      }),
    )

    mockedAccess.mockResolvedValue(
      ok({ ...ACCESS, agentModeEnabled: false, autopilotEnabled: true }),
    )
    expect(
      expectOk(await SteelAiChatService.capabilities('u1', 'ws1'))
        .autopilotEnabled,
    ).toBe(false)
  })
})

describe('SteelAiChatService.sendMessage() — memory tools', () => {
  const memoryService = vi.mocked(AiMemoryService)

  it('offers memory tools only when memory is enabled', async () => {
    const off = setup({ rounds: [{ response: { text: 'Oi' } }] })
    await send({ content: 'olá' })
    const offNames = (off.requests[0].tools ?? []).map((t) => t.name)
    expect(offNames).not.toContain('memory_save')

    const on = setup({ rounds: [{ response: { text: 'Oi' } }] })
    mockedAccess.mockResolvedValue(ok({ ...ACCESS, memoryEnabled: true }))
    await send({ content: 'olá' })
    const onNames = (on.requests[0].tools ?? []).map((t) => t.name)
    expect(onNames).toEqual(
      expect.arrayContaining(['memory_save', 'memory_forget']),
    )
  })

  it('saves a memory in Ask mode without confirmation and shows the chip', async () => {
    const fake = setup({
      rounds: [
        {
          response: {
            toolCalls: [
              call('m1', 'memory_save', { content: 'Ana prefere tabelas' }),
            ],
          },
        },
        { response: { text: 'Anotado.' } },
      ],
    })
    mockedAccess.mockResolvedValue(ok({ ...ACCESS, memoryEnabled: true }))
    const memory = createFakeAiMemory({
      id: 'mem1',
      scope: 'PERSONAL',
      content: 'Ana prefere tabelas',
    })
    memoryService.saveFromModel.mockResolvedValue(
      ok({ memory, action: 'saved', downgraded: false }),
    )

    const events = await send({ content: 'prefiro tabelas', mode: 'EXPLORE' })

    expect(memoryService.saveFromModel).toHaveBeenCalledWith(
      {
        workspaceId: 'ws1',
        actorId: 'u1',
        source: 'assistant',
        conversationId: 'conv1',
      },
      { content: 'Ana prefere tabelas', scope: 'PERSONAL' },
    )
    const end = events.find((e) => e.type === 'tool.end') as Extract<
      SteelAiStreamEvent,
      { type: 'tool.end' }
    >
    expect(end.call).toEqual(
      expect.objectContaining({
        name: 'memory_save',
        label: 'Salvando na memória',
        status: 'done',
        summary: 'Memória salva',
        memory: {
          id: 'mem1',
          scope: 'PERSONAL',
          content: 'Ana prefere tabelas',
          action: 'saved',
        },
      }),
    )
    expect(pendingRepo.create).not.toHaveBeenCalled()
    expect(endOf(events).message.toolCalls[0].memory?.id).toBe('mem1')
    // The result goes back to the model on the next round.
    expect(fake.requests[1].messages.at(-1)).toEqual(
      expect.objectContaining({ role: 'tool', name: 'memory_save' }),
    )
  })

  it('reports a refused memory as an error without a chip', async () => {
    setup({
      rounds: [
        {
          response: {
            toolCalls: [call('m1', 'memory_save', { content: 'senha 123' })],
          },
        },
        { response: { text: 'Não posso guardar isso.' } },
      ],
    })
    mockedAccess.mockResolvedValue(ok({ ...ACCESS, memoryEnabled: true }))
    memoryService.saveFromModel.mockResolvedValue(
      err(validationError('Não guardo senhas')),
    )

    const events = await send({ content: 'guarde minha senha' })
    const end = events.find((e) => e.type === 'tool.end') as Extract<
      SteelAiStreamEvent,
      { type: 'tool.end' }
    >
    expect(end.call.status).toBe('error')
    expect(end.call.summary).toBe('Não guardo senhas')
    expect(end.call.memory).toBeUndefined()
  })

  it('refuses a memory tool when memory is disabled', async () => {
    setup({
      rounds: [
        {
          response: {
            toolCalls: [call('m1', 'memory_save', { content: 'x' })],
          },
        },
        { response: { text: 'ok' } },
      ],
    })
    const events = await send({ content: 'lembre disso' })
    const end = events.find((e) => e.type === 'tool.end') as Extract<
      SteelAiStreamEvent,
      { type: 'tool.end' }
    >
    expect(end.call.status).toBe('error')
    expect(memoryService.saveFromModel).not.toHaveBeenCalled()
  })
})

describe('SteelAiChatService.sendMessage() — TEST (Teste) mode', () => {
  it('should never call execute on a write, nor propose or send anything', async () => {
    const fake = setup({
      rounds: [
        {
          response: {
            toolCalls: [
              call('r1', 'sd_list_tickets', {}),
              call('c1', 'sd_create_ticket', { title: 'Impressora' }),
            ],
          },
        },
        {
          deltas: ['Eu criaria o chamado.'],
          response: { text: 'Eu criaria o chamado.' },
        },
      ],
      conversationOverrides: { title: 'x' },
    })
    // Agent mode off: TEST does not depend on it.
    mockedAccess.mockResolvedValue(ok({ ...ACCESS, agentModeEnabled: false }))
    writePreview.mockResolvedValue(
      ok({ title: 'Criar chamado “Impressora”', summary: 'Novo incidente' }),
    )

    const events = await send({ content: 'Abra um chamado', mode: 'TEST' })

    expect(writeTool.execute).not.toHaveBeenCalled()
    expect(readExecute).toHaveBeenCalled()
    expect(pendingRepo.create).not.toHaveBeenCalled()
    expect(types(events)).not.toContain('action.pending')
    expect(types(events)).not.toContain('action.executed')
    expect(fake.requests[0].system).toContain('Modo atual: TESTE')
    // Not stopped after the write: the model continues its plan.
    expect(fake.requests[1].toolChoice).toBe('auto')
    expect(conversations.update).toHaveBeenCalledWith('conv1', {
      mode: 'TEST',
    })

    const ends = events.filter(
      (e): e is Extract<SteelAiStreamEvent, { type: 'tool.end' }> =>
        e.type === 'tool.end',
    )
    expect(ends[1].call).toEqual(
      expect.objectContaining({
        status: 'simulated',
        summary: 'Criar chamado “Impressora”',
        simulation: {
          kind: 'CREATE',
          preview: {
            title: 'Criar chamado “Impressora”',
            summary: 'Novo incidente',
          },
        },
      }),
    )
    const toolRow = messages.createMany.mock.calls[1][0][2]
    expect(JSON.parse(toolRow.content)).toEqual(
      expect.objectContaining({ status: 'simulated' }),
    )
    expect(actionLogs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'ASSISTANT',
        actorId: 'u1',
        outcome: 'simulated',
        toolName: 'sd_create_ticket',
      }),
    )
    // Real model usage is still billed.
    expect(aiUsage.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        scope: expect.objectContaining({ module: 'SERVICE_DESK' }),
      }),
    )
    expect(endOf(events).message.pendingActions).toEqual([])
  })

  it('should simulate memory tools instead of saving', async () => {
    setup({
      rounds: [
        {
          response: {
            toolCalls: [
              call('m1', 'memory_save', { content: 'Ana prefere tabelas' }),
            ],
          },
        },
        { response: { text: 'Salvaria isso na memória.' } },
      ],
      conversationOverrides: { mode: 'TEST', title: 'x' },
    })
    mockedAccess.mockResolvedValue(ok({ ...ACCESS, memoryEnabled: true }))

    const events = await send({ content: 'Lembre que prefiro tabelas' })

    expect(vi.mocked(AiMemoryService).saveFromModel).not.toHaveBeenCalled()
    const end = events.find(
      (e): e is Extract<SteelAiStreamEvent, { type: 'tool.end' }> =>
        e.type === 'tool.end',
    )
    expect(end?.call.status).toBe('simulated')
    expect(end?.call.memory).toBeUndefined()
    expect(end?.call.simulation?.preview.title).toBe('Salvar na memória')
  })

  it('should report a write whose preview fails as an error, still without executing', async () => {
    setup({
      rounds: [
        { response: { toolCalls: [call('c1', 'sd_create_ticket', {})] } },
        { response: { text: 'Não daria certo.' } },
      ],
      conversationOverrides: { mode: 'TEST', title: 'x' },
    })
    writePreview.mockResolvedValue(err(validationError('Título obrigatório')))

    const events = await send({ content: 'Abra um chamado' })

    expect(writeTool.execute).not.toHaveBeenCalled()
    const end = events.find(
      (e): e is Extract<SteelAiStreamEvent, { type: 'tool.end' }> =>
        e.type === 'tool.end',
    )
    expect(end?.call.status).toBe('error')
    expect(end?.call.summary).toBe('Título obrigatório')
    expect(actionLogs.create).not.toHaveBeenCalled()
  })
})

describe('SteelAiChatService.sendMessage() — prompt injection (ADR 0041)', () => {
  it('should ask for confirmation in AUTOPILOT once third-party content tried to instruct the model', async () => {
    const fake = setup({
      rounds: [
        {
          response: {
            toolCalls: [
              call('c1', 'sd_create_ticket', { title: 'Impressora' }),
            ],
          },
        },
        { deltas: ['Confirme, por favor.'], response: { text: 'Confirme.' } },
      ],
      conversationOverrides: { mode: 'AUTOPILOT', title: 'x' },
    })
    mockedAccess.mockResolvedValue(ok({ ...ACCESS, autopilotEnabled: true }))
    aiUsage.prepare.mockResolvedValue(
      ok({
        ...prepared(fake.provider),
        guard: {
          report: {
            piiCounts: { EMAIL: 0, CNPJ: 0, CPF: 0, CARD: 0, PHONE: 0 },
            injection: {
              detected: true,
              signals: ['ignore_instructions'],
              sources: ['tool_result'],
            },
            failovers: [],
          },
          tainted: () => true,
        },
      }),
    )

    const events = await send({ content: 'Abra um chamado' })

    expect(types(events)).toContain('action.pending')
    expect(types(events)).not.toContain('action.executed')
    expect(writeTool.execute).not.toHaveBeenCalled()
  })
})
