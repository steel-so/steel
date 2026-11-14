import { describe, expect, it } from 'vitest'
import {
  findTourForPath,
  matchesRoute,
  pathAfterSlug,
  tourEntryPath,
  tourRoutes,
} from '../tours/match'
import type { TourDefinition } from '../tours/types'

function tour(overrides: Partial<TourDefinition>): TourDefinition {
  return {
    key: 'crm.example',
    version: 1,
    module: 'crm',
    title: 'Exemplo',
    description: 'Um tour de exemplo.',
    route: '/crm/example',
    steps: [{ title: 'Passo', body: 'Texto.' }],
    ...overrides,
  }
}

describe('matchesRoute()', () => {
  it('should match identical static paths', () => {
    expect(matchesRoute('/crm/leads', '/crm/leads')).toBe(true)
    expect(matchesRoute('/crm/leads', '/crm/people')).toBe(false)
  })

  it('should match one segment per parameter', () => {
    expect(matchesRoute('/crm/sites/:siteId', '/crm/sites/abc')).toBe(true)
    expect(matchesRoute('/crm/sites/:siteId', '/crm/sites')).toBe(false)
    expect(matchesRoute('/crm/sites/:siteId', '/crm/sites/abc/blog')).toBe(
      false,
    )
  })

  it('should treat the empty pattern as the workspace home', () => {
    expect(matchesRoute('', '')).toBe(true)
    expect(matchesRoute('', '/crm')).toBe(false)
  })

  it('should ignore a trailing slash', () => {
    expect(matchesRoute('/crm/leads', '/crm/leads/')).toBe(true)
  })
})

describe('pathAfterSlug()', () => {
  it('should return the path after the workspace slug', () => {
    expect(pathAfterSlug('/acme/crm/leads', 'acme')).toBe('/crm/leads')
    expect(pathAfterSlug('/acme', 'acme')).toBe('')
  })

  it('should drop query and hash', () => {
    expect(pathAfterSlug('/acme/crm?tour=x#top', 'acme')).toBe('/crm')
  })

  it('should return null outside the workspace', () => {
    expect(pathAfterSlug('/other/crm', 'acme')).toBeNull()
    expect(pathAfterSlug('/acme-two/crm', 'acme')).toBeNull()
  })
})

describe('findTourForPath()', () => {
  const list = tour({ key: 'crm.templates', route: '/crm/email-templates' })
  const editor = tour({
    key: 'crm.templates.editor',
    route: ['/crm/email-templates/new', '/crm/email-templates/:templateId'],
  })
  const item = tour({ key: 'crm.item', route: '/crm/:section/new' })

  it('should return null when no tour lives on the screen', () => {
    expect(findTourForPath([list, editor], '/crm/leads')).toBeNull()
  })

  it('should find a tour by any of its routes', () => {
    expect(findTourForPath([list, editor], '/crm/email-templates')?.key).toBe(
      'crm.templates',
    )
    expect(
      findTourForPath([list, editor], '/crm/email-templates/tpl_1')?.key,
    ).toBe('crm.templates.editor')
  })

  it('should prefer the route with more static segments', () => {
    expect(
      findTourForPath([item, editor], '/crm/email-templates/new')?.key,
    ).toBe('crm.templates.editor')
    expect(
      findTourForPath([editor, item], '/crm/email-templates/new')?.key,
    ).toBe('crm.templates.editor')
  })
})

describe('tourRoutes() and tourEntryPath()', () => {
  it('should list a single route as an array', () => {
    expect(tourRoutes(tour({ route: '/crm/leads' }))).toEqual(['/crm/leads'])
  })

  it('should link straight to a static route', () => {
    expect(tourEntryPath(tour({ route: ['/crm/a/:id', '/crm/a'] }))).toEqual({
      path: '/crm/a',
      direct: true,
    })
    expect(tourEntryPath(tour({ route: '' }))).toEqual({
      path: '',
      direct: true,
    })
  })

  it('should fall back to openFrom for routes with parameters', () => {
    expect(
      tourEntryPath(
        tour({ route: '/crm/sites/:siteId', openFrom: '/crm/sites' }),
      ),
    ).toEqual({ path: '/crm/sites', direct: false })
  })

  it('should return null when there is nowhere to send the user', () => {
    expect(tourEntryPath(tour({ route: '/crm/sites/:siteId' }))).toBeNull()
  })
})
