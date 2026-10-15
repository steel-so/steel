import { createId } from '@paralleldrive/cuid2'
import type {
  Prisma,
  Site,
  SiteGlobal,
  SitePage,
  SiteVersion,
} from '@prisma/client'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { prisma } from '@/src/lib/prisma'
import { createEmptySiteDocument } from '@/src/lib/sites/document'
import { buildSiteSnapshot, type SiteSnapshot } from '@/src/lib/sites/snapshot'

/** A small valid `site` document: section > heading. */
export function createSiteDocument(text = 'Olá'): CanvasDocument {
  return {
    catalog: 'site',
    version: 1,
    rootId: 'root',
    nodes: {
      root: { id: 'root', type: 'site.page', props: {}, children: ['s1'] },
      s1: {
        id: 's1',
        type: 'site.section',
        props: { anchorId: 'inicio' },
        children: ['h1'],
      },
      h1: { id: 'h1', type: 'site.heading', props: { text, level: 1 } },
    },
  }
}

export function createFakeSite(overrides?: Partial<Site>): Site {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    name: 'Clínica São Lucas',
    slug: `clinica-${createId().slice(0, 8)}`,
    status: 'DRAFT',
    theme: {},
    settings: {},
    homePageId: null,
    publishedVersionId: null,
    publishedAt: null,
    sourceLandingPageId: null,
    createdById: createId(),
    updatedById: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  }
}

export function createFakeSitePage(overrides?: Partial<SitePage>): SitePage {
  const now = new Date()
  return {
    id: createId(),
    siteId: createId(),
    parentId: null,
    title: 'Início',
    slug: 'inicio',
    path: 'inicio',
    document: createEmptySiteDocument() as unknown as Prisma.JsonValue,
    seo: {},
    position: 0,
    isHome: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function createFakeSiteGlobal(
  overrides?: Partial<SiteGlobal>,
): SiteGlobal {
  const now = new Date()
  return {
    id: createId(),
    siteId: createId(),
    kind: 'HEADER',
    name: 'Cabeçalho',
    document: createEmptySiteDocument() as unknown as Prisma.JsonValue,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function createFakeSnapshot(
  overrides?: Partial<SiteSnapshot>,
): SiteSnapshot {
  const home = createFakeSitePage({ id: 'home', isHome: true })
  return {
    ...buildSiteSnapshot({
      name: 'Clínica',
      theme: {},
      settings: {},
      homePageId: home.id,
      pages: [home],
      globals: [],
    }),
    ...overrides,
  }
}

export function createFakeSiteVersion(
  overrides?: Partial<SiteVersion>,
): SiteVersion {
  return {
    id: createId(),
    siteId: createId(),
    number: 1,
    snapshot: createFakeSnapshot() as unknown as Prisma.JsonValue,
    publishedById: createId(),
    createdAt: new Date(),
    ...overrides,
  }
}

export async function seedSite(
  workspaceId: string,
  createdById: string,
  overrides?: Partial<
    Pick<Site, 'name' | 'slug' | 'status' | 'deletedAt' | 'sourceLandingPageId'>
  >,
) {
  return prisma.site.create({
    data: {
      workspaceId,
      createdById,
      name: 'Seed Site',
      slug: `seed-${createId().slice(0, 10)}`,
      ...overrides,
    },
  })
}

export async function seedSitePage(
  siteId: string,
  overrides?: Partial<
    Pick<
      SitePage,
      'title' | 'slug' | 'path' | 'parentId' | 'position' | 'isHome'
    >
  >,
) {
  const slug = overrides?.slug ?? `pagina-${createId().slice(0, 6)}`
  return prisma.sitePage.create({
    data: {
      siteId,
      title: 'Seed Page',
      slug,
      path: overrides?.path ?? slug,
      document: createSiteDocument() as unknown as Prisma.InputJsonValue,
      ...overrides,
    },
  })
}

export async function seedSiteGlobal(
  siteId: string,
  overrides?: Partial<Pick<SiteGlobal, 'kind' | 'name'>>,
) {
  return prisma.siteGlobal.create({
    data: {
      siteId,
      kind: 'HEADER',
      name: 'Cabeçalho',
      document: createSiteDocument() as unknown as Prisma.InputJsonValue,
      ...overrides,
    },
  })
}
