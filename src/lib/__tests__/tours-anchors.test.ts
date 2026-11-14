import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { matchesRoute, tourRoutes } from '../tours/match'
import { TOURS } from '../tours/registry'

/**
 * Static guards for the tour definitions: nothing here renders the app, so
 * an anchor, a route or a manual page that does not exist would otherwise
 * only show up as a tour that silently loses steps.
 */

const ROOT = process.cwd()
const WORKSPACE_DIR = join(ROOT, 'app', '(private)', '[workspace-slug]')

function walk(dir: string, visit: (file: string) => void): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, visit)
    else visit(full)
  }
}

/** Every `data-tour='name'` literal in the UI source. */
function collectAnchors(): Set<string> {
  const anchors = new Set<string>()
  const pattern = /data-tour['"]?\s*[=:]\s*\{?\s*['"]([a-z0-9-]+)['"]/g
  for (const dir of ['app', 'components']) {
    walk(join(ROOT, dir), (file) => {
      if (!file.endsWith('.tsx') && !file.endsWith('.ts')) return
      const source = readFileSync(file, 'utf8')
      if (!source.includes('data-tour')) return
      for (const match of source.matchAll(pattern)) anchors.add(match[1])
    })
  }
  return anchors
}

/** Workspace page routes as tour patterns: `[id]` → `:id`, groups dropped. */
function collectPageRoutes(): string[] {
  const routes: string[] = []
  walk(WORKSPACE_DIR, (file) => {
    if (!file.endsWith('/page.tsx')) return
    const segments = file
      .slice(WORKSPACE_DIR.length, -'/page.tsx'.length)
      .split(/[\\/]/)
      .filter((part) => part !== '' && !/^\(.*\)$/.test(part))
      .map((part) => (part.startsWith('[') ? ':param' : part))
    routes.push(segments.length === 0 ? '' : `/${segments.join('/')}`)
  })
  return routes
}

describe('tour definitions against the app', () => {
  const anchors = collectAnchors()
  const pages = collectPageRoutes()

  it('should anchor every step on a data-tour attribute that exists', () => {
    for (const tour of TOURS) {
      for (const step of tour.steps) {
        if (step.target === undefined) continue
        expect(
          anchors.has(step.target),
          `${tour.key}: no data-tour='${step.target}' in app/ or components/`,
        ).toBe(true)
      }
    }
  })

  it('should live on routes that are real workspace pages', () => {
    for (const tour of TOURS) {
      const routes = [...tourRoutes(tour)]
      if (tour.openFrom !== undefined) routes.push(tour.openFrom)
      for (const route of routes) {
        // A static tour segment may sit on a dynamic page segment
        // (`/zap/configuracoes/conexoes` on `/zap/configuracoes/[section]`).
        const concrete = route.replace(/:[^/]+/g, 'x')
        expect(
          pages.some((page) => matchesRoute(page, concrete)),
          `${tour.key}: no page for ${route === '' ? '(home)' : route}`,
        ).toBe(true)
      }
    }
  })

  it('should link manual pages that exist', () => {
    for (const tour of TOURS) {
      if (tour.docsHref === undefined) continue
      const base = join(ROOT, 'content', tour.docsHref)
      expect(
        existsSync(`${base}.mdx`) || existsSync(join(base, 'index.mdx')),
        `${tour.key}: no manual page for ${tour.docsHref}`,
      ).toBe(true)
    }
  })
})
