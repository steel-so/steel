import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasEditor } from '@/app/_components/canvas/canvas-editor'
import { mockFetch } from '@/src/__tests__/component-utils'
import { getNode } from '@/src/lib/canvas/nodes'
import { createCanvasStore } from '@/src/lib/canvas/store'
import type { CanvasDocument, CanvasNode } from '@/src/lib/canvas/types'
import { createEmailRenderContext } from '@/src/lib/canvas-email/theme'
import type {
  CrmEmailSavedBlockDTO,
  CrmEmailTemplateVersionDTO,
} from '@/types/crm-email-editor'
import { AiSectionPanel } from '../ai-section-panel'
import { createEditorEmailCatalog } from '../editor-catalog'
import { type EmailEditorData, EmailEditorDataProvider } from '../editor-data'
import { EMAIL_EDITOR_FRAME_CSS } from '../frame-styles'
import { ProductPickerControl } from '../product-picker-control'
import { SavedBlocksPanel } from '../saved-blocks-panel'
import { createTemplateMetaStore } from '../template-meta'
import { VersionHistoryButton } from '../version-history'
import {
  newsletterDocument,
  notify,
  product,
  template,
  WS,
} from './editor-fixtures'

vi.mock('@/lib/notify', async () => ({
  notify: (await import('./editor-fixtures')).notify,
}))
vi.mock('@/app/_components/canvas/inspector/controls/richtext', () => ({
  RichTextControl: () => null,
}))

const HEADING_FRAGMENT = {
  rootId: 'sh',
  nodes: {
    sh: {
      id: 'sh',
      type: 'email.heading',
      props: {
        text: 'Bloco salvo',
        level: 'h2',
        align: 'left',
        padding: { top: 8, right: 0, bottom: 8, left: 0 },
        visibility: { base: true, tablet: true, mobile: true },
      },
    },
  },
}

function savedBlock(
  overrides: Partial<CrmEmailSavedBlockDTO> = {},
): CrmEmailSavedBlockDTO {
  return {
    id: 'sb1',
    workspaceId: WS,
    name: 'Título da casa',
    category: 'Cabeçalhos',
    kind: 'block',
    fragment: HEADING_FRAGMENT,
    nodeCount: 1,
    thumbnail: null,
    createdBy: { id: 'u1', name: 'Ana' },
    createdAt: '2026-10-14T12:00:00.000Z',
    updatedAt: '2026-10-14T12:00:00.000Z',
    ...overrides,
  }
}

function version(
  overrides: Partial<CrmEmailTemplateVersionDTO> = {},
): CrmEmailTemplateVersionDTO {
  return {
    id: 'v1',
    templateId: 't1',
    reason: 'SAVE',
    label: 'Antes da revisão',
    subject: 'Assunto antigo',
    restoredFromId: null,
    createdBy: { id: 'u1', name: 'Ana' },
    createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    ...overrides,
  }
}

function headingOf(doc: CanvasDocument): CanvasNode {
  return Object.values(doc.nodes).find(
    (node) => node.type === 'email.heading',
  ) as CanvasNode
}

function mount(overrides: Partial<EmailEditorData> = {}) {
  const doc = newsletterDocument()
  const holder: { store?: ReturnType<typeof createCanvasStore> } = {}
  const catalog = createEditorEmailCatalog({
    allowHtml: true,
    productPicker: ProductPickerControl,
    context: () =>
      createEmailRenderContext({
        doc: () => holder.store?.getState().doc ?? doc,
      }),
  })
  const store = createCanvasStore(catalog, doc)
  holder.store = store
  const data: EmailEditorData = {
    workspaceId: WS,
    slug: 'acme',
    templateId: 't1',
    products: [product()],
    productsLoading: false,
    brand: {
      companyName: 'Acme',
      logoUrl: '',
      primaryColor: '#0F766E',
      address: '',
      website: '',
    },
    meta: createTemplateMetaStore({ name: 'N', subject: 'Novidades' }),
    flushMeta: vi.fn(async () => true),
    flushDocument: vi.fn(async () => true),
    applyTemplate: vi.fn(),
    ...overrides,
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <EmailEditorDataProvider value={data}>
        <CanvasEditor
          catalog={catalog}
          store={store}
          initialDocument={doc}
          viewportWidths={{ base: 680, mobile: 375 }}
          frameHead={<style>{EMAIL_EDITOR_FRAME_CSS}</style>}
          title='E-mail'
          actions={() => <VersionHistoryButton />}
          extraTabs={[
            {
              id: 'saved',
              label: 'Salvos',
              icon: 'saved',
              render: ({ store: s }) => <SavedBlocksPanel store={s} />,
            },
            {
              id: 'ai',
              label: 'IA',
              icon: 'ai',
              render: ({ store: s }) => <AiSectionPanel store={s} />,
            },
          ]}
          onSave={async () => true}
        />
      </EmailEditorDataProvider>
    </QueryClientProvider>,
  )
  return { store, data, doc }
}

// Base UI only commits a mouse selection that started on the item itself.
async function choose(combobox: string, option: string | RegExp) {
  fireEvent.click(screen.getByRole('combobox', { name: combobox }))
  const item = await screen.findByRole('option', { name: option })
  fireEvent.pointerDown(item, { pointerType: 'mouse' })
  fireEvent.click(item)
}

const tab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }))

const bodyOf = (spy: ReturnType<typeof mockFetch>, match: string) =>
  spy.mock.calls
    .filter(([url, init]) => String(url).includes(match) && init?.method)
    .map(([, init]) => JSON.parse(String(init?.body ?? '{}')))

beforeEach(() => {
  for (const fn of Object.values(notify)) fn.mockClear()
})

describe('"Salvos" — saved blocks', () => {
  it('lists the workspace blocks and inserts one by click', async () => {
    mockFetch([{ match: '/crm/email-saved-blocks', data: [savedBlock()] }])
    const { store } = mount()
    tab('Salvos')
    const card = await screen.findByTestId('saved-block-sb1')
    expect(card.textContent).toContain('Título da casa')
    expect(screen.getByText('Cabeçalhos')).toBeTruthy()
    const before = Object.keys(store.getState().doc.nodes).length
    fireEvent.click(card)
    expect(Object.keys(store.getState().doc.nodes).length).toBe(before + 1)
    const inserted = Object.values(store.getState().doc.nodes).find(
      (node) => node.props.text === 'Bloco salvo',
    )
    expect(inserted?.id).not.toBe('sh')
  })

  it('searches and shows the empty states', async () => {
    mockFetch([
      {
        match: '/crm/email-saved-blocks',
        data: [savedBlock(), savedBlock({ id: 'sb2', name: 'Rodapé' })],
      },
    ])
    mount()
    tab('Salvos')
    await screen.findByTestId('saved-block-sb2')
    fireEvent.change(screen.getByLabelText('Buscar blocos salvos'), {
      target: { value: 'rodape' },
    })
    expect(screen.queryByTestId('saved-block-sb1')).toBeNull()
    fireEvent.change(screen.getByLabelText('Buscar blocos salvos'), {
      target: { value: 'xyz' },
    })
    expect(screen.getByText('Nenhum bloco encontrado.')).toBeTruthy()
  })

  it('saves the selected block for the workspace', async () => {
    const spy = mockFetch([
      {
        method: 'POST',
        match: '/crm/email-saved-blocks',
        handler: (_url, init) =>
          savedBlock({
            id: 'new',
            name: JSON.parse(String(init?.body)).name,
          }),
      },
      { match: '/crm/email-saved-blocks', data: [] },
    ])
    const { store, doc } = mount()
    tab('Salvos')
    expect(await screen.findByText('Nenhum bloco salvo ainda')).toBeTruthy()
    const save = screen.getByTestId('saved-block-save') as HTMLButtonElement
    expect(save.disabled).toBe(true)

    const heading = headingOf(doc)
    act(() => store.select(heading.id))
    await waitFor(() => expect(save.disabled).toBe(false))
    expect(save.textContent).toContain('Salvar bloco selecionado')
    fireEvent.click(save)
    fireEvent.change(await screen.findByLabelText('Nome'), {
      target: { value: 'Meu título' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await screen.findByTestId('saved-block-new')
    const [body] = bodyOf(spy, '/crm/email-saved-blocks')
    expect(body.name).toBe('Meu título')
    expect(body.category).toBe('Outros')
    const root = body.fragment.nodes[body.fragment.rootId]
    expect(root.type).toBe('email.heading')
    expect(body.fragment.rootId).not.toBe(heading.id)
    expect(notify.success).toHaveBeenCalled()
  })

  it('renames and deletes a block from its menu', async () => {
    const spy = mockFetch([
      {
        method: 'PATCH',
        match: '/crm/email-saved-blocks/sb1',
        data: savedBlock({ name: 'Renomeado' }),
      },
      { method: 'DELETE', match: '/crm/email-saved-blocks/sb1', data: null },
      { match: '/crm/email-saved-blocks', data: [savedBlock()] },
    ])
    mount()
    tab('Salvos')
    await screen.findByTestId('saved-block-sb1')
    fireEvent.click(screen.getByLabelText('Ações de Título da casa'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Renomear' }))
    const name = await screen.findByLabelText('Nome')
    fireEvent.change(name, { target: { value: 'Renomeado' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(screen.getByTestId('saved-block-sb1').textContent).toContain(
        'Renomeado',
      ),
    )
    expect(bodyOf(spy, '/crm/email-saved-blocks/sb1')[0]).toEqual({
      name: 'Renomeado',
      category: 'Cabeçalhos',
    })

    fireEvent.click(screen.getByLabelText('Ações de Renomeado'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Excluir' }))
    fireEvent.click(await screen.findByTestId('saved-block-confirm-delete'))
    await waitFor(() =>
      expect(screen.queryByTestId('saved-block-sb1')).toBeNull(),
    )
    expect(notify.success).toHaveBeenCalledWith('Bloco excluído')
  })

  it('reports a failed save', async () => {
    mockFetch([
      {
        method: 'POST',
        match: '/crm/email-saved-blocks',
        status: 422,
        error: 'Bloco inválido',
      },
      { match: '/crm/email-saved-blocks', data: [] },
    ])
    const { store, doc } = mount()
    tab('Salvos')
    await screen.findByText('Nenhum bloco salvo ainda')
    act(() => store.select(headingOf(doc).id))
    fireEvent.click(screen.getByTestId('saved-block-save'))
    fireEvent.change(await screen.findByLabelText('Nome'), {
      target: { value: 'X' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
  })
})

describe('"Histórico" — template versions', () => {
  it('lists versions, previews the newest and saves a new one', async () => {
    const spy = mockFetch([
      {
        method: 'POST',
        match: '/versions',
        data: version({ id: 'v2', label: 'Nova' }),
      },
      {
        match: '/versions/v1',
        data: { ...version(), document: newsletterDocument() },
      },
      {
        match: '/versions/v2',
        data: { ...version({ id: 'v2' }), document: newsletterDocument() },
      },
      { match: '/versions', data: [version()] },
    ])
    const { data } = mount()
    fireEvent.click(screen.getByTestId('version-history-trigger'))
    const row = await screen.findByTestId('version-v1')
    expect(row.textContent).toContain('Antes da revisão')
    expect(row.textContent).toContain('Versão salva')
    expect(row.textContent).toContain('Ana')
    expect(await screen.findByText('Assunto antigo')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Nome da versão (opcional)'), {
      target: { value: 'Nova' },
    })
    fireEvent.click(screen.getByTestId('version-save'))
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Versão salva'),
    )
    expect(data.flushDocument).toHaveBeenCalled()
    expect(data.flushMeta).toHaveBeenCalled()
    expect(bodyOf(spy, '/versions')[0]).toEqual({ label: 'Nova' })
  })

  it('says when nothing changed and stops when the flush fails', async () => {
    mockFetch([
      { method: 'POST', match: '/versions', data: null },
      { match: '/versions', data: [] },
    ])
    const { data } = mount()
    fireEvent.click(screen.getByTestId('version-history-trigger'))
    expect(await screen.findByText(/Nenhuma versão ainda/)).toBeTruthy()
    fireEvent.click(screen.getByTestId('version-save'))
    await waitFor(() =>
      expect(notify.info).toHaveBeenCalledWith(
        'Nada mudou desde a última versão',
      ),
    )
    vi.mocked(data.flushDocument).mockResolvedValueOnce(false)
    fireEvent.click(screen.getByTestId('version-save'))
    await waitFor(() => expect(data.flushDocument).toHaveBeenCalledTimes(2))
    expect(notify.info).toHaveBeenCalledTimes(1)
  })

  it('restores a version after confirmation', async () => {
    const restoredTemplate = template({ subject: 'Assunto antigo' })
    mockFetch([
      {
        method: 'POST',
        match: '/versions/v1/restore',
        data: {
          template: restoredTemplate,
          version: version({ id: 'v3', reason: 'RESTORE' }),
        },
      },
      {
        match: '/versions/v1',
        data: { ...version(), document: newsletterDocument() },
      },
      {
        match: '/versions/v3',
        data: { ...version({ id: 'v3' }), document: newsletterDocument() },
      },
      { match: '/versions', data: [version()] },
    ])
    const { data } = mount()
    fireEvent.click(screen.getByTestId('version-history-trigger'))
    await screen.findByText('Assunto antigo')
    const restore = screen.getByTestId('version-restore') as HTMLButtonElement
    await waitFor(() => expect(restore.disabled).toBe(false))
    fireEvent.click(restore)
    fireEvent.click(await screen.findByTestId('version-confirm-restore'))
    await waitFor(() =>
      expect(data.applyTemplate).toHaveBeenCalledWith(restoredTemplate),
    )
    expect(notify.success).toHaveBeenCalledWith(
      'Versão restaurada — a anterior continua no histórico',
    )
  })
})

describe('AI on blocks', () => {
  it('rewrites the selected heading with the AI (one undo step)', async () => {
    const spy = mockFetch([
      {
        method: 'POST',
        match: '/crm/email-ai/rewrite',
        data: { value: 'Título mais curto' },
      },
    ])
    const { store, doc } = mount()
    const heading = headingOf(doc)
    act(() => store.select(heading.id))
    const control = await screen.findByTestId('ai-text-control')
    fireEvent.click(within(control).getByTestId('ai-rewrite'))
    fireEvent.click(await screen.findByTestId('ai-rewrite-shorter'))
    await waitFor(() =>
      expect(getNode(store.getState().doc, heading.id)?.props.text).toBe(
        'Título mais curto',
      ),
    )
    expect(bodyOf(spy, '/crm/email-ai/rewrite')[0]).toMatchObject({
      blockType: 'email.heading',
      mode: 'shorter',
      text: heading.props.text,
      subject: 'Novidades',
    })
    act(() => store.undo())
    expect(getNode(store.getState().doc, heading.id)?.props.text).toBe(
      heading.props.text,
    )
  })

  it('writes from a request and reports provider failures', async () => {
    mockFetch([
      {
        method: 'POST',
        match: '/crm/email-ai/rewrite',
        status: 502,
        error: 'A IA não conseguiu responder agora',
      },
    ])
    const { store, doc } = mount()
    act(() => store.select(headingOf(doc).id))
    fireEvent.click(await screen.findByTestId('ai-write'))
    fireEvent.change(await screen.findByLabelText(/O que escrever/), {
      target: { value: 'Convite para o webinar' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Escrever' }))
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
  })

  it('generates a section and inserts it', async () => {
    const spy = mockFetch([
      {
        method: 'POST',
        match: '/crm/email-ai/section',
        data: {
          reply: 'Montei a seção.',
          fragment: {
            rootId: 'gs',
            nodes: {
              gs: {
                id: 'gs',
                type: 'email.section',
                props: {
                  background: { kind: 'none' },
                  padding: { top: 16, right: 40, bottom: 16, left: 40 },
                  radius: 0,
                  visibility: { base: true, tablet: true, mobile: true },
                },
                children: ['gc'],
              },
              gc: {
                id: 'gc',
                type: 'email.column',
                props: {
                  width: null,
                  verticalAlign: 'top',
                  padding: { top: 0, right: 0, bottom: 0, left: 0 },
                  stackOnMobile: true,
                },
                children: ['gh'],
              },
              gh: {
                ...HEADING_FRAGMENT.nodes.sh,
                id: 'gh',
                props: { ...HEADING_FRAGMENT.nodes.sh.props, text: 'Gerado' },
              },
            },
          },
        },
      },
    ])
    const { store } = mount()
    tab('IA')
    const generate = screen.getByTestId(
      'ai-section-generate',
    ) as HTMLButtonElement
    expect(generate.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('O que a seção deve ter?'), {
      target: { value: 'Três benefícios' },
    })
    fireEvent.click(generate)
    expect(await screen.findByText('Montei a seção.')).toBeTruthy()
    expect(bodyOf(spy, '/crm/email-ai/section')[0]).toEqual({
      prompt: 'Três benefícios',
      subject: 'Novidades',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Inserir no e-mail' }))
    const doc = store.getState().doc
    const inserted = Object.values(doc.nodes).find(
      (node) => node.props.text === 'Gerado',
    )
    expect(inserted).toBeTruthy()
    // Sections never land after the footer.
    const rootChildren = doc.nodes[doc.rootId].children ?? []
    expect(doc.nodes[rootChildren.at(-1) as string].type).toBe('email.footer')
  })
})

describe('"Mostrar se" and mobile overrides', () => {
  it('adds a condition to a block and badges it on the canvas', async () => {
    mockFetch([])
    const { store, doc } = mount()
    const heading = headingOf(doc)
    act(() => store.select(heading.id))
    fireEvent.click(await screen.findByRole('tab', { name: 'Avançado' }))
    fireEvent.click(await screen.findByTestId('condition-add'))
    const editor = await screen.findByTestId('condition-editor')
    fireEvent.change(within(editor).getByLabelText('Valor da condição'), {
      target: { value: 'Campinas' },
    })
    expect(getNode(store.getState().doc, heading.id)?.props.showIf).toEqual({
      kind: 'field',
      field: 'cidade',
      op: 'equals',
      value: 'Campinas',
    })
    expect(editor.textContent).toContain('cidade é igual a “Campinas”')
    const frame = screen.getByTestId('canvas-frame') as HTMLIFrameElement
    await waitFor(() =>
      expect(
        frame.contentDocument
          ?.querySelector(`[data-canvas-id="${heading.id}"]`)
          ?.getAttribute('data-ec-cond'),
      ).toBe('Mostrar se: Cidade é igual a “Campinas”'),
    )
    fireEvent.click(within(editor).getByLabelText('Remover condição'))
    expect(
      getNode(store.getState().doc, heading.id)?.props.showIf,
    ).toBeUndefined()
  })

  it('shows a block only to a mailing list', async () => {
    mockFetch([
      {
        match: '/crm/mailing-lists',
        data: [{ id: 'l1', name: 'Clientes VIP', memberCount: 3 }],
      },
    ])
    const { store, doc } = mount()
    const heading = headingOf(doc)
    act(() => store.select(heading.id))
    fireEvent.click(await screen.findByRole('tab', { name: 'Avançado' }))
    fireEvent.click(await screen.findByTestId('condition-add'))
    await choose('Tipo de condição', 'Lista de e-mail')
    await choose('Lista de e-mail', 'Clientes VIP')
    expect(getNode(store.getState().doc, heading.id)?.props.showIf).toEqual({
      kind: 'list',
      op: 'in',
      listId: 'l1',
    })
    await choose('Comparação', 'não está na lista')
    expect(getNode(store.getState().doc, heading.id)?.props.showIf).toEqual({
      kind: 'list',
      op: 'not_in',
      listId: 'l1',
    })
    await choose('Tipo de condição', 'Dado do contato')
    await choose('Dado do contato', 'Empresa')
    await choose('Comparação', 'está vazio')
    expect(getNode(store.getState().doc, heading.id)?.props.showIf).toEqual({
      kind: 'field',
      field: 'empresa',
      op: 'empty',
      value: '',
    })
    expect(screen.queryByLabelText('Valor da condição')).toBeNull()
  })

  it('says when the CRM has no mailing list', async () => {
    mockFetch([{ match: '/crm/mailing-lists', data: [] }])
    const { store, doc } = mount()
    act(() => store.select(headingOf(doc).id))
    fireEvent.click(await screen.findByRole('tab', { name: 'Avançado' }))
    fireEvent.click(await screen.findByTestId('condition-add'))
    await choose('Tipo de condição', 'Lista de e-mail')
    expect(
      await screen.findByText(/Nenhuma lista de e-mail no CRM/),
    ).toBeTruthy()
  })

  it('edits phone-only visibility, padding and font size', async () => {
    mockFetch([])
    const { store, doc } = mount()
    const heading = headingOf(doc)
    act(() => store.select(heading.id))
    fireEvent.click(await screen.findByRole('tab', { name: 'Avançado' }))
    fireEvent.click(
      within(await screen.findByTestId('canvas-inspector-body')).getByRole(
        'button',
        { name: 'Celular' },
      ),
    )

    const visibility = await screen.findByTestId('mobile-visibility')
    fireEvent.click(
      within(visibility).getByRole('switch', { name: 'Mostrar no celular' }),
    )
    expect(
      getNode(store.getState().doc, heading.id)?.props.visibility,
    ).toMatchObject({ base: true, mobile: false })

    const padding = screen.getByTestId('mobile-padding')
    fireEvent.click(
      within(padding).getByRole('switch', {
        name: 'Margem própria no celular',
      }),
    )
    const stored = getNode(store.getState().doc, heading.id)?.props.padding as {
      base: unknown
      mobile: unknown
    }
    expect(stored.mobile).toEqual(stored.base)

    const fontSize = screen.getByLabelText('Tamanho da fonte no celular')
    fireEvent.change(fontSize, { target: { value: '18' } })
    fireEvent.blur(fontSize)
    await waitFor(() =>
      expect(
        getNode(store.getState().doc, heading.id)?.props.typography,
      ).toMatchObject({ mobile: { fontSize: 18 } }),
    )
  })
})
