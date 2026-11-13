import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { notify } from '@/lib/notify'
import { filesOf, hasFiles, imageFileProblem } from '../image-file'
import { filterMedia, MediaLibrary } from '../media-library-picker'
import type { MediaItem, MediaProvider } from '../media-types'

vi.mock('@/lib/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

const ITEMS: MediaItem[] = [
  { id: 'praia.png', url: 'https://cdn.test/praia.png', size: 2048 },
  { id: 'a.webp', url: 'https://cdn.test/a.webp', name: 'Logo azul' },
  {
    id: 'old.jpg',
    url: 'https://cdn.test/old.jpg',
    removable: false,
    alt: 'Fachada',
  },
]

function provider(overrides: Partial<MediaProvider> = {}): MediaProvider {
  return {
    key: ['media-test'],
    list: vi.fn(async () => ITEMS),
    upload: vi.fn(async (file: File) => ({
      id: file.name,
      url: `https://cdn.test/${file.name}`,
      size: file.size,
    })),
    remove: vi.fn(async () => undefined),
    ...overrides,
  }
}

function renderLibrary(
  media: MediaProvider,
  props: { onSelect?: (item: MediaItem) => void; canEdit?: boolean } = {},
) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MediaLibrary provider={media} {...props} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('imageFileProblem', () => {
  const file = (type: string, size = 10, name = 'f.png') => ({
    name,
    type,
    size,
  })

  it('accepts JPEG, PNG and WebP up to 5 MB', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(imageFileProblem(file(type))).toBeNull()
    }
    expect(imageFileProblem(file('image/png', 5 * 1024 * 1024))).toBeNull()
  })

  it('names the file and the reason when refused', () => {
    expect(imageFileProblem(file('image/gif', 10, 'a.gif'))).toBe(
      'a.gif: use JPEG, PNG ou WebP.',
    )
    expect(imageFileProblem(file('image/png', 6 * 1024 * 1024))).toContain(
      'o limite é 5 MB',
    )
  })

  it('honors a narrower accept list and ignores the image/* wildcard', () => {
    expect(
      imageFileProblem(file('image/jpeg'), ['image/png']),
    ).not.toBeNull()
    expect(imageFileProblem(file('image/webp'), ['image/*'])).toBeNull()
  })
})

describe('drag data helpers', () => {
  it('detects drags that carry files', () => {
    expect(hasFiles({ types: ['Files'] } as unknown as DataTransfer)).toBe(true)
    expect(hasFiles({ types: ['text/plain'] } as unknown as DataTransfer)).toBe(
      false,
    )
    expect(hasFiles(null)).toBe(false)
  })

  it('lists the files of a drop', () => {
    const file = new File(['x'], 'a.png')
    expect(filesOf({ files: [file] } as unknown as DataTransfer)).toEqual([file])
    expect(filesOf(null)).toEqual([])
  })
})

describe('filterMedia', () => {
  it('matches every word against the name and the alt text', () => {
    expect(filterMedia(ITEMS, '')).toEqual(ITEMS)
    expect(filterMedia(ITEMS, 'logo azul').map((i) => i.id)).toEqual(['a.webp'])
    expect(filterMedia(ITEMS, 'fachada').map((i) => i.id)).toEqual(['old.jpg'])
    expect(filterMedia(ITEMS, 'praia png').map((i) => i.id)).toEqual([
      'praia.png',
    ])
  })
})

describe('MediaLibrary', () => {
  it('lists images and reports the picked one', async () => {
    const onSelect = vi.fn()
    renderLibrary(provider(), { onSelect })
    fireEvent.click(
      await screen.findByRole('button', { name: 'Usar imagem Logo azul' }),
    )
    expect(onSelect).toHaveBeenCalledWith(ITEMS[1])
  })

  it('shows the empty state', async () => {
    renderLibrary(provider({ list: vi.fn(async () => []) }))
    expect(await screen.findByText(/Nenhuma imagem ainda/)).toBeTruthy()
  })

  it('uploads dropped files and puts them first', async () => {
    const media = provider()
    renderLibrary(media)
    const zone = await screen.findByTestId('media-library')
    await screen.findByLabelText('Imagens')
    const file = new File(['x'], 'nova.png', { type: 'image/png' })
    fireEvent.drop(zone, {
      dataTransfer: { types: ['Files'], files: [file] },
    })
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Excluir imagem nova.png' }),
      ).toBeTruthy(),
    )
    expect(media.upload).toHaveBeenCalledWith(file)
  })

  it('ignores drags that are not files', async () => {
    const media = provider()
    renderLibrary(media)
    const zone = await screen.findByTestId('media-library')
    fireEvent.drop(zone, { dataTransfer: { types: ['text/plain'], files: [] } })
    expect(media.upload).not.toHaveBeenCalled()
  })

  it('refuses a dropped file with an unsupported type', async () => {
    const media = provider()
    renderLibrary(media)
    const zone = await screen.findByTestId('media-library')
    fireEvent.drop(zone, {
      dataTransfer: {
        types: ['Files'],
        files: [new File(['x'], 'a.gif', { type: 'image/gif' })],
      },
    })
    expect(notify.error).toHaveBeenCalled()
    expect(media.upload).not.toHaveBeenCalled()
  })

  it('tells the user when an upload fails', async () => {
    const error = new Error('Armazenamento indisponível')
    const media = provider({ upload: vi.fn(async () => Promise.reject(error)) })
    renderLibrary(media)
    const zone = await screen.findByTestId('media-library')
    fireEvent.drop(zone, {
      dataTransfer: {
        types: ['Files'],
        files: [new File(['x'], 'a.png', { type: 'image/png' })],
      },
    })
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        error,
        'Não foi possível enviar a.png',
      ),
    )
  })

  it('confirms before deleting, and only for removable images', async () => {
    const media = provider()
    renderLibrary(media)
    await screen.findByLabelText('Imagens')
    expect(
      screen.queryByRole('button', { name: 'Excluir imagem old.jpg' }),
    ).toBeNull()
    fireEvent.click(
      screen.getByRole('button', { name: 'Excluir imagem praia.png' }),
    )
    expect(media.remove).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }))
    await waitFor(() => expect(media.remove).toHaveBeenCalledWith(ITEMS[0]))
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Usar imagem praia.png' }),
      ).toBeNull(),
    )
    expect(notify.success).toHaveBeenCalledWith('Imagem excluída.')
  })

  it('tells the user when a delete fails and keeps the image', async () => {
    const error = new Error('Sem permissão')
    const media = provider({ remove: vi.fn(async () => Promise.reject(error)) })
    renderLibrary(media)
    await screen.findByLabelText('Imagens')
    fireEvent.click(
      screen.getByRole('button', { name: 'Excluir imagem praia.png' }),
    )
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }))
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        error,
        'Não foi possível excluir a imagem',
      ),
    )
    expect(
      screen.getByRole('button', { name: 'Usar imagem praia.png' }),
    ).toBeTruthy()
  })

  it('is read-only without edit permission', async () => {
    renderLibrary(provider(), { canEdit: false })
    await screen.findByLabelText('Imagens')
    expect(screen.queryByText('Enviar imagens')).toBeNull()
    expect(screen.queryByRole('button', { name: /Excluir imagem/ })).toBeNull()
  })
})
