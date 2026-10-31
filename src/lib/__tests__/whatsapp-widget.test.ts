import { describe, expect, it } from 'vitest'
import {
  buildWidgetSnippet,
  generateVisitorToken,
  generateWidgetKey,
  hashVisitorToken,
  isOriginAllowed,
  isWidgetWaId,
  normalizeOrigin,
  WIDGET_KEY_PREFIX,
  widgetSurveyQuestion,
  widgetWaId,
} from '../whatsapp/widget'

describe('widget keys and tokens', () => {
  it('should generate unique prefixed keys', () => {
    const a = generateWidgetKey()
    expect(a.startsWith(WIDGET_KEY_PREFIX)).toBe(true)
    expect(a).not.toBe(generateWidgetKey())
  })

  it('should hash a visitor token deterministically', () => {
    const token = generateVisitorToken()
    expect(token.length).toBeGreaterThanOrEqual(40)
    expect(hashVisitorToken(token)).toBe(hashVisitorToken(token))
    expect(hashVisitorToken(token)).not.toBe(token)
    expect(hashVisitorToken(token)).toHaveLength(64)
  })

  it('should build and recognize the widget wa id', () => {
    expect(widgetWaId('abc')).toBe('widget:abc')
    expect(isWidgetWaId('widget:abc')).toBe(true)
    expect(isWidgetWaId('5511999999999')).toBe(false)
  })
})

describe('normalizeOrigin', () => {
  it('should lower-case and drop the path', () => {
    expect(normalizeOrigin('HTTPS://Site.com.br/pagina?x=1')).toBe(
      'https://site.com.br',
    )
  })

  it('should keep the port and the wildcard', () => {
    expect(normalizeOrigin('http://localhost:3000')).toBe(
      'http://localhost:3000',
    )
    expect(normalizeOrigin('https://*.Empresa.com.br')).toBe(
      'https://*.empresa.com.br',
    )
  })

  it('should reject anything that is not an http origin', () => {
    expect(normalizeOrigin('ftp://site.com')).toBeNull()
    expect(normalizeOrigin('site.com')).toBeNull()
    expect(normalizeOrigin('https://')).toBeNull()
    expect(normalizeOrigin('https://user:pass@site.com')).toBeNull()
    expect(normalizeOrigin('https://exa mple.com')).toBeNull()
  })
})

describe('isOriginAllowed', () => {
  const allowed = [
    'https://www.empresa.com.br',
    'https://*.loja.com.br',
    'http://localhost:3000',
    'not-an-origin',
  ]

  it('should accept an exact match', () => {
    expect(isOriginAllowed('https://www.empresa.com.br', allowed)).toBe(true)
    expect(isOriginAllowed('http://localhost:3000', allowed)).toBe(true)
  })

  it('should accept a subdomain of a wildcard entry', () => {
    expect(isOriginAllowed('https://a.loja.com.br', allowed)).toBe(true)
    expect(isOriginAllowed('https://a.b.loja.com.br', allowed)).toBe(true)
  })

  it('should not let the bare domain or a look-alike through the wildcard', () => {
    expect(isOriginAllowed('https://loja.com.br', allowed)).toBe(false)
    expect(isOriginAllowed('https://evilloja.com.br', allowed)).toBe(false)
    expect(isOriginAllowed('https://loja.com.br.evil.com', allowed)).toBe(false)
  })

  it('should keep scheme and port apart', () => {
    expect(isOriginAllowed('http://www.empresa.com.br', allowed)).toBe(false)
    expect(isOriginAllowed('http://localhost:4000', allowed)).toBe(false)
    expect(isOriginAllowed('http://a.loja.com.br', allowed)).toBe(false)
    expect(isOriginAllowed('https://a.loja.com.br:8443', allowed)).toBe(false)
  })

  it('should refuse a missing, invalid or wildcard origin', () => {
    expect(isOriginAllowed(null, allowed)).toBe(false)
    expect(isOriginAllowed(undefined, allowed)).toBe(false)
    expect(isOriginAllowed('', allowed)).toBe(false)
    expect(isOriginAllowed('null', allowed)).toBe(false)
    expect(isOriginAllowed('https://*.loja.com.br', allowed)).toBe(false)
    expect(isOriginAllowed('https://www.empresa.com.br', [])).toBe(false)
  })
})

describe('snippet and survey copy', () => {
  it('should build the script tag', () => {
    expect(buildWidgetSnippet('https://steel.example.com', 'stw_k')).toBe(
      '<script src="https://steel.example.com/steel-widget.js" data-key="stw_k" async></script>',
    )
  })

  it('should have a question per survey kind', () => {
    expect(widgetSurveyQuestion('NPS')).toContain('0 a 10')
    expect(widgetSurveyQuestion('CSAT')).toContain('1 a 5')
    expect(widgetSurveyQuestion('CES')).toContain('1 a 7')
  })
})
