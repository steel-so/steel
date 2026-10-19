import { describe, expect, it } from 'vitest'
import {
  type ApolloSearchFilters,
  buildApolloSearchBody,
  isImportableEmailStatus,
  maskApolloKey,
} from '../integrations/apollo'

const EMPTY: ApolloSearchFilters = {
  personTitles: [],
  includeSimilarTitles: true,
  seniorities: [],
  personLocations: [],
  organizationLocations: [],
  organizationDomains: [],
  employeeRanges: [],
  keywords: '',
  emailStatuses: [],
}

describe('buildApolloSearchBody', () => {
  it('sends only paging when no filter is filled', () => {
    expect(buildApolloSearchBody(EMPTY, 1, 25)).toEqual({
      page: 1,
      per_page: 25,
    })
  })

  it('maps every filled filter to the Apollo field', () => {
    expect(
      buildApolloSearchBody(
        {
          personTitles: ['CTO'],
          includeSimilarTitles: false,
          seniorities: ['c_suite'],
          personLocations: ['Brazil'],
          organizationLocations: ['São Paulo, Brazil'],
          organizationDomains: ['acme.com'],
          employeeRanges: ['11,50'],
          keywords: '  telecom ',
          emailStatuses: ['verified'],
        },
        3,
        100,
      ),
    ).toEqual({
      page: 3,
      per_page: 100,
      person_titles: ['CTO'],
      include_similar_titles: false,
      person_seniorities: ['c_suite'],
      person_locations: ['Brazil'],
      organization_locations: ['São Paulo, Brazil'],
      q_organization_domains_list: ['acme.com'],
      organization_num_employees_ranges: ['11,50'],
      contact_email_status: ['verified'],
      q_keywords: 'telecom',
    })
  })
})

describe('maskApolloKey', () => {
  it('keeps only the last 4 characters', () => {
    expect(maskApolloKey('abcdefghij1234')).toBe('••••1234')
  })

  it('hides short keys entirely', () => {
    expect(maskApolloKey('abc')).toBe('••••')
  })
})

describe('isImportableEmailStatus', () => {
  it('accepts verified and likely to engage only', () => {
    expect(isImportableEmailStatus('verified')).toBe(true)
    expect(isImportableEmailStatus('likely to engage')).toBe(true)
    expect(isImportableEmailStatus('unverified')).toBe(false)
    expect(isImportableEmailStatus(null)).toBe(false)
  })
})
