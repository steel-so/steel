import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { mockFetch, renderWithQuery } from '@/src/__tests__/component-utils'
import type { SdWfmForecastDTO } from '@/types/sd-wfm'
import { SdWfmView } from '../sd-wfm-view'

const settings = {
  historyWeeks: 8,
  ticketsPerAgentHour: 2.5,
  targetOccupancyPercent: 75,
  minAgentsPerShift: 1,
  shifts: [{ name: 'Manhã', startHour: 6, endHour: 14 }],
}

function forecast(overrides: Partial<SdWfmForecastDTO> = {}): SdWfmForecastDTO {
  return {
    generatedAt: '2026-11-04T12:00:00.000Z',
    timeZone: 'America/Sao_Paulo',
    departmentId: null,
    insufficientData: false,
    historyTickets: 300,
    historyWeeksWithData: 8,
    trend: 1.1,
    teamSize: 4,
    hasOnCallSchedule: false,
    settings,
    heatmap: Array.from({ length: 7 }, () => new Array(24).fill(1)),
    hourly: [],
    daily: [{ dateKey: '2026-11-04', dow: 3, expected: 20, low: 15, high: 25 }],
    staffing: [
      {
        dateKey: '2026-11-04',
        dow: 3,
        shift: 'Manhã',
        hours: 8,
        expected: 20,
        low: 15,
        high: 25,
        suggestedAgents: 2,
        suggestedAgentsHigh: 3,
        onCallAgents: null,
        understaffed: true,
        exceedsTeam: false,
      },
    ],
    ...overrides,
  }
}

describe('SdWfmView', () => {
  it('shows the staffing table with the understaffed flag', async () => {
    mockFetch([
      { match: '/wfm/forecast', data: forecast() },
      { match: '/departments', data: [] },
    ])
    renderWithQuery(<SdWfmView workspaceId='ws-1' isAdmin={false} />)
    expect(await screen.findByText('Faltam pessoas')).toBeTruthy()
    expect(screen.getByText('Escala sugerida por turno')).toBeTruthy()
    expect(screen.queryByText('Ajustes')).toBeNull()
  })

  it('warns when the history is short and lets admins open the settings', async () => {
    mockFetch([
      {
        match: '/wfm/forecast',
        data: forecast({
          insufficientData: true,
          historyTickets: 3,
          staffing: [],
        }),
      },
      { match: '/departments', data: [] },
    ])
    renderWithQuery(<SdWfmView workspaceId='ws-1' isAdmin />)
    expect(await screen.findByRole('status')).toBeTruthy()
    expect(screen.getByText(/Nenhum turno configurado/)).toBeTruthy()
    fireEvent.click(screen.getByText('Ajustes'))
    expect(await screen.findByText('Ajustes da previsão')).toBeTruthy()
  })

  it('saves the settings', async () => {
    const spy = mockFetch([
      { match: '/wfm/forecast', data: forecast() },
      { match: '/departments', data: [] },
      { match: '/wfm/settings', method: 'PATCH', data: settings },
    ])
    renderWithQuery(<SdWfmView workspaceId='ws-1' isAdmin />)
    fireEvent.click(await screen.findByText('Ajustes'))
    fireEvent.click(await screen.findByText('Salvar'))
    await waitFor(() =>
      expect(spy.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(
        true,
      ),
    )
  })

  it('shows the error message when the forecast fails', async () => {
    mockFetch([
      { match: '/wfm/forecast', status: 500, error: 'Falhou' },
      { match: '/departments', data: [] },
    ])
    renderWithQuery(<SdWfmView workspaceId='ws-1' isAdmin={false} />)
    expect(await screen.findByRole('alert')).toBeTruthy()
  })
})
