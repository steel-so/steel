import { describe, expect, it } from 'vitest'
import { searchSettings } from '@/src/__tests__/factories/site-search.factory'
import {
  businessNode,
  formatAddress,
  formatHours,
  isLocalBusiness,
  napConsistency,
  phonesIn,
  profileCompleteness,
} from '@/src/lib/sites/search/business'
import {
  isEmptyProfile,
  keepStoredSearch,
  suggestBusinessProfile,
} from '@/src/lib/sites/search/context'
import {
  STRUCTURED_DATA_HINTS,
  STRUCTURED_DATA_LABELS,
  structuredDataNode,
  validateStructuredData,
} from '@/src/lib/sites/search/structured-data'
import {
  parseSearchContent,
  parseSiteSearchSettings,
  SearchContentSchema,
  type SiteBusinessProfileDTO,
  SiteSearchSettingsSchema,
  STRUCTURED_DATA_TYPES,
  UpdateSiteSearchSettingsSchema,
} from '@/src/schemas/site-search.schema'

const FULL: SiteBusinessProfileDTO = {
  type: 'Dentist',
  name: 'Clínica Sorriso',
  legalName: 'Sorriso Odontologia Ltda',
  description: 'Clínica odontológica em Pinheiros.',
  category: 'Clínica odontológica',
  address: {
    street: 'Rua dos Pinheiros, 100',
    district: 'Pinheiros',
    city: 'São Paulo',
    region: 'SP',
    postalCode: '05422-000',
  },
  geo: { latitude: -23.56, longitude: -46.68 },
  phone: '+55 (11) 3333-4444',
  email: 'contato@sorriso.com.br',
  hours: [
    { days: ['Monday', 'Friday'], opens: '08:00', closes: '18:00' },
    { days: ['Saturday'], opens: '08:00', closes: '12:00' },
  ],
  serviceArea: ['São Paulo', 'Osasco'],
  foundingYear: 2010,
  logoUrl: 'https://sorriso.com.br/logo.png',
  sameAs: ['https://instagram.com/sorriso'],
  people: [
    {
      name: 'Dra. Ana',
      role: 'Diretora clínica',
      url: 'https://linkedin.com/in/ana',
    },
    { name: 'Dr. Beto' },
  ],
  priceRange: '$$',
}

describe('business profile', () => {
  it('measures completeness and lists the most important gaps first', () => {
    expect(profileCompleteness(FULL)).toEqual({ percent: 100, missing: [] })
    const empty = profileCompleteness({})
    expect(empty.percent).toBe(0)
    expect(empty.missing.slice(0, 4)).toEqual([
      'nome',
      'descrição',
      'telefone',
      'endereço',
    ])
    expect(profileCompleteness({ type: 'Dentist' }).missing).not.toContain(
      'categoria',
    )
    expect(profileCompleteness({ address: { city: 'SP' } }).missing).toContain(
      'endereço',
    )
  })

  it('tells local businesses apart', () => {
    expect(isLocalBusiness(FULL)).toBe(true)
    expect(isLocalBusiness({})).toBe(false)
    expect(isLocalBusiness({ type: 'Organization' })).toBe(false)
    expect(isLocalBusiness({ type: 'EducationalOrganization' })).toBe(false)
  })

  it('formats address and hours', () => {
    expect(formatAddress(FULL)).toBe(
      'Rua dos Pinheiros, 100 · Pinheiros · São Paulo/SP · 05422-000',
    )
    expect(formatAddress({})).toBe('')
    expect(formatHours(FULL)).toBe('seg, sex: 08:00–18:00; sáb: 08:00–12:00')
    expect(formatHours({})).toBe('')
  })

  it('builds a full LocalBusiness node', () => {
    const node = businessNode(FULL, {
      id: 'https://s/#organization',
      siteUrl: 'https://s/',
      fallbackName: 'Site',
    })
    expect(node).toMatchObject({
      '@type': 'Dentist',
      name: 'Clínica Sorriso',
      legalName: 'Sorriso Odontologia Ltda',
      knowsAbout: 'Clínica odontológica',
      logo: 'https://sorriso.com.br/logo.png',
      image: 'https://sorriso.com.br/logo.png',
      telephone: '+55 (11) 3333-4444',
      email: 'contato@sorriso.com.br',
      address: {
        '@type': 'PostalAddress',
        streetAddress: 'Rua dos Pinheiros, 100',
        addressLocality: 'São Paulo',
        addressRegion: 'SP',
        postalCode: '05422-000',
        addressCountry: 'BR',
      },
      geo: { '@type': 'GeoCoordinates', latitude: -23.56 },
      foundingDate: '2010',
      priceRange: '$$',
    })
    expect(node.openingHoursSpecification).toHaveLength(2)
    expect(node.areaServed).toEqual([
      { '@type': 'Place', name: 'São Paulo' },
      { '@type': 'Place', name: 'Osasco' },
    ])
    expect(node.employee).toEqual([
      {
        '@type': 'Person',
        name: 'Dra. Ana',
        jobTitle: 'Diretora clínica',
        url: 'https://linkedin.com/in/ana',
      },
      { '@type': 'Person', name: 'Dr. Beto' },
    ])
  })

  it('falls back to a minimal Organization', () => {
    expect(
      businessNode(
        { address: { country: 'PT' } },
        {
          id: '#o',
          siteUrl: 'https://s/',
          fallbackName: 'Site',
          logo: '/l.png',
          sameAs: ['https://x.com/s'],
        },
      ),
    ).toEqual({
      '@type': 'Organization',
      '@id': '#o',
      name: 'Site',
      url: 'https://s/',
      logo: '/l.png',
      sameAs: ['https://x.com/s'],
    })
    expect(
      businessNode(
        { priceRange: '$', address: { city: 'Lisboa', country: 'PT' } },
        { id: '#o', siteUrl: 's', fallbackName: 'S' },
      ),
    ).toMatchObject({
      address: { addressCountry: 'PT', addressLocality: 'Lisboa' },
    })
    expect(
      businessNode(
        { priceRange: '$' },
        { id: '#o', siteUrl: 's', fallbackName: 'S' },
      ).priceRange,
    ).toBeUndefined()
  })

  it('checks that the phone on the site matches the profile', () => {
    expect(
      phonesIn('Ligue (11) 3333-4444 ou +55 11 98888-7777. CEP 01'),
    ).toEqual(['33334444', '88887777'])
    expect(napConsistency({}, 'qualquer')).toBe('no-profile')
    expect(napConsistency(FULL, 'Fale: 11 3333 4444')).toBe('consistent')
    expect(napConsistency(FULL, 'Fale: 11 2222-1111')).toBe('conflict')
    expect(napConsistency(FULL, 'Sem telefone')).toBe('missing')
  })
})

describe('structured data', () => {
  const context = {
    pageTitle: 'Implante',
    description: 'Descrição',
    faqCount: 0,
    business: {} as SiteBusinessProfileDTO,
  }

  it('has a label and a hint for every type', () => {
    for (const type of STRUCTURED_DATA_TYPES) {
      expect(STRUCTURED_DATA_LABELS[type]).toBeTruthy()
      expect(STRUCTURED_DATA_HINTS[type]).toBeTruthy()
    }
  })

  it('lists missing required properties per type', () => {
    expect(
      validateStructuredData(
        { type: 'Article' },
        { ...context, pageTitle: '' },
      ),
    ).toEqual(['título', 'autor', 'data de publicação'])
    expect(
      validateStructuredData(
        { type: 'Article', authorName: 'Ana', datePublished: '2026-10-01' },
        context,
      ),
    ).toEqual([])
    expect(
      validateStructuredData(
        { type: 'Product' },
        { ...context, description: undefined },
      ),
    ).toEqual(['nome', 'preço', 'descrição'])
    expect(
      validateStructuredData({ type: 'Service', name: 'Limpeza' }, context),
    ).toEqual(['tipo de serviço'])
    expect(
      validateStructuredData(
        { type: 'Service', name: 'Limpeza' },
        { ...context, business: { category: 'Odonto' } },
      ),
    ).toEqual([])
    expect(validateStructuredData({ type: 'Event' }, context)).toEqual([
      'nome',
      'data de início',
      'local',
    ])
    expect(
      validateStructuredData(
        {
          type: 'Event',
          name: 'Live',
          startDate: '2026-11-01',
          attendance: 'online',
        },
        context,
      ),
    ).toEqual(['link do evento'])
    expect(
      validateStructuredData(
        {
          type: 'Event',
          name: 'Feira',
          startDate: '2026-11-02',
          endDate: '2026-11-01',
          locationName: 'Expo',
        },
        context,
      ),
    ).toEqual(['data de término depois do início'])
    expect(
      validateStructuredData(
        { type: 'HowTo', steps: [{ text: 'Um' }] },
        context,
      ),
    ).toEqual(['pelo menos 2 passos'])
    expect(validateStructuredData({ type: 'FAQPage' }, context)).toEqual([
      'perguntas com resposta',
    ])
    expect(
      validateStructuredData({ type: 'FAQPage' }, { ...context, faqCount: 2 }),
    ).toEqual([])
    expect(validateStructuredData({ type: 'LocalBusiness' }, context)).toEqual([
      'nome do negócio',
      'cidade',
      'telefone',
    ])
    expect(
      validateStructuredData(
        { type: 'LocalBusiness' },
        { ...context, business: FULL },
      ),
    ).toEqual([])
  })

  const nodeContext = {
    pageUrl: 'https://s/p',
    pageTitle: 'Página',
    description: 'Desc',
    image: 'https://s/_og?page=p',
    organizationId: 'https://s/#organization',
    dateModified: '2026-10-10T00:00:00.000Z',
  }

  it('builds Article, Product and Service nodes', () => {
    expect(
      structuredDataNode(
        { type: 'Article', authorName: 'Ana', datePublished: '2026-10-01' },
        0,
        nodeContext,
      ),
    ).toEqual({
      '@type': 'Article',
      '@id': 'https://s/p#article-1',
      headline: 'Página',
      mainEntityOfPage: 'https://s/p',
      image: 'https://s/_og?page=p',
      author: { '@type': 'Person', name: 'Ana' },
      datePublished: '2026-10-01',
      dateModified: '2026-10-10T00:00:00.000Z',
      publisher: { '@id': 'https://s/#organization' },
      description: 'Desc',
    })
    expect(
      structuredDataNode(
        { type: 'Article', headline: 'H', image: '/i.png' },
        1,
        {
          ...nodeContext,
          description: undefined,
          dateModified: undefined,
        },
      ),
    ).toEqual({
      '@type': 'Article',
      '@id': 'https://s/p#article-2',
      headline: 'H',
      mainEntityOfPage: 'https://s/p',
      image: '/i.png',
      publisher: { '@id': 'https://s/#organization' },
    })
    expect(
      structuredDataNode(
        {
          type: 'Product',
          name: 'Kit',
          sku: 'K1',
          brand: 'Marca',
          price: 99.9,
          currency: 'USD',
          availability: 'PreOrder',
        },
        0,
        nodeContext,
      ),
    ).toMatchObject({
      '@type': 'Product',
      name: 'Kit',
      sku: 'K1',
      brand: { '@type': 'Brand', name: 'Marca' },
      offers: {
        price: '99.90',
        priceCurrency: 'USD',
        availability: 'https://schema.org/PreOrder',
      },
    })
    const plain = structuredDataNode({ type: 'Product' }, 0, nodeContext)
    expect(plain).toMatchObject({ name: 'Página', description: 'Desc' })
    expect(plain).not.toHaveProperty('offers')
    expect(
      structuredDataNode(
        { type: 'Service', serviceType: 'Odonto', areaServed: 'SP', price: 10 },
        0,
        nodeContext,
      ),
    ).toMatchObject({
      '@type': 'Service',
      serviceType: 'Odonto',
      areaServed: 'SP',
      provider: { '@id': 'https://s/#organization' },
      offers: { priceCurrency: 'BRL' },
    })
    expect(
      structuredDataNode({ type: 'Service', name: 'S' }, 0, nodeContext),
    ).not.toHaveProperty('serviceType')
  })

  it('builds Event nodes for each attendance mode', () => {
    expect(
      structuredDataNode(
        {
          type: 'Event',
          name: 'Feira',
          startDate: '2026-11-01',
          endDate: '2026-11-02',
          locationName: 'Expo',
          locationAddress: 'Av. X',
          price: 0,
        },
        0,
        nodeContext,
      ),
    ).toMatchObject({
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      location: { '@type': 'Place', name: 'Expo', address: 'Av. X' },
      startDate: '2026-11-01',
      endDate: '2026-11-02',
      offers: { url: 'https://s/p' },
    })
    expect(
      structuredDataNode(
        {
          type: 'Event',
          attendance: 'online',
          url: 'https://live.x',
          price: 5,
        },
        0,
        nodeContext,
      ),
    ).toMatchObject({
      eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
      location: { '@type': 'VirtualLocation', url: 'https://live.x' },
      offers: { url: 'https://live.x' },
    })
    const mixed = structuredDataNode(
      {
        type: 'Event',
        attendance: 'mixed',
        locationAddress: 'Rua Y',
        url: 'https://live.x',
      },
      0,
      nodeContext,
    )
    expect(mixed?.eventAttendanceMode).toBe(
      'https://schema.org/MixedEventAttendanceMode',
    )
    expect(mixed?.location).toEqual([
      { '@type': 'Place', name: 'Rua Y', address: 'Rua Y' },
      { '@type': 'VirtualLocation', url: 'https://live.x' },
    ])
  })

  it('builds HowTo nodes and skips the assembled types', () => {
    expect(
      structuredDataNode(
        {
          type: 'HowTo',
          totalTime: 'PT30M',
          steps: [{ name: 'Um', text: 'Faça' }, { text: 'Pronto' }],
        },
        0,
        nodeContext,
      ),
    ).toMatchObject({
      '@type': 'HowTo',
      totalTime: 'PT30M',
      step: [
        { '@type': 'HowToStep', position: 1, name: 'Um', text: 'Faça' },
        { '@type': 'HowToStep', position: 2, text: 'Pronto' },
      ],
    })
    expect(structuredDataNode({ type: 'HowTo' }, 0, nodeContext)?.step).toEqual(
      [],
    )
    expect(structuredDataNode({ type: 'FAQPage' }, 0, nodeContext)).toBeNull()
    expect(
      structuredDataNode({ type: 'LocalBusiness' }, 0, nodeContext),
    ).toBeNull()
  })
})

describe('search schemas', () => {
  it('parses stored settings and content, falling back on bad data', () => {
    expect(parseSiteSearchSettings(undefined)).toEqual({
      business: {},
      crawlers: {},
      llms: { enabled: true },
      indexNow: { enabled: false },
      verification: {},
    })
    expect(
      parseSiteSearchSettings({ indexNow: { enabled: 'sim' } }).indexNow,
    ).toEqual({ enabled: false })
    expect(parseSearchContent({ focusKeyword: 'implante' })).toEqual({
      focusKeyword: 'implante',
    })
    expect(parseSearchContent({ questions: 'x' })).toEqual({})
    expect(parseSearchContent(null)).toEqual({})
  })

  it('validates dates, times and URLs', () => {
    expect(
      SearchContentSchema.safeParse({
        structuredData: [
          { type: 'Article', datePublished: '2026-02-30T10:00' },
        ],
      }).success,
    ).toBe(true)
    expect(
      SearchContentSchema.safeParse({
        structuredData: [{ type: 'Article', datePublished: '30/10/2026' }],
      }).success,
    ).toBe(false)
    expect(
      SiteSearchSettingsSchema.safeParse({
        business: {
          hours: [{ days: ['Monday'], opens: '25:00', closes: '18:00' }],
        },
      }).success,
    ).toBe(false)
    expect(
      SiteSearchSettingsSchema.safeParse({
        business: { logoUrl: 'javascript:x' },
      }).success,
    ).toBe(false)
    expect(
      SiteSearchSettingsSchema.safeParse({
        business: { sameAs: ['instagram.com/x'] },
      }).success,
    ).toBe(false)
    expect(UpdateSiteSearchSettingsSchema.safeParse({}).success).toBe(false)
    expect(
      UpdateSiteSearchSettingsSchema.safeParse({
        verification: { google: 'abc-123_X' },
      }).success,
    ).toBe(true)
    expect(
      UpdateSiteSearchSettingsSchema.safeParse({
        verification: { bing: '<meta>' },
      }).success,
    ).toBe(false)
  })
})

describe('stored search data and the profile draft', () => {
  it('keeps the stored search block when an update omits it', () => {
    const titled: { title: string; search?: unknown } = { title: 'A' }
    expect(keepStoredSearch(titled, { search: { focusKeyword: 'x' } })).toEqual(
      {
        title: 'A',
        search: { focusKeyword: 'x' },
      },
    )
    expect(
      keepStoredSearch(
        { search: { summary: 'novo' } },
        { search: { focusKeyword: 'x' } },
      ),
    ).toEqual({
      search: { summary: 'novo' },
    })
    expect(keepStoredSearch(titled, { search: 'lixo' })).toEqual({
      title: 'A',
    })
    expect(keepStoredSearch(titled, null)).toEqual({ title: 'A' })
    expect(keepStoredSearch(titled, 'texto')).toEqual({ title: 'A' })
  })

  it('tells an empty profile apart', () => {
    expect(isEmptyProfile({})).toBe(true)
    expect(isEmptyProfile({ name: '', sameAs: [] })).toBe(true)
    expect(isEmptyProfile({ name: 'X' })).toBe(false)
  })

  it('drafts the profile from the site, the brand and the workspace', () => {
    const settings = searchSettings({
      seo: {
        organizationName: 'Org',
        description: 'Desc',
        sameAs: ['https://x.com/o'],
      },
    })
    expect(
      suggestBusinessProfile({
        siteName: 'Site',
        settings,
        brand: {
          companyName: 'Marca',
          logoUrl: 'logo-relativo.png',
          address: 'Rua B',
          website: 'https://x.com/o',
        },
        workspace: { name: 'WS', logoUrl: '/ws.png' },
      }),
    ).toEqual({
      name: 'Org',
      description: 'Desc',
      address: { street: 'Rua B' },
      logoUrl: '/ws.png',
      sameAs: ['https://x.com/o'],
    })
    expect(
      suggestBusinessProfile({
        siteName: 'Site',
        settings: searchSettings(),
        brand: {
          companyName: '',
          logoUrl: '',
          address: '',
          website: 'sem-protocolo.com',
        },
        workspace: { name: '', logoUrl: null },
      }),
    ).toEqual({ name: 'Site' })
    expect(
      suggestBusinessProfile({
        siteName: 'Site',
        settings: searchSettings(),
        workspace: { name: 'WS', logoUrl: null },
      }),
    ).toEqual({
      name: 'WS',
    })
  })
})
