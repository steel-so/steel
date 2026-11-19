import type { BioLink } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { appError } from '@/src/errors/app-error'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/bio-link.repository')

import {
  BioLinkEventRepository,
  BioLinkRepository,
} from '@/src/repositories/bio-link.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { DEFAULT_BIO_THEME } from '@/src/schemas/bio-link.schema'
import { BioLinkPublicService } from '../bio-link-public.service'

const pages = vi.mocked(BioLinkRepository)
const events = vi.mocked(BioLinkEventRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)

const NOW = new Date('2026-11-19T15:00:00.000Z')
const MOBILE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const GOOGLEBOT =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'

const blocks = [
  {
    id: 'wa',
    type: 'link',
    active: true,
    network: 'whatsapp',
    title: 'Fale conosco',
    value: '11912345678',
    message: 'Olá',
  },
  {
    id: 'off',
    type: 'link',
    active: false,
    network: 'custom',
    title: 'Desligado',
    value: 'a.com',
  },
  {
    id: 'later',
    type: 'link',
    active: true,
    network: 'custom',
    title: 'Em breve',
    value: 'b.com',
    startsAt: '2026-12-01T00:00:00.000Z',
  },
  {
    id: 'form',
    type: 'form',
    active: true,
    title: 'Contato',
    formToken: 'tok',
    mode: 'link',
  },
]

const row = {
  id: 'bio1',
  workspaceId: 'ws1',
  name: 'Loja',
  slug: 'minha-loja',
  status: 'PUBLISHED',
  title: '  ',
  description: null,
  avatarUrl: null,
  theme: DEFAULT_BIO_THEME,
  blocks,
  noIndex: false,
  publishedAt: NOW,
  createdById: 'u1',
  updatedById: null,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
} as unknown as BioLink

const visitor = (userAgent = MOBILE) => ({
  ip: '203.0.113.9',
  userAgent,
  host: 'app.exemplo.com',
  country: 'BR',
  now: NOW,
})

beforeEach(() => {
  vi.clearAllMocks()
  moduleAccess.isEnabled.mockResolvedValue(ok(true))
  pages.findPublishedBySlug.mockResolvedValue(ok(row))
  events.record.mockResolvedValue(ok(undefined))
})

describe('BioLinkPublicService.getPublished', () => {
  it('serves the page with the internal name when there is no title', async () => {
    const page = expectOk(await BioLinkPublicService.getPublished('minha-loja'))
    expect(page).toMatchObject({ id: 'bio1', title: 'Loja', noIndex: false })
    expect(page.blocks).toHaveLength(4)
  })

  it('answers not found for an unknown page and for a CRM disabled workspace', async () => {
    pages.findPublishedBySlug.mockResolvedValue(
      err(appError('BIO_LINK_NOT_FOUND', 'Link da bio não encontrado')),
    )
    expectErr(
      await BioLinkPublicService.getPublished('x'),
      'BIO_LINK_NOT_FOUND',
    )

    pages.findPublishedBySlug.mockResolvedValue(ok(row))
    moduleAccess.isEnabled.mockResolvedValue(ok(false))
    expectErr(
      await BioLinkPublicService.getPublished('minha-loja'),
      'BIO_LINK_NOT_FOUND',
    )
  })
})

describe('BioLinkPublicService.recordView', () => {
  it('records an anonymous view without the IP or the raw user agent', async () => {
    expectOk(
      await BioLinkPublicService.recordView('minha-loja', visitor(), {
        referrer: 'https://l.instagram.com/redirect?token=abc',
        utmSource: 'instagram',
      }),
    )
    const event = events.record.mock.calls[0][0]
    expect(event).toMatchObject({
      bioLinkId: 'bio1',
      kind: 'VIEW',
      referrer: 'l.instagram.com',
      utmSource: 'instagram',
      country: 'BR',
      device: 'mobile',
    })
    expect(event.visitorHash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(event)).not.toContain('203.0.113.9')
    expect(JSON.stringify(event)).not.toContain('iPhone')
  })

  it('keeps no referrer for navigation inside the app host', async () => {
    await BioLinkPublicService.recordView('minha-loja', visitor(), {
      referrer: 'https://app.exemplo.com/outra',
    })
    expect(events.record.mock.calls[0][0].referrer).toBeNull()
  })

  it('does not count robots', async () => {
    expectOk(
      await BioLinkPublicService.recordView(
        'minha-loja',
        visitor(GOOGLEBOT),
        {},
      ),
    )
    expect(events.record).not.toHaveBeenCalled()
  })

  it('fails for an unknown page', async () => {
    pages.findPublishedBySlug.mockResolvedValue(
      err(appError('BIO_LINK_NOT_FOUND', 'Link da bio não encontrado')),
    )
    expectErr(
      await BioLinkPublicService.recordView('x', visitor(), {}),
      'BIO_LINK_NOT_FOUND',
    )
  })
})

describe('BioLinkPublicService.resolveClick', () => {
  it('returns the destination and records the click with the page UTM', async () => {
    const destination = expectOk(
      await BioLinkPublicService.resolveClick('minha-loja', 'wa', {
        ...visitor(),
        pageUrl:
          'https://app.exemplo.com/b/minha-loja?utm_source=instagram&utm_campaign=bio',
      }),
    )
    expect(destination).toBe('https://wa.me/5511912345678?text=Ol%C3%A1')
    expect(events.record.mock.calls[0][0]).toMatchObject({
      kind: 'CLICK',
      linkId: 'wa',
      linkTitle: 'Fale conosco',
      utmSource: 'instagram',
      utmCampaign: 'bio',
      device: 'mobile',
      country: 'BR',
    })
  })

  it('sends a form link to the public form page', async () => {
    expect(
      expectOk(
        await BioLinkPublicService.resolveClick(
          'minha-loja',
          'form',
          visitor(),
        ),
      ),
    ).toBe('/f/tok')
  })

  it('resolves nothing for hidden, scheduled, unknown or non-clickable blocks', async () => {
    for (const id of ['off', 'later', 'nope']) {
      expect(
        expectOk(
          await BioLinkPublicService.resolveClick('minha-loja', id, visitor()),
        ),
      ).toBeNull()
    }
    expect(events.record).not.toHaveBeenCalled()
  })

  it('redirects without counting when asked not to record, and for robots', async () => {
    expect(
      expectOk(
        await BioLinkPublicService.resolveClick('minha-loja', 'wa', {
          ...visitor(),
          record: false,
        }),
      ),
    ).toMatch(/^https:\/\/wa\.me\//)
    expectOk(
      await BioLinkPublicService.resolveClick(
        'minha-loja',
        'wa',
        visitor(GOOGLEBOT),
      ),
    )
    expect(events.record).not.toHaveBeenCalled()
  })

  it('still redirects when recording the click fails', async () => {
    events.record.mockResolvedValue(err(databaseError()))
    expect(
      expectOk(
        await BioLinkPublicService.resolveClick('minha-loja', 'wa', visitor()),
      ),
    ).toMatch(/^https:\/\/wa\.me\//)
  })

  it('fails for an unknown page', async () => {
    pages.findPublishedBySlug.mockResolvedValue(
      err(appError('BIO_LINK_NOT_FOUND', 'Link da bio não encontrado')),
    )
    expectErr(
      await BioLinkPublicService.resolveClick('x', 'wa', visitor()),
      'BIO_LINK_NOT_FOUND',
    )
  })
})
