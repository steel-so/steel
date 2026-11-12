import { createId } from '@paralleldrive/cuid2'
import { describe, expect, it } from 'vitest'
import { authenticatedOwner, defaultHeaders } from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'
import { prisma } from '@/src/lib/prisma'

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

describe('proposals moved to Documentos (ADR 0063)', () => {
  async function location(path: string, cookie?: string) {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: cookie ? { ...defaultHeaders, Cookie: cookie } : defaultHeaders,
      redirect: 'manual',
    })
    expect(res.status).toBe(307)
    return new URL(res.headers.get('location') ?? '', BASE_URL)
  }

  async function legacyProposal(workspaceId: string, userId: string) {
    return prisma.crmProposal.create({
      data: {
        name: 'Proposta antiga',
        status: 'SENT',
        shareToken: createId(),
        workspaceId,
        createdById: userId,
        responsibleId: userId,
        sections: {
          create: [
            {
              type: 'COVER',
              order: 0,
              content: { type: 'COVER', title: 'Proposta antiga' },
            },
          ],
        },
      },
    })
  }

  it('redirects the proposal list and the templates to Documentos', async () => {
    const { user, workspace } = await authenticatedOwner()
    const list = await location(`/${workspace.slug}/crm/proposals`, user.cookie)
    expect(list.pathname).toBe(`/${workspace.slug}/crm/documents`)
    expect(list.searchParams.get('kind')).toBe('PROPOSAL')

    for (const path of ['proposal-templates', 'proposal-templates/any']) {
      const url = await location(`/${workspace.slug}/crm/${path}`, user.cookie)
      expect(url.pathname).toBe(`/${workspace.slug}/crm/documents`)
      expect(url.searchParams.get('tab')).toBe('modelos')
    }

    const unknown = await location(
      `/${workspace.slug}/crm/proposals/unknown-id`,
      user.cookie,
    )
    expect(unknown.pathname).toBe(`/${workspace.slug}/crm/documents`)
  })

  it('converts a legacy proposal on the fly and opens its document', async () => {
    const { user, workspace } = await authenticatedOwner()
    const proposal = await legacyProposal(workspace.id, user.id)

    const url = await location(
      `/${workspace.slug}/crm/proposals/${proposal.id}`,
      user.cookie,
    )
    const doc = await prisma.document.findUniqueOrThrow({
      where: { legacyProposalId: proposal.id },
    })
    expect(url.pathname).toBe(`/${workspace.slug}/crm/documents/${doc.id}`)
    expect(doc).toMatchObject({
      kind: 'PROPOSAL',
      status: 'SENT',
      publicToken: proposal.shareToken,
      source: 'LEGACY_PROPOSAL',
    })
  })

  it('sends the old public link to /d with the same token', async () => {
    const { user, workspace } = await authenticatedOwner()
    const proposal = await legacyProposal(workspace.id, user.id)

    const url = await location(`/p/${proposal.shareToken}`)
    expect(url.pathname).toBe(`/d/${proposal.shareToken}`)
    const doc = await prisma.document.findUnique({
      where: { legacyProposalId: proposal.id },
    })
    expect(doc?.currentVersionId).not.toBeNull()

    const unknown = await location('/p/no-such-token')
    expect(unknown.pathname).toBe('/d/no-such-token')
  })
})
