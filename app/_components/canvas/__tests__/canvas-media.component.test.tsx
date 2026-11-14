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
import type { MediaProvider } from '@/app/_components/media/media-types'
import { notify } from '@/lib/notify'
import { getNode } from '@/src/lib/canvas/ops'
import type { CanvasStore } from '@/src/lib/canvas/store'
import {
  DEMO_TOKENS,
  demoCatalog,
  demoDocument,
} from '../__demo__/demo-catalog'
import { CanvasEditor } from '../canvas-editor'
import type { CanvasImageBlock } from '../types'

vi.mock('@/lib/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))
vi.mock('../inspector/controls/richtext', () => ({
  RichTextControl: () => <div>rich</div>,
}))

let store: CanvasStore

const IMAGE_BLOCK: CanvasImageBlock = {
  type: 'demo.image',
  toProps: (src, current) => ({
    image: { ...((current?.image as object | undefined) ?? { alt: '' }), src },
  }),
}

const LIBRARY = [
  { id: 'praia.png', url: 'https://cdn.test/praia.png', size: 2048 },
  { id: 'logo.webp', url: 'https://cdn.test/logo.webp', size: 1024 },
]

function provider(overrides: Partial<MediaProvider> = {}): MediaProvider {
  return {
    key: ['test-media'],
    list: vi.fn(async () => LIBRARY),
    upload: vi.fn(async (file: File) => ({
      id: file.name,
      url: `https://cdn.test/${file.name}`,
      size: file.size,
    })),
    ...overrides,
  }
}

function setup(options: {
  onUploadImage?: (file: File) => Promise<string | null>
  mediaProvider?: MediaProvider
}) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CanvasEditor
        catalog={demoCatalog}
        initialDocument={demoDocument()}
        viewportWidths={{}}
        colorTokens={DEMO_TOKENS}
        title='Teste'
        actions={(ctx) => {
          store = ctx.store
          return null
        }}
        onSave={async () => true}
        imageBlock={IMAGE_BLOCK}
        {...options}
      />
    </QueryClientProvider>,
  )
}

const image = (id = 'hero-image') =>
  getNode(store.getState().doc, id)?.props.image as {
    src: string
    alt: string
    decorative?: boolean
  }
const panel = () => screen.getByTestId('canvas-inspector')

function pasteFiles(files: File[]) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { files } })
  act(() => {
    window.dispatchEvent(event)
  })
  return event
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('canvas media', () => {
  it('picks an image from the library', async () => {
    setup({ mediaProvider: provider() })
    act(() => store.select('hero-image'))
    fireEvent.click(
      within(panel()).getByRole('button', { name: 'Escolher da biblioteca' }),
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Usar imagem praia.png' }),
    )
    expect(image().src).toBe('https://cdn.test/praia.png')
    await waitFor(() =>
      expect(screen.queryByText('Biblioteca de imagens')).toBeNull(),
    )
  })

  it('filters the library by name', async () => {
    setup({ mediaProvider: provider() })
    act(() => store.select('hero-image'))
    fireEvent.click(
      within(panel()).getByRole('button', { name: 'Escolher da biblioteca' }),
    )
    await screen.findByRole('button', { name: 'Usar imagem praia.png' })
    fireEvent.change(screen.getByLabelText('Buscar imagem'), {
      target: { value: 'logo' },
    })
    expect(
      screen.queryByRole('button', { name: 'Usar imagem praia.png' }),
    ).toBe(null)
    expect(
      screen.getByRole('button', { name: 'Usar imagem logo.webp' }),
    ).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Buscar imagem'), {
      target: { value: 'zzz' },
    })
    expect(screen.getByText(/Nenhuma imagem com/)).toBeTruthy()
  })

  it('shows the library error with a retry', async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce(new Error('falhou'))
      .mockResolvedValue(LIBRARY)
    setup({ mediaProvider: provider({ list }) })
    act(() => store.select('hero-image'))
    fireEvent.click(
      within(panel()).getByRole('button', { name: 'Escolher da biblioteca' }),
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Tentar de novo' }),
    )
    expect(
      await screen.findByRole('button', { name: 'Usar imagem praia.png' }),
    ).toBeTruthy()
  })

  it('hides the library button without a provider', () => {
    setup({ onUploadImage: async () => null })
    act(() => store.select('hero-image'))
    expect(
      within(panel()).queryByRole('button', { name: 'Escolher da biblioteca' }),
    ).toBeNull()
  })

  it('requires alt text unless the image is decorative', () => {
    setup({})
    act(() => store.select('hero-image'))
    expect(
      within(panel()).getByText('Descreva a imagem ou marque como decorativa.'),
    ).toBeTruthy()
    fireEvent.click(
      within(panel()).getByRole('switch', {
        name: 'Imagem: imagem decorativa',
      }),
    )
    expect(image().decorative).toBe(true)
    expect(image().alt).toBe('')
    expect(
      within(panel()).queryByText(
        'Descreva a imagem ou marque como decorativa.',
      ),
    ).toBeNull()
    fireEvent.click(
      within(panel()).getByRole('switch', {
        name: 'Imagem: imagem decorativa',
      }),
    )
    fireEvent.change(
      within(panel()).getByLabelText('Imagem: texto alternativo'),
      { target: { value: 'Praia' } },
    )
    expect(image()).toMatchObject({ alt: 'Praia' })
    expect(image().decorative).toBeUndefined()
  })

  it('replaces the selected image when a picture is pasted', async () => {
    const onUploadImage = vi.fn(async () => 'https://cdn.test/colada.png')
    setup({ onUploadImage })
    act(() => store.select('hero-image'))
    const event = pasteFiles([
      new File(['x'], 'colada.png', { type: 'image/png' }),
    ])
    expect(event.defaultPrevented).toBe(true)
    await waitFor(() => expect(image().src).toBe('https://cdn.test/colada.png'))
  })

  it('ignores a paste without images', () => {
    const onUploadImage = vi.fn(async () => 'https://cdn.test/x.png')
    setup({ onUploadImage })
    act(() => store.select('hero-image'))
    const event = pasteFiles([new File(['x'], 'a.txt', { type: 'text/plain' })])
    expect(event.defaultPrevented).toBe(false)
    expect(onUploadImage).not.toHaveBeenCalled()
  })

  it('refuses a pasted image over 5 MB and says why', () => {
    const onUploadImage = vi.fn(async () => 'https://cdn.test/x.png')
    setup({ onUploadImage })
    act(() => store.select('hero-image'))
    const big = new File(['x'], 'enorme.png', { type: 'image/png' })
    Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 })
    pasteFiles([big])
    expect(notify.error).toHaveBeenCalledWith(
      expect.stringContaining('limite é 5 MB'),
    )
    expect(onUploadImage).not.toHaveBeenCalled()
  })

  it('refuses a picked file of an unsupported type', () => {
    const onUploadImage = vi.fn(async () => 'https://cdn.test/x.gif')
    setup({ onUploadImage })
    act(() => store.select('hero-image'))
    const input = panel().querySelector('input[type="file"]') as HTMLElement
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'a.gif', { type: 'image/gif' })] },
    })
    expect(notify.error).toHaveBeenCalledWith(
      expect.stringContaining('use JPEG, PNG ou WebP'),
    )
    expect(onUploadImage).not.toHaveBeenCalled()
  })

  it('uploads through the provider when the editor has no upload callback', async () => {
    const media = provider()
    setup({ mediaProvider: media })
    act(() => store.select('hero-image'))
    const input = panel().querySelector('input[type="file"]') as HTMLElement
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'nova.png', { type: 'image/png' })] },
    })
    await waitFor(() => expect(image().src).toBe('https://cdn.test/nova.png'))
    expect(media.upload).toHaveBeenCalled()
  })
})
