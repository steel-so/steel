import { describe, expect, it } from 'vitest'
import {
  buildRemoteLink,
  isValidRemoteId,
  normalizeRemoteId,
  validateLinkTemplate,
} from '../servicedesk/remote-access'

describe('normalizeRemoteId', () => {
  it('strips spaces and dashes from numeric ids', () => {
    expect(normalizeRemoteId(' 123 456 789 ')).toBe('123456789')
    expect(normalizeRemoteId('123-456-789')).toBe('123456789')
  })

  it('keeps aliases and host names as typed (trimmed)', () => {
    expect(normalizeRemoteId('  suporte@ad ')).toBe('suporte@ad')
    expect(normalizeRemoteId('pc-recepcao.local')).toBe('pc-recepcao.local')
  })
})

describe('isValidRemoteId', () => {
  it.each(['123456789', 'suporte@ad', 'pc.recepcao-01'])('accepts %s', (id) => {
    expect(isValidRemoteId(id)).toBe(true)
  })

  it.each(['', 'ab', 'has space', 'a;b=c', 'x'.repeat(65), 'rm -rf /'])(
    'rejects %j',
    (id) => {
      expect(isValidRemoteId(id)).toBe(false)
    },
  )
})

describe('validateLinkTemplate', () => {
  it('accepts allowed schemes that carry {id}', () => {
    expect(validateLinkTemplate('rustdesk://connection/new/{id}')).toBeNull()
    expect(validateLinkTemplate('anydesk:{id}')).toBeNull()
    expect(validateLinkTemplate('https://remote.example.com/c/{id}')).toBeNull()
  })

  it('requires the {id} placeholder', () => {
    expect(validateLinkTemplate('rustdesk://connection/new/')).toMatch(/\{id\}/)
  })

  it.each([
    'javascript:alert({id})',
    'data:text/html,{id}',
    'ftp://x/{id}',
    '{id}',
  ])('rejects the scheme of %s', (template) => {
    expect(validateLinkTemplate(template)).toMatch(/rustdesk/)
  })
})

describe('buildRemoteLink', () => {
  it('uses the provider default', () => {
    expect(buildRemoteLink('RUSTDESK', '123456789')).toBe(
      'rustdesk://connection/new/123456789',
    )
    expect(buildRemoteLink('ANYDESK', '987654321', null)).toBe(
      'anydesk:987654321',
    )
  })

  it('uses a valid custom template and encodes the id', () => {
    expect(
      buildRemoteLink('ANYDESK', 'a@ad', 'https://remote.example.com/c/{id}'),
    ).toBe('https://remote.example.com/c/a%40ad')
  })

  it('falls back to the default when the template is unsafe', () => {
    expect(buildRemoteLink('RUSTDESK', '1234', 'javascript:alert({id})')).toBe(
      'rustdesk://connection/new/1234',
    )
  })
})
