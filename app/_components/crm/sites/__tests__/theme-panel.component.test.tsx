import { fireEvent, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getNode } from '@/src/lib/canvas/nodes'
import { SITE_KITS } from '@/src/lib/canvas-site/presets/kits'
import { defaultSiteTheme, type SiteTheme } from '@/src/lib/canvas-site/theme'
import { validateSiteDocument } from '@/src/lib/sites/document'
import { ThemePanel, themePreviewDocument } from '../theme-panel'
import { renderInEditor } from './harness'

const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))

beforeEach(() => vi.clearAllMocks())

function lastTheme(setTheme: unknown): SiteTheme {
  const mock = setTheme as { mock: { calls: SiteTheme[][] } }
  return mock.mock.calls.at(-1)?.[0] as SiteTheme
}

describe('themePreviewDocument', () => {
  it('is a valid site document with the three button variants', () => {
    const doc = themePreviewDocument()
    expect(validateSiteDocument(doc).ok).toBe(true)
    const variants = Object.values(doc.nodes)
      .filter((node) => node.type === 'site.button')
      .map((node) => node.props.variant)
    expect(variants).toEqual(['primary', 'secondary', 'outline'])
    expect(getNode(doc, doc.rootId)?.children).toHaveLength(1)
  })
})

describe('<ThemePanel />', () => {
  it('draws a live preview with the theme', () => {
    renderInEditor(<ThemePanel />)
    expect(screen.getByTestId('site-snapshot')).toBeTruthy()
  })

  it('edits a palette color from its hex field', () => {
    const { ctx } = renderInEditor(<ThemePanel />)
    const field = screen.getByLabelText('Primária') as HTMLInputElement
    expect(field.value).toBe(defaultSiteTheme().colors.primary)
    fireEvent.change(field, { target: { value: '#0F766E' } })
    fireEvent.blur(field)
    expect(lastTheme(ctx.setTheme).colors.primary).toBe('#0f766e')
    // Other colors are untouched.
    expect(lastTheme(ctx.setTheme).colors.dark).toBe(
      defaultSiteTheme().colors.dark,
    )
  })

  it('ignores an invalid hex and restores the field', () => {
    const { ctx } = renderInEditor(<ThemePanel />)
    const field = screen.getByLabelText('Primária') as HTMLInputElement
    fireEvent.change(field, { target: { value: 'azul' } })
    fireEvent.blur(field)
    expect(ctx.setTheme).not.toHaveBeenCalled()
    expect(field.value).toBe(defaultSiteTheme().colors.primary)
  })

  it('applies a ready-made style', () => {
    const { ctx } = renderInEditor(<ThemePanel />)
    const kit = SITE_KITS.b2b
    fireEvent.click(screen.getByRole('button', { name: new RegExp(kit.label) }))
    expect(lastTheme(ctx.setTheme)).toEqual(kit.theme)
    expect(notify.success).toHaveBeenCalledWith(
      `Estilo “${kit.label}” aplicado.`,
    )
  })

  it('changes fonts, button corners and the content width', async () => {
    const { ctx } = renderInEditor(<ThemePanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Botões' }))
    const corners = (await screen.findAllByLabelText('Cantos'))[0]
    fireEvent.change(corners, { target: { value: '999' } })
    expect(lastTheme(ctx.setTheme).buttons.radius).toBe(999)

    fireEvent.click(screen.getByRole('button', { name: 'Cantos e largura' }))
    const width = await screen.findByLabelText('Largura máxima do conteúdo')
    fireEvent.change(width, { target: { value: '5000' } })
    // Clamped to the schema's maximum.
    expect(lastTheme(ctx.setTheme).contentWidth).toBe(2400)

    fireEvent.click(screen.getByRole('button', { name: 'Espaçamento' }))
    const spacing = await screen.findAllByLabelText('Médio')
    fireEvent.change(spacing[spacing.length - 1], {
      target: { value: '' },
    })
    // An empty field changes nothing.
    expect(lastTheme(ctx.setTheme).spacing.md).toBe(
      defaultSiteTheme().spacing.md,
    )
  })

  it('edits a text style per breakpoint', async () => {
    const { ctx } = renderInEditor(<ThemePanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Estilos de texto' }))
    fireEvent.click(await screen.findByRole('button', { name: /Título 1/ }))
    const mobile = (await screen.findAllByLabelText('Celular'))[0]
    fireEvent.change(mobile, { target: { value: '30' } })
    const theme = lastTheme(ctx.setTheme)
    expect(theme.text.h1.size.mobile).toBe(30)
    expect(theme.text.h1.size.base).toBe(defaultSiteTheme().text.h1.size.base)
  })

  it('is read-only without edit permission', () => {
    const { ctx } = renderInEditor(<ThemePanel />, { canEdit: false })
    const panel = screen.getByTestId('theme-panel')
    const fieldset = panel.querySelector('fieldset') as HTMLFieldSetElement
    expect(fieldset.disabled).toBe(true)
    fireEvent.click(
      within(panel).getByRole('button', {
        name: new RegExp(SITE_KITS.saas.label),
      }),
    )
    expect(ctx.setTheme).not.toHaveBeenCalled()
  })
})
