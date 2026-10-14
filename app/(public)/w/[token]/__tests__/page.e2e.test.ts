import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  seedWikiPage,
  withWiki,
} from '@/src/__tests__/factories/wiki-page.factory'
import { authenticatedOwner, getJson } from '@/src/__tests__/helpers/e2e'
import { prisma } from '@/src/lib/prisma'
import { ensureBucket, putObject } from '@/src/lib/storage/s3'

const newToken = () => randomBytes(24).toString('base64url')

/**
 * The root layout streams every page inside a Suspense boundary, so a
 * `notFound()` in the page body arrives as the not-found UI (and its
 * `NEXT_HTTP_ERROR_FALLBACK;404` digest) after the 200 status is sent.
 */
async function expectNotFound(res: Response, hidden: string) {
  const html = await res.text()
  expect([200, 404]).toContain(res.status)
  expect(html).toContain('NEXT_HTTP_ERROR_FALLBACK;404')
  expect(html).not.toContain(hidden)
}

async function publishedPage() {
  const { user, workspace } = await withWiki(authenticatedOwner())
  const token = newToken()
  const key = `${workspace.id}/e2e-${token.slice(0, 8)}.png`
  const page = await seedWikiPage(workspace.id, user.id, {
    title: 'Guia público',
    publicToken: token,
    publishedAt: new Date(),
    content: [
      { type: 'p', children: [{ text: 'Conteúdo aberto' }] },
      {
        type: 'img',
        url: `http://localhost:9002/wiki-media/${key}?X-Amz-Signature=old`,
        children: [{ text: '' }],
      },
    ],
  })
  return { page, token, key, workspace }
}

describe('GET /w/[token] (published wiki page)', () => {
  it('should render the page anonymously, noindex', async () => {
    const { token } = await publishedPage()

    const res = await getJson(`/w/${token}`)

    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Guia público')
    expect(html).toContain('Conteúdo aberto')
    expect(html).toContain('noindex')
    expect(html).toContain(`/api/wiki/public/${token}/media?key=`)
  })

  it('should 404 an unknown token and a revoked one', async () => {
    const { page, token } = await publishedPage()

    await expectNotFound(await getJson(`/w/${newToken()}`), 'Guia público')

    await prisma.wikiPage.update({
      where: { id: page.id },
      data: { publicToken: null, publishedAt: null },
    })
    await expectNotFound(await getJson(`/w/${token}`), 'Guia público')
  })
})

describe('GET /api/wiki/public/[token]/media', () => {
  it('should stream a referenced image to an anonymous visitor', async () => {
    const { token, key } = await publishedPage()
    await ensureBucket('wiki-media')
    await putObject({
      bucket: 'wiki-media',
      key,
      body: Buffer.from([137, 80, 78, 71]),
      contentType: 'image/png',
    })

    const res = await getJson(
      `/api/wiki/public/${token}/media?key=${encodeURIComponent(key)}`,
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await res.arrayBuffer())).toEqual(
      Buffer.from([137, 80, 78, 71]),
    )
  })

  it('should 404 a key the page does not reference', async () => {
    const { token, workspace } = await publishedPage()

    const res = await getJson(
      `/api/wiki/public/${token}/media?key=${encodeURIComponent(`${workspace.id}/other.png`)}`,
    )

    expect(res.status).toBe(404)
  })
})
