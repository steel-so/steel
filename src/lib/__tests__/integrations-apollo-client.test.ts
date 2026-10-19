import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { logger } from '@/lib/axiom/logger'
import { ApolloClient, readRateLimit } from '../integrations/apollo-client'

const fetchMock = vi.fn()
const KEY = 'apollo-key-super-secreta-123'

function reply(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  } as unknown as Response
}

const FILTERS = {
  personTitles: ['CTO'],
  includeSimilarTitles: true,
  seniorities: [],
  personLocations: [],
  organizationLocations: [],
  organizationDomains: [],
  employeeRanges: [],
  keywords: '',
  emailStatuses: [],
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('request plumbing', () => {
  it('authenticates only through x-api-key and refuses redirects', async () => {
    fetchMock.mockResolvedValue(reply({ healthy: true, is_logged_in: true }))
    expectOk(await ApolloClient.health(KEY))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.apollo.io/api/v1/auth/health')
    expect(url).not.toContain(KEY)
    expect(init.headers['x-api-key']).toBe(KEY)
    expect(init.headers['Cache-Control']).toBe('no-cache')
    expect(init.redirect).toBe('error')
  })

  it('reads the plan rate limit from the headers', async () => {
    fetchMock.mockResolvedValue(
      reply({ healthy: true }, 200, {
        'x-minute-requests-left': '49',
        'x-hourly-requests-left': '199',
        'x-24-hour-requests-left': '599',
      }),
    )
    const result = expectOk(await ApolloClient.health(KEY))
    expect(result.rateLimit).toEqual({
      minuteLeft: 49,
      hourLeft: 199,
      dayLeft: 599,
    })
  })

  it('leaves missing or invalid rate headers as null', () => {
    expect(
      readRateLimit(new Headers({ 'x-minute-requests-left': 'abc' })),
    ).toEqual({ minuteLeft: null, hourLeft: null, dayLeft: null })
  })

  it('maps 401, 403, 429 and 5xx to the Apollo error codes', async () => {
    fetchMock.mockResolvedValueOnce(reply({}, 401))
    expectErr(await ApolloClient.health(KEY), 'CRM_APOLLO_INVALID_KEY')
    fetchMock.mockResolvedValueOnce(reply({}, 403))
    expectErr(await ApolloClient.listLabels(KEY), 'CRM_APOLLO_FORBIDDEN')
    fetchMock.mockResolvedValueOnce(reply({}, 429, { 'retry-after': '42' }))
    const limited = expectErr(
      await ApolloClient.listLabels(KEY),
      'CRM_APOLLO_RATE_LIMITED',
    )
    expect(limited.details).toEqual({ retryAfterSeconds: 42 })
    fetchMock.mockResolvedValueOnce(reply({}, 429))
    expect(
      expectErr(await ApolloClient.listLabels(KEY), 'CRM_APOLLO_RATE_LIMITED')
        .details,
    ).toBeUndefined()
    fetchMock.mockResolvedValueOnce(reply({}, 503))
    expectErr(await ApolloClient.listLabels(KEY), 'CRM_APOLLO_REQUEST_FAILED')
  })

  it('maps a network failure and never logs the key', async () => {
    fetchMock.mockRejectedValue(new Error('boom'))
    expectErr(await ApolloClient.health(KEY), 'CRM_APOLLO_REQUEST_FAILED')
    expect(
      JSON.stringify([
        vi.mocked(logger.warn).mock.calls,
        vi.mocked(logger.error).mock.calls,
      ]),
    ).not.toContain(KEY)
  })
})

describe('ApolloClient.health', () => {
  it('rejects a key that is not logged in', async () => {
    fetchMock.mockResolvedValue(reply({ healthy: true, is_logged_in: false }))
    expectErr(await ApolloClient.health(KEY), 'CRM_APOLLO_INVALID_KEY')
  })

  it('rejects an unhealthy answer', async () => {
    fetchMock.mockResolvedValue(reply({ healthy: false }))
    expectErr(await ApolloClient.health(KEY), 'CRM_APOLLO_INVALID_KEY')
  })
})

describe('ApolloClient.searchPeople', () => {
  it('posts the filters and normalizes the preview people', async () => {
    fetchMock.mockResolvedValue(
      reply({
        total_entries: 2,
        people: [
          {
            id: 'p1',
            first_name: 'Maria',
            last_name_obfuscated: 'Si***a',
            title: 'CTO',
            has_email: true,
            has_direct_phone: false,
            organization: { name: 'Acme' },
          },
          { id: 'p2' },
        ],
      }),
    )
    const result = expectOk(
      await ApolloClient.searchPeople(KEY, FILTERS, 2, 25),
    )
    expect(result.data.totalEntries).toBe(2)
    expect(result.data.people[0]).toEqual({
      id: 'p1',
      firstName: 'Maria',
      lastNameObfuscated: 'Si***a',
      title: 'CTO',
      hasEmail: true,
      hasDirectPhone: false,
      organizationName: 'Acme',
    })
    expect(result.data.people[1].hasEmail).toBe(false)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.apollo.io/api/v1/mixed_people/api_search')
    expect(JSON.parse(init.body)).toMatchObject({
      page: 2,
      per_page: 25,
      person_titles: ['CTO'],
    })
  })

  it('treats an empty answer as no results', async () => {
    fetchMock.mockResolvedValue(reply({}))
    const result = expectOk(
      await ApolloClient.searchPeople(KEY, FILTERS, 1, 25),
    )
    expect(result.data).toEqual({ totalEntries: 0, people: [] })
  })

  it('propagates a failure', async () => {
    fetchMock.mockResolvedValue(reply({}, 401))
    expectErr(
      await ApolloClient.searchPeople(KEY, FILTERS, 1, 25),
      'CRM_APOLLO_INVALID_KEY',
    )
  })
})

describe('ApolloClient.bulkMatch', () => {
  it('never reveals personal e-mails and normalizes the matches', async () => {
    fetchMock.mockResolvedValue(
      reply({
        credits_consumed: 1,
        matches: [
          {
            id: 'p1',
            first_name: 'Maria',
            last_name: 'Silva',
            email: 'maria@acme.com',
            email_status: 'verified',
            title: 'CTO',
            city: 'Recife',
            state: 'PE',
            country: 'Brazil',
            linkedin_url: 'https://linkedin.com/in/maria',
            organization: {
              name: 'Acme',
              primary_domain: 'acme.com',
              website_url: 'https://acme.com',
              estimated_num_employees: 40,
              industry: 'telecom',
            },
          },
          null,
          { id: 'p3', name: 'Joao Souza' },
        ],
      }),
    )
    const result = expectOk(
      await ApolloClient.bulkMatch(KEY, ['p1', 'p2', 'p3']),
    )
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/people/bulk_match?reveal_personal_emails=false')
    expect(JSON.parse(init.body)).toEqual({
      details: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
    })
    expect(result.data.creditsConsumed).toBe(1)
    expect(result.data.matches[0]).toMatchObject({
      id: 'p1',
      name: 'Maria Silva',
      email: 'maria@acme.com',
      organizationDomain: 'acme.com',
      organizationEmployees: 40,
    })
    expect(result.data.matches[1]).toBeNull()
    expect(result.data.matches[2]).toMatchObject({
      name: 'Joao Souza',
      email: null,
    })
  })

  it('asks for phones only with a webhook url and keeps the request id', async () => {
    fetchMock.mockResolvedValue(reply({ request_id: -123, matches: [] }))
    const result = expectOk(
      await ApolloClient.bulkMatch(KEY, ['p1'], {
        webhookUrl: 'https://steel.test/api/crm/apollo/webhook/tok?x=1',
      }),
    )
    const url = new URL(fetchMock.mock.calls[0][0])
    expect(url.searchParams.get('reveal_phone_number')).toBe('true')
    expect(url.searchParams.get('reveal_personal_emails')).toBe('false')
    expect(url.searchParams.get('webhook_url')).toBe(
      'https://steel.test/api/crm/apollo/webhook/tok?x=1',
    )
    expect(result.data.requestId).toBe('-123')
  })

  it('does not send phone parameters without a webhook url', async () => {
    fetchMock.mockResolvedValue(reply({ request_id: 'abc', matches: [] }))
    const result = expectOk(await ApolloClient.bulkMatch(KEY, ['p1']))
    expect(fetchMock.mock.calls[0][0]).not.toContain('reveal_phone_number')
    expect(result.data.requestId).toBe('abc')
  })

  it('tolerates a body without matches', async () => {
    fetchMock.mockResolvedValue(reply({}))
    const result = expectOk(await ApolloClient.bulkMatch(KEY, ['p1']))
    expect(result.data).toEqual({
      matches: [],
      creditsConsumed: 0,
      requestId: null,
    })
  })

  it('propagates a rate limit', async () => {
    fetchMock.mockResolvedValue(reply({}, 429, { 'retry-after': '10' }))
    expectErr(
      await ApolloClient.bulkMatch(KEY, ['p1']),
      'CRM_APOLLO_RATE_LIMITED',
    )
  })
})

describe('ApolloClient.listLabels', () => {
  it('normalizes the saved lists', async () => {
    fetchMock.mockResolvedValue(
      reply([{ id: 'l1', name: 'Clientes', cached_count: 12 }, { id: 'l2' }]),
    )
    expect(expectOk(await ApolloClient.listLabels(KEY)).data).toEqual([
      { id: 'l1', name: 'Clientes', count: 12 },
      { id: 'l2', name: 'Lista sem nome', count: 0 },
    ])
  })

  it('treats a non-array body as no lists', async () => {
    fetchMock.mockResolvedValue(reply({ error: 'x' }))
    expect(expectOk(await ApolloClient.listLabels(KEY)).data).toEqual([])
  })
})

describe('ApolloClient.searchContacts', () => {
  it('posts the label and normalizes the contacts', async () => {
    fetchMock.mockResolvedValue(
      reply({
        contacts: [
          {
            id: 'c1',
            first_name: 'Ana',
            last_name: 'Lima',
            email: 'ana@acme.com',
            email_status: 'verified',
            title: 'CEO',
            organization_name: 'Acme',
            linkedin_url: 'https://linkedin.com/in/ana',
            city: 'Recife',
          },
          { id: 'c2', name: 'Bruno' },
        ],
        pagination: { total_entries: 2, total_pages: 1 },
      }),
    )
    const result = expectOk(await ApolloClient.searchContacts(KEY, 'l1', 1, 25))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      contact_label_ids: ['l1'],
      page: 1,
      per_page: 25,
    })
    expect(result.data.totalEntries).toBe(2)
    expect(result.data.totalPages).toBe(1)
    expect(result.data.contacts[0]).toMatchObject({
      name: 'Ana Lima',
      email: 'ana@acme.com',
      organizationName: 'Acme',
    })
    expect(result.data.contacts[1].name).toBe('Bruno')
  })

  it('defaults a missing pagination to zero', async () => {
    fetchMock.mockResolvedValue(reply({}))
    const result = expectOk(await ApolloClient.searchContacts(KEY, 'l1', 1, 25))
    expect(result.data).toEqual({
      contacts: [],
      totalEntries: 0,
      totalPages: 0,
    })
  })
})
