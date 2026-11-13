import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { WhatsappSettingsAi } from '../whatsapp-settings-ai'
import { WhatsappSettingsAiKnowledge } from '../whatsapp-settings-ai-knowledge'

// Dialog/select flows render Base UI portals and wait on several fetches;
// the project default (5s) is too tight when the suite runs under load.
vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const CONFIG = '/api/workspaces/ws_1/whatsapp/ai-config'
const DOCS = `${CONFIG}/knowledge-documents`

const savedConfig = {
  id: 'ai_1',
  workspaceId: 'ws_1',
  model: 'gpt-4.1',
  systemPrompt: 'Responda sempre em português.',
  active: true,
  readMedia: false,
  hasApiKey: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function doc(id: string, filename: string, status: string) {
  return {
    id,
    workspaceId: 'ws_1',
    filename,
    contentType: 'application/pdf',
    sizeBytes: 1024,
    status,
    errorMessage: null,
    createdById: 'u_1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('<WhatsappSettingsAi />', () => {
  const PROVIDER_HINT = /Provedor \(OpenAI ou Claude\), modelo e cota/

  it('hydrates the form from the saved configuration', async () => {
    mockFetch([{ match: CONFIG, data: savedConfig }])
    renderWithQuery(<WhatsappSettingsAi workspaceId='ws_1' />)

    await waitFor(() =>
      expect(
        (screen.getByLabelText('Instruções da IA') as HTMLTextAreaElement)
          .value,
      ).toBe('Responda sempre em português.'),
    )
    const [activeSwitch, mediaSwitch] = screen.getAllByRole('switch')
    expect(activeSwitch.getAttribute('aria-checked')).toBe('true')
    expect(mediaSwitch.getAttribute('aria-checked')).toBe('false')
  })

  it('points provider/model choice to Steel IA instead of asking for a key', async () => {
    mockFetch([{ match: CONFIG, data: null }])
    renderWithQuery(<WhatsappSettingsAi workspaceId='ws_1' />)

    expect(await screen.findByText(PROVIDER_HINT)).toBeTruthy()
    expect(screen.queryByLabelText('Chave da API OpenAI')).toBeNull()
    expect(screen.queryByLabelText('Modelo')).toBeNull()
  })

  it('saves toggles and prompt without key or model', async () => {
    const fetchSpy = mockFetch([
      { method: 'PATCH', match: CONFIG, data: savedConfig },
      { match: CONFIG, data: savedConfig },
    ])
    renderWithQuery(<WhatsappSettingsAi workspaceId='ws_1' />)
    await waitFor(() =>
      expect(
        (screen.getByLabelText('Instruções da IA') as HTMLTextAreaElement)
          .value,
      ).toBe('Responda sempre em português.'),
    )

    fireEvent.click(screen.getAllByRole('switch')[1])
    fireEvent.click(screen.getByRole('button', { name: 'Salvar configuração' }))

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Configuração de IA salva'),
    )
    expect(fetchBody(fetchSpy, CONFIG, 'PATCH')).toEqual({
      systemPrompt: 'Responda sempre em português.',
      active: true,
      readMedia: true,
    })
  })

  it('reports save failures', async () => {
    mockFetch([
      { method: 'PATCH', match: CONFIG, status: 400, error: 'Dados inválidos' },
      { match: CONFIG, data: savedConfig },
    ])
    renderWithQuery(<WhatsappSettingsAi workspaceId='ws_1' />)
    await screen.findByText(PROVIDER_HINT)

    fireEvent.click(screen.getByRole('button', { name: 'Salvar configuração' }))
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
    expect((notify.error.mock.calls[0][0] as Error).message).toBe(
      'Dados inválidos',
    )
  })
})

describe('<WhatsappSettingsAi /> prerequisites and errors', () => {
  const AI_SETTINGS = '/api/workspaces/ws_1/ai-settings'

  function aiSettings(overrides: Record<string, unknown> = {}) {
    return {
      workspaceId: 'ws_1',
      providers: [],
      models: [
        {
          key: 'openai:gpt-4.1',
          provider: 'openai',
          model: 'gpt-4.1',
          label: 'GPT-4.1',
          available: true,
          enabled: true,
          inputUsdPer1M: 1,
          outputUsdPer1M: 1,
        },
      ],
      whatsappReplyModel: 'openai:gpt-4.1',
      aiEnabled: true,
      usage: { exceeded: false },
      ...overrides,
    }
  }

  it('warns when the AI is switched off for the workspace and blocks saving', async () => {
    const fetchSpy = mockFetch([
      { match: AI_SETTINGS, data: aiSettings({ aiEnabled: false }) },
      { method: 'PATCH', match: CONFIG, data: savedConfig },
      { match: CONFIG, data: savedConfig },
    ])
    renderWithQuery(<WhatsappSettingsAi workspaceId='ws_1' />)

    expect(
      await screen.findByText(/recursos de IA estão desligados/),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar configuração' }))
    expect(notify.error).toHaveBeenCalledWith(
      'Antes de ligar a IA, resolva os avisos em vermelho nesta tela.',
    )
    expect(fetchBody(fetchSpy, CONFIG, 'PATCH')).toBeUndefined()
  })

  it('warns when the monthly quota is exhausted but still allows saving', async () => {
    mockFetch([
      {
        match: AI_SETTINGS,
        data: aiSettings({ usage: { exceeded: true } }),
      },
      { match: CONFIG, data: savedConfig },
    ])
    renderWithQuery(<WhatsappSettingsAi workspaceId='ws_1' />)

    expect(await screen.findByText(/cota mensal de IA acabou/)).toBeTruthy()
  })

  it('shows the server reason instead of default values on a load error', async () => {
    mockFetch([
      {
        match: CONFIG,
        status: 403,
        error: 'Só administradores configuram a IA',
      },
    ])
    renderWithQuery(<WhatsappSettingsAi workspaceId='ws_1' />)

    expect(
      await screen.findByText(/Só administradores configuram a IA/),
    ).toBeTruthy()
    expect(screen.queryByLabelText('Instruções da IA')).toBeNull()
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy()
  })
})

describe('<WhatsappSettingsAiKnowledge />', () => {
  it('lists documents with translated status labels', async () => {
    mockFetch([
      {
        match: DOCS,
        data: [
          doc('d1', 'manual.pdf', 'READY'),
          doc('d2', 'faq.docx', 'PROCESSING'),
          doc('d3', 'scan.pdf', 'FAILED'),
        ],
      },
    ])
    renderWithQuery(<WhatsappSettingsAiKnowledge workspaceId='ws_1' />)

    expect(await screen.findByText('manual.pdf')).toBeTruthy()
    expect(screen.getByText('Pronto')).toBeTruthy()
    expect(screen.getByText('Processando')).toBeTruthy()
    expect(screen.getByText('Falhou')).toBeTruthy()
  })

  it('explains why a document failed', async () => {
    mockFetch([
      {
        match: DOCS,
        data: [
          {
            ...doc('d3', 'scan.pdf', 'FAILED'),
            errorMessage: 'Nenhum texto encontrado no arquivo',
          },
        ],
      },
    ])
    renderWithQuery(<WhatsappSettingsAiKnowledge workspaceId='ws_1' />)

    expect(
      await screen.findByText('Nenhum texto encontrado no arquivo'),
    ).toBeTruthy()
  })

  it('shows the empty state', async () => {
    mockFetch([{ match: DOCS, data: [] }])
    renderWithQuery(<WhatsappSettingsAiKnowledge workspaceId='ws_1' />)
    expect(
      await screen.findByText('Nenhum documento enviado ainda.'),
    ).toBeTruthy()
  })

  it('uploads the chosen file as multipart form data', async () => {
    const fetchSpy = mockFetch([
      {
        method: 'POST',
        match: DOCS,
        data: doc('d9', 'novo.txt', 'PROCESSING'),
      },
      { match: DOCS, data: [] },
    ])
    const { container } = renderWithQuery(
      <WhatsappSettingsAiKnowledge workspaceId='ws_1' />,
    )
    await screen.findByText('Nenhum documento enviado ainda.')

    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement
    expect(input.accept).toBe('.pdf,.docx,.txt,.csv')
    const file = new File(['conteúdo'], 'novo.txt', { type: 'text/plain' })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(([, init]) => init?.method === 'POST'),
      ).toBe(true),
    )
    const post = fetchSpy.mock.calls.find(([, init]) => init?.method === 'POST')
    const body = post?.[1]?.body as FormData
    expect(body).toBeInstanceOf(FormData)
    expect((body.get('file') as File).name).toBe('novo.txt')
  })

  it('surfaces an upload error', async () => {
    mockFetch([
      { method: 'POST', match: DOCS, status: 413, error: 'Arquivo grande' },
      { match: DOCS, data: [] },
    ])
    const { container } = renderWithQuery(
      <WhatsappSettingsAiKnowledge workspaceId='ws_1' />,
    )
    await screen.findByText('Nenhum documento enviado ainda.')
    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'big.pdf')] },
    })

    await waitFor(() => expect(notify.error).toHaveBeenCalled())
    expect((notify.error.mock.calls[0][0] as Error).message).toBe(
      'Arquivo grande',
    )
  })

  it('deletes a document', async () => {
    const fetchSpy = mockFetch([
      { method: 'DELETE', match: `${DOCS}/d1`, data: null },
      { match: DOCS, data: [doc('d1', 'manual.pdf', 'READY')] },
    ])
    renderWithQuery(<WhatsappSettingsAiKnowledge workspaceId='ws_1' />)

    fireEvent.click(
      await screen.findByRole('button', { name: 'Remover manual.pdf' }),
    )
    const alert = await screen.findByRole('alertdialog')
    expect(within(alert).getByText(/deixa de usar "manual.pdf"/)).toBeTruthy()
    fireEvent.click(within(alert).getByRole('button', { name: 'Remover' }))

    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(
          ([url, init]) =>
            init?.method === 'DELETE' && String(url).endsWith('/d1'),
        ),
      ).toBe(true),
    )
  })
})
