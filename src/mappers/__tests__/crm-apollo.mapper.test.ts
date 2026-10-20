import { describe, expect, it } from 'vitest'
import {
  createFakeApolloIntegration,
  createFakeCrmApolloImport,
} from '@/src/__tests__/factories/crm-apollo.factory'
import {
  apolloDefaultMailingListId,
  toCrmApolloConnectionDTO,
  toCrmApolloContactDTO,
  toCrmApolloImportDTO,
  toCrmApolloPersonDTO,
} from '../crm-apollo.mapper'

describe('apolloDefaultMailingListId', () => {
  it('reads the id from the config', () => {
    expect(apolloDefaultMailingListId({ defaultMailingListId: 'l1' })).toBe(
      'l1',
    )
  })

  it.each([
    null,
    undefined,
    'x',
    {},
    { defaultMailingListId: '' },
    { defaultMailingListId: 3 },
  ])('returns null for %j', (config) => {
    expect(apolloDefaultMailingListId(config)).toBeNull()
  })
})

describe('toCrmApolloConnectionDTO', () => {
  it('describes a missing connection', () => {
    expect(toCrmApolloConnectionDTO(null)).toEqual({
      connected: false,
      status: null,
      statusError: null,
      keyHint: null,
      lastCheckedAt: null,
      defaultMailingListId: null,
      phoneRevealAvailable: false,
    })
    expect(toCrmApolloConnectionDTO(null, true).phoneRevealAvailable).toBe(true)
  })

  it('exposes only the key hint, never the encrypted key', () => {
    const dto = toCrmApolloConnectionDTO(
      createFakeApolloIntegration({
        config: { defaultMailingListId: 'l1' },
        lastCheckedAt: new Date('2026-10-19T10:00:00.000Z'),
      }),
    )
    expect(dto).toMatchObject({
      connected: true,
      status: 'ACTIVE',
      keyHint: '••••ab12',
      defaultMailingListId: 'l1',
      lastCheckedAt: '2026-10-19T10:00:00.000Z',
    })
    expect(JSON.stringify(dto)).not.toContain('apollo-key')
  })
})

describe('toCrmApolloPersonDTO', () => {
  const base = {
    id: 'p1',
    firstName: 'Maria',
    lastNameObfuscated: 'Si***a',
    title: 'CTO',
    hasEmail: true,
    directPhone: 'YES',
    organizationName: 'Acme',
  }

  it('joins the first name with the obfuscated surname', () => {
    expect(toCrmApolloPersonDTO(base)).toEqual({
      id: 'p1',
      name: 'Maria Si***a',
      title: 'CTO',
      organizationName: 'Acme',
      hasEmail: true,
      directPhone: 'YES',
    })
  })

  it('falls back when Apollo sent no name', () => {
    expect(
      toCrmApolloPersonDTO({
        ...base,
        firstName: null,
        lastNameObfuscated: null,
      }).name,
    ).toBe('Sem nome')
  })
})

describe('toCrmApolloContactDTO', () => {
  const contact = {
    id: 'c1',
    personId: 'p1',
    name: 'Ana Lima',
    firstName: 'Ana',
    lastName: 'Lima',
    email: 'ana@acme.com',
    emailStatus: 'verified',
    title: 'CEO',
    organizationName: 'Acme',
    linkedinUrl: null,
    city: 'Recife',
  }

  it('maps the contact', () => {
    expect(toCrmApolloContactDTO(contact)).toMatchObject({
      id: 'c1',
      personId: 'p1',
      name: 'Ana Lima',
      email: 'ana@acme.com',
    })
  })

  it('falls back to the e-mail and then to a placeholder name', () => {
    expect(toCrmApolloContactDTO({ ...contact, name: '' }).name).toBe(
      'ana@acme.com',
    )
    expect(
      toCrmApolloContactDTO({ ...contact, name: '', email: null }).name,
    ).toBe('Sem nome')
  })
})

describe('toCrmApolloImportDTO skip reasons', () => {
  it('keeps positive numeric counts and ignores malformed JSON', () => {
    const dto = (skipReasons: unknown) =>
      toCrmApolloImportDTO(
        createFakeCrmApolloImport({ skipReasons: skipReasons as never }),
      ).skipReasons
    expect(dto({ no_email: 2, bad: 'x', zero: 0 })).toEqual({ no_email: 2 })
    expect(dto(null)).toEqual({})
    expect(dto([1])).toEqual({})
  })
})

describe('toCrmApolloImportDTO', () => {
  it('serializes dates and keeps the counters', () => {
    const dto = toCrmApolloImportDTO(
      createFakeCrmApolloImport({
        id: 'i1',
        status: 'DONE',
        createdCount: 3,
        creditsConsumed: 4,
        startedAt: new Date('2026-10-19T12:01:00.000Z'),
        finishedAt: new Date('2026-10-19T12:02:00.000Z'),
      }),
    )
    expect(dto).toMatchObject({
      id: 'i1',
      status: 'DONE',
      createdCount: 3,
      creditsConsumed: 4,
      startedAt: '2026-10-19T12:01:00.000Z',
      finishedAt: '2026-10-19T12:02:00.000Z',
    })
  })

  it('keeps unset dates null', () => {
    const dto = toCrmApolloImportDTO(createFakeCrmApolloImport())
    expect(dto.startedAt).toBeNull()
    expect(dto.finishedAt).toBeNull()
  })
})
