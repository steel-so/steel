import { describe, expect, it } from 'vitest'
import { findMatches, ticketSearchTerms } from '../src/lib/match'
import { contact, lead } from './helpers'

describe('findMatches', () => {
  it('matches by phone, ignoring formatting and the ninth digit', () => {
    const leads = [lead({ id: 'a', phones: ['+55 (11) 1234-5678'] }), lead({ id: 'b' })]
    expect(findMatches(leads, contact())).toEqual([{ lead: leads[0], reason: 'phone' }])
  })

  it('matches by e-mail regardless of case', () => {
    const leads = [lead({ emails: ['ANA@Cliente.com'] })]
    const result = findMatches(leads, contact({ source: 'gmail', phones: [], emails: ['ana@cliente.com'] }))
    expect(result[0]?.reason).toBe('email')
  })

  it('matches by LinkedIn profile', () => {
    const leads = [lead({ linkedin: 'https://linkedin.com/in/Maria/' })]
    const result = findMatches(
      leads,
      contact({ source: 'linkedin', phones: [], linkedin: 'https://www.linkedin.com/in/maria' }),
    )
    expect(result[0]?.reason).toBe('linkedin')
  })

  it('offers a same-name lead only when nothing stronger matched and the name has two words', () => {
    const leads = [lead({ name: 'MARIA  silva' }), lead({ id: 'x', name: 'Maria' })]
    expect(findMatches(leads, contact({ phones: [] }))[0]?.reason).toBe('name')
    expect(findMatches(leads, contact({ phones: [], name: 'Maria' }))).toEqual([])
    expect(findMatches(leads, contact({ phones: [], name: null }))).toEqual([])
  })

  it('does not fall back to the name when a strong match exists', () => {
    const leads = [lead({ id: 'a', name: 'Outra Pessoa', phones: ['5511912345678'] }), lead({ id: 'b' })]
    const result = findMatches(leads, contact())
    expect(result.map((match) => match.lead.id)).toEqual(['a'])
  })

  it('returns nothing without a match', () => {
    expect(findMatches([lead({ name: 'Joao Souza' })], contact())).toEqual([])
  })
})

describe('ticketSearchTerms', () => {
  it('lists canonical phones, e-mails and the LinkedIn slug without repeats', () => {
    expect(
      ticketSearchTerms(
        contact({
          phones: ['5511912345678', '5511912345678', '12'],
          emails: ['Ana@X.com'],
          linkedin: 'https://www.linkedin.com/in/ana',
        }),
      ),
    ).toEqual(['551112345678', 'ana@x.com', 'ana'])
  })

  it('is empty for a contact with only a name', () => {
    expect(ticketSearchTerms(contact({ phones: [] }))).toEqual([])
  })
})
