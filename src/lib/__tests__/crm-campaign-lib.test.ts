import { describe, expect, it } from 'vitest'
import {
  buildCampaignAudience,
  type CampaignOptOutIndex,
} from '../crm-campaign/audience'
import {
  buildDestinationUrl,
  hasCampaignRef,
  readCampaignRefParams,
  slugifyCampaignName,
  withCampaignParams,
} from '../crm-campaign/campaign-url'
import { formatE164, toCampaignWaId } from '../crm-campaign/phone'
import {
  isWithinSendWindow,
  nextSendWindowOpen,
} from '../crm-campaign/send-window'
import {
  campaignClickUrl,
  campaignOpenPixelUrl,
  createCampaignLinkToken,
  createCampaignUnsubscribeToken,
  verifyCampaignLinkToken,
  verifyCampaignUnsubscribeToken,
} from '../crm-campaign/tokens'
import {
  firstName,
  quickReplyCarriesLink,
  renderButtonUrl,
  renderZapiText,
  resolveTemplateValues,
  templateBlockedReason,
  templateFields,
  validateCampaignWhatsApp,
} from '../crm-campaign/whatsapp-rules'

describe('send window (America/Sao_Paulo)', () => {
  // 2026-10-09 is a Friday; São Paulo is UTC-3.
  const fri10 = new Date('2026-10-09T13:00:00.000Z') // 10:00 local
  const fri20 = new Date('2026-10-09T23:30:00.000Z') // 20:30 local
  const business = { startHour: 8, endHour: 18, weekdaysOnly: true }

  it('should accept any time without hours', () => {
    expect(
      isWithinSendWindow(fri20, {
        startHour: null,
        endHour: null,
        weekdaysOnly: false,
      }),
    ).toBe(true)
  })

  it('should check business hours in the São Paulo timezone', () => {
    expect(isWithinSendWindow(fri10, business)).toBe(true)
    expect(isWithinSendWindow(fri20, business)).toBe(false)
  })

  it('should handle a window crossing midnight', () => {
    const night = { startHour: 22, endHour: 6, weekdaysOnly: false }
    expect(isWithinSendWindow(new Date('2026-10-10T02:00:00Z'), night)).toBe(
      true,
    ) // 23:00 local
    expect(isWithinSendWindow(fri10, night)).toBe(false)
  })

  it('should block weekends when weekdaysOnly', () => {
    const sat10 = new Date('2026-10-10T13:00:00.000Z')
    expect(isWithinSendWindow(sat10, business)).toBe(false)
    expect(
      isWithinSendWindow(sat10, { ...business, weekdaysOnly: false }),
    ).toBe(true)
  })

  it('should return the same instant when already open', () => {
    expect(nextSendWindowOpen(fri10, business)).toBe(fri10)
  })

  it('should jump to Monday 08:00 from Friday night', () => {
    expect(nextSendWindowOpen(fri20, business).toISOString()).toBe(
      '2026-10-12T11:00:00.000Z',
    )
  })
})

describe('campaign URLs', () => {
  it('should build landing and form destinations', () => {
    expect(
      buildDestinationUrl('https://app.test/', {
        type: 'LANDING_PAGE',
        token: 'abc',
      }),
    ).toBe('https://app.test/l/abc')
    expect(
      buildDestinationUrl('https://app.test', { type: 'FORM', token: 'xyz' }),
    ).toBe('https://app.test/f/xyz')
  })

  it('should append the UTM parameters and the ref', () => {
    const url = new URL(
      withCampaignParams('https://app.test/l/abc?x=1', {
        source: 'email',
        medium: 'campanha',
        campaign: 'black-friday',
        ref: 'tok',
      }),
    )
    expect(url.searchParams.get('x')).toBe('1')
    expect(url.searchParams.get('utm_source')).toBe('email')
    expect(url.searchParams.get('utm_medium')).toBe('campanha')
    expect(url.searchParams.get('utm_campaign')).toBe('black-friday')
    expect(url.searchParams.get('stc')).toBe('tok')
    expect(
      withCampaignParams('https://app.test/l/abc', {
        source: 'whatsapp',
        medium: 'm',
        campaign: 'c',
      }),
    ).not.toContain('stc=')
  })

  it('should slugify names', () => {
    expect(slugifyCampaignName('  Promoção de Verão 2026! ')).toBe(
      'promocao-de-verao-2026',
    )
    expect(slugifyCampaignName('!!!')).toBe('campanha')
    expect(slugifyCampaignName(`${'a'.repeat(59)} b`)).toHaveLength(59)
  })

  it('should read campaign params of a page URL', () => {
    const ref = readCampaignRefParams(
      '?utm_campaign=bf&utm_source=email&stc=tok&other=1',
    )
    expect(ref).toEqual({ ref: 'tok', utmCampaign: 'bf', utmSource: 'email' })
    expect(hasCampaignRef(ref)).toBe(true)
    expect(hasCampaignRef(readCampaignRefParams('?utm_source=x&stc= '))).toBe(
      false,
    )
  })
})

describe('phone → waId', () => {
  it.each([
    ['(11) 99999-0000', '5511999990000'],
    ['1133334444', '551133334444'],
    ['+55 11 99999-0000', '5511999990000'],
    ['0044 20 7946 0958', '442079460958'],
  ])('%s → %s', (raw, expected) => {
    expect(toCampaignWaId(raw)).toBe(expected)
  })

  it.each([null, undefined, '', '1234', '1'.repeat(16)])(
    'should reject %s',
    (raw) => {
      expect(toCampaignWaId(raw)).toBeNull()
    },
  )

  it('should format E.164', () => {
    expect(formatE164('5511999990000')).toBe('+5511999990000')
  })
})

describe('audience snapshot', () => {
  const none: CampaignOptOutIndex = {
    emails: new Set(),
    personIds: new Set(),
    waIds: new Set(),
  }

  it('should dedupe by person, lead and e-mail (first wins)', () => {
    const { rows, counts } = buildCampaignAudience(
      [
        {
          personId: 'p1',
          name: 'Ana',
          email: 'ANA@x.com',
          phone: '11999990000',
        },
        { personId: 'p1', name: 'Ana dup', email: 'other@x.com' },
        { leadId: 'l1', name: 'Lead', email: 'ana@x.com' },
        { leadId: 'l2', name: 'Lead 2', email: 'lead2@x.com' },
        { leadId: 'l2', name: 'Lead 2 dup' },
        { name: 'Avulso', email: 'avulso@x.com' },
        { name: 'Sem nada' },
        { name: '', email: 'semnome@x.com' },
      ],
      none,
      { whatsappEnabled: true },
    )
    expect(rows.map((r) => r.name)).toEqual([
      'Ana',
      'Lead 2',
      'Avulso',
      'semnome@x.com',
    ])
    expect(rows[0]).toMatchObject({
      email: 'ana@x.com',
      waId: '5511999990000',
      emailState: { status: 'PENDING' },
      whatsappState: { status: 'PENDING' },
    })
    expect(counts).toEqual({
      total: 4,
      email: { reachable: 4, optedOut: 0, missing: 0 },
      whatsapp: { reachable: 1, optedOut: 0, missing: 3 },
    })
  })

  it('should exclude opted-out contacts per channel', () => {
    const { rows, counts } = buildCampaignAudience(
      [
        { personId: 'p1', name: 'A', email: 'a@x.com', phone: '11999990001' },
        { personId: 'p2', name: 'B', email: 'b@x.com', phone: '11999990002' },
        { leadId: 'l1', name: 'C', phone: '11999990003' },
      ],
      {
        emails: new Set(['a@x.com']),
        personIds: new Set(['p2']),
        waIds: new Set(['5511999990003']),
      },
      { whatsappEnabled: true },
    )
    expect(rows.map((r) => r.emailState.status)).toEqual([
      'SKIPPED',
      'SKIPPED',
      'NONE',
    ])
    expect(rows[2].whatsappState).toEqual({
      status: 'SKIPPED',
      skipReason: 'opted_out',
    })
    expect(counts.email).toEqual({ reachable: 0, optedOut: 2, missing: 1 })
    expect(counts.whatsapp).toEqual({ reachable: 2, optedOut: 1, missing: 0 })
  })

  it('should treat Apollo-imported leads like any other on WhatsApp', () => {
    const { rows } = buildCampaignAudience(
      [
        {
          leadId: 'l1',
          name: 'Imported',
          email: 'cold@x.com',
          phone: '11999990001',
        },
      ],
      none,
      { whatsappEnabled: true },
    )
    expect(rows[0].waId).not.toBeNull()
    expect(rows[0].whatsappState).toEqual({
      status: 'PENDING',
      skipReason: null,
    })
    expect(rows[0].emailState.status).toBe('PENDING')
  })

  it('should leave WhatsApp off when disabled', () => {
    const { rows, counts } = buildCampaignAudience(
      [{ personId: 'p1', name: 'A', email: 'a@x.com', phone: '11999990001' }],
      none,
      { whatsappEnabled: false },
    )
    expect(rows[0].whatsappState).toEqual({ status: 'NONE', skipReason: null })
    expect(counts.whatsapp).toEqual({ reachable: 0, optedOut: 0, missing: 0 })
  })

  it('should fall back to a generic name', () => {
    const { rows } = buildCampaignAudience(
      [{ leadId: 'l1', name: ' ', phone: '11999990001' }],
      none,
      { whatsappEnabled: true },
    )
    expect(rows[0].name).toBe('Contato')
  })
})

describe('campaign tokens', () => {
  it('should round-trip link tokens per channel', () => {
    const email = createCampaignLinkToken('rcpt1', 'EMAIL')
    const wa = createCampaignLinkToken('rcpt1', 'WHATSAPP')
    expect(verifyCampaignLinkToken(email)).toEqual({
      recipientId: 'rcpt1',
      channel: 'EMAIL',
    })
    expect(verifyCampaignLinkToken(wa)?.channel).toBe('WHATSAPP')
    expect(email).toMatch(/^rcpt1-e\.[A-Za-z0-9_-]{22}$/)
  })

  it('should reject forged or malformed link tokens', () => {
    const [, signature] = createCampaignLinkToken('rcpt1', 'EMAIL').split('.')
    expect(verifyCampaignLinkToken(`rcpt2-e.${signature}`)).toBeNull()
    expect(verifyCampaignLinkToken('nodot')).toBeNull()
    expect(verifyCampaignLinkToken('.abc')).toBeNull()
    expect(verifyCampaignLinkToken(`rcpt1-e.${signature}x`)).toBeNull()
  })

  it('should reject a signed payload without channel', () => {
    // An unsubscribe token is signed under another domain.
    const unsub = createCampaignUnsubscribeToken('rcpt1')
    expect(verifyCampaignLinkToken(unsub)).toBeNull()
  })

  it('should round-trip unsubscribe tokens and keep domains apart', () => {
    const token = createCampaignUnsubscribeToken('rcpt1')
    expect(verifyCampaignUnsubscribeToken(token)).toBe('rcpt1')
    expect(
      verifyCampaignUnsubscribeToken(createCampaignLinkToken('rcpt1', 'EMAIL')),
    ).toBeNull()
  })

  it('should build the public tracking URLs', () => {
    expect(campaignClickUrl('https://a.test/', 't')).toBe(
      'https://a.test/api/crm/campaigns/c/t',
    )
    expect(campaignOpenPixelUrl('https://a.test', 't')).toBe(
      'https://a.test/api/crm/campaigns/o/t',
    )
  })
})

describe('WhatsApp provider rules', () => {
  const metaTemplate = {
    status: 'APPROVED',
    components: [
      { type: 'HEADER', format: 'TEXT', text: 'Olá {{1}}' },
      { type: 'BODY', text: 'Oi {{1}}, veja {{2}}' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Sim' },
          { type: 'URL', text: 'Abrir', url: 'https://a.test/c/{{1}}' },
        ],
      },
    ],
  }

  it('should require text with {link} on Z-API', () => {
    const base = {
      provider: 'ZAPI' as const,
      template: null,
      variables: null,
      mediaUrl: null,
    }
    expect(validateCampaignWhatsApp({ ...base, text: ' ' })).toEqual([
      'Escreva a mensagem do WhatsApp',
    ])
    expect(validateCampaignWhatsApp({ ...base, text: 'Oi {nome}' })[0]).toMatch(
      /\{link\}/,
    )
    expect(
      validateCampaignWhatsApp({ ...base, text: 'Oi {nome}, {link}' }),
    ).toEqual([])
  })

  it('should require an approved template on Meta', () => {
    const base = {
      provider: 'META' as const,
      variables: null,
      text: null,
      mediaUrl: null,
    }
    expect(validateCampaignWhatsApp({ ...base, template: null })[0]).toMatch(
      /template aprovado/,
    )
    expect(
      validateCampaignWhatsApp({
        ...base,
        template: { ...metaTemplate, status: 'PENDING' },
      })[0],
    ).toMatch(/não está aprovado/)
  })

  it('should require every Meta variable to be mapped', () => {
    const base = {
      provider: 'META' as const,
      template: metaTemplate,
      text: null,
      mediaUrl: null,
    }
    expect(validateCampaignWhatsApp({ ...base, variables: null })).toEqual([
      'Preencha as 4 variável(is) do template',
    ])
    expect(
      validateCampaignWhatsApp({
        ...base,
        variables: {
          header: { '1': { source: 'first_name' } },
          body: { '1': { source: 'name' }, '2': { source: 'link' } },
          buttons: { '1': { source: 'link_code' } },
        },
      }),
    ).toEqual([])
  })

  it('should resolve template values for a recipient', () => {
    const fields = templateFields(metaTemplate.components)
    const ctx = { name: 'Ana Souza', link: 'https://l', linkCode: 'tok' }
    expect(
      resolveTemplateValues(
        fields,
        {
          header: { '1': { source: 'first_name' } },
          body: {
            '1': { source: 'static', value: 'Promo' },
            '2': { source: 'link' },
          },
          buttons: { '1': { source: 'link_code' } },
        },
        ctx,
      ),
    ).toEqual({
      header: { 1: 'Ana' },
      body: { 1: 'Promo', 2: 'https://l' },
      buttons: { 1: 'tok' },
    })
    expect(
      resolveTemplateValues(fields, null, { ...ctx, name: ' ' }).body,
    ).toEqual({ 1: '', 2: '' })
    expect(
      resolveTemplateValues(
        fields,
        {
          header: { '1': { source: 'name' } },
          body: { '1': { source: 'first_name' }, '2': { source: 'static' } },
          buttons: {},
        },
        { ...ctx, name: '' },
      ),
    ).toEqual({
      header: { 1: 'cliente' },
      body: { 1: 'cliente', 2: '' },
      buttons: { 1: '' },
    })
  })

  it('should read fields of non-array components as empty', () => {
    expect(templateFields(null).body.variableCount).toBe(0)
  })

  it('should render Z-API text tokens', () => {
    const ctx = { name: 'Ana Souza', link: 'https://l', linkCode: 't' }
    expect(renderZapiText('{primeiro_nome}/{nome}: {link}', ctx)).toBe(
      'Ana/Ana Souza: https://l',
    )
    expect(renderZapiText('{nome} {primeiro_nome}', { ...ctx, name: '' })).toBe(
      'cliente cliente',
    )
  })

  it('should take the first name', () => {
    expect(firstName('  Ana  Souza ')).toBe('Ana')
    expect(firstName('')).toBe('')
  })
})

describe('WhatsApp template blocking and quick replies', () => {
  it('should explain why paused, disabled, unapproved or red templates are blocked', () => {
    expect(
      templateBlockedReason({ status: 'APPROVED', quality: 'GREEN' }),
    ).toBeNull()
    expect(templateBlockedReason({ status: 'APPROVED' })).toBeNull()
    expect(
      templateBlockedReason({ status: 'APPROVED', quality: 'RED' }),
    ).toMatch(/Qualidade baixa/)
    expect(
      templateBlockedReason({
        status: 'PAUSED',
        statusReason: 'Muitas denúncias',
      }),
    ).toMatch(/pausou.*Motivo informado: Muitas denúncias\./)
    expect(templateBlockedReason({ status: 'DISABLED' })).toMatch(/desativou/)
    expect(templateBlockedReason({ status: 'PENDING' })).toMatch(
      /não está aprovado/,
    )
    expect(
      validateCampaignWhatsApp({
        provider: 'META',
        template: { status: 'APPROVED', quality: 'RED', components: [] },
        variables: null,
        text: null,
        mediaUrl: null,
      })[0],
    ).toMatch(/Qualidade baixa/)
  })

  it('should accept the campaign link in a quick reply URL button', () => {
    const buttons = [
      { type: 'REPLY' },
      { type: 'URL', url: 'https://x.test/{link}' },
    ]
    expect(quickReplyCarriesLink(buttons)).toBe(true)
    expect(
      quickReplyCarriesLink([{ type: 'URL', url: 'https://x.test' }]),
    ).toBe(false)
    expect(quickReplyCarriesLink([{ type: 'URL' }])).toBe(false)
    const base = {
      provider: 'ZAPI' as const,
      template: null,
      variables: null,
      mediaUrl: null,
      text: 'Oi {nome}',
    }
    expect(
      validateCampaignWhatsApp({ ...base, quickReply: { buttons } }),
    ).toEqual([])
    expect(
      validateCampaignWhatsApp({ ...base, quickReply: { buttons: [] } })[0],
    ).toMatch(/\{link\}/)
    expect(validateCampaignWhatsApp({ ...base, quickReply: null })).toEqual([
      'A resposta rápida escolhida não existe mais',
    ])
  })

  it('should put the recipient link in a button URL', () => {
    expect(
      renderButtonUrl('https://x.test/?to={link}', {
        name: 'Ana',
        link: 'https://l',
        linkCode: 'c',
      }),
    ).toBe('https://x.test/?to=https://l')
  })
})
