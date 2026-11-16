import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { outlineSettings } from '@/src/lib/canvas-document/outline'
import {
  describeImages,
  encodePng,
  extractPdfImages,
  isFullPage,
  scanOperators,
} from '@/src/lib/document-ai/images'
import { wireToOutlineInput } from '@/src/lib/document-ai/outline-wire'

function solidPng(width: number, height: number): Buffer {
  const pixels = new Uint8Array(width * height * 3).fill(120)
  return encodePng({ width, height, components: 3, pixels })
}

describe('scanOperators()', () => {
  it('reports operators with their operands and skips strings and inline images', () => {
    const calls: Array<[string, unknown[]]> = []
    scanOperators(
      Buffer.from('q 1 0 0 1 5 6 cm (Do not) Tj BI /W 1 ID xx EI /Im1 Do Q'),
      (operator, operands) => calls.push([operator, operands]),
    )
    expect(calls.map(([operator]) => operator)).toEqual([
      'q',
      'cm',
      'Tj',
      'Do',
      'Q',
    ])
    expect(calls[1]?.[1]).toEqual([1, 0, 0, 1, 5, 6])
    expect(calls[3]?.[1]).toEqual(['Im1'])
  })
})

describe('encodePng()', () => {
  it('writes a PNG signature, with alpha when a mask is given', () => {
    const png = encodePng({
      width: 2,
      height: 2,
      components: 3,
      pixels: new Uint8Array(12),
      alpha: { width: 1, height: 1, data: new Uint8Array([128]) },
    })
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    expect(png[25]).toBe(6)
  })
})

describe('extractPdfImages()', () => {
  async function pdfWith(
    draw: (
      page: import('pdf-lib').PDFPage,
      image: import('pdf-lib').PDFImage,
    ) => void,
  ) {
    const doc = await PDFDocument.create()
    const image = await doc.embedPng(solidPng(80, 40))
    const page = doc.addPage([600, 800])
    draw(page, image)
    return Buffer.from(await doc.save())
  }

  it('finds a drawn image with its place on the page', async () => {
    const pdf = await pdfWith((page, image) =>
      page.drawImage(image, { x: 60, y: 700, width: 300, height: 100 }),
    )
    const images = await extractPdfImages(pdf)
    expect(images).toHaveLength(1)
    const [found] = images
    expect(found?.id).toBe('img-1')
    expect(found?.mime).toBe('image/png')
    expect(found?.width).toBe(80)
    expect(found?.placements[0]).toMatchObject({
      page: 1,
      x: 0.1,
      y: 0,
      width: 0.5,
      height: 0.125,
    })
  })

  it('flags a picture that covers the page', async () => {
    const pdf = await pdfWith((page, image) =>
      page.drawImage(image, { x: 0, y: 0, width: 600, height: 800 }),
    )
    const [found] = await extractPdfImages(pdf)
    const placement = found?.placements[0]
    expect(placement ? isFullPage(placement) : false).toBe(true)
    expect(describeImages(found ? [found] : [], 1)).toContain('background')
  })

  it('counts one picture drawn twice once, and ignores tiny ones', async () => {
    const pdf = await pdfWith((page, image) => {
      page.drawImage(image, { x: 0, y: 0, width: 200, height: 100 })
      page.drawImage(image, { x: 300, y: 0, width: 200, height: 100 })
      page.drawImage(image, { x: 0, y: 500, width: 4, height: 2 })
    })
    const images = await extractPdfImages(pdf)
    expect(images).toHaveLength(1)
    expect(images[0]?.placements).toHaveLength(2)
  })

  it('returns nothing for a file that is not a PDF', async () => {
    expect(await extractPdfImages(Buffer.from('not a pdf'))).toEqual([])
  })
})

describe('describeImages()', () => {
  it('is empty without images', () => {
    expect(describeImages([], 3)).toBe('')
  })
})

describe('image ids in the model answer', () => {
  const answer = {
    title: 'Doc',
    kind: 'OTHER',
    primaryColor: null,
    page: {
      headerText: 'Empresa',
      headerImageId: 'img-2',
      footerText: null,
      footerImageId: null,
      pageNumbers: true,
      watermarkText: null,
      watermarkImageId: 'img-9',
    },
    sections: [
      {
        name: 'Capa',
        variant: 'cover',
        pageBreakBefore: null,
        backgroundImageId: 'img-1',
        blocks: [
          { type: 'image', alt: 'x', caption: null, imageId: 'img-2' },
          { type: 'image', alt: 'y', caption: null, imageId: 'img-404' },
        ],
      },
    ],
  }
  const urls = { 'img-1': 'https://cdn/a.jpg', 'img-2': 'https://cdn/b.png' }

  it('swaps known ids for URLs and leaves unknown ones as placeholders', () => {
    const out = wireToOutlineInput(answer, urls) as {
      page: Record<string, unknown>
      sections: Array<{
        backgroundImage?: string
        blocks: Array<{ src?: string }>
      }>
    }
    expect(out.sections[0]?.backgroundImage).toBe('https://cdn/a.jpg')
    expect(out.sections[0]?.blocks[0]?.src).toBe('https://cdn/b.png')
    expect(out.sections[0]?.blocks[1]?.src).toBeUndefined()
    expect(out.page).toEqual({
      headerText: 'Empresa',
      headerImage: 'https://cdn/b.png',
      pageNumbers: true,
    })
  })

  it('turns the page object into document settings', () => {
    expect(
      outlineSettings({
        headerText: 'Empresa',
        pageNumbers: true,
        watermarkText: 'RASCUNHO',
      }),
    ).toMatchObject({
      header: { text: 'Empresa', align: 'left' },
      pageNumbers: { enabled: true, position: 'footer' },
      watermark: { text: 'RASCUNHO' },
    })
    expect(outlineSettings(undefined)).toEqual({})
  })
})
