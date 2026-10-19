import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspacePermissionsProvider } from '@/app/_components/workspace/workspace-permissions'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { WorkspaceAiSettingsDTO } from '@/types/ai-settings'
import { AiSettingsSection } from '../ai-settings-section'

vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const URL = '/api/workspaces/ws_1/ai-settings'

function settings(
  overrides?: Partial<WorkspaceAiSettingsDTO>,
): WorkspaceAiSettingsDTO {
  return {
    workspaceId: 'ws_1',
    providers: [
      { id: 'openai', label: 'OpenAI', available: true },
      { id: 'anthropic', label: 'Anthropic (Claude)', available: false },
    ],
    models: [
      {
        key: 'openai:gpt-4o-mini',
        provider: 'openai',
        model: 'gpt-4o-mini',
        label: 'GPT-4o mini',
        available: true,
        enabled: true,
        inputUsdPer1M: 0.15,
        outputUsdPer1M: 0.6,
      },
      {
        key: 'anthropic:claude-sonnet-5',
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        label: 'Claude Sonnet 5',
        available: false,
        enabled: false,
        inputUsdPer1M: 2,
        outputUsdPer1M: 10,
      },
    ],
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
    proactiveEnabled: true,
    usage: {
      periodStart: '2026-09-01T00:00:00.000Z',
      inputTokens: 1500,
      outputTokens: 500,
      usedUsd: 8,
      remainingUsd: 42,
      exceeded: false,
    },
    userPreference: null,
    canManage: true,
    ...overrides,
  }
}

function renderAs(isPrivileged: boolean) {
  return renderWithQuery(
    <WorkspacePermissionsProvider value={{ isPrivileged, permissions: {} }}>
      <AiSettingsSection workspaceId='ws_1' />
    </WorkspacePermissionsProvider>,
  )
}

describe('<AiSettingsSection />', () => {
  it('shows consumption vs. quota', async () => {
    mockFetch([{ match: URL, data: settings() }])
    renderAs(true)

    expect(await screen.findByText('Consumo do mês')).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(
      '16',
    )
    expect(screen.getByText(/Restante:/).textContent).toContain('42')
  })

  it('hides admin-only controls from a regular member', async () => {
    mockFetch([{ match: URL, data: settings({ canManage: false }) }])
    renderAs(false)

    expect(await screen.findByText('Meu modelo')).toBeTruthy()
    expect(screen.queryByText('Provedores e modelos habilitados')).toBeNull()
    expect(screen.queryByLabelText('Cota (US$)')).toBeNull()
    expect(screen.getByText(/Apenas o dono e os administradores/)).toBeTruthy()
  })

  it('marks a provider without a platform key as unavailable', async () => {
    mockFetch([{ match: URL, data: settings() }])
    renderAs(true)

    expect(await screen.findByText('Indisponível')).toBeTruthy()
    const sonnet = screen.getByRole('checkbox', { name: /Claude Sonnet 5/ })
    expect(sonnet.getAttribute('aria-disabled')).toBe('true')
  })

  it('lets an admin save a new quota', async () => {
    const fetchSpy = mockFetch([
      {
        method: 'PATCH',
        match: URL,
        data: settings({ monthlyQuotaUsd: 120 }),
      },
      { match: URL, data: settings() },
    ])
    renderAs(true)

    const quota = (await screen.findByLabelText(
      'Cota (US$)',
    )) as HTMLInputElement
    fireEvent.change(quota, { target: { value: '120' } })
    fireEvent.click(
      screen.getByRole('button', { name: 'Salvar ajustes de IA' }),
    )

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Ajustes de IA salvos'),
    )
    expect(fetchBody(fetchSpy, URL, 'PATCH')).toEqual({
      enabledModels: ['openai:gpt-4o-mini'],
      crmAssistantModel: 'openai:gpt-4o-mini',
      whatsappReplyModel: 'openai:gpt-4o-mini',
      whatsappSentimentModel: 'openai:gpt-4o-mini',
      monthlyQuotaUsd: 120,
      agentModeEnabled: true,
      aiEnabled: true,
      agentsEnabled: true,
      memoryEnabled: true,
      autopilotEnabled: false,
      usageWeeklyEmailEnabled: true,
      mcpWriteEnabled: false,
      agentModel: null,
      failoverEnabled: true,
      proactiveEnabled: true,
    })
  })

  it('lets an admin turn the provider failover off (ADR 0042)', async () => {
    const fetchSpy = mockFetch([
      {
        method: 'PATCH',
        match: URL,
        data: settings({ failoverEnabled: false }),
      },
      { match: URL, data: settings() },
    ])
    renderAs(true)

    expect(await screen.findByText('Modelo por tipo de tarefa')).toBeTruthy()
    expect(screen.getByText('Steel Agents')).toBeTruthy()
    const toggle = screen.getByRole('switch', {
      name: 'Contingência automática entre provedores',
    })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle)
    fireEvent.click(
      screen.getByRole('button', { name: 'Salvar ajustes de IA' }),
    )
    await waitFor(() =>
      expect(fetchBody(fetchSpy, URL, 'PATCH')).toMatchObject({
        failoverEnabled: false,
        agentModel: null,
      }),
    )
  })

  it('refuses an agent model that is no longer enabled', async () => {
    mockFetch([
      {
        match: URL,
        data: settings({ agentModel: 'anthropic:claude-sonnet-5' }),
      },
    ])
    renderAs(true)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Salvar ajustes de IA' }),
    )
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
  })

  it('lets an admin turn the weekly usage e-mail off', async () => {
    const fetchSpy = mockFetch([
      {
        method: 'PATCH',
        match: URL,
        data: settings({ usageWeeklyEmailEnabled: false }),
      },
      { match: URL, data: settings() },
    ])
    renderAs(true)

    const toggle = await screen.findByRole('switch', {
      name: 'Resumo semanal de consumo por e-mail',
    })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText(/Toda segunda-feira, às 08:00/)).toBeTruthy()
    fireEvent.click(toggle)
    fireEvent.click(
      screen.getByRole('button', { name: 'Salvar ajustes de IA' }),
    )

    await waitFor(() =>
      expect(fetchBody(fetchSpy, URL, 'PATCH')).toMatchObject({
        usageWeeklyEmailEnabled: false,
      }),
    )
  })

  it('shows the weekly e-mail switch off and locked while Steel AI is off', async () => {
    mockFetch([
      {
        match: URL,
        data: settings({ aiEnabled: false, usageWeeklyEmailEnabled: false }),
      },
    ])
    renderAs(true)

    const toggle = await screen.findByRole('switch', {
      name: 'Resumo semanal de consumo por e-mail',
    })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(toggle.hasAttribute('data-disabled')).toBe(true)
  })

  it('lets an admin allow Autopilot and turn memory off, with the autopilot warning', async () => {
    const fetchSpy = mockFetch([
      {
        method: 'PATCH',
        match: URL,
        data: settings({ autopilotEnabled: true, memoryEnabled: false }),
      },
      { match: URL, data: settings() },
    ])
    renderAs(true)

    expect(
      await screen.findByText('Autopilot executa sem pedir confirmação'),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: 'Permitir Autopilot' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Ativar memória' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Salvar ajustes de IA' }),
    )

    await waitFor(() =>
      expect(fetchBody(fetchSpy, URL, 'PATCH')).toMatchObject({
        aiEnabled: true,
        agentsEnabled: true,
        memoryEnabled: false,
        autopilotEnabled: true,
      }),
    )
  })

  it('lets an admin allow writes over MCP, explaining how they are guarded', async () => {
    const fetchSpy = mockFetch([
      {
        method: 'PATCH',
        match: URL,
        data: settings({ mcpWriteEnabled: true }),
      },
      { match: URL, data: settings() },
    ])
    renderAs(true)

    const toggle = await screen.findByRole('switch', {
      name: 'Permitir escrita via MCP',
    })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText(/Apps de IA conectados por MCP/)).toBeTruthy()
    expect(screen.queryByText('Como a escrita via MCP é controlada')).toBeNull()

    fireEvent.click(toggle)
    expect(screen.getByText('Como a escrita via MCP é controlada')).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: 'Salvar ajustes de IA' }),
    )

    await waitFor(() =>
      expect(fetchBody(fetchSpy, URL, 'PATCH')).toMatchObject({
        mcpWriteEnabled: true,
      }),
    )
  })

  it('locks the MCP write switch while Steel AI is off', async () => {
    mockFetch([{ match: URL, data: settings({ aiEnabled: false }) }])
    renderAs(true)

    const toggle = await screen.findByRole('switch', {
      name: 'Permitir escrita via MCP',
    })
    expect(toggle.hasAttribute('data-disabled')).toBe(true)
  })

  it('disables the Steel AI feature switches while Steel AI is off', async () => {
    mockFetch([{ match: URL, data: settings({ aiEnabled: false }) }])
    renderAs(true)

    const master = await screen.findByRole('switch', {
      name: 'Ativar Steel AI',
    })
    expect(master.getAttribute('aria-checked')).toBe('false')
    expect(
      screen
        .getByRole('switch', { name: 'Ativar agentes' })
        .hasAttribute('data-disabled'),
    ).toBe(true)
  })

  it('lets an admin turn the Steel AI agent mode off', async () => {
    const fetchSpy = mockFetch([
      {
        method: 'PATCH',
        match: URL,
        data: settings({ agentModeEnabled: false }),
      },
      { match: URL, data: settings() },
    ])
    renderAs(true)

    const toggle = await screen.findByRole('switch', {
      name: 'Permitir o modo agente neste workspace',
    })
    fireEvent.click(toggle)
    fireEvent.click(
      screen.getByRole('button', { name: 'Salvar ajustes de IA' }),
    )

    await waitFor(() =>
      expect(fetchBody(fetchSpy, URL, 'PATCH')).toMatchObject({
        agentModeEnabled: false,
      }),
    )
    expect(screen.getByText('Assistente')).toBeTruthy()
  })

  it('warns when the quota is exhausted', async () => {
    mockFetch([
      {
        match: URL,
        data: settings({
          usage: {
            periodStart: '2026-09-01T00:00:00.000Z',
            inputTokens: 10000,
            outputTokens: 2500,
            usedUsd: 50,
            remainingUsd: 0,
            exceeded: true,
          },
        }),
      },
    ])
    renderAs(true)

    expect(await screen.findByText(/A cota mensal foi atingida/)).toBeTruthy()
  })
})
