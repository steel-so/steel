import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mockFetch, renderWithQuery } from '@/src/__tests__/component-utils'
import type {
  SteelAgentSimulationCaseDTO,
  SteelAgentSimulationDetailDTO,
  SteelAgentSimulationDTO,
} from '@/types/steel-agent-simulation'
import {
  type ScenarioForm,
  scenariosProblem,
} from '../steel-agent-simulation-builder'
import {
  describeScoreboard,
  parseCriteriaLines,
} from '../steel-agent-simulation-labels'
import { SteelAgentSimulationView } from '../steel-agent-simulation-view'
import { SteelAgentSimulations } from '../steel-agent-simulations'

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/app/_components/steel-ai/steel-ai-top-bar', () => ({
  SteelAiTopBar: ({
    title,
    actions,
  }: {
    title?: string
    actions?: React.ReactNode
  }) => (
    <div>
      {title}
      {actions}
    </div>
  ),
}))

const WS = 'ws_1'

function simulation(
  over: Partial<SteelAgentSimulationDTO> = {},
): SteelAgentSimulationDTO {
  return {
    id: 'sim_1',
    agentId: 'agent_1',
    name: 'Antes de ativar',
    status: 'COMPLETED',
    startedById: 'u1',
    passScore: 70,
    totalCases: 2,
    passedCases: 1,
    failedCases: 1,
    avgScore: 78,
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 0.0123,
    modelKey: 'openai:gpt-4o-mini',
    error: null,
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-11-06T12:00:00.000Z',
    ...over,
  }
}

function caseDto(
  over: Partial<SteelAgentSimulationCaseDTO> = {},
): SteelAgentSimulationCaseDTO {
  return {
    id: 'case_1',
    position: 0,
    label: 'Cliente irritado',
    personaKey: 'irritated_customer',
    persona: 'Sem paciência',
    scenario: 'Internet fora',
    channel: 'WHATSAPP',
    openingMessage: 'Cadê?',
    criteria: ['Reconhece o problema'],
    maxTurns: 3,
    status: 'DONE',
    verdict: 'PASS',
    score: 90,
    transcript: [
      { role: 'customer', text: 'Cadê minha internet?' },
      { role: 'agent', text: 'Vou verificar agora.' },
    ],
    toolEvents: [
      {
        turn: 1,
        toolName: 'sd_update_ticket',
        kind: 'UPDATE',
        status: 'SIMULATED',
        title: 'Atualizar chamado',
        error: null,
      },
    ],
    criteriaResults: [
      {
        criterion: 'Reconhece o problema',
        met: true,
        evidence: 'Disse "verificar"',
      },
      { criterion: 'Informa o prazo', met: false, evidence: '' },
    ],
    judgeSummary: 'Boa conversa.',
    endReason: 'O cliente encerrou',
    error: null,
    costUsd: 0.01,
    startedAt: null,
    finishedAt: null,
    ...over,
  }
}

describe('simulation labels', () => {
  it('should describe the scoreboard by status', () => {
    const base = { passedCases: 1, totalCases: 3 }
    expect(describeScoreboard({ ...base, status: 'QUEUED' })).toBe(
      'Aguardando a fila',
    )
    expect(describeScoreboard({ ...base, status: 'SKIPPED' })).toBe(
      'Não executada',
    )
    expect(describeScoreboard({ ...base, status: 'RUNNING' })).toBe(
      '1 de 3 passaram até agora',
    )
    expect(describeScoreboard({ ...base, status: 'COMPLETED' })).toBe(
      '1 de 3 passaram',
    )
  })

  it('should split criteria lines and drop bullets', () => {
    expect(parseCriteriaLines('- Um\n\n• Dois\n  * Três  \n')).toEqual([
      'Um',
      'Dois',
      'Três',
    ])
  })
})

describe('scenariosProblem', () => {
  const ok: ScenarioForm = {
    uid: 1,
    label: 'A',
    personaKey: null,
    persona: 'p',
    scenario: 's',
    channel: 'CHAT',
    openingMessage: 'o',
    criteria: 'c',
    maxTurns: 4,
  }

  it('should accept complete scenarios', () => {
    expect(scenariosProblem([ok])).toBeNull()
  })

  it('should explain what is missing', () => {
    expect(scenariosProblem([])).toContain('ao menos um cenário')
    expect(scenariosProblem([{ ...ok, persona: ' ' }])).toContain('“A”')
    expect(scenariosProblem([{ ...ok, label: '' }])).toContain('Cenário 1')
    expect(scenariosProblem([{ ...ok, criteria: '\n' }])).toContain('critério')
  })
})

describe('<SteelAgentSimulations />', () => {
  it('lists simulations with the scoreboard', async () => {
    mockFetch([{ match: '/simulations?limit=50', data: [simulation()] }])
    renderWithQuery(
      <SteelAgentSimulations
        workspaceId={WS}
        slug='acme'
        agentId='agent_1'
        timezone='America/Sao_Paulo'
        canSimulate
      />,
    )
    expect(await screen.findByText('Antes de ativar')).toBeTruthy()
    expect(screen.getByText(/1 de 2 passaram · nota 78/)).toBeTruthy()
    expect(screen.getByRole('link').getAttribute('href')).toBe(
      '/acme/ai/agents/agent_1/simulations/sim_1',
    )
    expect(screen.getByRole('button', { name: 'Nova simulação' })).toBeTruthy()
  })

  it('shows the empty state and hides the button without permission', async () => {
    mockFetch([{ match: '/simulations?limit=50', data: [] }])
    renderWithQuery(
      <SteelAgentSimulations
        workspaceId={WS}
        slug='acme'
        agentId='agent_1'
        timezone='America/Sao_Paulo'
        canSimulate={false}
      />,
    )
    expect(await screen.findByText('Nenhuma simulação ainda.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Nova simulação' })).toBeNull()
  })

  it('opens the builder with presets', async () => {
    mockFetch([{ match: '/simulations?limit=50', data: [] }])
    renderWithQuery(
      <SteelAgentSimulations
        workspaceId={WS}
        slug='acme'
        agentId='agent_1'
        timezone='America/Sao_Paulo'
        canSimulate
      />,
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Nova simulação' }),
    )
    expect(await screen.findByText('Começar de um modelo')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Cliente irritado/ }))
    expect(await screen.findByText('Cenário 1')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Simular conversas' }),
    ).toBeTruthy()
  })
})

describe('<SteelAgentSimulationView />', () => {
  const detail: SteelAgentSimulationDetailDTO = {
    ...simulation(),
    agentName: 'Atendimento',
    cases: [
      caseDto(),
      caseDto({ id: 'case_2', label: 'Outro', verdict: 'FAIL', score: 40 }),
    ],
  }

  it('shows the scoreboard, the transcript, criteria and tools', async () => {
    mockFetch([
      { match: '/simulations/sim_1', data: detail },
      {
        match: '/agents/agent_1',
        data: { id: 'agent_1', timezone: 'America/Sao_Paulo' },
      },
      {
        match: '/agents/catalog',
        data: { canManage: true, tools: [], events: [] },
      },
    ])
    renderWithQuery(
      <SteelAgentSimulationView
        workspaceId={WS}
        slug='acme'
        agentId='agent_1'
        simulationId='sim_1'
      />,
    )
    expect(await screen.findByText('Antes de ativar')).toBeTruthy()
    expect(screen.getByText('1 de 2 passaram')).toBeTruthy()
    expect(screen.getByText('Cadê minha internet?')).toBeTruthy()
    expect(screen.getByText('Vou verificar agora.')).toBeTruthy()
    expect(screen.getByText('Informa o prazo')).toBeTruthy()
    expect(screen.getByText('sd_update_ticket')).toBeTruthy()
    expect(screen.getByText('Alteração simulada')).toBeTruthy()
    expect(screen.getByText('Boa conversa.')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Repetir simulação' }),
    ).toBeTruthy()
  })

  it('reports a missing simulation', async () => {
    mockFetch([
      {
        match: '/simulations/sim_1',
        status: 404,
        error: 'Simulação não encontrada',
      },
      {
        match: '/agents/agent_1',
        data: { id: 'agent_1', timezone: 'America/Sao_Paulo' },
      },
      {
        match: '/agents/catalog',
        data: { canManage: false, tools: [], events: [] },
      },
    ])
    renderWithQuery(
      <SteelAgentSimulationView
        workspaceId={WS}
        slug='acme'
        agentId='agent_1'
        simulationId='sim_1'
      />,
    )
    expect(await screen.findByText(/Simulação não encontrada/)).toBeTruthy()
  })
})
