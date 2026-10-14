import '@/src/__tests__/helpers/dom-matchers'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { COMPETITOR_COMPARISON } from '@/src/config/competitor-comparison'
import { PAID_PLAN_PRICES } from '@/src/config/plan-prices'
import { formatMoney } from '@/src/lib/pricing/comparison'
import { formatCurrency } from '../plans'
import { PricingBillingNote } from '../pricing-billing-note'
import { PricingCalculator } from '../pricing-calculator'
import { PricingCardPlan } from '../pricing-card-plan'
import { formatCheckedAt, PricingComparison } from '../pricing-comparison'
import { PRICING_FAQ, PricingFaq } from '../pricing-faq'
import { PRICING_GROUPS } from '../table/pricing-table-data'
import { PricingTableGroup } from '../table/pricing-table-group'

describe('<PricingComparison />', () => {
  // Inactive tabs stay mounted but hidden, hence `hidden: true`.
  const card = (title: string, scope: HTMLElement = document.body) =>
    within(scope)
      .getAllByRole('article', { hidden: true })
      .find(
        (article) =>
          within(article).getByRole('heading', { level: 4, hidden: true })
            .textContent === title,
      ) as HTMLElement
  const block = (title: string) =>
    screen
      .getByRole('heading', { name: title, hidden: true })
      .closest('section') as HTMLElement

  it('renders one tab and one block per module', () => {
    render(<PricingComparison />)
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'ServiceDesk',
      'CRM',
      'Comunicação',
    ])
    for (const title of [
      'Steel vs ServiceDesk',
      'Steel vs CRM',
      'Steel vs Comunicação',
    ]) {
      expect(block(title)).toBeInTheDocument()
    }
  })

  it('switches the visible module by tab', async () => {
    const user = userEvent.setup()
    render(<PricingComparison />)
    expect(screen.queryByRole('heading', { name: 'Steel vs CRM' })).toBeNull()
    await user.click(screen.getByRole('tab', { name: 'CRM' }))
    expect(
      screen.getByRole('heading', { name: 'Steel vs CRM' }),
    ).toBeInTheDocument()
  })

  it('shows every competitor logo from the Brandfetch CDN', () => {
    const { container } = render(<PricingComparison />)
    const zendesk = container.querySelector('img[title="Zendesk Suite"]')
    expect(zendesk?.getAttribute('src')).toMatch(
      /^https:\/\/cdn\.brandfetch\.io\/zendesk\.com\/.+\?c=/,
    )
  })

  it('falls back to the product initials when a logo fails to load', () => {
    const { container } = render(<PricingComparison />)
    const selector = (tag: string) => `${tag}[title="Jira Service Management"]`
    // Matrix header and price card.
    const logos = container.querySelectorAll(selector('img'))
    expect(logos).toHaveLength(2)
    for (const logo of logos) fireEvent.error(logo)
    expect(container.querySelector(selector('img'))).toBeNull()
    for (const fallback of container.querySelectorAll(selector('span'))) {
      expect(fallback).toHaveTextContent('JS')
    }
  })

  it('prices Steel from plan-prices and computes the team of 10', () => {
    render(<PricingComparison />)
    const steel = card('Steel', block('Steel vs CRM'))
    const proMonthly = Math.round(PAID_PLAN_PRICES.PRO.yearly / 12)
    expect(steel).toHaveTextContent(
      `${formatMoney(proMonthly, 'BRL')} por usuário/mês`,
    )
    expect(steel).toHaveTextContent(formatMoney(proMonthly * 10, 'BRL'))
    // Pipedrive Growth, verified on the official page, with its BRL estimate.
    const pipedrive = card('Pipedrive', block('Steel vs CRM'))
    const rate = COMPETITOR_COMPARISON.exchangeRate.usdBrl
    expect(pipedrive).toHaveTextContent('US$ 24 por usuário/mês')
    expect(pipedrive).toHaveTextContent(
      `≈ ${formatMoney(Math.round(2400 * rate), 'BRL')}`,
    )
    expect(pipedrive).toHaveTextContent('Equipe de 10: US$ 240 por mês')
  })

  it('dates and sources every competitor, without rating them "no"', () => {
    render(<PricingComparison />)
    expect(
      screen.getByText(
        new RegExp(
          `consultada em ${formatCheckedAt(COMPETITOR_COMPARISON.checkedAt)}`,
        ),
      ),
    ).toBeInTheDocument()
    const zendesk = screen.getByRole('link', {
      name: 'Fonte: página de preços de Zendesk Suite',
    })
    expect(zendesk).toHaveAttribute('href', 'https://www.zendesk.com/pricing/')
    expect(zendesk).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.queryByText('Não')).toBeNull()
    expect(screen.getAllByText('Não informado').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Em alguns planos').length).toBeGreaterThan(0)
    expect(screen.getAllByText('À parte').length).toBeGreaterThan(0)
  })

  it('keeps account-wide prices out of the team-of-10 line', () => {
    render(<PricingComparison />)
    const zenvia = card('Zenvia', block('Steel vs Comunicação'))
    expect(zenvia).toHaveTextContent('R$ 600 por mês')
    expect(zenvia).not.toHaveTextContent('Equipe de 10')
  })

  it('formats the check month in Portuguese', () => {
    expect(formatCheckedAt('2026-10')).toBe('outubro de 2026')
    expect(formatCheckedAt('2027-01')).toBe('janeiro de 2027')
  })
})

describe('<PricingCalculator />', () => {
  const rate = COMPETITOR_COMPARISON.exchangeRate.usdBrl
  const reais = (cents: number) => formatCurrency(Math.round(cents / 100) * 100)
  const radio = (name: string) =>
    screen.getByRole('radio', { name }) as HTMLInputElement
  const result = (title: RegExp) =>
    (screen.getByText(title).closest('[data-slot="card"]') as HTMLElement)
      .textContent

  it('defaults to 10 members and the first tool of each module', () => {
    render(<PricingCalculator />)
    const seats = screen.getByLabelText('Número de membros', {
      selector: 'input',
    }) as HTMLInputElement
    expect(seats.value).toBe('10')
    expect(radio('Zendesk Suite').checked).toBe(true)
    expect(radio('Salesforce Sales Cloud').checked).toBe(true)
    expect(radio('Zenvia').checked).toBe(true)
    // Zendesk Suite Team (US$ 55) + Salesforce Starter (US$ 25), 10 seats a
    // year, converted, plus Zenvia Specialist (R$ 600 per account a month).
    const current =
      Math.round(5500 * 12 * 10 * rate) +
      Math.round(2500 * 12 * 10 * rate) +
      60000 * 12
    const steel = PAID_PLAN_PRICES.PRO.yearly * 10
    expect(result(/^Custo anual das ferramentas/)).toContain(reais(current))
    expect(result(/^Custo anual com o Steel Pro/)).toContain(reais(steel))
    expect(result(/^Economia com o Steel/)).toContain(reais(current - steel))
  })

  it('recomputes when the team or a tool changes', async () => {
    const user = userEvent.setup()
    render(<PricingCalculator />)
    const seats = screen.getByLabelText('Número de membros', {
      selector: 'input',
    })
    fireEvent.change(seats, { target: { value: '3' } })
    await user.click(screen.getByRole('radio', { name: 'Pipedrive' }))
    expect(screen.getByText(/Pipedrive · Lite, 3 usuários/)).toBeInTheDocument()
    expect(result(/^Custo anual com o Steel Pro/)).toContain(
      reais(PAID_PLAN_PRICES.PRO.yearly * 3),
    )
  })

  it('skips free plans and states the exchange rate it used', async () => {
    const user = userEvent.setup()
    render(<PricingCalculator />)
    // Jira Service Management starts free; the calculator uses Standard.
    await user.click(
      screen.getByRole('radio', { name: 'Jira Service Management' }),
    )
    expect(
      screen.getByText(/Jira Service Management · Standard, 10 usuários/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/PTAX de venda do Banco Central de 14\/10\/2026/),
    ).toHaveTextContent('US$ 1 = R$ 5,0441')
  })
})

describe('<PricingTableGroup />', () => {
  it('shows the seat limit per plan and checks everything else', () => {
    render(
      <TooltipProvider>
        <PricingTableGroup />
      </TooltipProvider>,
    )
    const seats = screen
      .getByText('Membros (assentos)')
      .closest('tr') as HTMLElement
    expect(within(seats).getAllByText('Até 12')).toHaveLength(2)
    expect(within(seats).getAllByText('Ilimitados')).toHaveLength(2)

    const wiki = screen
      .getByText('Wiki colaborativa')
      .closest('tr') as HTMLElement
    expect(within(wiki).getAllByText('Incluído')).toHaveLength(4)
    expect(
      within(
        screen.getByText('Cota de IA').closest('tr') as HTMLElement,
      ).getAllByText('Mensal, por workspace'),
    ).toHaveLength(4)
  })

  it('has no leftover rows from the project-management catalog', () => {
    const labels = PRICING_GROUPS.flatMap((g) => g.rows.map((r) => r.label))
    for (const word of ['Ciclos', 'Iniciativas', 'LDAP', 'Jira', 'Créditos']) {
      expect(labels.join(' ')).not.toContain(word)
    }
  })
})

describe('<PricingCardPlan /> copy', () => {
  it('lists what every plan includes', () => {
    render(
      <NuqsTestingAdapter searchParams='?billing=yearly'>
        <TooltipProvider>
          <PricingCardPlan plan='PRO' billingEnabled={false} />
        </TooltipProvider>
      </NuqsTestingAdapter>,
    )
    expect(screen.getByText('Inclui')).toBeInTheDocument()
    expect(screen.getByText('Membros ilimitados')).toBeInTheDocument()
    expect(
      screen.getByText('ServiceDesk, CRM e Comunicação'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/teste gratuito de duas semanas/)).toBeNull()
  })

  it('shows Enterprise on request', () => {
    render(
      <NuqsTestingAdapter>
        <TooltipProvider>
          <PricingCardPlan plan='ENTERPRISE' billingEnabled={true} />
        </TooltipProvider>
      </NuqsTestingAdapter>,
    )
    expect(screen.getByText('Sob consulta')).toBeInTheDocument()
    expect(screen.getByText('Falar com vendas').closest('a')).toHaveAttribute(
      'href',
      '/talk-to-sales',
    )
  })
})

describe('<PricingFaq /> and <PricingBillingNote />', () => {
  it('renders every question', () => {
    render(<PricingFaq />)
    for (const item of PRICING_FAQ) {
      expect(screen.getByText(item.question)).toBeInTheDocument()
    }
  })

  it('explains how paid plans are bought with billing on and off', () => {
    const { rerender } = render(<PricingBillingNote billingEnabled={false} />)
    expect(screen.getByText(/equipe comercial/)).toBeInTheDocument()
    rerender(<PricingBillingNote billingEnabled={true} />)
    expect(screen.getByText(/contratação online/)).toBeInTheDocument()
  })
})
