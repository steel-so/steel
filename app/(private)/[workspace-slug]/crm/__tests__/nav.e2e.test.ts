import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  defaultHeaders,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

// Regression: "E-mail e agenda" and "Chaves de API" existed as pages but had
// no entry in the CRM sidebar, so nobody could reach them without the URL.
async function renderPage(slug: string, cookie: string, path = 'leads') {
  const res = await fetch(`${BASE_URL}/${slug}/crm/${path}`, {
    headers: { ...defaultHeaders, Cookie: cookie },
    redirect: 'manual',
  })
  return { status: res.status, html: await res.text() }
}

describe('CRM sidebar entries', () => {
  it('should link e-mail sync and API keys for an owner', async () => {
    const { user, workspace } = await authenticatedOwner()

    const { status, html } = await renderPage(workspace.slug, user.cookie)

    expect(status).toBe(200)
    expect(html).toContain(`href="/${workspace.slug}/crm/email-sync"`)
    expect(html).toContain(`href="/${workspace.slug}/crm/integration-keys"`)
    expect(html).toContain('E-mail e agenda')
    expect(html).toContain('Chaves de API')
  })

  it('should hide API keys from a plain member, keeping e-mail sync', async () => {
    const { workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')

    const { status, html } = await renderPage(workspace.slug, member.cookie)

    expect(status).toBe(200)
    expect(html).toContain(`href="/${workspace.slug}/crm/email-sync"`)
    expect(html).not.toContain(`href="/${workspace.slug}/crm/integration-keys"`)
  })

  // Streaming keeps the HTTP status at 200 when `notFound()` fires; the RSC
  // marker is the reliable signal (see admin-pages.e2e.test.ts).
  it('should not render the API keys page for a plain member', async () => {
    const { workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')

    const { html } = await renderPage(
      workspace.slug,
      member.cookie,
      'integration-keys',
    )

    expect(html).toContain('NEXT_HTTP_ERROR_FALLBACK;404')
  })

  it('should render the API keys page for an owner', async () => {
    const { user, workspace } = await authenticatedOwner()

    const { status, html } = await renderPage(
      workspace.slug,
      user.cookie,
      'integration-keys',
    )

    expect(status).toBe(200)
    expect(html).not.toContain('NEXT_HTTP_ERROR_FALLBACK;404')
  })
})
