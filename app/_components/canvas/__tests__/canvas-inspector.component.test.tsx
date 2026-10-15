import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { getNode } from '@/src/lib/canvas/ops'
import type { CanvasStore } from '@/src/lib/canvas/store'
import {
  DEMO_TOKENS,
  demoCatalog,
  demoDocument,
} from '../__demo__/demo-catalog'
import { CanvasEditor } from '../canvas-editor'

vi.mock('@/lib/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))
vi.mock('../inspector/controls/richtext', () => ({
  RichTextControl: () => <div>rich</div>,
}))

let store: CanvasStore

function setup(onUploadImage?: (file: File) => Promise<string | null>) {
  render(
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
      onUploadImage={onUploadImage}
    />,
  )
}

const props = (id: string) => getNode(store.getState().doc, id)?.props ?? {}
const panel = () => screen.getByTestId('canvas-inspector')
const q = () => within(panel())

function select(id: string, tab?: string) {
  act(() => store.select(id))
  if (tab) fireEvent.click(q().getByRole('tab', { name: tab }))
}

function typeNumber(label: string | RegExp, value: string) {
  const input = q().getByLabelText(label)
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
}

describe('inspector controls', () => {
  it('edits spacing linked and per side', () => {
    setup()
    select('features', 'Estilo')
    // 64/32 is not uniform: the sides start unlinked.
    typeNumber('Margem interna: Esquerda', '12')
    expect(props('features').padding).toEqual({
      top: 64,
      right: 32,
      bottom: 64,
      left: 12,
    })
    const input = q().getByLabelText('Margem interna: Topo')
    fireEvent.keyDown(input, { key: 'ArrowUp', shiftKey: true })
    expect((props('features').padding as { top: number }).top).toBe(74)
    fireEvent.click(
      q().getByRole('button', { name: 'Usar o mesmo valor em todos os lados' }),
    )
    typeNumber('Margem interna (todos os lados)', '40')
    expect(props('features').padding).toEqual({
      top: 40,
      right: 40,
      bottom: 40,
      left: 40,
    })
    fireEvent.click(
      q().getByRole('button', { name: 'Editar Margem interna por lado' }),
    )
    expect(q().getByLabelText('Margem interna: Esquerda')).toBeTruthy()
  })

  it('switches background kinds and edits the gradient angle', () => {
    setup()
    select('features', 'Estilo')
    fireEvent.click(q().getByRole('button', { name: 'Gradiente' }))
    expect(props('features').background).toMatchObject({
      kind: 'gradient',
      angle: 135,
    })
    typeNumber('Fundo: ângulo', '90')
    expect(props('features').background).toMatchObject({ angle: 90 })
    fireEvent.click(q().getByRole('button', { name: 'Imagem' }))
    expect(props('features').background).toMatchObject({
      kind: 'image',
      url: '',
    })
    fireEvent.change(q().getByLabelText('Fundo: imagem: endereço'), {
      target: { value: 'https://img.test/a.png' },
    })
    expect(props('features').background).toMatchObject({
      url: 'https://img.test/a.png',
    })
    fireEvent.click(q().getByRole('button', { name: 'Cor' }))
    expect(props('features').background).toEqual({
      kind: 'color',
      color: '#6366F1',
    })
    fireEvent.click(q().getByRole('button', { name: 'Nenhum' }))
    expect(props('features').background).toEqual({ kind: 'none' })
  })

  it('edits border, radius and shadow', () => {
    setup()
    select('features', 'Estilo')
    fireEvent.click(q().getByRole('button', { name: 'Borda e sombra' }))
    fireEvent.click(q().getByRole('button', { name: 'Tracejada' }))
    expect(props('features').border).toMatchObject({
      style: 'dashed',
      width: 1,
    })
    typeNumber('Borda: espessura', '3')
    expect(props('features').border).toMatchObject({ width: 3 })
    typeNumber('Cantos', '16')
    expect(props('features').radius).toEqual({
      topLeft: 16,
      topRight: 16,
      bottomRight: 16,
      bottomLeft: 16,
    })
    fireEvent.click(q().getByRole('button', { name: 'Editar Cantos por lado' }))
    typeNumber('Cantos: Inferior direito', '0')
    expect(props('features').radius).toMatchObject({
      bottomRight: 0,
      topLeft: 16,
    })
    fireEvent.click(q().getByRole('button', { name: 'Média' }))
    expect(props('features').shadow).toMatchObject({ y: 4, blur: 12 })
    fireEvent.click(q().getByRole('button', { name: 'Ajustar' }))
    typeNumber('Sombra: Desfoque', '30')
    expect(props('features').shadow).toMatchObject({ blur: 30 })
    fireEvent.click(q().getByRole('switch', { name: 'Sombra interna' }))
    expect(props('features').shadow).toMatchObject({ inset: true })
    fireEvent.click(q().getAllByRole('button', { name: 'Nenhuma' })[1])
    expect(props('features').shadow).toBeNull()
  })

  it('picks colors from tokens and hex', async () => {
    setup()
    select('hero-cta', 'Estilo')
    fireEvent.click(q().getByRole('button', { name: /^Cor do texto:/ }))
    const hex = await screen.findByLabelText('Código hexadecimal')
    fireEvent.change(hex, { target: { value: '#123456' } })
    fireEvent.keyDown(hex, { key: 'Enter' })
    expect(props('hero-cta').textColor).toBe('#123456')
    fireEvent.click(screen.getByRole('button', { name: 'Destaque' }))
    expect(props('hero-cta').textColor).toBe('token:accent')
    const hue = screen.getByRole('slider', { name: 'Matiz' })
    fireEvent.keyDown(hue, { key: 'ArrowRight', shiftKey: true })
    expect(props('hero-cta').textColor).toMatch(/^#[0-9A-F]{6}$/)
    // A required color refuses removal; an optional one clears.
    select('hero-title', 'Estilo')
    fireEvent.click(q().getByRole('button', { name: /^Cor:/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Primária' }))
    expect(props('hero-title').color).toBe('token:primary')
    fireEvent.click(q().getByRole('button', { name: 'Remover Cor' }))
    expect(props('hero-title').color).toBeUndefined()
  })

  it('edits links, toggles and typography', async () => {
    setup()
    select('hero-cta')
    fireEvent.change(q().getByLabelText('Link: Endereço web'), {
      target: { value: 'https://stratus.test' },
    })
    expect(props('hero-cta').link).toEqual({
      type: 'url',
      value: 'https://stratus.test',
    })
    fireEvent.click(q().getByRole('switch', { name: 'Abrir em nova aba' }))
    expect(props('hero-cta').link).toMatchObject({ newTab: true })
    fireEvent.click(q().getByRole('switch', { name: 'Largura total' }))
    expect(props('hero-cta').fullWidth).toEqual({ base: true, mobile: true })
    fireEvent.click(q().getByRole('tab', { name: 'Estilo' }))
    typeNumber('Tipografia: tamanho', '20')
    expect(props('hero-cta').typography).toEqual({ fontSize: 20 })
    fireEvent.click(q().getByRole('button', { name: 'MAIÚSCULAS' }))
    fireEvent.click(q().getByRole('button', { name: 'Itálico' }))
    expect(props('hero-cta').typography).toEqual({
      fontSize: 20,
      textTransform: 'uppercase',
      italic: true,
    })
    typeNumber('Tipografia: tamanho', '')
    expect(props('hero-cta').typography).toEqual({
      textTransform: 'uppercase',
      italic: true,
    })
  })

  it('uploads images and edits size, alt and visibility', async () => {
    const upload = vi.fn(async () => 'https://cdn.test/foto.png')
    setup(upload)
    select('hero-image')
    const file = new File(['x'], 'foto.png', { type: 'image/png' })
    const input = panel().querySelector(
      'input[type="file"]',
    ) as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() =>
      expect(props('hero-image').image).toMatchObject({
        src: 'https://cdn.test/foto.png',
      }),
    )
    expect(upload).toHaveBeenCalledWith(file)
    fireEvent.change(q().getByLabelText('Imagem: texto alternativo'), {
      target: { value: 'Equipe' },
    })
    expect(props('hero-image').image).toEqual({
      src: 'https://cdn.test/foto.png',
      alt: 'Equipe',
    })
    fireEvent.click(q().getByRole('tab', { name: 'Estilo' }))
    typeNumber('Largura', '60')
    expect(props('hero-image').width).toEqual({ value: 60, unit: '%' })
    fireEvent.click(q().getByRole('tab', { name: 'Avançado' }))
    fireEvent.click(q().getByRole('button', { name: 'Visível em Celular' }))
    expect(props('hero-image').visibility).toEqual({
      base: true,
      tablet: true,
      mobile: false,
    })
  })

  it('adds, edits, duplicates and removes list items', () => {
    setup()
    select('features-list')
    fireEvent.click(q().getByRole('button', { name: 'Adicionar item' }))
    expect(props('features-list').items).toHaveLength(3)
    fireEvent.change(q().getByLabelText('Título'), {
      target: { value: 'Wi-Fi 6' },
    })
    expect(
      (props('features-list').items as Array<{ title: string }>)[2].title,
    ).toBe('Wi-Fi 6')
    fireEvent.click(q().getByRole('button', { name: 'Duplicar Wi-Fi 6' }))
    expect(props('features-list').items).toHaveLength(4)
    fireEvent.click(q().getByRole('button', { name: 'Remover Sem fidelidade' }))
    expect(
      (props('features-list').items as Array<{ title: string }>)[0].title,
    ).toBe('Suporte humano')
    expect(q().getByText('3 de 12')).toBeTruthy()
  })

  it('shows the root inspector as document settings and a select control', () => {
    setup()
    expect(q().getByText('Documento')).toBeTruthy()
    fireEvent.click(q().getByRole('button', { name: /^Cor de fundo:/ }))
    expect(screen.getByText('Cores do tema')).toBeTruthy()
  })
})
