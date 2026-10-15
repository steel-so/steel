import { describe, expect, it } from 'vitest'
import {
  compileThemeCss,
  defaultSiteTheme,
  fontStack,
  parseSiteTheme,
  SITE_COLOR_IDS,
  siteColorTokens,
  siteThemeSchema,
  themeColor,
} from '@/src/lib/canvas-site/theme'

describe('site theme', () => {
  it('ships a valid default theme', () => {
    expect(siteThemeSchema.safeParse(defaultSiteTheme()).success).toBe(true)
  })

  it('returns fresh defaults for missing or non-object input', () => {
    expect(parseSiteTheme(undefined)).toEqual(defaultSiteTheme())
    expect(parseSiteTheme('nope')).toEqual(defaultSiteTheme())
    expect(parseSiteTheme(null)).toEqual(defaultSiteTheme())
    const a = parseSiteTheme({})
    a.colors.primary = '#000000'
    expect(parseSiteTheme({}).colors.primary).toBe('#473bf0')
  })

  it('merges a partial theme over the defaults and drops unknown keys', () => {
    const theme = parseSiteTheme({
      colors: { primary: '#112233' },
      contentWidth: 960,
      extra: true,
    })
    expect(theme.colors.primary).toBe('#112233')
    expect(theme.colors.dark).toBe('#161c2d')
    expect(theme.contentWidth).toBe(960)
    expect(theme).not.toHaveProperty('extra')
  })

  it('resets only the invalid leaves', () => {
    const theme = parseSiteTheme({
      colors: { primary: 'red', accent: '#ff0000' },
      text: { h1: { weight: 50 } },
      fonts: { heading: 'comic' },
    })
    expect(theme.colors.primary).toBe('#473bf0')
    expect(theme.colors.accent).toBe('#ff0000')
    expect(theme.text.h1.weight).toBe(700)
    expect(theme.fonts.heading).toBe('geist')
  })

  it('resets a whole branch replaced by a scalar', () => {
    const theme = parseSiteTheme({ colors: 'blue', spacing: [1, 2] })
    expect(theme.colors).toEqual(defaultSiteTheme().colors)
    expect(theme.spacing).toEqual(defaultSiteTheme().spacing)
  })

  it('exposes the palette as editor color tokens', () => {
    const tokens = siteColorTokens(defaultSiteTheme())
    expect(tokens.map((token) => token.id)).toEqual([...SITE_COLOR_IDS])
    expect(tokens[0]).toEqual({
      id: 'primary',
      label: 'Primária',
      value: '#473bf0',
    })
  })

  it('resolves fonts and token colors', () => {
    expect(fontStack('serif')).toContain('Georgia')
    expect(fontStack('unknown' as never)).toContain('Geist')
    expect(themeColor('token:primary')).toBe('var(--canvas-primary)')
    expect(themeColor('#fff')).toBe('#fff')
  })

  it('compiles the theme stylesheet deterministically', () => {
    const css = compileThemeCss(defaultSiteTheme())
    expect(css).toBe(compileThemeCss(defaultSiteTheme()))
    expect(css).toContain('--canvas-primary:#473bf0')
    expect(css).toContain('--s-space-md:16px')
    expect(css).toContain('--s-content:1200px')
    expect(css).toContain(
      '.s-site :where(.s-t-h1){font-family:var(--s-font-heading);font-size:64px',
    )
    expect(css).toContain(
      '@media (max-width: 767.98px){.s-site :where(.s-t-h1){font-size:38px}',
    )
    expect(css).toContain(
      '.s-site :where(.s-btn-primary){background:var(--canvas-primary)',
    )
    expect(css).toMatchSnapshot()
  })

  it('varies link decoration and skips empty media blocks', () => {
    const theme = defaultSiteTheme()
    theme.links.underline = 'always'
    for (const preset of Object.values(theme.text)) {
      preset.size = { base: preset.size.base }
    }
    const css = compileThemeCss(theme)
    expect(css).toContain('text-decoration:underline;text-underline-offset')
    expect(css).not.toContain('@media')
    theme.links.underline = 'none'
    theme.shadows.sm.inset = true
    const none = compileThemeCss(theme)
    expect(none).toContain('text-decoration:none;text-underline-offset')
    expect(none).toContain('--s-shadow-sm:inset 0px')
  })
})
