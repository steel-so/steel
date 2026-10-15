import type { Prisma } from '@prisma/client'
import { SITE_SYMBOL_TYPE } from '@/src/lib/canvas-site'
import { form, spec } from '@/src/lib/canvas-site/presets/builder'
import { buildSiteSnapshot, type SiteSnapshot } from '@/src/lib/sites/snapshot'
import type { CampaignSiteRecord } from '@/src/repositories/crm-campaign-lookup.repository'
import { siteDoc } from '../helpers/site-canvas'
import { createFakeSitePage } from './site.factory'

/**
 * A published site for campaign tests: home (`/`) with the form `tok-home`,
 * "Contato" (`/contato`) showing the symbol `sym1` that holds the form
 * `tok-sym`, and a footer with the form `tok-foot` on every page.
 */
export function createCampaignSiteSnapshot(): SiteSnapshot {
  return buildSiteSnapshot({
    name: 'Clínica',
    theme: {},
    settings: {},
    homePageId: 'home',
    pages: [
      createFakeSitePage({
        id: 'contato',
        slug: 'contato',
        path: 'contato',
        title: 'Contato',
        position: 1,
        document: siteDoc([
          spec(SITE_SYMBOL_TYPE, { symbolId: 'sym1' }),
        ]) as unknown as Prisma.JsonValue,
      }),
      createFakeSitePage({
        id: 'home',
        isHome: true,
        title: 'Início',
        position: 0,
        document: siteDoc([
          form({ formToken: 'tok-home' }),
        ]) as unknown as Prisma.JsonValue,
      }),
    ],
    globals: [
      {
        id: 'foot',
        kind: 'FOOTER',
        name: 'Rodapé',
        document: siteDoc([form({ formToken: 'tok-foot' })]),
      },
      {
        id: 'sym1',
        kind: 'SYMBOL',
        name: 'Contato',
        document: siteDoc([form({ formToken: 'tok-sym' })]),
      },
      {
        id: 'sym-unused',
        kind: 'SYMBOL',
        name: 'Outro',
        document: siteDoc([form({ formToken: 'tok-unused' })]),
      },
    ],
  })
}

/** A site row as `CrmCampaignLookupRepository.findSite` returns it. */
export function createFakeCampaignSite(
  overrides?: Partial<CampaignSiteRecord>,
): CampaignSiteRecord {
  return {
    id: 'site1',
    name: 'Clínica',
    slug: 'clinica',
    status: 'PUBLISHED',
    updatedAt: new Date('2026-10-15T12:00:00.000Z'),
    snapshot: createCampaignSiteSnapshot(),
    pages: [
      { id: 'home', title: 'Início', path: 'inicio', isHome: true },
      { id: 'contato', title: 'Contato', path: 'contato', isHome: false },
      { id: 'nova', title: 'Nova', path: 'nova', isHome: false },
    ],
    ...overrides,
  }
}
