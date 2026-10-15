import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  backgroundToCss,
  borderToCss,
  canvasBackgroundSchema,
  canvasColorSchema,
  canvasLinkSchema,
  canvasShadowSchema,
  canvasSpacingSchema,
  isTokenColor,
  linkHref,
  radiusToCss,
  resolveColor,
  responsiveSchema,
  shadowToCss,
  sizeToCss,
  spacing,
  spacingToCss,
  typographyToCss,
} from '@/src/lib/canvas/values'

const tokens = [{ id: 'primary', label: 'Primária', value: '#2563EB' }]

describe('colors', () => {
  it('accepts tokens, hex with alpha and transparent', () => {
    for (const value of [
      'token:primary',
      '#fff',
      '#1A2B3C',
      '#1A2B3C80',
      'transparent',
    ]) {
      expect(canvasColorSchema.safeParse(value).success).toBe(true)
    }
    for (const value of [
      'red',
      '#12',
      'token:',
      'token:Primary',
      'rgb(0,0,0)',
    ]) {
      expect(canvasColorSchema.safeParse(value).success).toBe(false)
    }
  })

  it('resolves tokens through the list, else a CSS variable', () => {
    expect(isTokenColor('token:primary')).toBe(true)
    expect(isTokenColor('#fff')).toBe(false)
    expect(resolveColor('token:primary', tokens)).toBe('#2563EB')
    expect(resolveColor('token:accent', tokens)).toBe('var(--canvas-accent)')
    expect(resolveColor('token:accent')).toBe('var(--canvas-accent)')
    expect(resolveColor('#000000')).toBe('#000000')
    expect(resolveColor(undefined)).toBeUndefined()
    expect(resolveColor('')).toBeUndefined()
  })
})

describe('box model', () => {
  it('builds spacing and its CSS', () => {
    expect(spacing(8)).toEqual({ top: 8, right: 8, bottom: 8, left: 8 })
    expect(spacing(8, 16)).toEqual({ top: 8, right: 16, bottom: 8, left: 16 })
    expect(spacingToCss({ top: 1, right: 2, bottom: 3, left: 4 })).toBe(
      '1px 2px 3px 4px',
    )
    expect(spacingToCss(undefined)).toBeUndefined()
    expect(
      canvasSpacingSchema.safeParse({ top: -1, right: 0, bottom: 0, left: 0 })
        .success,
    ).toBe(false)
  })

  it('formats radius, border and shadow', () => {
    expect(
      radiusToCss({ topLeft: 1, topRight: 2, bottomRight: 3, bottomLeft: 4 }),
    ).toBe('1px 2px 3px 4px')
    expect(radiusToCss(undefined)).toBeUndefined()
    expect(
      borderToCss(
        { width: 2, style: 'dashed', color: 'token:primary' },
        tokens,
      ),
    ).toBe('2px dashed #2563EB')
    expect(
      borderToCss({ width: 2, style: 'none', color: '#000' }),
    ).toBeUndefined()
    expect(
      borderToCss({ width: 0, style: 'solid', color: '#000' }),
    ).toBeUndefined()
    expect(borderToCss(undefined)).toBeUndefined()
    expect(
      shadowToCss({ x: 0, y: 2, blur: 4, spread: 0, color: '#00000033' }),
    ).toBe('0px 2px 4px 0px #00000033')
    expect(
      shadowToCss(
        { x: 1, y: 1, blur: 0, spread: 1, color: 'token:primary', inset: true },
        tokens,
      ),
    ).toBe('inset 1px 1px 0px 1px #2563EB')
    expect(shadowToCss(null)).toBeUndefined()
    expect(canvasShadowSchema.safeParse(null).success).toBe(true)
  })
})

describe('typography', () => {
  it('maps only the keys that are set', () => {
    expect(typographyToCss(undefined)).toEqual({})
    expect(typographyToCss({})).toEqual({})
    expect(
      typographyToCss({
        fontFamily: 'Inter, sans-serif',
        fontSize: 18,
        fontWeight: 600,
        lineHeight: 1.4,
        letterSpacing: 0.5,
        textTransform: 'uppercase',
        italic: true,
      }),
    ).toEqual({
      fontFamily: 'Inter, sans-serif',
      fontSize: '18px',
      fontWeight: 600,
      lineHeight: 1.4,
      letterSpacing: '0.5px',
      textTransform: 'uppercase',
      fontStyle: 'italic',
    })
  })
})

describe('background', () => {
  it('maps every kind', () => {
    expect(backgroundToCss(undefined)).toEqual({})
    expect(backgroundToCss({ kind: 'none' })).toEqual({})
    expect(
      backgroundToCss({ kind: 'color', color: 'token:primary' }, tokens),
    ).toEqual({ backgroundColor: '#2563EB' })
    expect(
      backgroundToCss(
        { kind: 'gradient', angle: 90, from: '#000000', to: 'token:primary' },
        tokens,
      ),
    ).toEqual({
      backgroundImage: 'linear-gradient(90deg, #000000, #2563EB)',
    })
    expect(
      backgroundToCss({
        kind: 'image',
        url: 'https://x.test/a"b.png',
        position: 'top',
        size: 'cover',
        repeat: false,
        color: '#FFFFFF',
      }),
    ).toEqual({
      backgroundImage: 'url("https://x.test/a%22b.png")',
      backgroundPosition: 'top',
      backgroundSize: 'cover',
      backgroundRepeat: 'no-repeat',
      backgroundColor: '#FFFFFF',
    })
    expect(
      backgroundToCss({
        kind: 'image',
        url: '',
        position: 'center',
        size: 'auto',
        repeat: true,
      }),
    ).toEqual({
      backgroundPosition: 'center',
      backgroundSize: 'auto',
      backgroundRepeat: 'repeat',
    })
    expect(canvasBackgroundSchema.safeParse({ kind: 'video' }).success).toBe(
      false,
    )
  })
})

describe('links and sizes', () => {
  it('builds hrefs per target', () => {
    expect(linkHref(undefined)).toBeUndefined()
    expect(linkHref({ type: 'url', value: '  ' })).toBeUndefined()
    expect(linkHref({ type: 'url', value: 'https://a.test' })).toBe(
      'https://a.test',
    )
    expect(linkHref({ type: 'file', value: 'https://a.test/f.pdf' })).toBe(
      'https://a.test/f.pdf',
    )
    expect(linkHref({ type: 'email', value: 'a@b.test' })).toBe(
      'mailto:a@b.test',
    )
    expect(linkHref({ type: 'email', value: 'mailto:a@b.test' })).toBe(
      'mailto:a@b.test',
    )
    expect(linkHref({ type: 'phone', value: '+55 (11) 9999-0000' })).toBe(
      'tel:+551199990000',
    )
    expect(linkHref({ type: 'phone', value: 'tel:123' })).toBe('tel:123')
    expect(linkHref({ type: 'anchor', value: 'contato' })).toBe('#contato')
    expect(linkHref({ type: 'anchor', value: '#topo' })).toBe('#topo')
    expect(linkHref({ type: 'page', value: 'p1' })).toBe('p1')
    expect(linkHref({ type: 'page', value: 'p1' }, (id) => `/site/${id}`)).toBe(
      '/site/p1',
    )
    expect(canvasLinkSchema.safeParse({ type: 'ftp', value: '' }).success).toBe(
      false,
    )
  })

  it('formats sizes', () => {
    expect(sizeToCss(undefined)).toBeUndefined()
    expect(sizeToCss({ value: 50, unit: '%' })).toBe('50%')
    expect(sizeToCss({ value: 320, unit: 'px' })).toBe('320px')
    expect(sizeToCss({ value: null, unit: 'px' })).toBe('auto')
    expect(sizeToCss({ value: 10, unit: 'auto' })).toBe('auto')
    expect(sizeToCss({ value: null, unit: 'fill' })).toBe('100%')
  })
})

describe('responsiveSchema', () => {
  it('accepts a plain value or per-breakpoint values', () => {
    const schema = responsiveSchema(z.number())
    expect(schema.safeParse(4).success).toBe(true)
    expect(schema.safeParse({ base: 4, mobile: 2 }).success).toBe(true)
    expect(schema.safeParse({ mobile: 2 }).success).toBe(false)
  })
})
