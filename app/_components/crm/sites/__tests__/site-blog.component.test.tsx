import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { SiteGlobalDTO } from '@/types/site'
import type { SitePostDTO, SitePostSummaryDTO } from '@/types/site-blog'
import { BlogPanel } from '../blog/blog-panel'
import { CollectionsPanel } from '../blog/collections-panel'
import { PostEditor } from '../blog/post-editor'
import { fakeSite, renderInEditor, SITE_ID, WS } from './harness'

const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))
vi.mock('@/app/_components/workspace/workspace-permissions', () => ({
  useCan: () => true,
  useIsPrivileged: () => true,
}))
// The Plate editor is covered by the knowledge base tests; here the body is
// a plain field so the editor screen logic can be driven.
vi.mock('../blog/post-body-editor', () => ({
  PostBodyEditor: ({
    header,
    onChange,
  }: {
    header: ReactNode
    onChange: (value: unknown) => void
  }) => (
    <div>
      {header}
      <textarea
        aria-label='Corpo do post'
        onChange={(event) =>
          onChange([{ type: 'p', children: [{ text: event.target.value }] }])
        }
      />
    </div>
  ),
}))

const BLOG = `/crm/sites/${SITE_ID}/blog`

function summary(
  overrides: Partial<SitePostSummaryDTO> = {},
): SitePostSummaryDTO {
  return {
    id: 'p1',
    siteId: SITE_ID,
    title: 'Primeiro post',
    slug: 'primeiro-post',
    excerpt: null,
    coverImageUrl: null,
    status: 'PUBLISHED',
    featured: true,
    publishedAt: '2026-10-15T12:00:00.000Z',
    readingMinutes: 3,
    author: null,
    categories: [],
    tags: [],
    path: '/blog/primeiro-post',
    createdAt: '2026-10-10T12:00:00.000Z',
    updatedAt: '2026-10-15T12:00:00.000Z',
    ...overrides,
  }
}

function fullPost(overrides: Partial<SitePostDTO> = {}): SitePostDTO {
  return {
    ...summary({ status: 'DRAFT', publishedAt: null, featured: false }),
    content: [{ type: 'p', children: [{ text: 'Olá' }] }],
    coverImageAlt: null,
    wordCount: 1,
    seo: {},
    createdById: 'u1',
    updatedById: null,
    ...overrides,
  }
}

function template(name: string): SiteGlobalDTO {
  return {
    id: `g-${name}`,
    siteId: SITE_ID,
    kind: 'TEMPLATE',
    name,
    document: { catalog: 'site', version: 1, rootId: 'root', nodes: {} },
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('<BlogPanel />', () => {
  function routes(
    items: SitePostSummaryDTO[] = [
      summary(),
      summary({
        id: 'p2',
        title: 'Ideias',
        status: 'DRAFT',
        featured: false,
        publishedAt: null,
      }),
    ],
  ) {
    return mockFetch([
      {
        match: `${BLOG}/posts?`,
        data: { items, total: items.length + 1, page: 1, pageSize: 50 },
      },
      { method: 'POST', match: `${BLOG}/posts/bulk`, data: { affected: 2 } },
      {
        method: 'POST',
        match: `${BLOG}/posts`,
        status: 201,
        data: fullPost({ id: 'novo' }),
      },
      {
        method: 'POST',
        match: `${BLOG}/templates`,
        data: ['blog-index', 'blog-post'].map(template),
      },
      { match: `${BLOG}/categories`, data: [] },
      { match: `${BLOG}/tags`, data: [] },
      { match: `${BLOG}/authors`, data: [] },
    ])
  }

  it('lists posts with status and featured mark', async () => {
    routes()
    renderInEditor(<BlogPanel />)
    expect(await screen.findByText('Primeiro post')).toBeTruthy()
    expect(screen.getByText('Ideias')).toBeTruthy()
    expect(screen.getByLabelText('Em destaque')).toBeTruthy()
    expect(screen.getByText(/Mostrando 2 de 3/)).toBeTruthy()
  })

  it('filters by search and status', async () => {
    const spy = routes([])
    renderInEditor(<BlogPanel />)
    expect(await screen.findByText(/Nenhum post ainda/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Buscar posts'), {
      target: { value: 'seo' },
    })
    await waitFor(() =>
      expect(
        spy.mock.calls.some(([url]) => String(url).includes('search=seo')),
      ).toBe(true),
    )
    expect(
      await screen.findByText('Nenhum post com esses filtros.'),
    ).toBeTruthy()
  })

  it('creates a post after saving the canvas and opens its editor', async () => {
    routes()
    const { save } = renderInEditor(<BlogPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Novo post' }))
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(`/acme/crm/sites/${SITE_ID}/blog/novo`),
    )
    expect(save).toHaveBeenCalled()
  })

  it('opens an existing post', async () => {
    routes()
    renderInEditor(<BlogPanel />)
    fireEvent.click(await screen.findByText('Primeiro post'))
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(`/acme/crm/sites/${SITE_ID}/blog/p1`),
    )
  })

  it('runs bulk actions on the selection', async () => {
    const spy = routes()
    renderInEditor(<BlogPanel />)
    await screen.findByText('Primeiro post')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar todos' }))
    const toolbar = screen.getByRole('toolbar', { name: 'Ações em massa' })
    expect(within(toolbar).getByText('2 posts selecionados')).toBeTruthy()
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Publicar' }))
    await waitFor(() =>
      expect(fetchBody(spy, `${BLOG}/posts/bulk`)).toEqual({
        ids: ['p1', 'p2'],
        action: 'publish',
      }),
    )
    expect(notify.success).toHaveBeenCalledWith('2 posts atualizados.')
  })

  it('confirms before a bulk delete', async () => {
    const spy = routes()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderInEditor(<BlogPanel />)
    await screen.findByText('Primeiro post')
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Selecionar Primeiro post' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    expect(confirm).toHaveBeenCalledWith(
      'Excluir o post selecionado? Isso não pode ser desfeito.',
    )
    expect(fetchBody(spy, `${BLOG}/posts/bulk`)).toBeUndefined()
  })

  it('creates the blog templates and opens one in the canvas', async () => {
    routes()
    const { ctx } = renderInEditor(<BlogPanel />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Personalizar páginas do blog' }),
    )
    await waitFor(() => expect(ctx.setGlobals).toHaveBeenCalled())
    const added = vi.mocked(ctx.setGlobals).mock.calls[0][0]
    expect(added.map((global) => global.name)).toEqual([
      'blog-index',
      'blog-post',
    ])
  })

  it('lists existing templates and opens them', async () => {
    routes()
    const { save, ctx } = renderInEditor(<BlogPanel />, {
      globals: [
        'blog-index',
        'blog-post',
        'blog-category',
        'blog-tag',
        'blog-author',
      ].map(template),
    })
    fireEvent.click(screen.getByRole('button', { name: /^Post/ }))
    await waitFor(() =>
      expect(ctx.open).toHaveBeenCalledWith({
        kind: 'global',
        id: 'g-blog-post',
      }),
    )
    expect(save).toHaveBeenCalled()
    expect(screen.queryByText('Recriar páginas que faltam')).toBeNull()
  })

  it('opens the categories/tags and authors dialogs', async () => {
    routes()
    renderInEditor(<BlogPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Categorias e tags' }))
    expect(await screen.findByText('Nenhuma categoria ainda.')).toBeTruthy()
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Autores' }))
    expect(await screen.findByText('Nenhum autor ainda.')).toBeTruthy()
  })
})

describe('<CollectionsPanel />', () => {
  const COLLECTIONS = `/crm/sites/${SITE_ID}/collections`
  const vagas = {
    id: 'col1',
    siteId: SITE_ID,
    name: 'Vagas',
    itemName: 'Vaga',
    slug: 'vagas',
    fields: [],
    templateGlobalId: null,
    itemCount: 3,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
  }

  it('lists collections, creates one and opens the item template', async () => {
    const spy = mockFetch([
      { match: COLLECTIONS, data: [vagas] },
      {
        method: 'POST',
        match: `${COLLECTIONS}/col1/template`,
        data: template('collection:col1'),
      },
      { method: 'POST', match: COLLECTIONS, status: 201, data: vagas },
    ])
    const { ctx } = renderInEditor(<CollectionsPanel />)
    expect(await screen.findByText('Vagas')).toBeTruthy()
    expect(screen.getByText(/3 itens/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Ações de Vagas' }))
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Criar página do item' }),
    )
    await waitFor(() =>
      expect(ctx.open).toHaveBeenCalledWith({
        kind: 'global',
        id: 'g-collection:col1',
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Nova coleção' }))
    fireEvent.change(await screen.findByLabelText('Nome'), {
      target: { value: 'Casos de sucesso' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Criar coleção' }))
    await waitFor(() =>
      expect(fetchBody(spy, /\/collections$/)).toMatchObject({
        name: 'Casos de sucesso',
        slug: 'casos-de-sucesso',
        itemName: 'Item',
        fields: [
          { key: 'resumo', label: 'Resumo', type: 'text' },
          { key: 'imagem', label: 'Imagem', type: 'image' },
        ],
      }),
    )
  })

  it('navigates to the items screen', async () => {
    mockFetch([{ match: COLLECTIONS, data: [vagas] }])
    renderInEditor(<CollectionsPanel />)
    fireEvent.click(await screen.findByText('Vagas'))
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        `/acme/crm/sites/${SITE_ID}/collections/col1`,
      ),
    )
  })
})

describe('<PostEditor />', () => {
  function routes(post: SitePostDTO = fullPost()) {
    return mockFetch([
      { match: `/crm/sites/${SITE_ID}/blog/posts/p1`, data: post },
      {
        method: 'PATCH',
        match: `/crm/sites/${SITE_ID}/blog/posts/p1`,
        handler: (_url, init) => {
          const body = JSON.parse(String(init?.body))
          return {
            ...post,
            ...body,
            status: body.status ?? post.status,
            publishedAt:
              body.status === 'PUBLISHED'
                ? '2026-10-15T12:00:00.000Z'
                : post.publishedAt,
          }
        },
      },
      {
        method: 'POST',
        match: `/crm/sites/${SITE_ID}/blog/ai`,
        data: { action: 'titles', titles: ['Título A', 'Título B'] },
      },
      {
        match: new RegExp(`/crm/sites/${SITE_ID}$`),
        data: fakeSite({ status: 'PUBLISHED' }),
      },
      {
        match: `/crm/sites/${SITE_ID}/blog/categories`,
        data: [
          {
            id: 'c1',
            siteId: SITE_ID,
            name: 'Dicas',
            slug: 'dicas',
            description: null,
            position: 0,
            postCount: 0,
          },
        ],
      },
      {
        match: `/crm/sites/${SITE_ID}/blog/tags`,
        data: [
          { id: 't1', siteId: SITE_ID, name: 'seo', slug: 'seo', postCount: 0 },
        ],
      },
      { match: `/crm/sites/${SITE_ID}/blog/authors`, data: [] },
    ])
  }

  function render() {
    return renderWithQuery(
      <PostEditor
        workspaceId={WS}
        slug='acme'
        siteId={SITE_ID}
        postId='p1'
        userId='u1'
        userName='Ana'
      />,
    )
  }

  it('edits the title, categories, tags and FAQ, then publishes now', async () => {
    const spy = routes()
    render()
    const title = await screen.findByLabelText('Título do post')
    fireEvent.change(title, { target: { value: 'Título novo' } })
    expect(screen.getByText('Não salvo')).toBeTruthy()
    const settings = screen.getByRole('complementary', {
      name: 'Ajustes do post',
    })
    fireEvent.click(within(settings).getByRole('checkbox', { name: 'Dicas' }))
    const tagInput = within(settings).getByLabelText('Adicionar tag')
    fireEvent.change(tagInput, { target: { value: 'seo' } })
    fireEvent.keyDown(tagInput, { key: 'Enter' })
    fireEvent.change(tagInput, { target: { value: 'Nova Tag' } })
    fireEvent.keyDown(tagInput, { key: 'Enter' })
    fireEvent.click(within(settings).getByRole('button', { name: 'Pergunta' }))
    fireEvent.change(within(settings).getByLabelText('Pergunta 1'), {
      target: { value: 'Quanto custa?' },
    })
    fireEvent.change(within(settings).getByLabelText('Resposta 1'), {
      target: { value: 'Depende do plano.' },
    })
    fireEvent.click(
      within(settings).getByRole('button', { name: 'Salvar perguntas' }),
    )
    fireEvent.change(screen.getByLabelText('Corpo do post'), {
      target: { value: 'Texto' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Publicar' }))
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Publicar agora' }),
    )
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Post publicado.'),
    )
    const body = fetchBody(spy, '/blog/posts/p1', 'PATCH')
    expect(body).toMatchObject({
      title: 'Título novo',
      status: 'PUBLISHED',
      publishedAt: null,
      categoryIds: ['c1'],
      tagIds: ['t1'],
      newTags: ['Nova Tag'],
      content: [{ type: 'p', children: [{ text: 'Texto' }] }],
      seo: {
        search: {
          questions: [
            { question: 'Quanto custa?', answer: 'Depende do plano.' },
          ],
        },
      },
    })
    expect(screen.queryByText('Não salvo')).toBeNull()
  })

  it('saves with Ctrl+S and applies AI title suggestions', async () => {
    const spy = routes()
    render()
    await screen.findByLabelText('Título do post')
    fireEvent.click(screen.getByRole('button', { name: 'IA' }))
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Sugerir títulos' }),
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Título B' }))
    expect(
      (screen.getByLabelText('Título do post') as HTMLTextAreaElement).value,
    ).toBe('Título B')
    expect(fetchBody(spy, '/blog/ai')).toMatchObject({
      action: 'titles',
      text: 'Olá',
    })
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Post salvo.'),
    )
    expect(fetchBody(spy, '/blog/posts/p1', 'PATCH')).toMatchObject({
      title: 'Título B',
    })
  })

  it('offers update or back to draft on a published post, with a link to the site', async () => {
    routes(
      fullPost({
        status: 'PUBLISHED',
        publishedAt: '2026-10-01T12:00:00.000Z',
      }),
    )
    render()
    expect(
      (await screen.findByLabelText('Ver no site')).getAttribute(
        'href',
      ),
    ).toBe('https://clinica.sites.example.com/blog/primeiro-post')
    fireEvent.click(screen.getByRole('button', { name: 'Publicado' }))
    expect(
      await screen.findByRole('menuitem', { name: 'Voltar para rascunho' }),
    ).toBeTruthy()
  })

  it('shows a message when the post is gone', async () => {
    mockFetch([
      { match: '/blog/posts/p1', status: 404, error: 'Post não encontrado' },
    ])
    render()
    expect(
      await screen.findByText(
        'Este post não existe mais ou você não tem acesso a ele.',
      ),
    ).toBeTruthy()
  })
})
