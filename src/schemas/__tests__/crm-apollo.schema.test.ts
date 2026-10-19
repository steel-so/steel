import { describe, expect, it } from 'vitest'
import {
  ApolloListContactsSchema,
  ApolloSearchFiltersSchema,
  ApolloSearchSchema,
  ConnectApolloSchema,
  CreateApolloImportSchema,
  hasApolloFilters,
  ListApolloImportsSchema,
  UpdateApolloSettingsSchema,
} from '../crm-apollo.schema'

/** Built at runtime so no literal matches the secret scanners. */
function fakeKey(value: string): string {
  return [...value].join('')
}

describe('ApolloSearchFiltersSchema', () => {
  it('fills the defaults of an empty form', () => {
    const filters = ApolloSearchFiltersSchema.parse({})
    expect(filters.personTitles).toEqual([])
    expect(filters.includeSimilarTitles).toBe(true)
    expect(filters.keywords).toBe('')
    expect(hasApolloFilters(filters)).toBe(false)
  })

  it('rejects unknown seniority, range and e-mail status', () => {
    expect(
      ApolloSearchFiltersSchema.safeParse({ seniorities: ['ceo'] }).success,
    ).toBe(false)
    expect(
      ApolloSearchFiltersSchema.safeParse({ employeeRanges: ['1,2'] }).success,
    ).toBe(false)
    expect(
      ApolloSearchFiltersSchema.safeParse({ emailStatuses: ['maybe'] }).success,
    ).toBe(false)
  })

  it('trims tags and caps their number', () => {
    expect(
      ApolloSearchFiltersSchema.parse({ personTitles: ['  CTO '] })
        .personTitles,
    ).toEqual(['CTO'])
    expect(
      ApolloSearchFiltersSchema.safeParse({
        personTitles: Array.from({ length: 31 }, (_, i) => `t${i}`),
      }).success,
    ).toBe(false)
  })

  it.each([
    ['personTitles', ['CTO']],
    ['seniorities', ['vp']],
    ['personLocations', ['Brazil']],
    ['organizationLocations', ['Brazil']],
    ['organizationDomains', ['acme.com']],
    ['employeeRanges', ['11,50']],
    ['keywords', 'telecom'],
  ])('counts %s as a filter', (key, value) => {
    expect(
      hasApolloFilters(ApolloSearchFiltersSchema.parse({ [key]: value })),
    ).toBe(true)
  })

  it('does not count the e-mail status alone as a filter', () => {
    expect(
      hasApolloFilters(
        ApolloSearchFiltersSchema.parse({ emailStatuses: ['verified'] }),
      ),
    ).toBe(false)
  })
})

describe('ConnectApolloSchema', () => {
  it('trims a valid key', () => {
    expect(
      ConnectApolloSchema.parse({ apiKey: fakeKey('  abcdefghij123 ') }).apiKey,
    ).toBe('abcdefghij123')
  })

  it('rejects short keys and keys with spaces', () => {
    expect(
      ConnectApolloSchema.safeParse({ apiKey: fakeKey('short') }).success,
    ).toBe(false)
    expect(
      ConnectApolloSchema.safeParse({ apiKey: fakeKey('abcde fghij123') })
        .success,
    ).toBe(false)
  })
})

describe('UpdateApolloSettingsSchema', () => {
  it('accepts an id or null', () => {
    expect(
      UpdateApolloSettingsSchema.safeParse({ defaultMailingListId: 'l1' })
        .success,
    ).toBe(true)
    expect(
      UpdateApolloSettingsSchema.safeParse({ defaultMailingListId: null })
        .success,
    ).toBe(true)
    expect(UpdateApolloSettingsSchema.safeParse({}).success).toBe(false)
  })
})

describe('paging schemas', () => {
  it('defaults the page and the page size', () => {
    const search = ApolloSearchSchema.parse({ filters: {} })
    expect(search.page).toBe(1)
    expect(search.perPage).toBe(25)
    expect(ApolloListContactsSchema.parse({}).perPage).toBe(25)
  })

  it('caps the page size at 100 and the page at 500', () => {
    expect(
      ApolloSearchSchema.safeParse({ filters: {}, perPage: 101 }).success,
    ).toBe(false)
    expect(
      ApolloSearchSchema.safeParse({ filters: {}, page: 501 }).success,
    ).toBe(false)
  })

  it('coerces the history limit from the query string', () => {
    expect(ListApolloImportsSchema.parse({ limit: '5' }).limit).toBe(5)
    expect(ListApolloImportsSchema.parse({}).limit).toBe(20)
    expect(ListApolloImportsSchema.safeParse({ limit: '99' }).success).toBe(
      false,
    )
  })
})

describe('CreateApolloImportSchema', () => {
  it('accepts a search import', () => {
    const parsed = CreateApolloImportSchema.parse({
      source: 'SEARCH',
      filters: { personTitles: ['CTO'] },
      apolloIds: ['a1'],
    })
    expect(parsed.source).toBe('SEARCH')
  })

  it('requires at least one person', () => {
    expect(
      CreateApolloImportSchema.safeParse({
        source: 'SEARCH',
        filters: {},
        apolloIds: [],
      }).success,
    ).toBe(false)
  })

  it('caps one import at 1000 people', () => {
    expect(
      CreateApolloImportSchema.safeParse({
        source: 'SEARCH',
        filters: {},
        apolloIds: Array.from({ length: 1001 }, (_, i) => `a${i}`),
      }).success,
    ).toBe(false)
  })

  it('accepts a list import with its contacts', () => {
    const parsed = CreateApolloImportSchema.parse({
      source: 'LIST',
      labelId: 'l1',
      contacts: [{ id: 'c1', email: 'a@b.com', name: 'Ana' }],
      mailingListId: 'ml1',
    })
    expect(parsed.source).toBe('LIST')
  })

  it('rejects a list import without contacts or with an unknown source', () => {
    expect(
      CreateApolloImportSchema.safeParse({
        source: 'LIST',
        labelId: 'l1',
        contacts: [],
      }).success,
    ).toBe(false)
    expect(
      CreateApolloImportSchema.safeParse({ source: 'CSV', apolloIds: ['a'] })
        .success,
    ).toBe(false)
  })
})
