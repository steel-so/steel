import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import {
  CRM_NEWSLETTER_REENGAGEMENT_DEFAULTS,
  type CrmNewsletterReengagementDTO,
  type CrmNewsletterWelcomeStepDTO,
} from '@/src/schemas/crm-newsletter-automation.schema'
import { delayLabel } from '../automation-format'
import { NewsletterReengageConfirm } from '../newsletter-reengage-confirm'
import { NewsletterReengagementSection } from '../newsletter-reengagement-section'
import { NewsletterWelcomeTab } from '../newsletter-welcome-tab'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/acme/crm/newsletters/nl1',
}))
afterEach(() => push.mockClear())

const WS = 'ws-1'
const BASE = `/api/workspaces/${WS}/crm/newsletters/nl1`
const STEPS = new RegExp(`${BASE}/welcome-steps$`)

function step(
  overrides: Partial<CrmNewsletterWelcomeStepDTO> = {},
): CrmNewsletterWelcomeStepDTO {
  return {
    id: 'st1',
    newsletterId: 'nl1',
    position: 0,
    delayValue: 0,
    delayUnit: 'DAYS',
    subject: 'Boas-vindas!',
    preheader: null,
    enabled: true,
    stats: { sent: 10, opened: 5, clicked: 1 },
    createdAt: '2026-10-28T12:00:00.000Z',
    updatedAt: '2026-10-28T12:00:00.000Z',
    ...overrides,
  }
}

function tab(senderVerified = true) {
  return (
    <NewsletterWelcomeTab
      workspaceId={WS}
      workspaceSlug='acme'
      newsletterId='nl1'
      senderVerified={senderVerified}
    />
  )
}

describe('delayLabel', () => {
  it('reads the delay after the confirmation', () => {
    expect(delayLabel(0, 'DAYS')).toBe('Logo após a confirmação')
    expect(delayLabel(1, 'DAYS')).toBe('1 dia após a confirmação')
    expect(delayLabel(3, 'DAYS')).toBe('3 dias após a confirmação')
    expect(delayLabel(1, 'HOURS')).toBe('1 hora após a confirmação')
    expect(delayLabel(6, 'HOURS')).toBe('6 horas após a confirmação')
  })
})

describe('<NewsletterWelcomeTab />', () => {
  it('shows the empty state and the unverified sender warning', async () => {
    mockFetch([{ match: STEPS, data: [] }])
    renderWithQuery(tab(false))
    expect(await screen.findByText('Nenhuma etapa ainda')).toBeTruthy()
    expect(
      screen.getByText('O remetente ainda não está verificado'),
    ).toBeTruthy()
  })

  it('lists the steps with delay and rates', async () => {
    mockFetch([
      {
        match: STEPS,
        data: [
          step(),
          step({
            id: 'st2',
            position: 1,
            subject: 'Nossos melhores conteúdos',
            delayValue: 2,
            enabled: false,
            stats: { sent: 0, opened: 0, clicked: 0 },
          }),
        ],
      },
    ])
    renderWithQuery(tab())
    const items = await screen.findAllByTestId('welcome-step')
    expect(items).toHaveLength(2)
    expect(within(items[0]).getByText('Logo após a confirmação')).toBeTruthy()
    expect(within(items[0]).getByText('50%')).toBeTruthy()
    expect(within(items[0]).getByText('10%')).toBeTruthy()
    expect(within(items[1]).getByText('2 dias após a confirmação')).toBeTruthy()
    expect(within(items[1]).getByText('Desligada')).toBeTruthy()
    expect(
      within(items[0])
        .getByRole('link', { name: 'Boas-vindas!' })
        .getAttribute('href'),
    ).toBe('/acme/crm/newsletters/nl1/welcome/st1')
  })

  it('switches a step off', async () => {
    const spy = mockFetch([
      { match: STEPS, data: [step()] },
      {
        method: 'PATCH',
        match: `${BASE}/welcome-steps/st1`,
        data: step({ enabled: false }),
      },
    ])
    renderWithQuery(tab())
    const [item] = await screen.findAllByTestId('welcome-step')
    fireEvent.click(within(item).getByRole('switch'))
    await waitFor(() =>
      expect(fetchBody(spy, `${BASE}/welcome-steps/st1`, 'PATCH')).toEqual({
        enabled: false,
      }),
    )
  })

  it('creates a step and opens the editor', async () => {
    const spy = mockFetch([
      { match: STEPS, data: [] },
      { method: 'POST', match: STEPS, status: 201, data: step({ id: 'new' }) },
    ])
    renderWithQuery(tab())
    await screen.findByText('Nenhuma etapa ainda')
    fireEvent.click(screen.getByTestId('new-welcome-step'))
    const dialog = await screen.findByRole('dialog')
    expect(
      (within(dialog).getByLabelText('Assunto') as HTMLInputElement).value,
    ).toBe('Boas-vindas!')
    fireEvent.change(within(dialog).getByLabelText('Enviar depois de'), {
      target: { value: '-1' },
    })
    expect(
      within(dialog).getByText('O atraso não pode ser negativo'),
    ).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText('Enviar depois de'), {
      target: { value: '0' },
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Criar e abrir o editor' }),
    )
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        '/acme/crm/newsletters/nl1/welcome/new',
      ),
    )
    expect(fetchBody(spy, STEPS)).toEqual({
      subject: 'Boas-vindas!',
      delayValue: 0,
      delayUnit: 'DAYS',
    })
  })
})

function reengagement(
  overrides: Partial<CrmNewsletterReengagementDTO> = {},
): CrmNewsletterReengagementDTO {
  return {
    newsletterId: 'nl1',
    saved: false,
    ...CRM_NEWSLETTER_REENGAGEMENT_DEFAULTS,
    updatedAt: null,
    preview: { candidates: 12, waiting: 3, dueNow: 1 },
    totals: { sent: 0, reengaged: 0, unsubscribed: 0, flagged: 0 },
    ...overrides,
  }
}

describe('<NewsletterReengagementSection />', () => {
  it('shows the preview and saves the settings', async () => {
    const spy = mockFetch([
      { match: new RegExp(`${BASE}/reengagement$`), data: reengagement() },
      {
        method: 'PUT',
        match: new RegExp(`${BASE}/reengagement$`),
        data: reengagement({ saved: true, enabled: true }),
      },
      {
        match: `${BASE}/reengagement/preview`,
        data: { candidates: 40, waiting: 3, dueNow: 1 },
      },
    ])
    renderWithQuery(
      <NewsletterReengagementSection workspaceId={WS} newsletterId='nl1' />,
    )
    expect(await screen.findByText('12')).toBeTruthy()
    expect(screen.getByText('Desligado')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Edições recebidas'), {
      target: { value: '2' },
    })
    expect(await screen.findByText('40', {}, { timeout: 2000 })).toBeTruthy()
    expect(
      spy.mock.calls.some(([url]) =>
        String(url).includes('preview?minIssues=2&inactiveDays=90'),
      ),
    ).toBe(true)

    fireEvent.click(
      screen.getByRole('switch', { name: 'Reengajamento de inativos' }),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Salvar reengajamento' }),
    )
    await waitFor(() =>
      expect(
        fetchBody(spy, new RegExp(`${BASE}/reengagement$`), 'PUT'),
      ).toMatchObject({ enabled: true, minIssues: 2, inactiveDays: 90 }),
    )
  })

  it('blocks saving invalid values and shows the totals', async () => {
    mockFetch([
      {
        match: new RegExp(`${BASE}/reengagement$`),
        data: reengagement({
          saved: true,
          totals: { sent: 9, reengaged: 2, unsubscribed: 5, flagged: 0 },
        }),
      },
    ])
    renderWithQuery(
      <NewsletterReengagementSection workspaceId={WS} newsletterId='nl1' />,
    )
    expect(await screen.findByText(/Até hoje: 9 e-mails/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Dias sem abrir'), {
      target: { value: '5' },
    })
    expect(screen.getByText('Mínimo de 30 dias')).toBeTruthy()
    expect(
      (
        screen.getByRole('button', {
          name: 'Salvar reengajamento',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })
})

describe('<NewsletterReengageConfirm />', () => {
  it('confirms and shows the thank-you state', async () => {
    mockFetch([
      {
        method: 'POST',
        match: '/api/newsletters/reengage/tok',
        data: { newsletterName: 'Novidades', resubscribed: true },
      },
    ])
    renderWithQuery(
      <NewsletterReengageConfirm
        token='tok'
        email='ana@example.com'
        newsletterName='Novidades'
        alreadyConfirmed={false}
      />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Quero continuar recebendo' }),
    )
    expect(await screen.findByText('Que bom que você fica!')).toBeTruthy()
    expect(screen.getByText(/foi reativada/)).toBeTruthy()
  })

  it('shows errors and the already-confirmed state', async () => {
    mockFetch([
      {
        method: 'POST',
        match: '/api/newsletters/reengage/tok',
        status: 404,
        error: 'Link inválido ou expirado',
      },
    ])
    const { unmount } = renderWithQuery(
      <NewsletterReengageConfirm
        token='tok'
        email='ana@example.com'
        newsletterName='Novidades'
        alreadyConfirmed={false}
      />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Quero continuar recebendo' }),
    )
    expect(await screen.findByRole('alert')).toBeTruthy()
    unmount()
    renderWithQuery(
      <NewsletterReengageConfirm
        token='tok'
        email='ana@example.com'
        newsletterName='Novidades'
        alreadyConfirmed
      />,
    )
    expect(screen.getByText(/Você continua recebendo/)).toBeTruthy()
  })
})
