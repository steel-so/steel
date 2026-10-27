import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspacePermissionsProvider } from '@/app/_components/workspace/workspace-permissions'
import { mockFetch, renderWithQuery } from '@/src/__tests__/component-utils'
import type {
  WhatsAppArchiveDTO,
  WhatsAppArchiveOverviewDTO,
} from '@/types/whatsapp-archive'
import { WhatsappSettingsArchive } from '../whatsapp-settings-archive'

vi.setConfig({ testTimeout: 20_000 })

const URL = '/api/workspaces/ws_1/whatsapp/archives'

function archive(
  overrides: Partial<WhatsAppArchiveDTO> = {},
): WhatsAppArchiveDTO {
  return {
    id: 'a1',
    kind: 'WEEKLY',
    status: 'DONE',
    periodStart: '2026-10-19T03:00:00.000Z',
    periodEnd: '2026-10-26T02:59:59.999Z',
    fileName: 'FIDELIZZAMAIS-whatsapp-semanal-2026-10-19-a-2026-10-25.zip',
    sizeBytes: 2_621_440,
    sha256: 'ab'.repeat(32),
    fileCount: 41,
    atendimentoCount: 40,
    offsiteCopiedAt: '2026-10-26T06:00:00.000Z',
    error: null,
    triggeredBy: null,
    createdAt: '2026-10-26T05:00:00.000Z',
    completedAt: '2026-10-26T05:10:00.000Z',
    expiresAt: '2027-01-24T05:10:00.000Z',
    expired: false,
    downloadUrl: `${URL}/a1/download`,
    ...overrides,
  }
}

function overview(
  overrides: Partial<WhatsAppArchiveOverviewDTO> = {},
): WhatsAppArchiveOverviewDTO {
  return {
    settings: {
      enabled: true,
      rootFolderName: null,
      effectiveRootFolderName: 'FIDELIZZAMAIS',
      updatedAt: '2026-10-20T12:00:00.000Z',
    },
    archives: [archive()],
    retention: { weeklyDays: 90, monthlyMonths: 12 },
    offsiteConfigured: true,
    ...overrides,
  }
}

describe('<WhatsappSettingsArchive />', () => {
  it('shows the layout and the packages with the download link', async () => {
    mockFetch([{ match: URL, data: overview() }])
    renderWithQuery(<WhatsappSettingsArchive workspaceId='ws_1' />)

    expect(await screen.findByText('Ativo')).toBeTruthy()
    expect(
      screen.getByText(/FIDELIZZAMAIS\/WHATSAPP\/data\/atendente/),
    ).toBeTruthy()
    expect(screen.getByText(/com cópia fora do servidor/)).toBeTruthy()
    expect(screen.getByText('Semanal')).toBeTruthy()
    expect(screen.getByText('Cópia externa')).toBeTruthy()
    // Period in São Paulo time (the end is Sunday 25/10, not Monday in UTC).
    expect(
      screen.getByText(
        '19/10/2026 a 25/10/2026 · 40 atendimento(s) · 41 arquivo(s) · 2,5 MB',
      ),
    ).toBeTruthy()
    const link = screen.getByText('Baixar').closest('a') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe(`${URL}/a1/download`)
    expect(link.getAttribute('download')).toBe(archive().fileName)
    expect(screen.getByText(/Guardado até 24\/01\/2027 02:10/)).toBeTruthy()
  })

  it('tells a workspace without the archive to call support', async () => {
    mockFetch([
      {
        match: URL,
        data: overview({
          settings: {
            enabled: false,
            rootFolderName: null,
            effectiveRootFolderName: 'ACME',
            updatedAt: null,
          },
          archives: [],
        }),
      },
    ])
    renderWithQuery(<WhatsappSettingsArchive workspaceId='ws_1' />)
    expect(await screen.findByText('Inativo')).toBeTruthy()
    expect(screen.getByText(/fale\s+com o suporte da Stratus/)).toBeTruthy()
    expect(screen.queryByText('Nenhum pacote gerado ainda.')).toBeNull()
  })

  it('shows failed, running, expired and full packages', async () => {
    mockFetch([
      {
        match: URL,
        data: overview({
          offsiteConfigured: false,
          archives: [
            archive({
              id: 'f',
              status: 'FAILED',
              error: 'disk full',
              downloadUrl: null,
              offsiteCopiedAt: null,
              sha256: null,
            }),
            archive({
              id: 'r',
              kind: 'MONTHLY_FULL',
              status: 'RUNNING',
              periodStart: null,
              periodEnd: '2026-11-01T02:59:59.999Z',
              downloadUrl: null,
              offsiteCopiedAt: null,
            }),
            archive({ id: 'e', expired: true, downloadUrl: null }),
          ],
        }),
      },
    ])
    renderWithQuery(<WhatsappSettingsArchive workspaceId='ws_1' />)
    expect(await screen.findByText('Falhou')).toBeTruthy()
    expect(screen.getByText('disk full')).toBeTruthy()
    expect(screen.getByText('Gerando')).toBeTruthy()
    expect(screen.getByText('todo o histórico até 31/10/2026')).toBeTruthy()
    expect(screen.getByText('Expirado')).toBeTruthy()
    expect(screen.queryByText('Baixar')).toBeNull()
    expect(screen.queryByText(/com cópia fora do servidor/)).toBeNull()
  })

  it('shows an empty list once enabled', async () => {
    mockFetch([{ match: URL, data: overview({ archives: [] }) }])
    renderWithQuery(<WhatsappSettingsArchive workspaceId='ws_1' />)
    expect(await screen.findByText('Nenhum pacote gerado ainda.')).toBeTruthy()
  })

  it('reports a load error', async () => {
    mockFetch([{ match: URL, status: 500, error: 'boom' }])
    renderWithQuery(<WhatsappSettingsArchive workspaceId='ws_1' />)
    expect(
      await screen.findByText('Não foi possível carregar o arquivamento.'),
    ).toBeTruthy()
  })

  it('renders nothing for non-admins and does not fetch', () => {
    const fetchSpy = mockFetch([])
    const { container } = renderWithQuery(
      <WorkspacePermissionsProvider
        value={{ isPrivileged: false, permissions: null }}
      >
        <WhatsappSettingsArchive workspaceId='ws_1' />
      </WorkspacePermissionsProvider>,
    )
    expect(container.innerHTML).toBe('')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
