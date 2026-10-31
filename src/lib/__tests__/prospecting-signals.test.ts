import { describe, expect, it } from 'vitest'
import {
  detectBuyingSignals,
  MAX_SIGNALS_PER_TEXT,
  PROSPECT_SIGNAL_LABELS,
  PROSPECT_SIGNAL_TYPES,
} from '@/src/lib/prospecting/signals'

const typesOf = (text: string, keywords: string[] = []) =>
  detectBuyingSignals(text, keywords).map((signal) => signal.type)

describe('detectBuyingSignals()', () => {
  it.each([
    ['HIRING', 'Estamos contratando analistas de redes em Curitiba.'],
    ['HIRING', 'See our open positions and join our team.'],
    ['FUNDING', 'A empresa anunciou uma rodada de investimento de R$ 20 mi.'],
    ['FUNDING', 'The startup raised $12.5 million in a seed round.'],
    ['EXPANSION', 'A inauguração da nova filial em Recife é em março.'],
    ['EXPANSION', 'A rede inaugurará três lojas em 2027.'],
    ['TECH_CHANGE', 'Iniciamos a migração para a nuvem e um novo ERP.'],
    ['LEADERSHIP_CHANGE', 'A Acme apresenta o novo diretor de operações.'],
    ['TENDER', 'Aviso de licitação para serviços de telefonia.'],
    ['LAUNCH', 'A empresa lançará uma nova linha de produtos.'],
    ['PAIN', 'Clientes relatam instabilidade e queda de serviço.'],
  ] as const)('should find a %s signal in "%s"', (type, text) => {
    expect(typesOf(text)).toContain(type)
  })

  it('should return nothing for a neutral text', () => {
    expect(detectBuyingSignals('Quem somos: uma empresa de logística.')).toEqual(
      [],
    )
  })

  it('should return the snippet around the match with ellipses', () => {
    const text = `${'a '.repeat(200)}estamos contratando agora${' b'.repeat(200)}`
    const [signal] = detectBuyingSignals(text)
    expect(signal.snippet.startsWith('…')).toBe(true)
    expect(signal.snippet.endsWith('…')).toBe(true)
    expect(signal.snippet).toContain('estamos contratando')
    expect(signal.match.toLowerCase()).toBe('estamos contratando')
    expect(signal.label).toBe(PROSPECT_SIGNAL_LABELS.HIRING)
  })

  it('should keep short texts whole, without ellipses', () => {
    const [signal] = detectBuyingSignals('Estamos contratando!')
    expect(signal.snippet).toBe('Estamos contratando!')
  })

  it('should report one hit per rule', () => {
    const text = 'Vagas abertas. Estamos contratando. Trabalhe conosco.'
    expect(typesOf(text).filter((type) => type === 'HIRING')).toHaveLength(1)
  })

  it('should add workspace keywords as CUSTOM signals, escaping regex symbols', () => {
    const signals = detectBuyingSignals('Usamos PABX (legado) há anos.', [
      'pabx',
      'c++',
      '  ',
      'ab',
      '(legado)',
    ])
    const custom = signals.filter((signal) => signal.type === 'CUSTOM')
    expect(custom.map((signal) => signal.match)).toEqual(['PABX', '(legado)'])
    expect(custom[0].label).toBe(PROSPECT_SIGNAL_LABELS.CUSTOM)
  })

  it('should cap the number of signals', () => {
    const keywords = Array.from({ length: 30 }, (_, i) => `termo${i}`)
    const text = keywords.join(' ')
    expect(detectBuyingSignals(text, keywords)).toHaveLength(
      MAX_SIGNALS_PER_TEXT,
    )
  })

  it('should label every signal type', () => {
    for (const type of PROSPECT_SIGNAL_TYPES) {
      expect(PROSPECT_SIGNAL_LABELS[type]).toBeTruthy()
    }
  })
})
