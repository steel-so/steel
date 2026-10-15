import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { CrmCampaignDetailDTO } from '@/types/crm-campaign'
import { ConversionsByDestination } from '../campaign-dashboard'
import { DestinationStep } from '../campaign-destination-step'
import { type CampaignDraft, draftFromCampaign } from '../campaign-draft'
import { EmailTemplatePicker } from '../campaign-email-template-picker'
import { CampaignWhatsAppPanel } from '../campaign-whatsapp-panel'
import { CrmCampaignWizard } from '../campaign-wizard'
import { campaign, options, SLUG, stats, WS } from './fixtures'

vi.mock('@/lib/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}))
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useParams: () => ({ 'workspace-slug': 'acme' }),
}))

beforeEach(() => {
  router.push.mockReset()
  router.replace.mockReset()
})

/** Renders a step with a live draft (like the wizard does). */
function WithDraft({
  initial,
  children,
}: {
  initial: CrmCampaignDetailDTO
  children: (
    draft: CampaignDraft,
    change: (patch: Partial<CampaignDraft>) => void,
  ) => React.ReactNode
}) {
  const [draft, setDraft] = useState(() => draftFromCampaign(initial))
  return (
    <>
      {children(draft, (patch) => setDraft((d) => ({ ...d, ...patch })))}
      <output data-testid='draft'>{JSON.stringify(draft)}</output>
    </>
  )
}

const draftOf = () =>
  JSON.parse(screen.getByTestId('draft').textContent ?? '{}') as CampaignDraft

function renderDestination(c = campaign()) {
  return renderWithQuery(
    <WithDraft initial={c}>
      {(draft, change) => (
        <DestinationStep
          draft={draft}
          onChange={change}
          options={options()}
          campaign={c}
          workspaceId={WS}
          workspaceSlug={SLUG}
          onRefreshOptions={vi.fn()}
        />
      )}
    </WithDraft>,
  )
}

describe('DestinationStep', () => {
  it('should list sites with address and status, blocking unpublished ones', () => {
    renderDestination(campaign({ destinationType: null, formId: null }))
    const live = screen.getByTestId('campaign-site-s1')
    expect(live.textContent).toContain('Clínica Sorriso')
    expect(live.textContent).toContain('app.test/s/clinica')
    expect(live.textContent).toContain('Publicado')
    expect(live.textContent).toContain('2 páginas no ar')

    const draft = screen.getByTestId('campaign-site-s2')
    expect(draft.textContent).toContain('Rascunho')
    expect(draft.textContent).toContain('Publique o site primeiro')
    expect(
      screen
        .getByRole('link', { name: 'Abrir no editor' })
        .getAttribute('href'),
    ).toBe('/acme/crm/sites/s2')
    expect(
      (
        screen.getByRole('button', {
          name: 'Usar o site Loja nova',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })

  it('should pick a site (home page first) and show the page preview', () => {
    renderDestination(campaign({ destinationType: null, formId: null }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Usar o site Clínica Sorriso' }),
    )
    expect(draftOf()).toMatchObject({
      destinationType: 'SITE_PAGE',
      siteId: 's1',
      sitePageId: 'home',
      formId: null,
    })
    const preview = screen.getByRole('complementary', {
      name: 'Destino escolhido',
    })
    expect(preview.textContent).toContain('Página do site')
    expect(
      screen.getByRole('link', { name: 'app.test/s/clinica' }),
    ).toBeTruthy()
  })

  it('should filter sites by search and status', () => {
    renderDestination(campaign({ destinationType: null, formId: null }))
    fireEvent.change(screen.getByLabelText('Buscar destino'), {
      target: { value: 'loja' },
    })
    expect(screen.queryByTestId('campaign-site-s1')).toBeNull()
    expect(screen.getByTestId('campaign-site-s2')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Buscar destino'), {
      target: { value: 'nada disso' },
    })
    expect(screen.getByText('Nenhum site encontrado.')).toBeTruthy()
  })

  it('should list forms with their public link and site embeds', () => {
    renderDestination()
    // A form campaign opens on the forms tab.
    const form = screen.getByTestId('campaign-form-f1')
    expect(form.textContent).toContain('app.test/f/ftok')
    expect(form.textContent).toContain('Clínica Sorriso › Contato')
    expect(screen.getByTestId('campaign-form-f2').textContent).toContain(
      'Rascunho',
    )

    // The embed chip makes that site page the destination.
    fireEvent.click(
      screen.getByRole('button', { name: 'Clínica Sorriso › Contato' }),
    )
    expect(draftOf()).toMatchObject({
      destinationType: 'SITE_PAGE',
      siteId: 's1',
      sitePageId: 'contato',
      formId: null,
    })
  })

  it('should label legacy landing pages and suggest migrating', () => {
    renderDestination(campaign({ destinationType: null, formId: null }))
    fireEvent.click(screen.getByRole('tab', { name: /Landing pages antigas/ }))
    expect(screen.getByText(/ainda não foram migradas/)).toBeTruthy()
    expect(
      screen
        .getByRole('link', { name: 'Migrar para Sites' })
        .getAttribute('href'),
    ).toBe('/acme/crm/sites')
    fireEvent.click(screen.getByRole('button', { name: /Página BF/ }))
    expect(draftOf()).toMatchObject({
      destinationType: 'LANDING_PAGE',
      landingPageId: 'l1',
    })
    expect(screen.getAllByText('Landing page antiga').length).toBeGreaterThan(0)
  })
})

describe('EmailTemplatePicker', () => {
  it('should show templates with their editor version and pick one', () => {
    const onChange = vi.fn()
    const onCreate = vi.fn()
    const onOpen = vi.fn()
    renderWithQuery(
      <EmailTemplatePicker
        workspaceId={WS}
        templates={options().emailTemplates}
        value='t1'
        onChange={onChange}
        onCreate={onCreate}
        onOpen={onOpen}
      />,
    )
    expect(screen.getByTestId('campaign-template-t1').textContent).toContain(
      'Novo editor',
    )
    expect(screen.getByTestId('campaign-template-t2').textContent).toContain(
      'HTML',
    )
    fireEvent.click(screen.getByRole('button', { name: /Newsletter antiga/ }))
    expect(onChange).toHaveBeenCalledWith('t2')
    fireEvent.click(screen.getByRole('button', { name: /Criar novo template/ }))
    expect(onCreate).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Abrir no editor/ }))
    expect(onOpen).toHaveBeenCalledWith('t1')

    fireEvent.change(screen.getByLabelText('Buscar template'), {
      target: { value: 'zzz' },
    })
    expect(screen.getByText('Nenhum template encontrado.')).toBeTruthy()
  })
})

describe('Content step — e-mail editor round trip', () => {
  function setupWizard(
    c = campaign(),
    initialEmailTemplateId: string | null = null,
  ) {
    const spy = mockFetch([
      {
        method: 'PATCH',
        match: `/crm/campaigns/${c.id}`,
        handler: (_url, init) => ({ ...c, ...JSON.parse(String(init?.body)) }),
      },
      {
        match: `/crm/campaigns/${c.id}/preview`,
        data: { subject: 'Oferta', html: '<p>Oi</p>', text: 'Oi' },
      },
    ])
    renderWithQuery(
      <CrmCampaignWizard
        workspaceId={WS}
        workspaceSlug={SLUG}
        campaign={c}
        options={options()}
        onRefreshOptions={vi.fn()}
        initialStep={1}
        initialEmailTemplateId={initialEmailTemplateId}
      />,
    )
    return spy
  }

  it('should open the template gallery with a way back to the wizard', async () => {
    setupWizard()
    fireEvent.click(screen.getByRole('button', { name: /Criar novo template/ }))
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(
        `/acme/crm/email-templates/new?returnTo=${encodeURIComponent('/acme/crm/campaigns/c1?passo=2')}`,
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: /Abrir no editor/ }))
    await waitFor(() =>
      expect(router.push).toHaveBeenLastCalledWith(
        `/acme/crm/email-templates/t1?returnTo=${encodeURIComponent('/acme/crm/campaigns/c1?passo=2')}`,
      ),
    )
  })

  it('should select and save the template the editor sent back', async () => {
    const spy = setupWizard(campaign(), 't2')
    await waitFor(() =>
      expect(fetchBody(spy, '/crm/campaigns/c1', 'PATCH')).toEqual({
        emailTemplateId: 't2',
      }),
    )
    expect(router.replace).toHaveBeenCalledWith(
      '/acme/crm/campaigns/c1?passo=2',
      {
        scroll: false,
      },
    )
  })

  it('should show the checklist of the chosen template', () => {
    setupWizard(
      campaign({
        emailChecklist: [
          { level: 'error', message: 'Variável desconhecida: {{x}}' },
          { level: 'warning', message: 'Imagem sem texto alternativo' },
        ],
      }),
    )
    const list = screen.getByRole('list', { name: 'Checklist do e-mail' })
    expect(list.textContent).toContain('Erro: Variável desconhecida')
    expect(list.textContent).toContain('Aviso: Imagem sem texto alternativo')
  })
})

describe('CampaignWhatsAppPanel', () => {
  function renderPanel(c: CrmCampaignDetailDTO) {
    return renderWithQuery(
      <WithDraft initial={c}>
        {(draft, change) => (
          <CampaignWhatsAppPanel
            draft={draft}
            onChange={change}
            options={options()}
            sampleLink='https://app.test/s/clinica?utm_source=whatsapp'
          />
        )}
      </WithDraft>,
    )
  }

  it('should show Meta templates with quality and block the red one', () => {
    renderPanel(
      campaign({ whatsappEnabled: true, whatsappConnectionId: 'meta' }),
    )
    const red = screen.getByTestId('campaign-wa-template-wt-red')
    expect(red.textContent).toContain('Qualidade baixa')
    expect(red.querySelector('button')?.disabled).toBe(true)
    expect(screen.getByRole('note').textContent).toMatch(/use outro template/)

    const good = screen.getByTestId('campaign-wa-template-wt1')
    expect(good.textContent).toContain('Imagem no cabeçalho')
    expect(good.textContent).toContain('2 botões')
  })

  it('should map the URL button to the campaign link and keep reply actions', () => {
    renderPanel(
      campaign({ whatsappEnabled: true, whatsappConnectionId: 'meta' }),
    )
    fireEvent.click(
      screen
        .getByTestId('campaign-wa-template-wt1')
        .querySelector('button') as HTMLButtonElement,
    )
    expect(draftOf()).toMatchObject({
      whatsappTemplateId: 'wt1',
      whatsappVariables: {
        header: {},
        body: {},
        buttons: { '0': { source: 'link_code' } },
      },
    })
    expect(screen.getByText(/leva ao destino da campanha/)).toBeTruthy()
    expect(
      screen.getByText(/2 ação\(ões\) configurada\(s\) na Comunicação/),
    ).toBeTruthy()
    const bubble = screen.getByRole('figure', {
      name: 'Prévia da mensagem de WhatsApp',
    })
    expect(bubble.textContent).toContain('Ver oferta')
    expect(bubble.querySelector('img')?.getAttribute('src')).toBe(
      'https://cdn.test/bf.png',
    )
  })

  it('should offer Z-API quick replies with buttons as content', () => {
    renderPanel(
      campaign({ whatsappEnabled: true, whatsappConnectionId: 'zapi' }),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Resposta rápida com botões' }),
    )
    expect(draftOf()).toMatchObject({
      whatsappQuickReplyId: 'qr1',
      // The quick reply carries {link} in its URL button: text kept as is.
      whatsappText: 'Oi {nome}, olha a promo!',
    })
    const bubble = screen.getByRole('figure', {
      name: 'Prévia da mensagem de WhatsApp',
    })
    expect(bubble.textContent).toContain('Oi Maria Silva, olha a promo!')
    expect(bubble.textContent).toContain('Quero')
    fireEvent.click(screen.getByRole('button', { name: 'Texto livre' }))
    expect(draftOf().whatsappQuickReplyId).toBeNull()
  })
})

describe('Review step', () => {
  it('should summarize the site page, audience, checklist and previews', async () => {
    mockFetch([
      {
        method: 'POST',
        match: '/crm/campaigns/audience-preview',
        data: {
          total: 30,
          email: { reachable: 25, optedOut: 2, missing: 3 },
          whatsapp: { reachable: 12, optedOut: 1, missing: 17 },
        },
      },
      {
        match: '/crm/campaigns/c1/preview',
        data: { subject: 'Oferta', html: '<p>Oi</p>', text: 'Oi' },
      },
    ])
    renderWithQuery(
      <CrmCampaignWizard
        workspaceId={WS}
        workspaceSlug={SLUG}
        campaign={campaign({
          destinationType: 'SITE_PAGE',
          formId: null,
          siteId: 's1',
          sitePageId: 'contato',
          whatsappEnabled: true,
          whatsappConnectionId: 'zapi',
          whatsappText: 'Oi {primeiro_nome}: {link}',
          emailChecklist: [
            { level: 'warning', message: 'Imagem sem texto alternativo' },
          ],
        })}
        options={options()}
        onRefreshOptions={vi.fn()}
        initialStep={3}
      />,
    )
    expect(
      screen.getByText('Página do site · Clínica Sorriso › Contato'),
    ).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'app.test/s/clinica/contato' }),
    ).toBeTruthy()
    expect(screen.getByText('Novo editor')).toBeTruthy()
    expect(await screen.findByText('25')).toBeTruthy()
    expect(screen.getByText('12')).toBeTruthy()
    expect(screen.getByText(/3 descadastro\(s\) ficam de fora/)).toBeTruthy()
    expect(screen.getByText('Imagem sem texto alternativo')).toBeTruthy()
    expect(screen.getByText(/nenhum problema impede o envio/)).toBeTruthy()
    expect(
      screen.getByRole('figure', { name: 'Prévia da mensagem de WhatsApp' })
        .textContent,
    ).toContain(
      'Oi Maria: https://app.test/s/clinica/contato?utm_source=whatsapp',
    )
    expect(await screen.findByTitle('Prévia do e-mail')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Celular' }))
    expect(screen.getByTitle('Prévia do e-mail no celular')).toBeTruthy()
  })
})

describe('ConversionsByDestination', () => {
  it('should split conversions by where they happened', () => {
    render(<ConversionsByDestination conversions={stats().conversions} />)
    const section = screen.getByRole('region', {
      name: 'Conversões por destino',
    })
    expect(section.textContent).toContain('Visitas no site5')
    expect(section.textContent).toContain('Formulários no site2')
    expect(section.textContent).toContain('Formulário do CRM1')
    // Legacy landing pages only show when they converted.
    expect(section.textContent).not.toContain('Landing page antiga')
  })
})
