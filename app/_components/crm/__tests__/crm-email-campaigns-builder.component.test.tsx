import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { CrmEmailCampaignsTable } from '../crm-email-campaigns-table'

const WS = 'ws_1'

const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))
vi.mock('@/src/hooks/use-crm-workspace-lookups', () => ({
  useCrmWorkspaceLookups: () => ({ lookups: undefined }),
}))
vi.mock('@/app/_components/crm/table/data-table', () => ({
  DataTable: (props: { headerAction?: React.ReactNode }) => (
    <div>{props.headerAction}</div>
  ),
}))
// The sender picker has its own test (email-sender-picker.component.test).
vi.mock('@/app/_components/crm/email-sender-picker', () => ({
  EmailSenderPicker: (props: {
    value: string
    onChange: (email: string) => void
  }) => (
    <input
      aria-label='Remetente'
      placeholder='contato@suaempresa.com'
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
    />
  ),
}))
vi.mock('@/app/_components/crm/email-editor-shell', () => ({
  EmailEditorShell: () => <div data-testid='free-editor' />,
}))

const BUILDER_TEMPLATE = {
  id: 'tb1',
  name: 'Promo visual',
  subject: 'Oi {{primeiro_nome}}',
  contentHtml: '<html>{{unsubscribe_url}}</html>',
  kind: 'BUILDER',
}

function setup() {
  const spy = mockFetch([
    {
      method: 'POST',
      match: '/email-templates/tb1/render',
      data: {
        subject: 'Oi Maria',
        html: '<p>Prévia renderizada</p>',
        text: '',
      },
    },
    {
      method: 'POST',
      match: /email-campaigns$/,
      data: { id: 'new1', subject: 'Oi {{primeiro_nome}}' },
    },
    { method: 'POST', match: '/email-campaigns/new1/send', data: {} },
    { match: '/crm/email-campaigns', data: [] },
    { match: '/crm/email-templates', data: [BUILDER_TEMPLATE] },
    { match: '/crm/people', data: [] },
    { match: '/crm/mailing-lists', data: [] },
  ])
  renderWithQuery(<CrmEmailCampaignsTable workspaceId={WS} slug='acme' />)
  return spy
}

describe('<CrmEmailCampaignsTable /> with a visual-builder template', () => {
  it('previews the server render and sends with templateId + campaign link', async () => {
    const spy = setup()
    fireEvent.click(screen.getByRole('button', { name: /nova campanha/i }))
    fireEvent.click(await screen.findByText('Editor em branco'))
    fireEvent.click(await screen.findByText(/Promo visual · editor visual/))

    const link = await screen.findByPlaceholderText(
      'https://suaempresa.com.br/oferta?utm_source=email',
    )
    expect(screen.queryByTestId('free-editor')).toBeNull()
    fireEvent.change(link, {
      target: { value: 'https://acme.com.br/oferta?utm_source=email' },
    })
    await waitFor(() =>
      expect(
        (
          screen.getByTitle('Pré-visualização da campanha') as HTMLIFrameElement
        ).getAttribute('srcdoc'),
      ).toContain('Prévia renderizada'),
    )
    await waitFor(() =>
      expect(fetchBody(spy, '/tb1/render')).toEqual({
        campaignLink: 'https://acme.com.br/oferta?utm_source=email',
      }),
    )

    fireEvent.change(screen.getByPlaceholderText('contato@suaempresa.com'), {
      target: { value: 'mkt@acme.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /enviar agora/i }))
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Campanha enviada'),
    )
    expect(fetchBody(spy, /email-campaigns$/)).toMatchObject({
      subject: 'Oi {{primeiro_nome}}',
      templateId: 'tb1',
      campaignLink: 'https://acme.com.br/oferta?utm_source=email',
    })
    expect(fetchBody(spy, /email-campaigns$/)).not.toHaveProperty('contentHtml')
  })

  it('rejects a campaign link that is not https', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /nova campanha/i }))
    fireEvent.click(await screen.findByText('Editor em branco'))
    fireEvent.click(await screen.findByText(/Promo visual · editor visual/))
    fireEvent.change(
      await screen.findByPlaceholderText(
        'https://suaempresa.com.br/oferta?utm_source=email',
      ),
      { target: { value: 'ftp://x' } },
    )
    fireEvent.change(screen.getByPlaceholderText('contato@suaempresa.com'), {
      target: { value: 'mkt@acme.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /enviar agora/i }))
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        'O link da campanha precisa começar com https://',
      ),
    )
  })
})
