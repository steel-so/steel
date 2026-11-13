import { describe, expect, it } from 'vitest'
import { parsePastedEmails } from '../crm-email-paste'

describe('parsePastedEmails', () => {
  it('splits lines, commas and semicolons', () => {
    const r = parsePastedEmails('a@x.com\nb@x.com; c@x.com, d@x.com')
    expect(r.members.map((m) => m.email)).toEqual([
      'a@x.com',
      'b@x.com',
      'c@x.com',
      'd@x.com',
    ])
    expect(r.invalid).toEqual([])
  })

  it('reads "Name <email>" and quoted cells', () => {
    const r = parsePastedEmails('Maria Silva <maria@x.com>\n"joao@x.com"')
    expect(r.members).toEqual([
      { email: 'maria@x.com', name: 'Maria Silva' },
      { email: 'joao@x.com' },
    ])
  })

  it('reports invalid tokens once and de-duplicates case-insensitively', () => {
    const r = parsePastedEmails('ok@x.com\nOK@x.com\nnope\nnope', ['old@x.com'])
    expect(r.members).toEqual([{ email: 'ok@x.com' }])
    expect(r.duplicates).toEqual(['ok@x.com'])
    expect(r.invalid).toEqual(['nope'])
  })

  it('skips addresses that already exist in the list', () => {
    const r = parsePastedEmails('Old@x.com, new@x.com', ['old@x.com'])
    expect(r.members).toEqual([{ email: 'new@x.com' }])
    expect(r.duplicates).toEqual(['old@x.com'])
  })

  it('handles empty input', () => {
    expect(parsePastedEmails('  \n ')).toEqual({
      members: [],
      invalid: [],
      duplicates: [],
    })
  })
})
