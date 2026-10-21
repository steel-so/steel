import { describe, expect, it } from 'vitest'
import {
  guessAiCampaignSheetColumns,
  parseAiCampaignSheet,
  toAiCampaignImportRows,
} from '@/src/lib/whatsapp/ai-campaign-import'

describe('parseAiCampaignSheet()', () => {
  it('should read a semicolon sheet with quotes and a BOM', () => {
    const sheet = parseAiCampaignSheet(
      '﻿Nome;Telefone;Valor\n"Silva; Maria";(11) 99999-0000;"R$ 1.200,00"\nJoão;11988887777;R$ 50\n',
    )
    expect(sheet.columns).toEqual(['Nome', 'Telefone', 'Valor'])
    expect(sheet.rows).toEqual([
      {
        Nome: 'Silva; Maria',
        Telefone: '(11) 99999-0000',
        Valor: 'R$ 1.200,00',
      },
      { Nome: 'João', Telefone: '11988887777', Valor: 'R$ 50' },
    ])
  })

  it('should read a comma sheet and name empty headers', () => {
    const sheet = parseAiCampaignSheet('phone,,vencimento\n5511,x,25/10')
    expect(sheet.columns).toEqual(['phone', 'coluna_2', 'vencimento'])
    expect(sheet.rows[0]).toEqual({
      phone: '5511',
      coluna_2: 'x',
      vencimento: '25/10',
    })
  })

  it('should return nothing for an empty file', () => {
    expect(parseAiCampaignSheet('\n\n')).toEqual({ columns: [], rows: [] })
  })
})

describe('guessAiCampaignSheetColumns()', () => {
  it('should find the phone and name columns, accents and case aside', () => {
    expect(
      guessAiCampaignSheetColumns([
        'Nome do Cliente',
        'Celular',
        'Número do pedido',
      ]),
    ).toEqual({ phone: 'Celular', name: 'Nome do Cliente' })
    expect(guessAiCampaignSheetColumns(['valor'])).toEqual({
      phone: null,
      name: null,
    })
  })
})

describe('toAiCampaignImportRows()', () => {
  it('should split phone, name and the other columns, dropping rows without phone', () => {
    const sheet = parseAiCampaignSheet(
      'Nome;Telefone;Valor;Obs\nMaria;11999990000;R$ 10;\n;;R$ 20;x',
    )
    expect(
      toAiCampaignImportRows(sheet, { phone: 'Telefone', name: 'Nome' }),
    ).toEqual([
      { phone: '11999990000', name: 'Maria', values: { Valor: 'R$ 10' } },
    ])
  })
})
