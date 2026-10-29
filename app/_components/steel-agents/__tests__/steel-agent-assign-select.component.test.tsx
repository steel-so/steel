import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { SteelAgentAssignSelect } from '../steel-agent-assign-select'

const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))

const AGENTS = [
  { id: 'sa-1', name: 'Qualificação', enabled: true },
  { id: 'sa-2', name: 'Triagem', enabled: true },
  { id: 'sa-3', name: 'Antigo', enabled: false },
]

const LEAD_URL = '/crm/leads/l1/agent'

function routes(agent: unknown = null) {
  return mockFetch([
    { match: /\/workspaces\/ws1\/agents$/, data: AGENTS },
    {
      method: 'GET',
      match: LEAD_URL,
      data: {
        entityType: 'CRM_LEAD',
        entityId: 'l1',
        agent,
        assignedAt: agent ? '2026-10-29T12:00:00.000Z' : null,
      },
    },
    {
      method: 'PUT',
      match: LEAD_URL,
      handler: (_url, init) => {
        const { agentId } = JSON.parse(String(init?.body))
        const found = AGENTS.find((a) => a.id === agentId)
        return {
          entityType: 'CRM_LEAD',
          entityId: 'l1',
          agent: found ?? null,
          assignedAt: found ? '2026-10-29T12:05:00.000Z' : null,
        }
      },
    },
  ])
}

function renderSelect() {
  return renderWithQuery(
    <SteelAgentAssignSelect
      workspaceId='ws1'
      entityType='CRM_LEAD'
      entityRef='l1'
    />,
  )
}

describe('<SteelAgentAssignSelect />', () => {
  it('hands the record to the chosen agent', async () => {
    const spy = routes()
    renderSelect()
    const trigger = await screen.findByRole('combobox', {
      name: 'Agente de IA',
    })
    await waitFor(() => expect(trigger.textContent).toContain('Nenhum'))

    fireEvent.click(trigger)
    // Paused agents are not offered.
    expect(screen.queryByRole('option', { name: /Antigo/ })).toBeNull()
    const option = await screen.findByRole('option', { name: 'Triagem' })
    fireEvent.pointerDown(option)
    fireEvent.click(option)

    await waitFor(() =>
      expect(fetchBody(spy, LEAD_URL, 'PUT')).toEqual({ agentId: 'sa-2' }),
    )
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith(
        'Atribuído a Triagem. O agente já foi acionado.',
      ),
    )
  })

  it('removes the agent with "Nenhum"', async () => {
    const spy = routes({ id: 'sa-1', name: 'Qualificação', enabled: true })
    renderSelect()
    const trigger = await screen.findByRole('combobox', {
      name: 'Agente de IA',
    })
    await waitFor(() => expect(trigger.textContent).toContain('Qualificação'))

    fireEvent.click(trigger)
    const none = await screen.findByRole('option', { name: 'Nenhum' })
    fireEvent.pointerDown(none)
    fireEvent.click(none)

    await waitFor(() =>
      expect(fetchBody(spy, LEAD_URL, 'PUT')).toEqual({ agentId: null }),
    )
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Agente removido.'),
    )
  })

  it('keeps a paused current agent visible by name', async () => {
    routes({ id: 'sa-3', name: 'Antigo', enabled: false })
    renderSelect()
    const trigger = await screen.findByRole('combobox', {
      name: 'Agente de IA',
    })
    await waitFor(() =>
      expect(trigger.textContent).toContain('Antigo (pausado)'),
    )
  })

  it('stays hidden when the workspace has no agents', async () => {
    mockFetch([
      { match: /\/workspaces\/ws1\/agents$/, data: [] },
      {
        match: LEAD_URL,
        data: { entityType: 'CRM_LEAD', entityId: 'l1', agent: null },
      },
    ])
    renderSelect()
    await waitFor(() =>
      expect(
        screen.queryByRole('combobox', { name: 'Agente de IA' }),
      ).toBeNull(),
    )
  })
})
