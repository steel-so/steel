import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { NewDocumentDialog } from '../new-document-dialog'
import { BASE, fakeDocument, fakeListItem, SLUG, WS } from './fixtures'

const push = vi.hoisted(() => vi.fn())
const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/lib/notify', () => ({ notify }))
vi.mock('@/app/_components/documents/import/document-import-dialog', () => ({
  DocumentImportDialog: ({
    open,
    initialMode,
  }: {
    open: boolean
    initialMode?: string
  }) => (open ? <div data-testid='import-dialog'>{initialMode}</div> : null),
}))
vi.mock('@/src/lib/canvas-document', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  DOCUMENT_STARTERS: [
    {
      id: 'proposal-modern',
      title: 'Proposta moderna',
      description: 'Capa, escopo, investimento e aceite.',
      kind: 'PROPOSAL',
    },
  ],
}))

function setup(props: Partial<Parameters<typeof NewDocumentDialog>[0]> = {}) {
  const onOpenChange = vi.fn()
  const spy = mockFetch([
    {
      match: `${BASE}?isTemplate=true`,
      data: {
        items: [
          fakeListItem({
            id: 'tpl_1',
            title: 'Proposta padrão',
            isTemplate: true,
          }),
        ],
        total: 1,
        page: 1,
        pageSize: 50,
      },
    },
    {
      method: 'POST',
      match: new RegExp(`${BASE}$`),
      status: 201,
      data: fakeDocument({ id: 'doc_new' }),
    },
  ])
  renderWithQuery(
    <NewDocumentDialog
      workspaceId={WS}
      slug={SLUG}
      open
      onOpenChange={onOpenChange}
      {...props}
    />,
  )
  return { spy, onOpenChange }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('<NewDocumentDialog />', () => {
  it('creates a blank document linked to the record and opens the editor', async () => {
    const { spy, onOpenChange } = setup({
      links: { opportunityId: 'o1', companyId: 'c1' },
      defaultTitle: 'Proposta — Acme',
    })
    const title = (await screen.findByLabelText('Título')) as HTMLInputElement
    expect(title.value).toBe('Proposta — Acme')
    fireEvent.click(screen.getByTestId('new-document-create'))
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/acme/crm/documents/doc_new/edit'),
    )
    expect(fetchBody(spy, new RegExp(`${BASE}$`))).toEqual({
      opportunityId: 'o1',
      companyId: 'c1',
      title: 'Proposta — Acme',
      kind: 'PROPOSAL',
      isTemplate: false,
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('asks for a title', async () => {
    const { spy } = setup()
    fireEvent.click(await screen.findByTestId('new-document-create'))
    expect(notify.error).toHaveBeenCalledWith('Informe o título')
    expect(fetchBody(spy, new RegExp(`${BASE}$`))).toBeUndefined()
  })

  it('starts from a workspace template', async () => {
    const { spy } = setup()
    fireEvent.click(
      await screen.findByRole('tab', { name: 'Modelos do workspace' }),
    )
    fireEvent.click(await screen.findByTestId('document-template-tpl_1'))
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/acme/crm/documents/doc_new/edit'),
    )
    expect(fetchBody(spy, new RegExp(`${BASE}$`))).toMatchObject({
      title: 'Proposta padrão',
      kind: 'PROPOSAL',
      templateId: 'tpl_1',
      isTemplate: false,
    })
  })

  it('starts from a gallery starter', async () => {
    const { spy } = setup()
    fireEvent.click(await screen.findByRole('tab', { name: 'Galeria' }))
    fireEvent.click(
      await screen.findByTestId('document-starter-proposal-modern'),
    )
    await waitFor(() => expect(push).toHaveBeenCalled())
    expect(fetchBody(spy, new RegExp(`${BASE}$`))).toMatchObject({
      title: 'Proposta moderna',
      starterId: 'proposal-modern',
    })
  })

  it('hands PDF import and AI generation to the import dialog', async () => {
    const { onOpenChange } = setup()
    fireEvent.click(await screen.findByTestId('new-document-import-pdf'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect((await screen.findByTestId('import-dialog')).textContent).toBe('PDF')
  })

  it('only asks the title when starting from a template', async () => {
    const { spy } = setup({
      templateId: 'tpl_1',
      defaultTitle: 'Proposta padrão',
      defaultKind: 'CONTRACT',
    })
    expect(
      await screen.findByRole('heading', {
        name: 'Novo documento a partir do modelo',
      }),
    ).toBeTruthy()
    expect(screen.queryByTestId('new-document-import-pdf')).toBeNull()
    fireEvent.click(screen.getByTestId('new-document-create'))
    await waitFor(() => expect(push).toHaveBeenCalled())
    expect(fetchBody(spy, new RegExp(`${BASE}$`))).toMatchObject({
      title: 'Proposta padrão',
      kind: 'CONTRACT',
      templateId: 'tpl_1',
    })
  })
})
