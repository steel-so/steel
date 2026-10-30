import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mockFetch, renderWithQuery } from '@/src/__tests__/component-utils'
import type {
  SteelAgentVersionDTO,
  SteelAgentVersionListDTO,
} from '@/types/steel-agent'
import { resolveTab } from '../steel-agent-detail'
import { SteelAgentVersions } from '../steel-agent-versions'

vi.mock('@/lib/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const STATS = {
  runs: 0,
  succeeded: 0,
  failed: 0,
  skipped: 0,
  successRate: null,
  avgCostUsd: null,
  avgRounds: null,
  approvalsDecided: 0,
  approvalsApproved: 0,
  approvalRate: null,
}

function version(over: Partial<SteelAgentVersionDTO>): SteelAgentVersionDTO {
  return {
    id: 'v1',
    agentId: 'a1',
    number: 1,
    status: 'PUBLISHED',
    instructions: 'Texto',
    maxToolRounds: 8,
    tools: [],
    changeNote: null,
    rolloutPercent: null,
    evalRunId: null,
    evalPassed: null,
    evalTotal: null,
    evalPassRate: null,
    evalNote: null,
    simulationId: null,
    simPassed: null,
    simTotal: null,
    simPassRate: null,
    createdById: null,
    publishedAt: null,
    resolvedAt: null,
    createdAt: '2026-10-30T12:00:00.000Z',
    stats: STATS,
    ...over,
  }
}

function render(
  versions: SteelAgentVersionDTO[],
  over: Partial<SteelAgentVersionListDTO> = {},
) {
  mockFetch([
    {
      match: '/agents/a1/versions',
      data: {
        versions,
        publishedVersionId: 'v1',
        challengerVersionId: null,
        evalSetId: 'set1',
        evalMinPassRate: 0.8,
        simGateEnabled: true,
        simGateMinPassRate: 0.75,
        canManage: true,
        ...over,
      } satisfies SteelAgentVersionListDTO,
    },
  ])
  return renderWithQuery(
    <SteelAgentVersions workspaceId='ws1' agentId='a1' timezone='UTC' />,
  )
}

describe('<SteelAgentVersions /> simulation gate', () => {
  it('should state the simulation minimum next to the eval one', async () => {
    render([version({})])
    await waitFor(() =>
      expect(
        screen.getByText(/Também precisam passar em ao menos 75%/),
      ).toBeTruthy(),
    )
  })

  it('should not mention simulations when the gate is off', async () => {
    render([version({})], { simGateEnabled: false })
    await waitFor(() =>
      expect(screen.getByText(/Mudanças só são/)).toBeTruthy(),
    )
    expect(screen.queryByText(/cenários de simulação salvos/)).toBeNull()
  })

  it('should show the simulation result and the one in progress', async () => {
    render([
      version({
        id: 'v3',
        number: 3,
        status: 'REJECTED',
        simPassed: 2,
        simTotal: 4,
        simPassRate: 0.5,
        evalNote:
          'Passou em 2 de 4 cenários da simulação (50%); o mínimo é 75%.',
      }),
      version({
        id: 'v2',
        number: 2,
        status: 'PENDING_EVAL',
        evalPassed: 9,
        evalTotal: 10,
        evalPassRate: 0.9,
        simulationId: 'sim1',
      }),
    ])
    await waitFor(() =>
      expect(screen.getByText(/Simulação: 2 de 4 cenários/)).toBeTruthy(),
    )
    expect(screen.getByText(/Rodando os cenários de simulação/)).toBeTruthy()
    expect(screen.getByText(/o mínimo é 75%/)).toBeTruthy()
  })

  it('should keep the eval wait message when no simulation started yet', async () => {
    render([version({ id: 'v2', number: 2, status: 'PENDING_EVAL' })])
    await waitFor(() =>
      expect(
        screen.getByText(/Aguardando o resultado da avaliação/),
      ).toBeTruthy(),
    )
  })
})

describe('resolveTab', () => {
  it('should open a known tab and fall back to the runs', () => {
    expect(resolveTab('versions')).toBe('versions')
    expect(resolveTab('simulations')).toBe('simulations')
    expect(resolveTab('nope')).toBe('runs')
    expect(resolveTab(undefined)).toBe('runs')
  })
})
