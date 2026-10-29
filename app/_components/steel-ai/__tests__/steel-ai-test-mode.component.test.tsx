import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SteelAgentDetail } from '@/app/_components/steel-agents/steel-agent-detail'
import { SteelAgentRunView } from '@/app/_components/steel-agents/steel-agent-run-view'
import { fetchBody, mockFetch } from '@/src/__tests__/component-utils'
import type {
  SteelAgentDTO,
  SteelAgentRunDetailDTO,
  SteelAgentRunDTO,
} from '@/types/steel-agent'
import type { AiMessageDTO, AiToolCallDTO } from '@/types/steel-ai'
import { SteelAiChat } from '../steel-ai-chat'
import { allowedSteelAiMode, SteelAiModeSwitch } from '../steel-ai-mode-switch'
import { simulatedActionsLabel } from '../steel-ai-simulated-action-card'
import {
  capabilities,
  conversation,
  renderSteelAi,
  sseResponse,
  WS,
} from './steel-ai-test-utils'

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/acme/ai/c1',
}))

afterEach(() => {
  window.sessionStorage.clear()
  push.mockClear()
  notify.success.mockClear()
  notify.error.mockClear()
})

const PREVIEW = {
  title: 'Criar o lead “Mariana Souza”',
  summary: 'Novo lead no funil.',
  fields: [{ label: 'Empresa', after: 'Acme Telecom' }],
}

const simulatedCall: AiToolCallDTO = {
  id: 'call_2',
  name: 'crm_create_lead',
  label: 'Criando lead',
  module: 'CRM',
  status: 'simulated',
  summary: PREVIEW.title,
  simulation: { kind: 'CREATE', preview: PREVIEW },
}

const userMessage: AiMessageDTO = {
  id: 'm1',
  conversationId: 'c1',
  role: 'USER',
  content: 'Cadastre a Mariana como lead',
  toolCalls: [],
  pendingActions: [],
  attachments: [],
  createdAt: '2026-10-08T12:00:00.000Z',
}

const testReply: AiMessageDTO = {
  id: 'm2',
  conversationId: 'c1',
  role: 'ASSISTANT',
  content: 'Eu criaria o lead.',
  toolCalls: [
    {
      id: 'call_1',
      name: 'crm_list_leads',
      label: 'Consultando leads',
      module: 'CRM',
      status: 'done',
      summary: 'Nenhum lead encontrado',
    },
    simulatedCall,
  ],
  pendingActions: [],
  attachments: [],
  createdAt: '2026-10-08T12:00:01.000Z',
}

describe('<SteelAiModeSwitch /> — Teste', () => {
  it('keeps Teste available with the agent mode off and explains it', async () => {
    const onChange = vi.fn()
    renderSteelAi(
      <SteelAiModeSwitch
        value='EXPLORE'
        onChange={onChange}
        agentModeEnabled={false}
      />,
    )
    const test = screen.getByRole('button', { name: /^Teste$/ })
    expect((test as HTMLButtonElement).disabled).toBe(false)
    expect(
      (screen.getByRole('button', { name: /^Build$/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    fireEvent.click(test)
    expect(onChange).toHaveBeenCalledWith('TEST')
    fireEvent.focus(test.parentElement as HTMLElement)
    expect(
      await screen.findByText(/Mostra o que faria sem alterar nada/),
    ).toBeTruthy()
  })

  it('never falls back from Teste', () => {
    expect(
      allowedSteelAiMode('TEST', {
        agentModeEnabled: false,
        autopilotEnabled: false,
      }),
    ).toBe('TEST')
    expect(simulatedActionsLabel(1)).toBe('1 ação simulada')
    expect(simulatedActionsLabel(3)).toBe('3 ações simuladas')
  })
})

describe('<SteelAiChat /> — Teste', () => {
  it('shows simulated cards, the summary and re-runs the request in Build', async () => {
    const spy = mockFetch([
      { match: '/ai/capabilities', data: capabilities() },
      {
        match: /\/conversations\/c1\/messages$/,
        data: [userMessage, testReply],
      },
      {
        method: 'POST',
        match: /\/conversations\/c1\/messages$/,
        handler: () =>
          sseResponse([
            { type: 'message.start', conversationId: 'c1', messageId: 'm4' },
            { type: 'text.delta', delta: 'Proposto.' },
          ]),
      },
      {
        match: /\/conversations\/c1$/,
        data: conversation({ mode: 'TEST', title: 'Leads' }),
      },
    ])
    renderSteelAi(<SteelAiChat conversationId='c1' />)

    const card = await screen.findByRole('article', {
      name: `Ação simulada: ${PREVIEW.title}`,
    })
    expect(card.getAttribute('data-status')).toBe('simulated')
    expect(screen.getByText('Simulado')).toBeTruthy()
    expect(screen.getByText(/nada foi alterado · criaria/)).toBeTruthy()
    expect(screen.getByText('Acme Telecom')).toBeTruthy()
    // The read tool keeps its chip; the simulated write becomes the card.
    expect(screen.getByText('Consultando leads')).toBeTruthy()
    expect(screen.queryByText('Criando lead')).toBeNull()
    expect(
      screen.getByText(/Em modo teste: 1 ação simulada, nada foi alterado/),
    ).toBeTruthy()
    expect(screen.getByText(/Modo Teste: o Steel AI consulta/)).toBeTruthy()
    expect(
      screen
        .getByRole('button', { name: /^Teste$/ })
        .getAttribute('aria-pressed'),
    ).toBe('true')

    fireEvent.click(
      screen.getByRole('button', { name: /Executar de verdade em Build/ }),
    )
    await waitFor(() =>
      expect(fetchBody(spy, '/conversations/c1/messages')).toEqual(
        expect.objectContaining({
          content: 'Cadastre a Mariana como lead',
          mode: 'AGENT',
        }),
      ),
    )
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: /^Build$/ })
          .getAttribute('aria-pressed'),
      ).toBe('true'),
    )
  })

  it('explains instead of offering Build when the agent mode is off', async () => {
    mockFetch([
      {
        match: '/ai/capabilities',
        data: capabilities({ agentModeEnabled: false }),
      },
      {
        match: /\/conversations\/c1\/messages$/,
        data: [userMessage, testReply],
      },
      {
        match: /\/conversations\/c1$/,
        data: conversation({ mode: 'TEST', title: 'Leads' }),
      },
    ])
    renderSteelAi(<SteelAiChat conversationId='c1' />)
    expect(await screen.findByText(/O modo Build foi desativado/)).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: /Executar de verdade em Build/ }),
    ).toBeNull()
  })
})

const RUN: SteelAgentRunDTO = {
  id: 'run_1',
  agentId: 'ag_1',
  status: 'SUCCEEDED',
  triggerType: 'MANUAL',
  triggerPayload: null,
  startedById: 'u1',
  startedAt: '2026-10-08T12:00:00.000Z',
  finishedAt: '2026-10-08T12:00:30.000Z',
  summary: 'Eu criaria 1 tarefa.',
  error: null,
  modelKey: 'openai:gpt-4o-mini',
  rounds: 2,
  inputTokens: 100,
  outputTokens: 50,
  costUsd: 0.01,
  isTest: true,
  createdAt: '2026-10-08T12:00:00.000Z',
}

const AGENT: SteelAgentDTO = {
  id: 'ag_1',
  name: 'Follow-up de leads',
  description: null,
  instructions: 'Crie tarefas.',
  triggerType: 'MANUAL',
  cron: null,
  timezone: 'America/Sao_Paulo',
  eventKey: null,
  enabled: false,
  owner: { id: 'u1', name: 'Ana', email: 'ana@x.com', image: null },
  createdById: 'u1',
  maxToolRounds: 8,
  monthlyRunCap: null,
  lastRunAt: null,
  nextRunAt: null,
  tools: [],
  lastRun: null,
  createdAt: '2026-10-08T12:00:00.000Z',
  updatedAt: '2026-10-08T12:00:00.000Z',
}

const AGENTS = `/api/workspaces/${WS}/agents`

describe('Steel Agents — test runs', () => {
  it('lists what a test run would have done', async () => {
    const detail: SteelAgentRunDetailDTO = {
      ...RUN,
      agent: { id: 'ag_1', name: 'Follow-up de leads', ownerId: 'u1' },
      steps: [
        {
          id: 's1',
          kind: 'TOOL',
          toolName: 'crm_create_task',
          toolLabel: 'Criando tarefa',
          pendingActionId: null,
          input: {},
          output: {
            title: 'Criar tarefa “Ligar”',
            simulation: {
              kind: 'CREATE',
              preview: { title: 'Criar tarefa “Ligar”', summary: 'Ligar' },
            },
          },
          status: 'SIMULATED',
          error: null,
          createdAt: '2026-10-08T12:00:10.000Z',
        },
        {
          id: 's2',
          kind: 'TOOL',
          toolName: 'crm_delete_task',
          toolLabel: null,
          pendingActionId: null,
          input: {},
          output: { title: 'x', simulation: { kind: 'DELETE' } },
          status: 'SIMULATED',
          error: null,
          createdAt: '2026-10-08T12:00:11.000Z',
        },
      ],
      pendingActions: [],
      canApprove: true,
    }
    mockFetch([
      { match: `${AGENTS}/ag_1/runs/run_1`, data: detail },
      { match: /\/agents\/ag_1$/, data: AGENT },
    ])
    renderSteelAi(
      <SteelAgentRunView
        workspaceId={WS}
        slug='acme'
        agentId='ag_1'
        runId='run_1'
      />,
    )
    expect(await screen.findByText(/Execução de teste/)).toBeTruthy()
    expect(screen.getByText('Teste')).toBeTruthy()
    expect(screen.getByText('O que o agente faria')).toBeTruthy()
    expect(
      screen.getByRole('article', {
        name: 'Ação simulada: Criar tarefa “Ligar”',
      }),
    ).toBeTruthy()
    // A malformed simulation is not listed (only one card).
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.getAllByText(/^Simulada ·/).length).toBe(2)
  })

  it('says when a test run only read data', async () => {
    mockFetch([
      {
        match: `${AGENTS}/ag_1/runs/run_1`,
        data: {
          ...RUN,
          agent: { id: 'ag_1', name: 'x', ownerId: 'u1' },
          steps: [],
          pendingActions: [],
          canApprove: false,
        },
      },
      { match: /\/agents\/ag_1$/, data: AGENT },
    ])
    renderSteelAi(
      <SteelAgentRunView
        workspaceId={WS}
        slug='acme'
        agentId='ag_1'
        runId='run_1'
      />,
    )
    expect(
      await screen.findByText('Nesta execução o agente só consultou dados.'),
    ).toBeTruthy()
  })

  it('tests a paused agent from its detail and opens the run', async () => {
    const spy = mockFetch([
      {
        match: `${AGENTS}/catalog`,
        data: {
          tools: [],
          events: [],
          agentModeEnabled: true,
          canManage: true,
        },
      },
      { match: `${AGENTS}/ag_1/runs`, data: [RUN] },
      { method: 'POST', match: `${AGENTS}/ag_1/test`, data: RUN },
      { match: /\/agents\/ag_1$/, data: AGENT },
      { match: '/members', data: [] },
    ])
    renderSteelAi(
      <SteelAgentDetail
        workspaceId={WS}
        slug='acme'
        agentId='ag_1'
        currentUserId='u1'
      />,
    )
    const button = await screen.findByRole('button', {
      name: 'Testar agente',
    })
    // "Executar agora" is off for a paused agent; testing is not.
    expect(
      (
        screen.getByRole('button', {
          name: 'Executar agora',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    expect(await screen.findByText('Teste')).toBeTruthy()
    fireEvent.click(button)
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/acme/ai/agents/ag_1/runs/run_1'),
    )
    expect(
      spy.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith('/agents/ag_1/test') &&
          (init as RequestInit | undefined)?.method === 'POST',
      ),
    ).toBe(true)
    expect(notify.success).toHaveBeenCalled()
  })

  it('reports a failed test request', async () => {
    mockFetch([
      {
        match: `${AGENTS}/catalog`,
        data: {
          tools: [],
          events: [],
          agentModeEnabled: true,
          canManage: true,
        },
      },
      { match: `${AGENTS}/ag_1/runs`, data: [] },
      {
        method: 'POST',
        match: `${AGENTS}/ag_1/test`,
        status: 403,
        error: 'Proibido',
      },
      { match: /\/agents\/ag_1$/, data: AGENT },
      { match: '/members', data: [] },
    ])
    renderSteelAi(
      <SteelAgentDetail
        workspaceId={WS}
        slug='acme'
        agentId='ag_1'
        currentUserId='u1'
      />,
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Testar agente' }),
    )
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
    expect(push).not.toHaveBeenCalled()
  })
})
