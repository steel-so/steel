import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { mockFetch, renderWithQuery } from '@/src/__tests__/component-utils'
import type { SdPublicStatusPageDTO } from '@/types/sd-status-page'
import { SdPublicStatusPage } from '../sd-public-status-page'

function page(
  overrides: Partial<SdPublicStatusPageDTO> = {},
): SdPublicStatusPageDTO {
  return {
    name: 'Acme · Telefonia',
    description: null,
    workspaceName: 'Stratus',
    timeZone: 'America/Sao_Paulo',
    overall: 'OPERATIONAL',
    services: [],
    components: [],
    maintenances: [],
    allowSubscriptions: false,
    active: [],
    recent: [],
    ...overrides,
  }
}

function render(data: SdPublicStatusPageDTO) {
  mockFetch([{ match: '/api/status-page/acme', data }])
  return renderWithQuery(<SdPublicStatusPage slug='acme' initial={data} />)
}

describe('SdPublicStatusPage components and maintenance', () => {
  it('lists each component with its own state', async () => {
    render(
      page({
        overall: 'PARTIAL_OUTAGE',
        components: [
          { name: 'Telefonia', state: 'OUTAGE' },
          { name: 'Portal', state: 'OPERATIONAL' },
          { name: 'Chat', state: 'DEGRADED' },
        ],
      }),
    )
    expect(await screen.findByText('Componentes')).toBeTruthy()
    expect(screen.getByText('Telefonia')).toBeTruthy()
    expect(screen.getByText('Indisponível')).toBeTruthy()
    expect(screen.getByText('Operacional')).toBeTruthy()
    expect(screen.getByText('Desempenho degradado')).toBeTruthy()
  })

  it('shows the maintenance banner with the period in the page zone', async () => {
    render(
      page({
        maintenances: [
          {
            id: 'mw1',
            title: 'Troca do switch',
            description: 'Queda curta.',
            startsAt: '2026-11-10T22:00:00.000Z',
            endsAt: '2026-11-11T02:00:00.000Z',
            inProgress: false,
          },
          {
            id: 'mw2',
            title: 'Atualização do portal',
            description: null,
            startsAt: '2026-11-10T22:00:00.000Z',
            endsAt: '2026-11-11T02:00:00.000Z',
            inProgress: true,
          },
        ],
      }),
    )
    expect(await screen.findByText('Manutenção programada')).toBeTruthy()
    expect(screen.getByText('Troca do switch')).toBeTruthy()
    expect(screen.getByText('Agendada')).toBeTruthy()
    expect(screen.getByText('Em andamento')).toBeTruthy()
    expect(
      screen.getAllByText(/10\/11\/2026, 19:00 até 10\/11\/2026, 23:00/),
    ).toHaveLength(2)
    expect(screen.getByText('Queda curta.')).toBeTruthy()
  })

  it('hides both sections when there is nothing to show', async () => {
    render(page())
    expect(
      await screen.findByText('Todos os sistemas operando normalmente'),
    ).toBeTruthy()
    expect(screen.queryByText('Componentes')).toBeNull()
    expect(screen.queryByText('Manutenção programada')).toBeNull()
  })
})
