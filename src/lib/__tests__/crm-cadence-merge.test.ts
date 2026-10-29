import { describe, expect, it } from 'vitest'
import {
  cadenceDelayMs,
  cadenceTextToHtml,
  digitsOnly,
  escapeHtml,
  leadPhoneToWaId,
  phonesMatch,
  renderCadenceText,
} from '../crm-cadence/merge'

const context = {
  name: 'Ana Souza',
  company: 'Empresa SA',
  jobTitle: 'Diretora',
  city: 'Recife',
  ownerName: 'Bruno',
}

describe('renderCadenceText', () => {
  it('should fill every merge field', () => {
    expect(
      renderCadenceText(
        '{{nome}}|{{primeiro_nome}}|{{empresa}}|{{cargo}}|{{cidade}}|{{responsavel}}',
        context,
      ),
    ).toBe('Ana Souza|Ana|Empresa SA|Diretora|Recife|Bruno')
  })

  it('should accept spaces and upper case inside the braces', () => {
    expect(renderCadenceText('Oi {{ Primeiro_Nome }}', context)).toBe('Oi Ana')
  })

  it('should blank unknown and empty fields', () => {
    expect(renderCadenceText('a{{xpto}}b{{empresa}}c', { name: 'Ana' })).toBe(
      'abc',
    )
  })
})

describe('cadenceDelayMs', () => {
  it.each([
    [2, 'MINUTES', 120_000],
    [3, 'HOURS', 10_800_000],
    [1, 'DAYS', 86_400_000],
    [-5, 'DAYS', 0],
  ] as const)('should convert %i %s', (value, unit, expected) => {
    expect(cadenceDelayMs(value, unit)).toBe(expected)
  })
})

describe('phones', () => {
  it('should keep only the digits', () => {
    expect(digitsOnly('+55 (11) 9 9999-0000')).toBe('5511999990000')
  })

  it('should add the Brazilian country code when missing', () => {
    expect(leadPhoneToWaId('(11) 99999-0000')).toBe('5511999990000')
    expect(leadPhoneToWaId('+55 11 99999-0000')).toBe('5511999990000')
  })

  it('should reject numbers that are too short or too long', () => {
    expect(leadPhoneToWaId('12345')).toBeNull()
    expect(leadPhoneToWaId('1234567890123456')).toBeNull()
  })

  it('should match the same number typed in different formats', () => {
    expect(phonesMatch('(11) 99999-0000', '5511999990000')).toBe(true)
    expect(phonesMatch('(11) 99999-0000', '5511988880000')).toBe(false)
    expect(phonesMatch('999', '5511999990000')).toBe(false)
  })
})

describe('html conversion', () => {
  it('should escape markup', () => {
    expect(escapeHtml('<b>"a" & b</b>')).toBe(
      '&lt;b&gt;&quot;a&quot; &amp; b&lt;/b&gt;',
    )
  })

  it('should build paragraphs, line breaks and links', () => {
    const html = cadenceTextToHtml('Oi\nTudo bem?\n\nVeja https://a.com/x <b>')
    expect(html).toContain('Oi<br>Tudo bem?')
    expect(html).toContain('<a href="https://a.com/x">https://a.com/x</a>')
    expect(html).toContain('&lt;b&gt;')
    expect(html.match(/<p /g)).toHaveLength(2)
  })
})
