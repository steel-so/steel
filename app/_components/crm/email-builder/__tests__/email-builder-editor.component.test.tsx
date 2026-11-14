import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { createBuilderDocument } from '@/src/lib/crm-email-builder/layouts'
import type {
  CrmEmailBrandDTO,
  CrmEmailTemplateDTO,
} from '@/types/crm-email-marketing'
import { EmailBuilderEditor } from '../email-builder-editor'
import {
  COALESCE_MS,
  historyReducer,
  initHistory,
} from '../use-builder-history'

const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))
vi.mock('@/src/hooks/use-crm-workspace-lookups', () => ({
  useCrmWorkspaceLookups: () => ({
    lookups: { maps: { companies: { c1: 'Acme Ltda.' } } },
  }),
}))
// TipTap needs layout APIs jsdom lacks; a textarea stands in for it.
vi.mock('../rich-text-field', () => ({
  RichTextField: (props: {
    id: string
    value: string
    onChange: (v: string) => void
  }) => (
    <textarea
      id={props.id}
      aria-label='Texto rico'
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
    />
  ),
}))

const WS = 'ws_1'

const template: CrmEmailTemplateDTO = {
  id: 't1',
  name: 'Newsletter de outubro',
  subject: 'Oi {{primeiro_nome}}',
  contentHtml: '',
  contentJson: null,
  templateId: null,
  templateProps: null,
  kind: 'BUILDER',
  builderDocument: createBuilderDocument('newsletter'),
  contentText: null,
  workspaceId: WS,
  createdById: 'u1',
  updatedById: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
}

const brand: CrmEmailBrandDTO = {
  companyName: 'Acme',
  logoUrl: '',
  primaryColor: '#2893CC',
  address: 'Rua das Flores, 10',
  website: '',
  saved: true,
  updatedAt: null,
}

function setup() {
  const spy = mockFetch([
    {
      method: 'PATCH',
      match: '/crm/email-templates/t1',
      handler: (_url, init) => ({
        ...template,
        ...JSON.parse(String(init?.body)),
      }),
    },
    {
      method: 'POST',
      match: '/crm/email-templates/t1/test-send',
      data: { to: 'eu@acme.com' },
    },
    {
      method: 'PUT',
      match: '/crm/email-brand',
      handler: (_url, init) => ({
        ...brand,
        ...JSON.parse(String(init?.body)),
      }),
    },
    {
      match: '/crm/email-builder/links',
      data: {
        forms: [],
      },
    },
    {
      match: '/crm/people',
      data: [
        {
          id: 'p1',
          name: 'Carla Dias',
          emails: ['carla@x.com'],
          phones: [],
          city: null,
          jobTitle: null,
          companyId: 'c1',
        },
      ],
    },
  ])
  renderWithQuery(
    <EmailBuilderEditor
      workspaceId={WS}
      slug='acme'
      template={template}
      brand={brand}
    />,
  )
  return spy
}

function frame() {
  return screen.getByTestId('email-preview-frame') as HTMLIFrameElement
}

async function previewText() {
  await waitFor(() =>
    expect(frame().contentDocument?.body?.textContent ?? '').not.toBe(''),
  )
  return frame().contentDocument?.body?.textContent ?? ''
}

async function clickSection(id: string) {
  await previewText()
  const node = frame().contentDocument?.querySelector(
    `[data-section-id="${id}"]`,
  ) as HTMLElement
  expect(node).not.toBeNull()
  fireEvent.click(node)
}

beforeEach(() => {
  notify.success.mockClear()
  notify.error.mockClear()
})

describe('<EmailBuilderEditor />', () => {
  it('renders the e-mail with the sample contact in the preview', async () => {
    setup()
    const text = await previewText()
    expect(text).toContain('Novidades deste mês')
    expect(text).toContain('Olá, Maria!')
    expect(text).toContain('Descadastrar')
  })

  it('selects a block clicked in the preview and shows its fields', async () => {
    setup()
    expect(
      screen.getByText(/clique em um bloco do e-mail para editar/i),
    ).toBeTruthy()
    await clickSection('hero')
    expect(screen.getByRole('heading', { name: 'Destaque' })).toBeTruthy()
    expect(screen.getByLabelText('Título')).toHaveProperty(
      'value',
      'Novidades deste mês',
    )
  })

  it('updates the preview when a field changes in the bottom panel', async () => {
    setup()
    await clickSection('hero')
    fireEvent.change(screen.getByLabelText('Título'), {
      target: { value: 'Edição especial' },
    })
    await waitFor(async () =>
      expect(await previewText()).toContain('Edição especial'),
    )
  })

  it('switches to the mobile width and simulates a dark client', async () => {
    setup()
    expect(frame().dataset.width).toBe('680')
    fireEvent.click(screen.getByRole('button', { name: /no celular/i }))
    expect(frame().dataset.width).toBe('375')
    fireEvent.click(
      screen.getByRole('button', { name: /simular cliente em modo escuro/i }),
    )
    expect(frame().dataset.dark).toBe('true')
    await waitFor(() =>
      expect(
        frame().contentDocument?.getElementById('builder-dark')?.textContent,
      ).toContain('invert'),
    )
  })

  it('zooms in and out within the allowed steps', () => {
    setup()
    expect(screen.getByText('100%')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /aumentar zoom/i }))
    expect(screen.getByText('125%')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: /aumentar zoom/i }),
    ).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: /diminuir zoom/i }))
    fireEvent.click(screen.getByRole('button', { name: /diminuir zoom/i }))
    expect(screen.getByText('75%')).toBeTruthy()
  })

  it('undoes and redoes edits', async () => {
    setup()
    const subject = screen.getByLabelText('Assunto')
    expect(screen.getByRole('button', { name: 'Desfazer' })).toHaveProperty(
      'disabled',
      true,
    )
    fireEvent.change(subject, { target: { value: 'Novo assunto' } })
    expect(subject).toHaveProperty('value', 'Novo assunto')
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }))
    expect(subject).toHaveProperty('value', 'Oi {{primeiro_nome}}')
    fireEvent.click(screen.getByRole('button', { name: 'Refazer' }))
    expect(subject).toHaveProperty('value', 'Novo assunto')
    // keyboard shortcut outside text fields
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(subject).toHaveProperty('value', 'Oi {{primeiro_nome}}')
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true })
    expect(subject).toHaveProperty('value', 'Novo assunto')
  })

  it('autosaves the document after edits', async () => {
    const spy = setup()
    fireEvent.change(screen.getByLabelText('Texto de pré-visualização'), {
      target: { value: 'Resumo novo' },
    })
    expect(screen.getByRole('status').textContent).toContain(
      'Alterações não salvas',
    )
    await waitFor(
      () => {
        expect(
          fetchBody(spy, '/crm/email-templates/t1', 'PATCH'),
        ).toMatchObject({
          name: 'Newsletter de outubro',
          builderDocument: { previewText: 'Resumo novo' },
        })
      },
      { timeout: 3000 },
    )
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('Salvo'),
    )
  })

  it('does not save an invalid draft', async () => {
    const spy = setup()
    await clickSection('hero')
    fireEvent.change(screen.getByLabelText('Link do botão'), {
      target: { value: 'javascript:alert(1)' },
    })
    await waitFor(
      () =>
        expect(screen.getByRole('status').textContent).toContain(
          'Corrija os campos destacados',
        ),
      { timeout: 3000 },
    )
    expect(
      spy.mock.calls.some(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
      ),
    ).toBe(false)
  })

  it('hides an optional section and reorders sections in the Seções tab', async () => {
    setup()
    fireEvent.click(screen.getByRole('tab', { name: 'Seções' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar Destaques' }))
    await waitFor(async () =>
      expect(await previewText()).not.toContain('Dica do mês'),
    )
    expect(
      screen.queryByRole('button', { name: 'Ocultar Cabeçalho' }),
    ).toBeNull()

    fireEvent.click(
      screen.getByRole('button', { name: 'Mover Texto para cima' }),
    )
    await waitFor(() => {
      const ids = Array.from(
        frame().contentDocument?.querySelectorAll('[data-section-id]') ?? [],
      ).map((n) => n.getAttribute('data-section-id'))
      expect(ids.indexOf('intro')).toBeLessThan(ids.indexOf('hero'))
    })
  })

  it('previews as a CRM person or with raw variables', async () => {
    setup()
    const select = screen.getByLabelText('Visualizar como')
    await within(select).findByRole('option', { name: 'Carla Dias' })
    fireEvent.change(select, { target: { value: 'person:p1' } })
    await waitFor(async () =>
      expect(await previewText()).toContain('Olá, Carla!'),
    )
    fireEvent.change(select, { target: { value: 'tokens' } })
    await waitFor(async () =>
      expect(await previewText()).toContain('{{primeiro_nome|tudo bem}}'),
    )
  })

  it('sends a test e-mail', async () => {
    const spy = setup()
    fireEvent.click(screen.getByRole('button', { name: /enviar teste/i }))
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith(
        'Teste enviado para eu@acme.com',
      ),
    )
    expect(fetchBody(spy, '/test-send')).toMatchObject({
      sample: { name: 'Maria Silva' },
    })
  })

  it('edits and saves the workspace brand', async () => {
    const spy = setup()
    fireEvent.click(screen.getByRole('tab', { name: 'Marca' }))
    fireEvent.change(screen.getByLabelText('Nome da empresa'), {
      target: { value: 'Acme Nova' },
    })
    await waitFor(async () =>
      expect(await previewText()).toContain('Acme Nova'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Salvar marca' }))
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith(
        'Marca salva para todos os templates',
      ),
    )
    expect(fetchBody(spy, '/crm/email-brand', 'PUT')).toMatchObject({
      companyName: 'Acme Nova',
    })
  })

  it('rejects an invalid brand color before saving', async () => {
    setup()
    fireEvent.click(screen.getByRole('tab', { name: 'Marca' }))
    fireEvent.change(screen.getByLabelText('Cor principal'), {
      target: { value: 'azul' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar marca' }))
    expect(notify.error).toHaveBeenCalledWith('Cor no formato #RRGGBB')
  })

  it('offers the campaign link first in the link picker', async () => {
    setup()
    await clickSection('cta')
    fireEvent.click(screen.getByRole('button', { name: 'Escolher link' }))
    const campaign = await screen.findByText('Link da campanha')
    expect(await screen.findByText('Nenhum formulário publicado')).toBeTruthy()
    fireEvent.click(campaign)
    expect(campaign).toBeDefined()
    expect(screen.getByLabelText('Link do botão')).toHaveProperty(
      'value',
      '{{campaign_link}}',
    )
    expect(
      screen.getByText('Usa o link da campanha, definido ao enviar.'),
    ).toBeTruthy()
  })

  it('inserts a personalization variable into a text field', async () => {
    setup()
    await clickSection('hero')
    const heading = screen.getByLabelText('Título') as HTMLInputElement
    heading.setSelectionRange(0, 0)
    const pickers = screen.getAllByRole('button', { name: 'Inserir variável' })
    fireEvent.click(pickers[1])
    fireEvent.click(await screen.findByText('Empresa'))
    expect(heading.value).toBe('{{empresa}}Novidades deste mês')
  })

  it('adds and removes list items within the allowed range', async () => {
    setup()
    await clickSection('highlights')
    expect(screen.getAllByText(/^Item \d$/, { selector: 'span' })).toHaveLength(
      3,
    )
    fireEvent.click(screen.getByRole('button', { name: /adicionar item/i }))
    expect(screen.getAllByText(/^Item \d$/, { selector: 'span' })).toHaveLength(
      4,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remover item 4' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Mover item 2 para cima' }),
    )
    expect(screen.getAllByLabelText('Título')[1]).toHaveProperty(
      'value',
      'Dica do mês',
    )
  })
})

describe('historyReducer', () => {
  it('coalesces quick edits of the same field into one undo step', () => {
    let state = initHistory('a')
    state = historyReducer(state, {
      type: 'set',
      value: 'ab',
      group: 'f',
      at: 1,
    })
    state = historyReducer(state, {
      type: 'set',
      value: 'abc',
      group: 'f',
      at: 2,
    })
    expect(state.past).toEqual(['a'])
    state = historyReducer(state, {
      type: 'set',
      value: 'abcd',
      group: 'f',
      at: 2 + COALESCE_MS,
    })
    expect(state.past).toEqual(['a', 'abc'])
  })

  it('ignores no-op sets and empty undo/redo, and resets', () => {
    const state = initHistory('a')
    expect(historyReducer(state, { type: 'set', value: 'a', at: 1 })).toBe(
      state,
    )
    expect(historyReducer(state, { type: 'undo' })).toBe(state)
    expect(historyReducer(state, { type: 'redo' })).toBe(state)
    expect(historyReducer(state, { type: 'reset', value: 'z' }).present).toBe(
      'z',
    )
  })
})
