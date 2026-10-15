import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mockFetch, renderWithQuery } from '@/src/__tests__/component-utils'
import { CrmEmailTemplatesTable } from '../crm-email-templates-table'

const WS = 'ws_1'

const push = vi.hoisted(() => vi.fn())
const opened = vi.hoisted(() => ({ results: [] as unknown[] }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/src/hooks/use-crm-workspace-lookups', () => ({
  useCrmWorkspaceLookups: () => ({ lookups: undefined }),
}))
vi.mock('@/app/_components/crm/table/data-table', () => ({
  DataTable: (props: {
    data: { id: string; name: string; kind: string }[]
    onOpenRecord?: (record: unknown) => unknown
  }) => (
    <ul>
      {props.data.map((r) => (
        <li key={r.id} data-kind={r.kind}>
          <button
            type='button'
            onClick={() => opened.results.push(props.onOpenRecord?.(r))}
          >
            {r.name}
          </button>
        </li>
      ))}
    </ul>
  ),
}))

function setup() {
  mockFetch([
    {
      match: '/crm/email-templates',
      data: [
        {
          id: 't1',
          name: 'Newsletter visual',
          kind: 'BUILDER',
          builderDocument: { version: 1, layout: 'newsletter', sections: [] },
        },
        { id: 't2', name: 'HTML antigo', kind: 'LEGACY' },
        {
          id: 't3',
          name: 'Promoção arrastar e soltar',
          kind: 'BUILDER',
          builderDocument: {
            catalog: 'email',
            version: 2,
            rootId: 'root',
            nodes: {},
          },
        },
      ],
    },
  ])
  renderWithQuery(<CrmEmailTemplatesTable workspaceId={WS} slug='acme' />)
}

describe('<CrmEmailTemplatesTable />', () => {
  it('links "Novo template" to the starter gallery', async () => {
    setup()
    await screen.findByText('Newsletter visual')
    expect(
      screen
        .getByText(/novo template/i)
        .closest('a')
        ?.getAttribute('href'),
    ).toBe('/acme/crm/email-templates/new')
  })

  it('opens builder templates in the visual editor', async () => {
    setup()
    fireEvent.click(await screen.findByText('Newsletter visual'))
    expect(push).toHaveBeenCalledWith('/acme/crm/email-templates/t1')
  })

  it('marks drag-and-drop (v2) templates with the "Novo editor" kind', async () => {
    setup()
    const v2 = await screen.findByText('Promoção arrastar e soltar')
    expect(v2.closest('li')?.dataset.kind).toBe('CANVAS')
    expect(
      screen.getByText('Newsletter visual').closest('li')?.dataset.kind,
    ).toBe('BUILDER')
    push.mockClear()
    fireEvent.click(v2)
    expect(push).toHaveBeenCalledWith('/acme/crm/email-templates/t3')
  })

  it('keeps the default record panel for free-HTML templates', async () => {
    setup()
    push.mockClear()
    opened.results = []
    fireEvent.click(await screen.findByText('HTML antigo'))
    expect(push).not.toHaveBeenCalled()
    expect(opened.results).toEqual([false])
  })
})
