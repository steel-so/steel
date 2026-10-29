import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspacePermissionsProvider } from '@/app/_components/workspace/workspace-permissions'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { WhatsAppFlowDTO } from '@/types/whatsapp-flow'
import { FlowEditor } from '../flow-editor'

vi.setConfig({ testTimeout: 30_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const BASE = '/api/workspaces/ws_1/whatsapp/flows'

const baseFlow: WhatsAppFlowDTO = {
  id: 'flow_1',
  workspaceId: 'ws_1',
  connectionId: 'conn_1',
  name: 'Cadastro',
  description: null,
  category: 'SIGN_UP',
  status: 'DRAFT',
  definition: {
    screens: [
      {
        title: 'Cadastro',
        fields: [
          {
            key: 'nome',
            label: 'Nome',
            type: 'text',
            required: true,
            mapping: { target: 'lead', attribute: 'name' },
          },
          {
            key: 'servico',
            label: 'Serviço',
            type: 'select',
            required: false,
            options: [
              { id: 'a', title: 'Consulta' },
              { id: 'b', title: 'Retorno' },
            ],
          },
        ],
      },
    ],
  },
  bodyText: 'Preencha o cadastro',
  ctaLabel: 'Cadastrar',
  confirmationText: null,
  crmAction: 'NONE',
  sourceCrmFormId: null,
  metaFlowId: null,
  metaStatus: null,
  publishError: null,
  publishedVersion: 0,
  publishedAt: null,
  hasUnpublishedChanges: true,
  sendable: false,
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
}

const render = (
  flow = baseFlow,
  extra: Parameters<typeof mockFetch>[0] = [],
) => {
  const spy = mockFetch([
    ...extra,
    { match: `${BASE}/flow_1`, data: flow },
    {
      match: `${BASE}/flow_1/responses`,
      data: { items: [], nextCursor: null },
    },
  ])
  renderWithQuery(<FlowEditor workspaceId='ws_1' slug='demo' flowId='flow_1' />)
  return spy
}

describe('<FlowEditor />', () => {
  it('shows the screens and fields of the flow', async () => {
    render()
    expect(await screen.findByDisplayValue('Cadastro')).toBeTruthy()
    expect(screen.getByDisplayValue('Nome')).toBeTruthy()
    expect(screen.getByDisplayValue('Consulta')).toBeTruthy()
    expect(
      screen.getByText('Alterações ainda não enviadas à Meta'),
    ).toBeTruthy()
  })

  it('saves what was edited, then enables nothing else', async () => {
    const spy = render(baseFlow, [
      {
        method: 'PATCH',
        match: `${BASE}/flow_1`,
        data: { ...baseFlow, ctaLabel: 'Começar' },
      },
    ])
    fireEvent.change(await screen.findByDisplayValue('Nome'), {
      target: { value: 'Seu nome' },
    })
    expect(screen.getByText('Alterações não salvas')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Formulário salvo'),
    )
    const body = fetchBody(spy, `${BASE}/flow_1`, 'PATCH')
    expect(body.definition.screens[0].fields[0].label).toBe('Seu nome')
    expect(body.crmAction).toBe('NONE')
    expect(body.confirmationText).toBeNull()
  })

  it('adds and removes fields and screens', async () => {
    render()
    await screen.findByDisplayValue('Nome')
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar tela' }))
    expect(await screen.findByText('Tela 2')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Remover tela' })[1])
    await waitFor(() => expect(screen.queryByText('Tela 2')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Remover Serviço' }))
    await waitFor(() =>
      expect(screen.queryByDisplayValue('Consulta')).toBeNull(),
    )
    // The last field of a screen cannot be removed.
    expect(
      (
        screen.getByRole('button', {
          name: 'Remover Nome',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })

  it('adds and removes options of a choice field', async () => {
    render()
    await screen.findByDisplayValue('Consulta')
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar opção' }))
    expect(await screen.findByDisplayValue('Opção 3')).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: 'Remover opção Opção 3' }),
    )
    await waitFor(() =>
      expect(screen.queryByDisplayValue('Opção 3')).toBeNull(),
    )
  })

  it('moves a field down', async () => {
    render()
    await screen.findByDisplayValue('Nome')
    fireEvent.click(screen.getByRole('button', { name: 'Descer Nome' }))
    const labels = (await screen.findAllByLabelText('Pergunta')).map(
      (input) => (input as HTMLInputElement).value,
    )
    expect(labels).toEqual(['Serviço', 'Nome'])
  })

  it('saves before publishing a dirty flow and reports Meta’s answer', async () => {
    const spy = render(baseFlow, [
      { method: 'PATCH', match: `${BASE}/flow_1`, data: baseFlow },
      {
        method: 'POST',
        match: `${BASE}/flow_1/publish`,
        data: {
          flow: { ...baseFlow, status: 'PUBLISHED' },
          published: true,
        },
      },
    ])
    fireEvent.change(await screen.findByDisplayValue('Nome'), {
      target: { value: 'Seu nome' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Publicar' }))
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith(
        'Formulário publicado na Meta',
      ),
    )
    expect(fetchBody(spy, `${BASE}/flow_1/publish`, 'POST')).toEqual({
      publish: true,
    })
  })

  it('uploads only a draft when asked', async () => {
    const spy = render(baseFlow, [
      {
        method: 'POST',
        match: `${BASE}/flow_1/publish`,
        data: { flow: baseFlow, published: false },
      },
    ])
    fireEvent.click(
      await screen.findByRole('button', { name: 'Enviar rascunho à Meta' }),
    )
    await waitFor(() =>
      expect(fetchBody(spy, `${BASE}/flow_1/publish`, 'POST')).toEqual({
        publish: false,
      }),
    )
  })

  it('shows what Meta refused', async () => {
    render({ ...baseFlow, publishError: 'Tela sem título' })
    expect((await screen.findByRole('alert')).textContent).toContain(
      'A Meta recusou o formulário: Tela sem título',
    )
  })

  it('shows a loading error', async () => {
    mockFetch([{ match: `${BASE}/flow_1`, status: 404, error: 'não achou' }])
    renderWithQuery(
      <FlowEditor workspaceId='ws_1' slug='demo' flowId='flow_1' />,
    )
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Não foi possível carregar',
    )
  })

  it('offers the template and the preview only for a published flow', async () => {
    const published = {
      ...baseFlow,
      status: 'PUBLISHED',
      metaFlowId: 'meta_1',
      metaStatus: 'PUBLISHED',
      publishedAt: '2026-10-02T12:00:00.000Z',
      publishedVersion: 1,
      hasUnpublishedChanges: false,
    }
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(published, [
      {
        match: `${BASE}/flow_1/preview`,
        data: {
          previewUrl: 'https://business.facebook.com/p/1',
          status: 'PUBLISHED',
        },
      },
    ])
    expect(
      await screen.findByRole('button', { name: 'Criar template' }),
    ).toBeTruthy()
    expect(screen.getByText(/Enviado à Meta em/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Pré-visualizar' }))
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith(
        'https://business.facebook.com/p/1',
        '_blank',
        'noopener,noreferrer',
      ),
    )
  })

  it('tells when Meta has no preview yet', async () => {
    render({ ...baseFlow, metaFlowId: 'meta_1', metaStatus: 'DRAFT' }, [
      {
        match: `${BASE}/flow_1/preview`,
        data: { previewUrl: null, status: 'DRAFT' },
      },
    ])
    fireEvent.click(
      await screen.findByRole('button', { name: 'Pré-visualizar' }),
    )
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        'A Meta ainda não gerou a pré-visualização',
      ),
    )
  })

  it('creates a template for the published flow', async () => {
    const spy = render(
      {
        ...baseFlow,
        status: 'PUBLISHED',
        metaFlowId: 'meta_1',
        metaStatus: 'PUBLISHED',
      },
      [
        {
          method: 'POST',
          match: `${BASE}/flow_1/template`,
          status: 201,
          data: { id: 't1' },
        },
      ],
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Criar template' }),
    )
    fireEvent.change(await screen.findByLabelText('Nome do template'), {
      target: { value: 'Cadastro Cliente' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Enviar para aprovação' }),
    )
    await waitFor(() =>
      expect(fetchBody(spy, `${BASE}/flow_1/template`, 'POST')).toMatchObject({
        name: 'cadastro_cliente',
        body: 'Preencha o cadastro',
        buttonText: 'Cadastrar',
      }),
    )
  })

  it('lets non-admins read but not change', async () => {
    mockFetch([
      { match: `${BASE}/flow_1`, data: baseFlow },
      {
        match: `${BASE}/flow_1/responses`,
        data: { items: [], nextCursor: null },
      },
    ])
    renderWithQuery(
      <WorkspacePermissionsProvider
        value={{ isPrivileged: false, permissions: null }}
      >
        <FlowEditor workspaceId='ws_1' slug='demo' flowId='flow_1' />
      </WorkspacePermissionsProvider>,
    )
    expect(await screen.findByText('Somente leitura')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Publicar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Adicionar tela' })).toBeNull()
    expect(
      (screen.getByDisplayValue('Nome') as HTMLInputElement).disabled,
    ).toBe(true)
  })

  it('shows the Flow JSON', async () => {
    render(baseFlow, [
      {
        match: `${BASE}/flow_1/meta-json`,
        data: { json: { version: '7.2', screens: [] } },
      },
    ])
    fireEvent.click(await screen.findByRole('button', { name: 'Ver JSON' }))
    expect(await screen.findByText(/"version": "7.2"/)).toBeTruthy()
  })

  it('retires a published flow', async () => {
    const spy = render(
      {
        ...baseFlow,
        status: 'PUBLISHED',
        metaFlowId: 'meta_1',
        metaStatus: 'PUBLISHED',
      },
      [
        {
          method: 'POST',
          match: `${BASE}/flow_1/deprecate`,
          data: { ...baseFlow, status: 'DEPRECATED' },
        },
      ],
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Descontinuar' }))
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Formulário descontinuado'),
    )
    expect(
      spy.mock.calls.some(([url]) => String(url).endsWith('/deprecate')),
    ).toBe(true)
  })
})
