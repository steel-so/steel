import '@/src/__tests__/helpers/dom-matchers'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mockFetch, renderWithQuery } from '@/src/__tests__/component-utils'
import type { AdminServerDTO } from '@/types/admin-server'
import {
  AdminServerDashboard,
  appendHistory,
  HISTORY_POINTS,
} from '../server/admin-server-dashboard'

// nivo needs layout; the sparkline is covered by its own contract here.
vi.mock('../server/server-sparkline', () => ({
  ServerSparkline: ({ label }: { label: string }) => (
    <div data-testid='sparkline'>{label}</div>
  ),
}))

function snapshot(over: Partial<AdminServerDTO> = {}): AdminServerDTO {
  return {
    generatedAt: '2026-11-19T12:00:00.000Z',
    host: {
      hostname: 'abc123',
      platform: 'Linux 6.1',
      cpuCount: 4,
      uptimeSeconds: 90_000,
      cpuPercent: 12.5,
      loadAvg: [0.5, 0.4, 0.3],
      memory: {
        totalBytes: 8 * 1024 ** 3,
        usedBytes: 7.5 * 1024 ** 3,
        availableBytes: 0.5 * 1024 ** 3,
        swapTotalBytes: 0,
        swapUsedBytes: 0,
        percent: 93.75,
      },
      disk: {
        path: '/',
        totalBytes: 100 * 1024 ** 3,
        usedBytes: 50 * 1024 ** 3,
        freeBytes: 50 * 1024 ** 3,
        percent: 50,
      },
      network: {
        rxBytesPerSec: 1024,
        txBytesPerSec: 2048,
        rxBytes: 1,
        txBytes: 2,
        interfaces: 1,
      },
    },
    docker: {
      available: true,
      reason: null,
      containers: [
        {
          id: 'a1',
          name: 'nextjs-app',
          image: 'steel:1',
          state: 'running',
          status: 'Up 2 hours (unhealthy)',
          health: 'unhealthy',
          restartCount: 2,
          cpuPercent: 10,
          memUsageBytes: 1024 ** 3,
          memLimitBytes: 4 * 1024 ** 3,
          memPercent: 25,
        },
      ],
    },
    postgres: {
      ok: true,
      latencyMs: 3,
      databaseSizeBytes: 1024 ** 3,
      connections: 7,
      maxConnections: 100,
      error: null,
    },
    redis: {
      ok: false,
      latencyMs: null,
      usedMemoryBytes: null,
      connectedClients: null,
      version: null,
      uptimeSeconds: null,
      error: 'tls handshake',
    },
    ...over,
  }
}

describe('<AdminServerDashboard />', () => {
  it('shows resources, flags high memory and unhealthy containers, and service health', async () => {
    mockFetch([{ match: '/api/admin/server', data: snapshot() }])
    renderWithQuery(<AdminServerDashboard />)

    expect(await screen.findByText('nextjs-app')).toBeInTheDocument()
    expect(screen.getByText('Unhealthy')).toBeInTheDocument()
    expect(screen.getByText('1 com alerta')).toBeInTheDocument()
    expect(screen.getByText(/Acima de 90%/)).toBeInTheDocument()
    expect(screen.getByText('tls handshake')).toBeInTheDocument()
    expect(screen.getByText('1d 1h')).toBeInTheDocument()
  })

  it('shows how to enable Docker when the socket is unavailable', async () => {
    mockFetch([
      {
        match: '/api/admin/server',
        data: snapshot({
          docker: {
            available: false,
            reason:
              'Indisponível: monte /var/run/docker.sock:ro no container do app.',
            containers: [],
          },
        }),
      },
    ])
    renderWithQuery(<AdminServerDashboard />)
    expect(
      await screen.findByText(/monte \/var\/run\/docker\.sock:ro/),
    ).toBeInTheDocument()
  })

  it('toggles pause', async () => {
    mockFetch([{ match: '/api/admin/server', data: snapshot() }])
    renderWithQuery(<AdminServerDashboard />)
    fireEvent.click(await screen.findByRole('button', { name: 'Pausar' }))
    expect(screen.getByText(/Atualização pausada/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retomar' })).toBeInTheDocument()
  })
})

describe('appendHistory()', () => {
  it('keeps at most HISTORY_POINTS per series and skips nulls', () => {
    let h = { cpu: [], mem: [], load: [], rx: [], tx: [] } as Parameters<
      typeof appendHistory
    >[0]
    for (let i = 0; i < HISTORY_POINTS + 5; i++)
      h = appendHistory(h, snapshot())
    expect(h.cpu).toHaveLength(HISTORY_POINTS)
    const empty = appendHistory(
      h,
      snapshot({
        host: { ...snapshot().host, cpuPercent: null },
      }),
    )
    expect(empty.cpu).toHaveLength(HISTORY_POINTS)
  })
})
