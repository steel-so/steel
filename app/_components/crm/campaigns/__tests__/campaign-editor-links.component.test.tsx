import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LinkControl } from '@/app/_components/canvas/inspector/controls/media'
import {
  campaignReturnHref,
  type EmailEditorData,
  EmailEditorDataProvider,
} from '@/app/_components/crm/email-editor/editor-data'
import { createTemplateMetaStore } from '@/app/_components/crm/email-editor/template-meta'
import { UseInCampaignButton } from '@/app/_components/crm/email-editor/use-in-campaign-button'
import { SiteCampaignsPanel } from '@/app/_components/crm/sites/metrics/site-campaigns-panel'
import { notify } from '@/lib/notify'
import { linkField } from '@/src/lib/canvas-email/inspector'
import { DEFAULT_EMAIL_BRAND } from '@/src/lib/canvas-email/theme'
import type { SiteAnalyticsDTO } from '@/types/site-platform'

vi.mock('@/lib/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}))
const router = vi.hoisted(() => ({ push: vi.fn() }))
const params = vi.hoisted(() => ({
  value: { 'workspace-slug': 'acme' } as Record<string, string> | null,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useParams: () => params.value,
}))

function editorData(overrides?: Partial<EmailEditorData>): EmailEditorData {
  return {
    workspaceId: 'ws',
    slug: 'acme',
    templateId: 'tpl9',
    products: [],
    productsLoading: false,
    brand: DEFAULT_EMAIL_BRAND,
    meta: createTemplateMetaStore({ name: 'A', subject: 'B' }),
    flushMeta: async () => true,
    flushDocument: async () => true,
    applyTemplate: () => {},
    returnTo: '/acme/crm/campaigns/c1?passo=2',
    ...overrides,
  }
}

describe('campaignReturnHref()', () => {
  it('should add the template to the wizard URL', () => {
    expect(campaignReturnHref('/acme/crm/campaigns/c1?passo=2', 't1')).toBe(
      '/acme/crm/campaigns/c1?passo=2&emailTemplate=t1',
    )
    expect(campaignReturnHref('/acme/crm/campaigns/c1', 't1')).toBe(
      '/acme/crm/campaigns/c1?emailTemplate=t1',
    )
  })
})

describe('UseInCampaignButton', () => {
  it('should save and go back to the wizard with the template', async () => {
    const flushDocument = vi.fn(async () => true)
    render(
      <EmailEditorDataProvider value={editorData({ flushDocument })}>
        <UseInCampaignButton />
      </EmailEditorDataProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Usar na campanha' }))
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(
        '/acme/crm/campaigns/c1?passo=2&emailTemplate=tpl9',
      ),
    )
    expect(flushDocument).toHaveBeenCalled()
  })

  it('should stay when saving fails and hide outside a campaign', async () => {
    router.push.mockClear()
    const { unmount } = render(
      <EmailEditorDataProvider
        value={editorData({ flushMeta: async () => false })}
      >
        <UseInCampaignButton />
      </EmailEditorDataProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Usar na campanha' }))
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
    expect(router.push).not.toHaveBeenCalled()
    unmount()

    render(
      <EmailEditorDataProvider value={editorData({ returnTo: null })}>
        <UseInCampaignButton />
      </EmailEditorDataProvider>,
    )
    expect(
      screen.queryByRole('button', { name: 'Usar na campanha' }),
    ).toBeNull()
  })
})

describe('LinkControl quick values', () => {
  it('should set the campaign link in one click', () => {
    const field = linkField()
    const onChange = vi.fn()
    const control = field.control as Extract<
      typeof field.control,
      { kind: 'link' }
    >
    const { rerender } = render(
      <LinkControl
        id='link'
        label='Link'
        value={{ type: 'url', value: 'https://x.test' }}
        onChange={onChange}
        control={control}
        node={{} as never}
        breakpoint='base'
      />,
    )
    const quick = screen.getByRole('button', { name: 'Link da campanha' })
    expect(quick.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(quick)
    expect(onChange).toHaveBeenCalledWith({
      type: 'url',
      value: '{{campaign_link}}',
    })
    rerender(
      <LinkControl
        id='link'
        label='Link'
        value={{ type: 'url', value: '{{campaign_link}}' }}
        onChange={onChange}
        control={control}
        node={{} as never}
        breakpoint='base'
      />,
    )
    expect(
      screen
        .getByRole('button', { name: 'Link da campanha' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
  })
})

describe('SiteCampaignsPanel', () => {
  const data = (campaigns: SiteAnalyticsDTO['campaigns']) =>
    ({ campaigns }) as SiteAnalyticsDTO

  it('should list campaign traffic with links to the campaign', () => {
    render(
      <SiteCampaignsPanel
        data={data([
          {
            campaignId: 'c1',
            name: 'Black Friday',
            slug: 'bf',
            views: 1200,
            formSubmissions: 34,
          },
        ])}
      />,
    )
    expect(
      screen.getByRole('link', { name: 'Black Friday' }).getAttribute('href'),
    ).toBe('/acme/crm/campaigns/c1')
    expect(screen.getByText('1.200')).toBeTruthy()
    expect(screen.getByText('34')).toBeTruthy()
  })

  it('should explain an empty period and work without a workspace slug', () => {
    const { unmount } = render(<SiteCampaignsPanel data={data([])} />)
    expect(screen.getByText(/Nenhuma visita de campanha/)).toBeTruthy()
    unmount()
    params.value = null
    render(
      <SiteCampaignsPanel
        data={data([
          {
            campaignId: 'c1',
            name: 'Natal',
            slug: 'natal',
            views: 1,
            formSubmissions: 0,
          },
        ])}
      />,
    )
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Natal')).toBeTruthy()
  })
})
