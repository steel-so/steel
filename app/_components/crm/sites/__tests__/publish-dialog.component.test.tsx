import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockFetch } from '@/src/__tests__/component-utils'
import type { SiteChangesDTO } from '@/types/site-studio'
import { PublishDialog, siteWideChanges } from '../publish-dialog'
import { fakeGlobal, fakeSite, renderInEditor, SITE_ID } from './harness'

const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))

const BASE = `/crm/sites/${SITE_ID}`

const CHANGES: SiteChangesDTO = {
  firstPublish: false,
  publishedAt: '2026-10-01T12:00:00.000Z',
  pages: [
    { id: 'home', name: 'Início', change: 'changed' },
    { id: 'blog', name: 'Blog', change: 'added' },
    { id: 'old', name: 'Promoção', change: 'removed' },
  ],
  globals: [{ id: 'g_footer', name: 'Rodapé', change: 'changed' }],
  structure: false,
  theme: true,
  settings: false,
  total: 5,
}

function routes(
  changes: SiteChangesDTO = CHANGES,
  publish: { status: number; body: unknown } = {
    status: 200,
    body: {
      success: true,
      data: {
        site: fakeSite({ status: 'PUBLISHED' }),
        version: { id: 'v3', number: 3, isLive: true },
      },
    },
  },
) {
  return mockFetch([
    { match: `${BASE}/changes`, data: changes },
    {
      method: 'POST',
      match: `${BASE}/publish`,
      handler: () => Response.json(publish.body, { status: publish.status }),
    },
  ])
}

beforeEach(() => vi.clearAllMocks())

describe('siteWideChanges', () => {
  it('describes structure, theme and settings', () => {
    expect(
      siteWideChanges({
        ...CHANGES,
        structure: true,
        theme: true,
        settings: true,
      }),
    ).toEqual([
      'Ordem ou hierarquia das páginas',
      'Tema (cores, fontes, botões ou espaçamentos)',
      'Nome, SEO ou configurações do site',
    ])
  })
})

describe('<PublishDialog />', () => {
  it('saves first, lists the changes and publishes', async () => {
    routes()
    const { ctx, save } = renderInEditor(
      <PublishDialog open onOpenChange={() => {}} />,
    )
    const dialog = await screen.findByTestId('publish-dialog')
    await within(dialog).findByText('Blog')
    expect(save).toHaveBeenCalled()
    expect(ctx.flushTheme).toHaveBeenCalled()
    for (const [name, label] of [
      ['Início', 'Alterada'],
      ['Blog', 'Nova'],
      ['Promoção', 'Removida'],
      ['Rodapé', 'Alterada'],
    ]) {
      const item = within(dialog).getByText(name).closest('li') as HTMLElement
      expect(item.textContent).toContain(label)
    }
    expect(
      within(dialog).getByText('Tema (cores, fontes, botões ou espaçamentos)'),
    ).toBeTruthy()

    fireEvent.click(within(dialog).getByTestId('publish-confirm'))
    await within(dialog).findByText('Seu site está no ar')
    expect(ctx.setSite).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PUBLISHED' }),
    )
    expect(within(dialog).getByText(/Versão 3 publicada/)).toBeTruthy()
    expect(
      (within(dialog).getByLabelText('Endereço do site') as HTMLInputElement)
        .value,
    ).toBe('https://clinica.sites.example.com')
  })

  it('announces the first publish with the address', async () => {
    routes({ ...CHANGES, firstPublish: true, publishedAt: null })
    renderInEditor(<PublishDialog open onOpenChange={() => {}} />)
    expect(
      await screen.findByText(
        'Primeira publicação: o site vai ao ar em https://clinica.sites.example.com.',
      ),
    ).toBeTruthy()
    expect(screen.getByText('Páginas que entram no ar')).toBeTruthy()
  })

  it('has nothing to publish when the draft equals the live site', async () => {
    routes({
      ...CHANGES,
      pages: [],
      globals: [],
      theme: false,
      total: 0,
    })
    renderInEditor(<PublishDialog open onOpenChange={() => {}} />)
    await screen.findByText(/já está igual ao rascunho/)
    expect(
      (screen.getByTestId('publish-confirm') as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeTruthy()
  })

  it('lists invalid pages and globals and opens them', async () => {
    routes(CHANGES, {
      status: 422,
      body: {
        success: false,
        message: 'Corrija as páginas com problemas antes de publicar',
        error: {
          code: 'SITE_DOCUMENT_INVALID',
          details: [
            { id: 'home', name: 'Início', problems: ['Título vazio'] },
            { id: 'g_header', name: 'Cabeçalho', problems: ['Menu inválido'] },
          ],
        },
      },
    })
    const onOpenChange = vi.fn()
    const { ctx } = renderInEditor(
      <PublishDialog open onOpenChange={onOpenChange} />,
      { globals: [fakeGlobal('HEADER')] },
    )
    fireEvent.click(await screen.findByTestId('publish-confirm'))
    await screen.findByText('Título vazio')
    const header = screen.getByText('Cabeçalho').closest('li') as HTMLElement
    fireEvent.click(within(header).getByRole('button', { name: 'Abrir' }))
    await waitFor(() =>
      expect(ctx.open).toHaveBeenCalledWith({ kind: 'global', id: 'g_header' }),
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('goes back to the summary when publishing fails', async () => {
    routes(CHANGES, {
      status: 503,
      body: { success: false, message: 'Fora do ar', error: { code: 'X' } },
    })
    renderInEditor(<PublishDialog open onOpenChange={() => {}} />)
    fireEvent.click(await screen.findByTestId('publish-confirm'))
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
    expect(screen.getByText('Blog')).toBeTruthy()
  })

  it('stops when the pending edits cannot be saved', async () => {
    const spy = routes()
    renderInEditor(
      <PublishDialog open onOpenChange={() => {}} />,
      {},
      { save: async () => false },
    )
    expect(
      await screen.findByText(/Não foi possível salvar as últimas alterações/),
    ).toBeTruthy()
    expect(spy).not.toHaveBeenCalled()
  })
})
