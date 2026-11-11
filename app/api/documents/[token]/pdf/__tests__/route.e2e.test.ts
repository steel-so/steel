import { describe, expect, it } from 'vitest'
import {
  seedDocument,
  seedDocumentVersion,
} from '@/src/__tests__/factories/document-pdf.factory'
import { authenticatedOwner, getJson } from '@/src/__tests__/helpers/e2e'
import { prisma } from '@/src/lib/prisma'

async function seedSentDocument(allowDownload: boolean) {
  const { user, workspace } = await authenticatedOwner()
  const document = await seedDocument(workspace.id, user.id, {
    status: 'SENT',
    settings: { allowDownload },
  })
  const version = await seedDocumentVersion(document.id, workspace.id, {
    settings: { allowDownload },
  })
  await prisma.document.update({
    where: { id: document.id },
    data: { currentVersionId: version.id },
  })
  return document
}

describe('GET /api/documents/[token]/pdf', () => {
  it('should answer 410 for an unknown link, without a session', async () => {
    const res = await getJson('/api/documents/unknown-token/pdf')
    expect(res.status).toBe(410)
    expect((await res.json()).error.code).toBe('DOCUMENT_LINK_UNAVAILABLE')
  })

  it('should refuse when the document disables downloads', async () => {
    const document = await seedSentDocument(false)
    const res = await getJson(`/api/documents/${document.publicToken}/pdf`)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('DOCUMENT_DOWNLOAD_DISABLED')
  })

  it('should queue the PDF and answer 202 while it renders', async () => {
    const document = await seedSentDocument(true)
    const path = `/api/documents/${document.publicToken}/pdf`

    const first = await getJson(path)
    expect(first.status).toBe(202)
    const { data } = await first.json()
    expect(data).toEqual({ status: 'PENDING', exportId: expect.any(String) })

    const poll = await getJson(`${path}?exportId=${data.exportId}`)
    expect(poll.status).toBe(202)
    expect((await poll.json()).data.exportId).toBe(data.exportId)

    const invalid = await getJson(`${path}?exportId=${'x'.repeat(65)}`)
    expect(invalid.status).toBe(422)
  })
})
