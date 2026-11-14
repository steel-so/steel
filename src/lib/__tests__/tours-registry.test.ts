import { describe, expect, it } from 'vitest'
import { tourRoutes } from '../tours/match'
import { getTour, isKnownTourKey, TOURS } from '../tours/registry'

/** `/crm/sites/:siteId` and `/crm/sites/:id` are the same screen. */
const shape = (route: string) => route.replace(/:[^/]+/g, ':param')

describe('tour registry', () => {
  it('should find tours by key', () => {
    expect(getTour('platform.home')?.title).toBe('Conheça o Steel')
    expect(getTour('nope')).toBeNull()
    expect(isKnownTourKey('platform.home')).toBe(true)
    expect(isKnownTourKey('nope')).toBe(false)
  })

  it('should give every tour a unique, well-formed key under its module', () => {
    const keys = TOURS.map((tour) => tour.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const tour of TOURS) {
      expect(tour.key).toMatch(/^[a-z]+(\.[a-z0-9]+(-[a-z0-9]+)*)+$/)
      expect(tour.key.length).toBeLessThanOrEqual(80)
      expect(tour.key.startsWith(`${tour.module}.`)).toBe(true)
      expect(Number.isInteger(tour.version) && tour.version >= 1).toBe(true)
    }
  })

  it('should never put two tours on the same screen', () => {
    const owners = new Map<string, string>()
    for (const tour of TOURS) {
      for (const route of tourRoutes(tour)) {
        const key = shape(route)
        expect(
          owners.get(key),
          `${tour.key} and ${owners.get(key)} share ${route}`,
        ).toBeUndefined()
        owners.set(key, tour.key)
      }
    }
  })

  it('should write routes relative to the workspace', () => {
    for (const tour of TOURS) {
      for (const route of tourRoutes(tour)) {
        expect(route === '' || route.startsWith('/'), tour.key).toBe(true)
        expect(route.endsWith('/'), tour.key).toBe(false)
      }
      if (tour.openFrom !== undefined) {
        expect(tour.openFrom.startsWith('/'), tour.key).toBe(true)
        expect(tour.openFrom.includes(':'), tour.key).toBe(false)
      }
    }
  })

  it('should keep tours short: 3 to 8 steps of brief copy', () => {
    for (const tour of TOURS) {
      expect(tour.steps.length, tour.key).toBeGreaterThanOrEqual(3)
      expect(tour.steps.length, tour.key).toBeLessThanOrEqual(8)
      expect(tour.title.length, tour.key).toBeLessThanOrEqual(40)
      expect(tour.description.length, tour.key).toBeLessThanOrEqual(120)
      for (const step of tour.steps) {
        expect(
          step.title.length,
          `${tour.key}: ${step.title}`,
        ).toBeLessThanOrEqual(48)
        expect(
          step.body.length,
          `${tour.key}: ${step.title}`,
        ).toBeLessThanOrEqual(220)
        expect(step.body.trim().length, tour.key).toBeGreaterThan(0)
      }
    }
  })

  it('should point at something on the screen and not repeat an anchor', () => {
    for (const tour of TOURS) {
      const targets = tour.steps
        .map((step) => step.target)
        .filter((target) => target !== undefined)
      expect(targets.length, tour.key).toBeGreaterThanOrEqual(2)
      expect(new Set(targets).size, tour.key).toBe(targets.length)
      for (const target of targets) {
        expect(target, tour.key).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      }
    }
  })

  it('should give desktop-only tours a summary for phones', () => {
    for (const tour of TOURS) {
      if (!tour.desktopOnly) continue
      expect(tour.mobileSummary?.trim().length ?? 0, tour.key).toBeGreaterThan(
        0,
      )
      expect(tour.mobileSummary?.length ?? 0, tour.key).toBeLessThanOrEqual(260)
    }
  })

  it('should link the manual with an internal /docs path', () => {
    for (const tour of TOURS) {
      if (tour.docsHref === undefined) continue
      expect(tour.docsHref, tour.key).toMatch(/^\/docs(\/[a-z0-9-]+)*$/)
    }
  })
})
