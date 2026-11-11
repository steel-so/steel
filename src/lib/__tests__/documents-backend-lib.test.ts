import { describe, expect, it } from 'vitest'
import type { DocumentFieldInfo } from '@/src/lib/canvas-document/fields'
import {
  sanitizePricingSelection,
  validateDocumentAnswers,
} from '@/src/lib/documents/answers'
import {
  formatDocumentDate,
  formatDocumentMoney,
} from '@/src/lib/documents/format'
import {
  canonicalJson,
  documentVersionHash,
  hashDocumentIp,
  newDocumentToken,
} from '@/src/lib/documents/hash'
import {
  parseDocumentSettings,
  pickSentSettings,
} from '@/src/lib/documents/settings'
import { isLinkPreviewBot } from '@/src/lib/documents/user-agent'
import { DEFAULT_DOCUMENT_SETTINGS } from '@/src/schemas/document.schema'

const field = (
  id: string,
  type: DocumentFieldInfo['type'],
  extra?: Partial<DocumentFieldInfo>,
): DocumentFieldInfo => ({ id, type, label: id, ...extra })

describe('documents hash helpers', () => {
  it('canonicalJson sorts keys at every level and drops undefined', () => {
    const nested = { b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } }
    expect(canonicalJson(nested)).toBe(
      '{"a":{"c":null,"d":[2,{"y":2,"z":1}]},"b":1}',
    )
    expect(canonicalJson({ a: undefined, b: 'x' })).toBe('{"b":"x"}')
    expect(canonicalJson(undefined)).toBe('null')
  })

  it('documentVersionHash is stable across key order and changes with content', () => {
    const one = documentVersionHash({
      content: { a: 1, b: 2 },
      theme: {},
      settings: { layout: 'web' },
    })
    const same = documentVersionHash({
      settings: { layout: 'web' },
      theme: {},
      content: { b: 2, a: 1 },
    })
    const other = documentVersionHash({
      content: { a: 1, b: 3 },
      theme: {},
      settings: { layout: 'web' },
    })
    expect(one).toMatch(/^[0-9a-f]{64}$/)
    expect(one).toBe(same)
    expect(one).not.toBe(other)
  })

  it('newDocumentToken is a random 32-byte base64url string', () => {
    const token = newDocumentToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(newDocumentToken()).not.toBe(token)
  })

  it('hashDocumentIp never returns the raw IP', () => {
    const hashed = hashDocumentIp('203.0.113.7')
    expect(hashed).toMatch(/^[0-9a-f]{64}$/)
    expect(hashed).not.toContain('203')
  })
})

describe('validateDocumentAnswers', () => {
  it('normalizes valid answers and drops unknown keys', () => {
    const result = validateDocumentAnswers(
      [
        field('name', 'field-text', { required: true }),
        field('cpf', 'field-cpf'),
        field('cnpj', 'field-cnpj'),
        field('mail', 'field-email'),
        field('phone', 'field-phone'),
        field('qty', 'field-number'),
        field('day', 'field-date'),
        field('notes', 'field-textarea'),
        field('agree', 'field-checkbox', { required: true }),
        field('plan', 'field-select', { options: ['A', 'B'] }),
        field('tags', 'field-select', { options: ['x', 'y'], multiple: true }),
        field('empty', 'field-text'),
      ],
      {
        name: '  Maria  ',
        cpf: '529.982.247-25',
        cnpj: '11.222.333/0001-81',
        mail: 'Maria@Example.com',
        phone: '(11) 98888-7777',
        qty: '3,5',
        day: '30/11/2026',
        notes: ' texto ',
        agree: true,
        plan: 'B',
        tags: ['x', 'y'],
        empty: '',
        unknown: 'drop me',
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.values).toEqual({
      name: 'Maria',
      cpf: '52998224725',
      cnpj: '11222333000181',
      mail: 'maria@example.com',
      phone: '11988887777',
      qty: 3.5,
      day: '2026-11-30T00:00:00.000Z',
      notes: 'texto',
      agree: true,
      plan: 'B',
      tags: ['x', 'y'],
    })
  })

  it('reports every invalid or missing field', () => {
    const result = validateDocumentAnswers(
      [
        field('name', 'field-text', { required: true }),
        field('cpf', 'field-cpf'),
        field('agree', 'field-checkbox', { required: true }),
        field('flag', 'field-checkbox'),
        field('plan', 'field-select', { options: ['A'] }),
        field('one', 'field-select', { options: ['A', 'B'] }),
        field('notes', 'field-textarea'),
        field('long', 'field-textarea'),
        field('mail', 'field-email'),
        field('list', 'field-text'),
      ],
      {
        cpf: '111.111.111-11',
        agree: false,
        flag: 'yes',
        plan: 'Z',
        one: ['A', 'B'],
        notes: 12,
        long: 'x'.repeat(5001),
        mail: 'nope',
        list: ['a'],
      },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toBe('"name" é obrigatório')
    expect(Object.keys(result.errors).sort()).toEqual(
      [
        'agree',
        'cpf',
        'flag',
        'list',
        'long',
        'mail',
        'name',
        'notes',
        'one',
        'plan',
      ].sort(),
    )
    expect(result.errors.agree).toBe('"agree" é obrigatório')
    expect(result.errors.one).toBe('"one" aceita uma opção')
  })

  it('accepts an empty optional field and a select without options list', () => {
    const result = validateDocumentAnswers(
      [field('plan', 'field-select'), field('opt', 'field-email')],
      { plan: null },
    )
    expect(result).toEqual({ ok: true, values: {} })
  })

  it('rejects a select value when the field has no options', () => {
    const fields = [field('plan', 'field-select')]
    const result = validateDocumentAnswers(fields, { plan: 'A' })
    expect(result.ok).toBe(false)
  })

  it('treats an empty array as missing', () => {
    const result = validateDocumentAnswers(
      [field('tags', 'field-select', { required: true, multiple: true })],
      { tags: [] },
    )
    expect(result.ok).toBe(false)
  })
})

describe('sanitizePricingSelection', () => {
  it('keeps only the items of the version', () => {
    expect(
      sanitizePricingSelection(
        [{ id: 'a', name: 'A', unitPrice: 1, quantity: 1 }],
        {
          a: { selected: true, quantity: 2 },
          ghost: { selected: true, quantity: 9 },
        },
      ),
    ).toEqual({ a: { selected: true, quantity: 2 } })
  })
})

describe('documents settings helpers', () => {
  it('parseDocumentSettings fills defaults and falls back on invalid data', () => {
    expect(parseDocumentSettings({ showToc: true })).toEqual({
      ...DEFAULT_DOCUMENT_SETTINGS,
      showToc: true,
    })
    expect(parseDocumentSettings({ layout: 'nope' })).toEqual(
      DEFAULT_DOCUMENT_SETTINGS,
    )
    expect(parseDocumentSettings(null)).toEqual(DEFAULT_DOCUMENT_SETTINGS)
  })

  it('pickSentSettings keeps only the keys present in the raw body', () => {
    expect(
      pickSentSettings(
        { ...DEFAULT_DOCUMENT_SETTINGS, showToc: true },
        { showToc: true },
      ),
    ).toEqual({ showToc: true })
    expect(pickSentSettings(undefined, { showToc: true })).toBeUndefined()
    expect(pickSentSettings({ showToc: true }, 'oops')).toBeUndefined()
  })
})

describe('documents format and user agent helpers', () => {
  it('formats money and dates in pt-BR (São Paulo)', () => {
    expect(formatDocumentMoney(48000)).toBe('R$ 48.000,00')
    expect(formatDocumentDate(new Date('2026-12-01T02:00:00.000Z'))).toBe(
      '30/11/2026',
    )
  })

  it('flags link previews and missing user agents as bots', () => {
    expect(isLinkPreviewBot(null)).toBe(true)
    expect(isLinkPreviewBot('WhatsApp/2.23.20.0 A')).toBe(true)
    expect(isLinkPreviewBot('facebookexternalhit/1.1')).toBe(true)
    expect(
      isLinkPreviewBot(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36',
      ),
    ).toBe(false)
  })
})
