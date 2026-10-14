import { fireEvent, screen, within } from '@testing-library/react'
import type { Value } from 'platejs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/src/__tests__/helpers/component'
import type { WikiLabelDTO } from '@/types/wiki-label'
import type { WikiPageDTO } from '@/types/wiki-page'
import type { WikiPanelTab } from '../use-wiki-preferences'
import {
  pageOutline,
  pageResources,
  pageStats,
  readingTimeLabel,
  scrollToBlock,
} from '../wiki-page-content'
import { WikiSidePanel, type WikiSidePanelProps } from '../wiki-side-panel'

const VALUE: Value = [
  { type: 'h1', id: 'h-1', children: [{ text: 'Introdução' }] },
  {
    type: 'p',
    id: 'p-1',
    children: [{ text: 'Um texto ' }, { text: 'com marcas', bold: true }],
  },
  { type: 'h2', id: 'h-2', children: [{ text: 'Fluxo' }] },
  { type: 'h3', id: 'h-3', children: [{ text: 'Prazos' }] },
  { type: 'h2', id: 'h-empty', children: [{ text: '   ' }] },
  {
    type: 'img',
    id: 'img-1',
    url: 'https://cdn.test/media/diagrama%20final.png?x=1',
    children: [{ text: '' }],
  },
  {
    type: 'file',
    id: 'file-1',
    url: '/media/a.pdf',
    name: 'procedimento.pdf',
    children: [{ text: '' }],
  },
  { type: 'video', id: 'vid-1', url: '', children: [{ text: '' }] },
  {
    type: 'table',
    id: 't-1',
    children: [
      {
        type: 'tr',
        children: [
          {
            type: 'td',
            children: [{ type: 'p', children: [{ text: 'célula um' }] }],
          },
        ],
      },
    ],
  },
  { type: 'p', id: 'p-empty', children: [{ text: '' }] },
]

const LABELS: WikiLabelDTO[] = [
  {
    id: 'l-1',
    workspaceId: 'ws-1',
    name: 'Processo',
    color: 'blue',
    pageCount: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as WikiLabelDTO,
  {
    id: 'l-2',
    workspaceId: 'ws-1',
    name: 'Outra',
    color: 'red',
    pageCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as WikiLabelDTO,
]

function buildPage(overrides: Partial<WikiPageDTO> = {}): WikiPageDTO {
  return {
    id: 'page-1',
    workspaceId: 'ws-1',
    parentId: null,
    title: 'Manual',
    icon: null,
    coverImage: null,
    content: VALUE,
    position: 0,
    labelIds: ['l-1'],
    createdById: 'user-1',
    updatedById: 'user-2',
    archivedAt: null,
    createdAt: '2026-10-10T12:00:00.000Z',
    updatedAt: '2026-10-14T11:00:00.000Z',
    publishedAt: null,
    publicToken: null,
    lockedAt: null,
    lockedById: null,
    canManageLock: true,
    isFavorite: false,
    createdBy: { id: 'user-1', name: 'Ana Souza', image: null },
    updatedBy: { id: 'user-2', name: 'Bruno', image: 'https://cdn.test/b.png' },
    ...overrides,
  }
}

function renderPanel(props: Partial<WikiSidePanelProps> = {}) {
  const onTabChange = vi.fn()
  const onOpenChange = vi.fn()
  function Harness({ tab = 'outline' }: { tab?: WikiPanelTab }) {
    return (
      <WikiSidePanel
        open
        onOpenChange={onOpenChange}
        tab={tab}
        onTabChange={onTabChange}
        value={VALUE}
        page={buildPage()}
        labels={LABELS}
        scroller={null}
        {...props}
      />
    )
  }
  const utils = renderWithProviders(<Harness tab={props.tab} />)
  return { ...utils, onTabChange, onOpenChange }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-10-14T12:00:00.000Z'))
})

const appended: HTMLElement[] = []

/** A rendered block the panel can scroll to. */
function addBlock(id: string) {
  const target = document.createElement('div')
  target.dataset.blockId = id
  target.scrollIntoView = vi.fn()
  document.body.append(target)
  appended.push(target)
  return target
}

afterEach(() => {
  vi.useRealTimers()
  for (const element of appended.splice(0)) element.remove()
})

describe('wiki page content readers', () => {
  it('counts words, characters and non-empty paragraphs', () => {
    expect(pageStats(VALUE)).toEqual({
      // Introdução + Um texto com marcas + Fluxo + Prazos + célula um
      words: 9,
      characters: 'IntroduçãoUm texto com marcasFluxoPrazos   célula um'.length,
      paragraphs: 2,
      readingMinutes: 1,
    })
  })

  it('reads an empty page as no reading time', () => {
    const stats = pageStats([{ type: 'p', children: [{ text: '' }] }])
    expect(stats).toEqual({
      words: 0,
      characters: 0,
      paragraphs: 0,
      readingMinutes: 0,
    })
    expect(readingTimeLabel(0)).toBe('Sem texto para ler')
  })

  it('rounds the reading time up at 200 words a minute', () => {
    const words = Array.from({ length: 401 }, () => 'palavra').join(' ')
    expect(
      pageStats([{ type: 'p', children: [{ text: words }] }]).readingMinutes,
    ).toBe(3)
    expect(readingTimeLabel(3)).toBe('3 min de leitura')
  })

  it('lists headings with their level, skipping empty ones', () => {
    expect(pageOutline(VALUE)).toEqual([
      { id: 'h-1', level: 1, text: 'Introdução' },
      { id: 'h-2', level: 2, text: 'Fluxo' },
      { id: 'h-3', level: 3, text: 'Prazos' },
    ])
  })

  it('lists images and files that have a url', () => {
    expect(pageResources(VALUE)).toEqual([
      {
        id: 'img-1',
        kind: 'image',
        url: 'https://cdn.test/media/diagrama%20final.png?x=1',
        name: 'diagrama final.png',
      },
      {
        id: 'file-1',
        kind: 'file',
        url: '/media/a.pdf',
        name: 'procedimento.pdf',
      },
    ])
  })

  it('keeps a file name that is not valid URI encoding', () => {
    expect(
      pageResources([
        {
          type: 'audio',
          id: 'a',
          url: '/m/%E0%A4%A.mp3',
          children: [{ text: '' }],
        },
      ])[0]?.name,
    ).toBe('%E0%A4%A.mp3')
  })

  it('scrolls to a block by its id', () => {
    const target = addBlock('h-2')

    expect(scrollToBlock('h-2')).toBe(true)
    expect(target.scrollIntoView).toHaveBeenCalled()
    expect(scrollToBlock('missing')).toBe(false)
  })
})

describe('<WikiSidePanel /> structure tab', () => {
  it('indents headings by level and scrolls to the clicked one', () => {
    const target = addBlock('h-3')
    renderPanel()

    const nav = screen.getByRole('navigation', { name: 'Estrutura da página' })
    const buttons = within(nav).getAllByRole('button')
    expect(buttons.map((b) => [b.textContent, b.style.paddingLeft])).toEqual([
      ['Introdução', '8px'],
      ['Fluxo', '20px'],
      ['Prazos', '32px'],
    ])
    fireEvent.click(within(nav).getByRole('button', { name: 'Prazos' }))
    expect(target.scrollIntoView).toHaveBeenCalled()
  })

  it('highlights the heading being read in the scroller', () => {
    const scroller = document.createElement('div')
    const headings = ['h-1', 'h-2', 'h-3'].map((id, index) => {
      const element = document.createElement('div')
      element.dataset.blockId = id
      element.getBoundingClientRect = () =>
        ({ top: index * 300 - 250 }) as DOMRect
      scroller.append(element)
      return element
    })
    scroller.getBoundingClientRect = () => ({ top: 0 }) as DOMRect
    document.body.append(scroller)
    appended.push(scroller)
    renderPanel({ scroller })

    expect(
      screen
        .getByRole('button', { name: 'Fluxo' })
        .getAttribute('aria-current'),
    ).toBe('location')

    headings[2].getBoundingClientRect = () => ({ top: 10 }) as DOMRect
    fireEvent.scroll(scroller)
    expect(
      screen
        .getByRole('button', { name: 'Prazos' })
        .getAttribute('aria-current'),
    ).toBe('location')
  })

  it('explains the empty outline', () => {
    renderPanel({ value: [{ type: 'p', children: [{ text: 'só texto' }] }] })
    expect(screen.getByText(/Os títulos da página/)).toBeTruthy()
  })

  it('changes tab', () => {
    const { onTabChange } = renderPanel()
    fireEvent.click(screen.getByRole('tab', { name: 'Info' }))
    expect(onTabChange).toHaveBeenCalledWith('info')
  })
})

describe('<WikiSidePanel /> info tab', () => {
  it('shows the numbers, the labels and who created and edited the page', () => {
    renderPanel({ tab: 'info' })

    const stats = screen.getByRole('region', { name: 'Estatísticas' })
    expect(within(stats).getByText('Palavras').nextSibling?.textContent).toBe(
      '9',
    )
    expect(within(stats).getByText('Parágrafos').nextSibling?.textContent).toBe(
      '2',
    )
    expect(within(stats).getByText('1 min de leitura')).toBeTruthy()

    const labels = screen.getByRole('region', { name: 'Etiquetas' })
    expect(within(labels).getByText('Processo')).toBeTruthy()
    expect(within(labels).queryByText('Outra')).toBeNull()

    const edited = screen.getByText('Editado por').parentElement as HTMLElement
    expect(within(edited).getByText('Bruno')).toBeTruthy()
    expect(within(edited).getByText('há cerca de 1 hora')).toBeTruthy()
    const created = screen.getByText('Criado por').parentElement as HTMLElement
    expect(within(created).getByText('Ana Souza')).toBeTruthy()
    expect(within(created).getByText('AS')).toBeTruthy()
    expect(within(created).getByText('há 4 dias')).toBeTruthy()
  })

  it('falls back to the dates while the backend does not send the people', () => {
    renderPanel({
      tab: 'info',
      page: buildPage({
        labelIds: [],
        createdBy: undefined,
        updatedBy: undefined,
      }),
    })

    expect(screen.getByText('Nenhuma etiqueta')).toBeTruthy()
    expect(screen.getByText('há cerca de 1 hora')).toBeTruthy()
    expect(screen.getByText('há 4 dias')).toBeTruthy()
  })
})

describe('<WikiSidePanel /> resources tab', () => {
  it('lists images with a thumbnail and files with their name', () => {
    const target = addBlock('file-1')
    renderPanel({ tab: 'resources' })

    const list = screen.getByRole('list', { name: 'Recursos da página' })
    expect(list.querySelector('img')?.getAttribute('src')).toBe(
      'https://cdn.test/media/diagrama%20final.png?x=1',
    )
    fireEvent.click(within(list).getByRole('button', { name: /procedimento/ }))
    expect(target.scrollIntoView).toHaveBeenCalled()
  })

  it('explains an empty list', () => {
    renderPanel({ tab: 'resources', value: [] })
    expect(screen.getByText(/Imagens e arquivos da página/)).toBeTruthy()
  })
})

describe('<WikiSidePanel /> visibility', () => {
  it('renders nothing on desktop while closed', () => {
    renderPanel({ open: false })
    expect(screen.queryByTestId('wiki-side-panel')).toBeNull()
  })

  it('becomes a sheet on phones and closes after navigating', () => {
    const width = window.innerWidth
    Object.defineProperty(window, 'innerWidth', {
      value: 390,
      configurable: true,
    })
    const target = addBlock('h-1')
    try {
      const { onOpenChange } = renderPanel()
      const dialog = screen.getByRole('dialog')
      expect(within(dialog).getByText('Painel da página')).toBeTruthy()
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Introdução' }),
      )
      expect(onOpenChange).toHaveBeenCalledWith(false)
      expect(target.scrollIntoView).toHaveBeenCalled()
    } finally {
      Object.defineProperty(window, 'innerWidth', {
        value: width,
        configurable: true,
      })
    }
  })
})
