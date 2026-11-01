import { describe, expect, it } from 'vitest'
import { authenticatedOwner, defaultHeaders } from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

// Renders every CRM sidebar section end-to-end against a real `next start`
// build, asserting a 200 (not a Next.js error boundary / 500) — this project
// doesn't otherwise test page-level SSR rendering, only API routes, so this
// is the only guard against a broken import/prop wiring in a page.tsx.
const SEGMENTS = [
  'leads',
  'cadences',
  'duplicates',
  'renewals',
  'opportunities',
  'companies',
  'people',
  'pipelines',
  'products',
  'forecast',
  'tasks',
  'tasks/calendar',
  'notes',
  'proposals',
  'forms',
  'custom-fields',
  'email-templates',
  'campaigns',
  'email-campaigns',
  'mailing-lists',
  'sites',
  'workflows',
  'social',
  'email-sync',
  'reports',
  'dashboards',
  'settings',
  'integration-keys',
]

describe('CRM sidebar pages', () => {
  it('should redirect /crm to the Leads page', async () => {
    const { user, workspace } = await authenticatedOwner()

    const res = await fetch(`${BASE_URL}/${workspace.slug}/crm`, {
      headers: { ...defaultHeaders, Cookie: user.cookie },
    })

    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).not.toContain('Application error')
  })

  it.each(SEGMENTS)(
    'should render /crm/%s without a server error',
    async (segment) => {
      const { user, workspace } = await authenticatedOwner()

      const res = await fetch(`${BASE_URL}/${workspace.slug}/crm/${segment}`, {
        headers: { ...defaultHeaders, Cookie: user.cookie },
        redirect: 'manual',
      })

      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).not.toContain('Application error')
    },
  )
})

describe('landing pages moved to Sites', () => {
  it('redirects the old list to /crm/sites', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await fetch(`${BASE_URL}/${workspace.slug}/crm/landing-pages`, {
      headers: { ...defaultHeaders, Cookie: user.cookie },
      redirect: 'manual',
    })
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location') ?? '', BASE_URL).pathname).toBe(
      `/${workspace.slug}/crm/sites`,
    )
  })

  it('renders the old builder route without a server error', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await fetch(
      `${BASE_URL}/${workspace.slug}/crm/landing-pages/unknown-id`,
      { headers: { ...defaultHeaders, Cookie: user.cookie } },
    )
    expect(res.status).toBe(200)
    expect(await res.text()).not.toContain('Application error')
  })
})
