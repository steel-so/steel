import { describe, expect, it } from 'vitest'
import {
  accountFromGmailTitle,
  buildGmailContact,
  buildLinkedinContact,
  buildWhatsAppContact,
  contactKey,
  linkedinProfile,
  nameFromLinkedinTitle,
  phoneFromMessageId,
  splitHeadline,
} from '../src/lib/extract'

describe('phoneFromMessageId', () => {
  it('reads the JID of a direct message', () => {
    expect(phoneFromMessageId('false_5511912345678@c.us_3EB0ABC')).toBe('5511912345678')
    expect(phoneFromMessageId('true_5511912345678@s.whatsapp.net_AAA')).toBe('5511912345678')
  })

  it('ignores groups, LIDs and empty values', () => {
    expect(phoneFromMessageId('false_120363123456789012@g.us_3EB0')).toBeNull()
    expect(phoneFromMessageId('false_123456789012345@lid_3EB0')).toBeNull()
    expect(phoneFromMessageId(null)).toBeNull()
    expect(phoneFromMessageId(undefined)).toBeNull()
  })
})

describe('buildWhatsAppContact', () => {
  it('uses the JID for the phone and the title for the name', () => {
    expect(
      buildWhatsAppContact({ title: ' Maria  Silva ', messageId: 'false_5511912345678@c.us_X' }),
    ).toEqual({
      source: 'whatsapp',
      name: 'Maria Silva',
      phones: ['5511912345678'],
      emails: [],
      company: null,
      jobTitle: null,
      linkedin: null,
    })
  })

  it('reads the phone from the title of an unsaved contact', () => {
    const contact = buildWhatsAppContact({ title: '+55 11 91234-5678', messageId: null })
    expect(contact?.name).toBeNull()
    expect(contact?.phones).toEqual(['5511912345678'])
  })

  it('keeps just the name when no number is known', () => {
    const contact = buildWhatsAppContact({ title: 'Maria', messageId: undefined })
    expect(contact?.name).toBe('Maria')
    expect(contact?.phones).toEqual([])
  })

  it('returns nothing for a group or an empty header', () => {
    expect(buildWhatsAppContact({ title: 'Equipe', messageId: 'false_1203@g.us_X' })).toBeNull()
    expect(buildWhatsAppContact({ title: '  ', messageId: null })).toBeNull()
    expect(buildWhatsAppContact({ title: null, messageId: null })).toBeNull()
  })
})

describe('Gmail', () => {
  it('finds the account in the tab title', () => {
    expect(accountFromGmailTitle('Caixa de entrada (3) - Voce@Example.com - Gmail')).toBe(
      'voce@example.com',
    )
    expect(accountFromGmailTitle('Gmail')).toBeNull()
    expect(accountFromGmailTitle(undefined)).toBeNull()
  })

  it('picks the latest sender who is not the account owner', () => {
    const contact = buildGmailContact({
      senders: [
        { email: 'Ana@Cliente.com', name: 'Ana Souza' },
        { email: 'voce@example.com', name: 'Você' },
        { email: 'bruno@cliente.com', name: 'Bruno' },
        { email: 'ana@cliente.com', name: 'Ana duplicada' },
        { email: 'not-an-email', name: 'x' },
      ],
      recipients: [],
      account: 'voce@example.com',
    })
    expect(contact?.emails).toEqual(['bruno@cliente.com'])
    expect(contact?.name).toBe('Bruno')
    expect(contact?.source).toBe('gmail')
  })

  it('falls back to the first recipient when the owner wrote alone', () => {
    const contact = buildGmailContact({
      senders: [{ email: 'voce@example.com', name: null }],
      recipients: [{ email: 'cliente@acme.com', name: 'cliente@acme.com' }],
      account: 'voce@example.com',
    })
    expect(contact?.emails).toEqual(['cliente@acme.com'])
    expect(contact?.name).toBeNull()
  })

  it('works without knowing the account and returns null on an empty thread', () => {
    expect(
      buildGmailContact({ senders: [{ email: 'a@b.co', name: 'A' }], recipients: [], account: null })
        ?.emails,
    ).toEqual(['a@b.co'])
    expect(buildGmailContact({ senders: [], recipients: [], account: null })).toBeNull()
  })
})

describe('LinkedIn', () => {
  it('normalizes a profile address', () => {
    expect(linkedinProfile('https://br.linkedin.com/in/Maria-Silva-123/?x=1')).toEqual({
      url: 'https://www.linkedin.com/in/maria-silva-123',
      slug: 'maria-silva-123',
    })
    expect(linkedinProfile('https://www.linkedin.com/in/jos%C3%A9/')?.slug).toBe('josé')
    expect(linkedinProfile('https://www.linkedin.com/in/%E0%A4%A/')?.slug).toBe('%e0%a4%a')
  })

  it('rejects other pages', () => {
    expect(linkedinProfile('https://www.linkedin.com/feed/')).toBeNull()
    expect(linkedinProfile(null)).toBeNull()
  })

  it('splits the headline into title and company', () => {
    expect(splitHeadline('Head of Sales at Acme')).toEqual({ jobTitle: 'Head of Sales', company: 'Acme' })
    expect(splitHeadline('Gerente de Vendas na Stratus | Telecom')).toEqual({
      jobTitle: 'Gerente de Vendas',
      company: 'Stratus',
    })
    expect(splitHeadline('Especialista em Redes na Vivo')).toEqual({
      jobTitle: 'Especialista em Redes',
      company: 'Vivo',
    })
    expect(splitHeadline('CEO - Acme')).toEqual({ jobTitle: 'CEO', company: 'Acme' })
    expect(splitHeadline('Analista em Dados Acme')).toEqual({
      jobTitle: 'Analista',
      company: 'Dados Acme',
    })
    expect(splitHeadline('Freelancer')).toEqual({ jobTitle: 'Freelancer', company: null })
    expect(splitHeadline('  ')).toEqual({ jobTitle: null, company: null })
    expect(splitHeadline(undefined)).toEqual({ jobTitle: null, company: null })
  })

  it('reads the name from the tab title', () => {
    expect(nameFromLinkedinTitle('(3) Maria Silva | LinkedIn')).toBe('Maria Silva')
    expect(nameFromLinkedinTitle(undefined)).toBeNull()
  })

  it('builds the contact', () => {
    expect(
      buildLinkedinContact({
        href: 'https://www.linkedin.com/in/maria/',
        name: ' Maria Silva ',
        headline: 'CTO at Acme',
      }),
    ).toEqual({
      source: 'linkedin',
      name: 'Maria Silva',
      phones: [],
      emails: [],
      company: 'Acme',
      jobTitle: 'CTO',
      linkedin: 'https://www.linkedin.com/in/maria',
    })
    expect(
      buildLinkedinContact({ href: 'https://www.linkedin.com/feed/', name: 'x', headline: 'y' }),
    ).toBeNull()
  })
})

describe('contactKey', () => {
  it('is empty for no contact and stable for the same one', () => {
    expect(contactKey(null)).toBe('')
    const contact = buildWhatsAppContact({ title: 'Ana', messageId: null })
    expect(contactKey(contact)).toBe(contactKey(structuredClone(contact)))
  })
})
