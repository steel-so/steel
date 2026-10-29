import { describe, expect, it } from 'vitest'
import {
  applyIssueTextTokens,
  buildNewsletterWhatsAppAudience,
  candidateWaId,
  issueLinkCode,
  newsletterWhatsAppProblems,
  toCampaignVariables,
  whatsappSummary,
} from '@/src/lib/newsletter/whatsapp'

const candidate = (
  over: Partial<Parameters<typeof candidateWaId>[0]> & {
    subscriberId?: string
    name?: string
  } = {},
) => ({
  subscriberId: over.subscriberId ?? 's1',
  personId: 'p1',
  name: over.name ?? 'Ana Lima',
  phones: over.phones ?? ['(11) 99999-0000'],
})

const approved = {
  status: 'APPROVED',
  quality: 'GREEN',
  components: [
    { type: 'BODY', text: 'Oi {{1}}, saiu {{2}}: {{3}} {{4}}' },
    {
      type: 'BUTTONS',
      buttons: [{ type: 'URL', text: 'Ler', url: 'https://app.test/n/{{1}}' }],
    },
  ],
}

describe('WhatsApp audience of an issue', () => {
  it('takes the first valid phone of the person', () => {
    expect(candidateWaId({ phones: ['123', '+55 11 98888-7777'] })).toBe(
      '5511988887777',
    )
    expect(candidateWaId({ phones: [] })).toBeNull()
  })

  it('dedupes numbers, keeps opted-out ones as SKIPPED and counts the reach', () => {
    const { rows, reach } = buildNewsletterWhatsAppAudience(
      [
        candidate(),
        candidate({ subscriberId: 's2', phones: ['11999990000'] }),
        candidate({ subscriberId: 's3', phones: ['abc'] }),
        candidate({ subscriberId: 's4', name: ' ', phones: ['21977776666'] }),
      ],
      new Set(['5521977776666']),
    )
    expect(rows).toEqual([
      {
        subscriberId: 's1',
        personId: 'p1',
        name: 'Ana Lima',
        waId: '5511999990000',
        status: 'PENDING',
        skipReason: null,
      },
      {
        subscriberId: 's4',
        personId: 'p1',
        name: 'Contato',
        waId: '5521977776666',
        status: 'SKIPPED',
        skipReason: 'OPTED_OUT',
      },
    ])
    expect(reach).toEqual({
      linked: 4,
      reachable: 1,
      missingPhone: 1,
      optedOut: 1,
    })
  })
})

describe('issue content on WhatsApp', () => {
  const content = { summary: 'Tudo sobre outubro', subject: 'Outubro' }

  it('maps summary/subject to static campaign sources', () => {
    expect(toCampaignVariables(null, content)).toBeNull()
    expect(
      toCampaignVariables(
        {
          header: { '1': { source: 'subject' } },
          body: {
            '1': { source: 'first_name' },
            '2': { source: 'summary' },
            '3': { source: 'static', value: 'fixo' },
          },
          buttons: { '0': { source: 'link_code' } },
        },
        content,
      ),
    ).toEqual({
      header: { '1': { source: 'static', value: 'Outubro' } },
      body: {
        '1': { source: 'first_name', value: undefined },
        '2': { source: 'static', value: 'Tudo sobre outubro' },
        '3': { source: 'static', value: 'fixo' },
      },
      buttons: { '0': { source: 'link_code', value: undefined } },
    })
    // Empty issue fields still give Meta a non-empty value.
    expect(
      toCampaignVariables(
        {
          header: {},
          body: { '1': { source: 'summary' }, '2': { source: 'subject' } },
          buttons: {},
        },
        { summary: '', subject: '' },
      )?.body,
    ).toEqual({
      '1': { source: 'static', value: ' ' },
      '2': { source: 'static', value: ' ' },
    })
  })

  it('fills {resumo} and {assunto}', () => {
    expect(applyIssueTextTokens('{assunto} — {resumo} {link}', content)).toBe(
      'Outubro — Tudo sobre outubro {link}',
    )
  })

  it('cuts the summary on a word near 280 characters', () => {
    expect(whatsappSummary(null)).toBe('')
    expect(whatsappSummary('  a\n b ')).toBe('a b')
    const long = `${'palavra '.repeat(60)}fim`
    const cut = whatsappSummary(long)
    expect(cut.length).toBeLessThanOrEqual(281)
    expect(cut.endsWith('…')).toBe(true)
    expect(cut).not.toContain('palavr…')
    const noSpaces = 'x'.repeat(400)
    expect(whatsappSummary(noSpaces)).toBe(`${'x'.repeat(280)}…`)
  })

  it('gives the path of the web version for URL buttons', () => {
    expect(issueLinkCode('https://app.test/n/acme/news/edicao-1')).toBe(
      'acme/news/edicao-1',
    )
    expect(issueLinkCode('edicao')).toBe('edicao')
  })

  it('validates the content with the campaign rules', () => {
    expect(
      newsletterWhatsAppProblems({
        provider: 'ZAPI',
        template: null,
        variables: null,
        text: 'Sem link',
      }),
    ).toEqual(['Inclua {link} na mensagem para levar o contato ao destino'])
    expect(
      newsletterWhatsAppProblems({
        provider: 'ZAPI',
        template: null,
        variables: null,
        text: 'Leia {link}',
      }),
    ).toEqual([])
    expect(
      newsletterWhatsAppProblems({
        provider: 'META',
        template: approved,
        variables: {
          header: {},
          body: { '1': { source: 'name' } },
          buttons: {},
        },
        text: null,
      }),
    ).toEqual(['Preencha as 4 variável(is) do template'])
    expect(
      newsletterWhatsAppProblems({
        provider: 'META',
        template: approved,
        variables: {
          header: {},
          body: {
            '1': { source: 'first_name' },
            '2': { source: 'subject' },
            '3': { source: 'summary' },
            '4': { source: 'link' },
          },
          buttons: { '0': { source: 'link_code' } },
        },
        text: null,
      }),
    ).toEqual([])
  })
})
