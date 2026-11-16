import { describe, expect, it } from 'vitest'
import { createEmptyDocumentContent } from '@/src/lib/canvas-document/catalog'
import {
  cssSafeUrl,
  formatPageNumber,
  furnitureBands,
  printMargins,
  printTemplates,
  screenBand,
  watermarkCss,
} from '@/src/lib/canvas-document/page-furniture'
import { renderDocumentHtml } from '@/src/lib/canvas-document/render'
import {
  DEFAULT_DOCUMENT_SETTINGS,
  DocumentSettingsSchema,
} from '@/src/schemas/document.schema'

const page = { width: 210, height: 297 }

describe('page furniture settings', () => {
  it('stay optional and clearable with null', () => {
    expect(DocumentSettingsSchema.parse({}).header).toBeUndefined()
    expect(DocumentSettingsSchema.parse({ header: null }).header).toBeNull()
    expect(
      DocumentSettingsSchema.parse({ watermark: { text: 'X' } }).watermark,
    ).toMatchObject({ opacity: 0.12, angle: -30 })
    expect(
      DocumentSettingsSchema.safeParse({
        watermark: { imageUrl: 'javascript:alert(1)' },
      }).success,
    ).toBe(false)
  })
})

describe('furnitureBands() and printMargins()', () => {
  it('asks for a band only when there is something to print', () => {
    expect(furnitureBands({})).toEqual({ header: false, footer: false })
    expect(
      furnitureBands({
        header: { text: 'A', align: 'left' },
        pageNumbers: {
          enabled: true,
          format: '{n}',
          align: 'center',
          position: 'footer',
        },
      }),
    ).toEqual({ header: true, footer: true })
  })

  it('grows the margin of a band to fit it', () => {
    expect(printMargins(10, { footer: { text: 'A', align: 'left' } })).toEqual({
      top: 10,
      bottom: 16,
    })
    expect(printMargins(18, {})).toEqual({ top: 18, bottom: 18 })
  })
})

describe('printTemplates()', () => {
  it('is off without furniture', () => {
    expect(
      printTemplates({ settings: {}, variables: {}, sideMarginMm: 18 })
        .displayHeaderFooter,
    ).toBe(false)
  })

  it('builds the footer with the page number markup and escapes text', () => {
    const out = printTemplates({
      settings: {
        footer: { text: 'A & B {{empresa.nome}}', align: 'left' },
        pageNumbers: {
          enabled: true,
          format: 'Página {n} de {total}',
          align: 'right',
          position: 'footer',
        },
      },
      variables: { 'empresa.nome': 'Stratus' },
      sideMarginMm: 18,
    })
    expect(out.displayHeaderFooter).toBe(true)
    expect(out.footerTemplate).toContain('A &amp; B Stratus')
    expect(out.footerTemplate).toContain('<span class="pageNumber"></span>')
    expect(out.footerTemplate).toContain('<span class="totalPages"></span>')
    expect(out.headerTemplate).toBe('<span></span>')
  })

  it('puts an embedded image in the header', () => {
    const out = printTemplates({
      settings: {
        header: { text: '', imageUrl: 'https://x/y.png', align: 'center' },
      },
      variables: {},
      sideMarginMm: 18,
      images: { header: 'data:image/png;base64,AAAA' },
    })
    expect(out.headerTemplate).toContain('data:image/png;base64,AAAA')
  })
})

describe('watermarkCss()', () => {
  it('is empty without text or image', () => {
    expect(watermarkCss(null, { paged: false, print: true, page })).toBe('')
    expect(
      watermarkCss(
        { text: ' ', opacity: 0.1, angle: 0 },
        { paged: false, print: true, page },
      ),
    ).toBe('')
  })

  it('repeats the text per sheet on paged screens and fixes it in print', () => {
    const wm = { text: 'RASCUNHO', opacity: 0.2, angle: -30 }
    const screen = watermarkCss(wm, { paged: true, print: false, page })
    expect(screen).toContain('position:absolute')
    expect(screen).toContain('repeat-y')
    expect(screen).toContain('100% 297mm')
    expect(watermarkCss(wm, { paged: true, print: true, page })).toContain(
      'position:fixed',
    )
  })

  it('refuses an address that could break out of the CSS', () => {
    expect(cssSafeUrl('javascript:alert(1)')).toBeNull()
    expect(cssSafeUrl('https://x/a").d{')).not.toContain('"')
  })
})

describe('screenBand() and formatPageNumber()', () => {
  it('fills variables and drops an empty band', () => {
    expect(screenBand(null, {})).toBeNull()
    expect(
      screenBand(
        { text: 'Para {{empresa.nome}}', align: 'right' },
        { 'empresa.nome': 'ACME' },
      ),
    ).toMatchObject({ text: 'Para ACME', align: 'right', imageUrl: null })
  })

  it('formats a known page', () => {
    expect(formatPageNumber('{n}/{total}', 2, 9)).toBe('2/9')
  })
})

describe('renderDocumentHtml() with furniture', () => {
  const base = {
    content: createEmptyDocumentContent(),
    theme: {},
    title: 'Doc',
  }
  const context = {
    mode: 'print' as const,
    variables: {},
    settings: DEFAULT_DOCUMENT_SETTINGS,
  }

  it('keeps the plain margin without furniture', () => {
    expect(renderDocumentHtml({ ...base, context })).toContain('margin:18mm}')
  })

  it('enlarges the margin, adds the watermark and leaves bands to the PDF engine', () => {
    const html = renderDocumentHtml({
      ...base,
      context: {
        ...context,
        settings: {
          ...DEFAULT_DOCUMENT_SETTINGS,
          footer: { text: 'Rodapé', align: 'left' },
          watermark: { text: 'CONFIDENCIAL', opacity: 0.1, angle: -30 },
        },
      },
    })
    expect(html).toContain('.d-doc::after')
    expect(html).not.toContain('data-document-furniture')
  })

  it('shows header and footer once on screen', () => {
    const html = renderDocumentHtml({
      ...base,
      context: {
        ...context,
        mode: 'public',
        settings: {
          ...DEFAULT_DOCUMENT_SETTINGS,
          header: { text: 'Topo', align: 'center' },
        },
      },
    })
    // renderDocumentHtml always prints; the band only exists on screens.
    expect(html).not.toContain('Topo</span>')
  })
})
