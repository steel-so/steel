import { describe, expect, it } from 'vitest'
import {
  crc32,
  createStoredZip,
  exportFileName,
  fitQuality,
  formatKb,
  slugifyName,
  uniqueNames,
} from '@/src/lib/banners/export'
import { fitScale, resizeBox, snapMove } from '@/src/lib/banners/geometry'
import { filterBanners, NO_FOLDER } from '@/src/lib/banners/library'
import { gradientPoints, wrapLines } from '@/src/lib/banners/render'

/** A fake encoder whose size shrinks linearly with quality. */
function encoder(bytesAtFull: number) {
  const calls: number[] = []
  const encode = async (quality: number) => {
    calls.push(quality)
    return new Blob([new Uint8Array(Math.round(bytesAtFull * quality))])
  }
  return { encode, calls }
}

describe('fitQuality()', () => {
  it('returns the best quality when it already fits', async () => {
    const { encode } = encoder(100_000)
    const result = await fitQuality(encode, 150 * 1024)
    expect(result).toMatchObject({ fits: true, quality: 0.95 })
  })

  it('finds the highest quality under the target', async () => {
    const { encode } = encoder(400_000)
    const target = 150 * 1024
    const result = await fitQuality(encode, target)
    expect(result.fits).toBe(true)
    expect(result.blob.size).toBeLessThanOrEqual(target)
    // Close to the ideal 0.384 (153600 / 400000), not the floor.
    expect(result.quality).toBeGreaterThan(0.34)
    expect(result.quality).toBeLessThanOrEqual(0.4)
  })

  it('reports when even the lowest quality is too heavy', async () => {
    const { encode } = encoder(2_000_000)
    const result = await fitQuality(encode, 150 * 1024)
    expect(result.fits).toBe(false)
    expect(result.quality).toBe(0.3)
  })
})

describe('file names', () => {
  it('slugifies accents and symbols', () => {
    expect(slugifyName('Campanha de Verão 2026!')).toBe(
      'campanha-de-verao-2026',
    )
    expect(slugifyName('   ')).toBe('banner')
  })

  it('names the file with size and extension', () => {
    expect(
      exportFileName('Promo Fibra', { width: 300, height: 250 }, 'jpeg'),
    ).toBe('promo-fibra-300x250.jpg')
    expect(exportFileName('Promo', { width: 1080, height: 1920 }, 'webp')).toBe(
      'promo-1080x1920.webp',
    )
  })

  it('makes names unique inside an archive', () => {
    expect(uniqueNames(['a.png', 'b.png', 'a.png', 'a.png'])).toEqual([
      'a.png',
      'b.png',
      'a (2).png',
      'a (3).png',
    ])
  })

  it('formats weights', () => {
    expect(formatKb(150 * 1024)).toBe('150 KB')
    expect(formatKb(10)).toBe('1 KB')
    expect(formatKb(2.5 * 1024 * 1024)).toBe('2.5 MB')
  })
})

describe('createStoredZip()', () => {
  const text = (value: string) => new TextEncoder().encode(value)

  it('computes the standard CRC-32', () => {
    expect(crc32(text('123456789'))).toBe(0xcbf43926)
  })

  it('writes a readable archive with every entry', () => {
    const zip = createStoredZip([
      { name: 'a.txt', data: text('hello') },
      { name: 'dir/ç.txt', data: text('world!') },
    ])
    const view = new DataView(zip.buffer)
    // End of central directory is the last 22 bytes.
    const end = zip.length - 22
    expect(view.getUint32(end, true)).toBe(0x06054b50)
    expect(view.getUint16(end + 10, true)).toBe(2)
    const centralOffset = view.getUint32(end + 16, true)
    expect(view.getUint32(centralOffset, true)).toBe(0x02014b50)
    // First local header starts the file and stores the CRC of "hello".
    expect(view.getUint32(0, true)).toBe(0x04034b50)
    expect(view.getUint32(14, true)).toBe(crc32(text('hello')))
    expect(view.getUint32(18, true)).toBe(5)
    // The payload follows the header and name.
    expect(new TextDecoder().decode(zip.slice(30 + 5, 30 + 5 + 5))).toBe(
      'hello',
    )
  })

  it('handles an empty list', () => {
    const zip = createStoredZip([])
    expect(zip.length).toBe(22)
  })
})

describe('renderer helpers', () => {
  it('wraps with a measuring function and keeps explicit breaks', () => {
    const measure = (t: string) => t.length * 10
    expect(wrapLines(measure, 'um dois três quatro', 100)).toEqual([
      'um dois',
      'três',
      'quatro',
    ])
    expect(wrapLines(measure, 'a\n\nb', 100)).toEqual(['a', '', 'b'])
  })

  it('computes CSS-like gradient lines', () => {
    const toRight = gradientPoints(200, 100, 90)
    expect(toRight.x0).toBeCloseTo(0)
    expect(toRight.x1).toBeCloseTo(200)
    expect(toRight.y0).toBeCloseTo(50)
    const toBottom = gradientPoints(200, 100, 180)
    expect(toBottom.y0).toBeCloseTo(0)
    expect(toBottom.y1).toBeCloseTo(100)
  })
})

describe('geometry', () => {
  const canvas = { width: 300, height: 250 }

  it('snaps the center of an element to the canvas center', () => {
    const box = { x: 0, y: 0, w: 100, h: 50 }
    const result = snapMove(box, 102, 10, canvas, [], 6)
    // Center x = 150 → x = 100.
    expect(result.x).toBe(100)
    expect(result.guides.vertical).toEqual([150])
    // y = 10 is nowhere near an anchor.
    expect(result.y).toBe(10)
    expect(result.guides.horizontal).toEqual([])
  })

  it('snaps to other elements', () => {
    const result = snapMove(
      { x: 0, y: 0, w: 40, h: 40 },
      53,
      10,
      canvas,
      [{ x: 50, y: 100, w: 20, h: 20 }],
      6,
    )
    expect(result.x).toBe(50)
  })

  it('does not snap outside the threshold', () => {
    const result = snapMove({ x: 0, y: 0, w: 40, h: 40 }, 20, 20, canvas, [], 4)
    expect(result).toMatchObject({ x: 20, y: 20 })
  })

  it('resizes by edges and corners', () => {
    const start = { x: 100, y: 100, w: 100, h: 50 }
    expect(resizeBox(start, 'e', 20, 0, false)).toEqual({
      x: 100,
      y: 100,
      w: 120,
      h: 50,
    })
    expect(resizeBox(start, 'nw', 10, 10, false)).toEqual({
      x: 110,
      y: 110,
      w: 90,
      h: 40,
    })
  })

  it('keeps the aspect ratio on corners with shift', () => {
    const out = resizeBox({ x: 0, y: 0, w: 100, h: 50 }, 'se', 50, 0, true)
    expect(out.w).toBe(150)
    expect(out.h).toBe(75)
  })

  it('never collapses below the minimum size', () => {
    const out = resizeBox({ x: 100, y: 100, w: 20, h: 20 }, 'w', 500, 0, false)
    expect(out.w).toBe(4)
    expect(out.x + out.w).toBe(120)
  })

  it('fits the artboard into the available area', () => {
    expect(
      fitScale({ width: 1080, height: 1080 }, { width: 540, height: 800 }),
    ).toBe(0.5)
    expect(
      fitScale({ width: 320, height: 50 }, { width: 2000, height: 800 }),
    ).toBe(3)
    expect(fitScale({ width: 320, height: 50 }, { width: 0, height: 0 })).toBe(
      1,
    )
  })
})

describe('filterBanners()', () => {
  const banners = [
    { name: 'Campanha de Verão', folder: 'Sazonal', tags: ['display'] },
    { name: 'Remarketing carrinho', folder: '', tags: ['meta', 'remarketing'] },
    { name: 'Evento online', folder: 'Eventos', tags: [] },
  ]

  it('searches name, folder and tags without accents', () => {
    expect(
      filterBanners(banners, { search: 'verao', folder: null, tag: null }),
    ).toHaveLength(1)
    expect(
      filterBanners(banners, { search: 'eventos', folder: null, tag: null }),
    ).toHaveLength(1)
    expect(
      filterBanners(banners, {
        search: 'meta remarketing',
        folder: null,
        tag: null,
      }),
    ).toHaveLength(1)
  })

  it('filters by folder, no folder and tag', () => {
    expect(
      filterBanners(banners, { search: '', folder: 'Sazonal', tag: null }),
    ).toHaveLength(1)
    expect(
      filterBanners(banners, { search: '', folder: NO_FOLDER, tag: null }),
    ).toEqual([banners[1]])
    expect(
      filterBanners(banners, { search: '', folder: null, tag: 'display' }),
    ).toEqual([banners[0]])
  })
})
