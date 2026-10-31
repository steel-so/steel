import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type {
  CrmProspectDraftDTO,
  CrmProspectingSettingsDTO,
} from '@/types/crm-prospecting'
import { ProspectingDrafts } from '../prospecting-drafts'
import {
  formatDraftDate,
  mailtoHref,
  parseKeywords,
  percentUsed,
  whatsappHref,
} from '../prospecting-labels'
import { ProspectingPanel } from '../prospecting-panel'
import { ProspectingSettings } from '../prospecting-settings'

const notify = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))

const DRAFT: CrmProspectDraftDTO = {
  id: 'd1',
  leadId: 'l1',
  companyId: null,
  personId: null,
  targetName: 'Ana Souza',
  channel: 'EMAIL',
  subject: 'Uma ideia para a Acme',
  body: 'Olá, Ana. Vi que a Acme abriu vagas de TI.',
  toEmail: 'ana@acme.com.br',
  toPhone: null,
  summary: 'A Acme está contratando na área de TI.',
  signals: [
    {
      type: 'HIRING',
      label: 'Contratando',
      evidence: 'Estamos contratando analistas',
      sourceUrl: 'https://acme.com.br/vagas',
    },
  ],
  sources: [{ url: 'https://acme.com.br/vagas', title: 'Vagas da Acme' }],
  status: 'PENDING',
  agentId: 'a1',
  createdById: 'u1',
  decidedById: null,
  decidedAt: null,
  rejectReason: null,
  createdAt: '2026-11-02T15:30:00.000Z',
  updatedAt: '2026-11-02T15:30:00.000Z',
}

const SETTINGS: CrmProspectingSettingsDTO = {
  enabled: true,
  monthlyWebLimit: 300,
  monthlyDraftLimit: 100,
  allowedChannels: ['EMAIL', 'WHATSAPP'],
  valueProposition: 'Telefonia em nuvem',
  signalKeywords: ['pabx'],
  searchAvailable: true,
  updatedAt: '2026-11-01T10:00:00.000Z',
}

const USAGE = {
  period: '2026-11-01T00:00:00.000Z',
  searches: 30,
  fetches: 20,
  drafts: 5,
  webLimit: 100,
  draftLimit: 10,
}

describe('prospecting labels', () => {
  it('should format dates in Brasília time', () => {
    expect(formatDraftDate('2026-11-02T15:30:00.000Z')).toMatch(
      /^02\/11\/2026,? 12:30$/,
    )
  })

  it('should build a mailto link with encoded text and no plus signs', () => {
    const href = mailtoHref(DRAFT)
    expect(href?.startsWith('mailto:ana%40acme.com.br?')).toBe(true)
    expect(href).toContain('subject=Uma%20ideia%20para%20a%20Acme')
    expect(href).not.toContain('+')
    expect(mailtoHref({ ...DRAFT, toEmail: null })).toBeNull()
    expect(mailtoHref({ ...DRAFT, channel: 'WHATSAPP' })).toBeNull()
    expect(mailtoHref({ ...DRAFT, subject: null })).toContain('subject=&')
  })

  it('should build a wa.me link, adding Brazil to short numbers', () => {
    const base = { ...DRAFT, channel: 'WHATSAPP' as const, toEmail: null }
    expect(whatsappHref({ ...base, toPhone: '(11) 99999-0000' })).toBe(
      `https://wa.me/5511999990000?text=${encodeURIComponent(DRAFT.body)}`,
    )
    expect(whatsappHref({ ...base, toPhone: '+55 11 99999-0000' })).toContain(
      'wa.me/5511999990000',
    )
    expect(whatsappHref({ ...base, toPhone: '123' })).toBeNull()
    expect(whatsappHref({ ...base, toPhone: null })).toBeNull()
    expect(whatsappHref(DRAFT)).toBeNull()
  })

  it('should parse keywords and compute usage percent', () => {
    expect(parseKeywords('pabx\n call center ,pabx\nab')).toEqual([
      'pabx',
      'call center',
    ])
    expect(percentUsed(50, 100)).toBe(50)
    expect(percentUsed(500, 100)).toBe(100)
    expect(percentUsed(0, 0)).toBe(0)
    expect(percentUsed(3, 0)).toBe(100)
  })
})

describe('<ProspectingDrafts />', () => {
  it('should show the empty state', async () => {
    mockFetch([{ match: '/prospecting/drafts', data: [] }])
    renderWithQuery(<ProspectingDrafts workspaceId='ws1' />)
    expect(await screen.findByText('Nenhum rascunho aqui')).toBeTruthy()
  })

  it('should show an error when the list fails', async () => {
    mockFetch([{ match: '/prospecting/drafts', status: 500, error: 'x' }])
    renderWithQuery(<ProspectingDrafts workspaceId='ws1' />)
    expect(
      await screen.findByText('Não foi possível carregar os rascunhos.'),
    ).toBeTruthy()
  })

  it('should show the draft with signals, evidence and sources', async () => {
    const spy = mockFetch([{ match: '/prospecting/drafts', data: [DRAFT] }])
    renderWithQuery(<ProspectingDrafts workspaceId='ws1' />)
    expect(await screen.findByText('Ana Souza')).toBeTruthy()
    expect(screen.getByText('Aguardando revisão')).toBeTruthy()
    expect(screen.getByText('Contratando')).toBeTruthy()
    expect(screen.getByText('Estamos contratando analistas')).toBeTruthy()
    expect(screen.getByText('Uma ideia para a Acme')).toBeTruthy()
    expect(screen.getByText(/02\/11\/2026,? 12:30/)).toBeTruthy()
    expect(screen.getByText('Páginas lidas (1)')).toBeTruthy()
    expect(String(spy.mock.calls[0][0])).toContain('status=PENDING')
  })

  it('should filter by status', async () => {
    const spy = mockFetch([{ match: '/prospecting/drafts', data: [] }])
    renderWithQuery(<ProspectingDrafts workspaceId='ws1' />)
    await screen.findByText('Nenhum rascunho aqui')
    fireEvent.click(screen.getByRole('tab', { name: 'Todos' }))
    await waitFor(() =>
      expect(
        spy.mock.calls.some(([url]) => !String(url).includes('status=')),
      ).toBe(true),
    )
  })

  it('should approve a pending draft', async () => {
    const spy = mockFetch([
      { match: '/prospecting/drafts/d1/decision', method: 'POST', data: { ...DRAFT, status: 'APPROVED' } },
      { match: '/prospecting/drafts', data: [DRAFT] },
    ])
    renderWithQuery(<ProspectingDrafts workspaceId='ws1' />)
    fireEvent.click(await screen.findByRole('button', { name: 'Aprovar' }))
    await waitFor(() => expect(notify.success).toHaveBeenCalledWith('Rascunho aprovado'))
    expect(fetchBody(spy, '/decision')).toEqual({ decision: 'APPROVE' })
  })

  it('should edit the text and save it', async () => {
    const spy = mockFetch([
      { match: '/prospecting/drafts/d1', method: 'PATCH', data: DRAFT },
      { match: '/prospecting/drafts', data: [DRAFT] },
    ])
    renderWithQuery(<ProspectingDrafts workspaceId='ws1' />)
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    fireEvent.change(screen.getByLabelText('Assunto'), {
      target: { value: 'Novo assunto' },
    })
    fireEvent.change(screen.getByLabelText('Mensagem'), {
      target: { value: 'Novo texto da mensagem para a Ana.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(notify.success).toHaveBeenCalledWith('Rascunho salvo'))
    expect(fetchBody(spy, '/drafts/d1', 'PATCH')).toEqual({
      body: 'Novo texto da mensagem para a Ana.',
      subject: 'Novo assunto',
    })
  })

  it('should cancel an edit and restore the text', async () => {
    mockFetch([{ match: '/prospecting/drafts', data: [DRAFT] }])
    renderWithQuery(<ProspectingDrafts workspaceId='ws1' />)
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    fireEvent.change(screen.getByLabelText('Mensagem'), {
      target: { value: 'Rascunho abandonado' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByText(DRAFT.body)).toBeTruthy()
  })

  it('should require a reason before rejecting', async () => {
    const spy = mockFetch([
      { match: '/decision', method: 'POST', data: { ...DRAFT, status: 'REJECTED' } },
      { match: '/prospecting/drafts', data: [DRAFT] },
    ])
    renderWithQuery(<ProspectingDrafts workspaceId='ws1' />)
    fireEvent.click(await screen.findByRole('button', { name: 'Recusar' }))
    const confirm = screen.getByRole('button', { name: 'Confirmar recusa' })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Motivo da recusa'), {
      target: { value: 'Fora do perfil' },
    })
    fireEvent.click(confirm)
    await waitFor(() => expect(notify.success).toHaveBeenCalledWith('Rascunho recusado'))
    expect(fetchBody(spy, '/decision')).toEqual({
      decision: 'REJECT',
      reason: 'Fora do perfil',
    })
  })

  it('should go back from the rejection form', async () => {
    mockFetch([{ match: '/prospecting/drafts', data: [DRAFT] }])
    renderWithQuery(<ProspectingDrafts workspaceId='ws1' />)
    fireEvent.click(await screen.findByRole('button', { name: 'Recusar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(screen.getByRole('button', { name: 'Aprovar' })).toBeTruthy()
  })

  it('should surface a failed decision', async () => {
    mockFetch([
      { match: '/decision', method: 'POST', status: 409, error: 'Já decidido' },
      { match: '/prospecting/drafts', data: [DRAFT] },
    ])
    renderWithQuery(<ProspectingDrafts workspaceId='ws1' />)
    fireEvent.click(await screen.findByRole('button', { name: 'Aprovar' }))
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
  })

  it('should offer the e-mail link and mark an approved draft as sent', async () => {
    const approved = { ...DRAFT, status: 'APPROVED' as const }
    const spy = mockFetch([
      { match: '/decision', method: 'POST', data: { ...approved, status: 'SENT' } },
      { match: '/prospecting/drafts', data: [approved] },
    ])
    renderWithQuery(<ProspectingDrafts workspaceId='ws1' />)
    const link = await screen.findByRole('link', {
      name: 'Abrir no programa de e-mail',
    })
    expect(link.getAttribute('href')).toContain('mailto:')
    expect(link.getAttribute('rel')).toContain('noreferrer')
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como enviado' }))
    await waitFor(() => expect(notify.success).toHaveBeenCalledWith('Marcado como enviado'))
    expect(fetchBody(spy, '/decision')).toEqual({ decision: 'MARK_SENT' })
  })

  it('should offer the WhatsApp link for a WhatsApp draft and hide edit actions', async () => {
    const whatsapp = {
      ...DRAFT,
      channel: 'WHATSAPP' as const,
      subject: null,
      toEmail: null,
      toPhone: '11999990000',
      status: 'APPROVED' as const,
      signals: [],
      sources: [],
      summary: null,
    }
    mockFetch([{ match: '/prospecting/drafts', data: [whatsapp] }])
    renderWithQuery(<ProspectingDrafts workspaceId='ws1' />)
    const link = await screen.findByRole('link', { name: 'Abrir no WhatsApp' })
    expect(link.getAttribute('href')).toContain('wa.me/5511999990000')
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull()
  })

  it('should show the rejection reason and no actions', async () => {
    const rejected = {
      ...DRAFT,
      status: 'REJECTED' as const,
      rejectReason: 'Fora do perfil',
      toEmail: null,
    }
    mockFetch([{ match: '/prospecting/drafts', data: [rejected] }])
    renderWithQuery(<ProspectingDrafts workspaceId='ws1' />)
    expect(await screen.findByText('Motivo: Fora do perfil')).toBeTruthy()
    expect(screen.getByText(/sem destinatário/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Aprovar' })).toBeNull()
  })
})

describe('<ProspectingSettings />', () => {
  const routes = (settings = SETTINGS) => [
    { match: '/prospecting/settings', data: settings },
    { match: '/prospecting/usage', data: USAGE },
  ]

  it('should show the switch, the numbers and the usage', async () => {
    mockFetch(routes())
    renderWithQuery(
      <ProspectingSettings workspaceId='ws1' slug='acme' canManage />,
    )
    expect(await screen.findByLabelText('Pesquisas por mês')).toBeTruthy()
    expect((screen.getByLabelText('Rascunhos por mês') as HTMLInputElement).value).toBe('100')
    expect(await screen.findByText('50 de 100')).toBeTruthy()
    expect(screen.getByText('5 de 10')).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Rascunhos' }).getAttribute('aria-valuenow')).toBe('50')
  })

  it('should warn when the environment has no web search key', async () => {
    mockFetch(routes({ ...SETTINGS, searchAvailable: false }))
    renderWithQuery(
      <ProspectingSettings workspaceId='ws1' slug='acme' canManage />,
    )
    expect(
      await screen.findByText(/A busca na web não está configurada/),
    ).toBeTruthy()
  })

  it('should save the edited settings', async () => {
    const spy = mockFetch([
      { match: '/prospecting/settings', method: 'PUT', data: SETTINGS },
      ...routes(),
    ])
    renderWithQuery(
      <ProspectingSettings workspaceId='ws1' slug='acme' canManage />,
    )
    fireEvent.change(await screen.findByLabelText('Pesquisas por mês'), {
      target: { value: '120' },
    })
    fireEvent.change(screen.getByLabelText('Rascunhos por mês'), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'WhatsApp' }))
    fireEvent.change(screen.getByLabelText(/O que vocês vendem/), {
      target: { value: '   ' },
    })
    fireEvent.change(screen.getByLabelText(/Termos de sinal de compra/), {
      target: { value: 'pabx\ncall center' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar configurações' }))
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Configurações salvas'),
    )
    expect(fetchBody(spy, '/settings', 'PUT')).toEqual({
      enabled: true,
      monthlyWebLimit: 120,
      monthlyDraftLimit: 0,
      allowedChannels: ['EMAIL'],
      valueProposition: null,
      signalKeywords: ['pabx', 'call center'],
    })
  })

  it('should turn a channel back on', async () => {
    mockFetch(routes({ ...SETTINGS, allowedChannels: ['EMAIL'] }))
    renderWithQuery(
      <ProspectingSettings workspaceId='ws1' slug='acme' canManage />,
    )
    const box = await screen.findByRole('checkbox', { name: 'WhatsApp' })
    fireEvent.click(box)
    expect(box.getAttribute('aria-checked')).toBe('true')
  })

  it('should be read-only for non-admins', async () => {
    mockFetch(routes())
    renderWithQuery(
      <ProspectingSettings workspaceId='ws1' slug='acme' canManage={false} />,
    )
    expect(
      await screen.findByText(/Só proprietários e administradores/),
    ).toBeTruthy()
    expect((screen.getByLabelText('Pesquisas por mês') as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: /Criar:/ })).toBeNull()
  })

  it('should create the agent and link to it', async () => {
    const spy = mockFetch([
      { match: '/prospecting/agent', method: 'POST', status: 201, data: { id: 'agent9' } },
      ...routes(),
    ])
    renderWithQuery(
      <ProspectingSettings workspaceId='ws1' slug='acme' canManage />,
    )
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Criar: roda quando um lead é atribuído a ele',
      }),
    )
    const link = await screen.findByRole('link', { name: 'Abrir o agente criado' })
    expect(link.getAttribute('href')).toBe('/acme/ai/agents/agent9')
    expect(fetchBody(spy, '/agent')).toEqual({ trigger: 'ASSIGNMENT' })
  })

  it('should create the new-lead agent', async () => {
    const spy = mockFetch([
      { match: '/prospecting/agent', method: 'POST', status: 201, data: { id: 'agent9' } },
      ...routes(),
    ])
    renderWithQuery(
      <ProspectingSettings workspaceId='ws1' slug='acme' canManage />,
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Criar: roda a cada lead novo' }),
    )
    await screen.findByRole('link', { name: 'Abrir o agente criado' })
    expect(fetchBody(spy, '/agent')).toEqual({ trigger: 'NEW_LEAD' })
  })

  it('should block the agent while prospecting is off, and report a failure', async () => {
    mockFetch(routes({ ...SETTINGS, enabled: false }))
    const { unmount } = renderWithQuery(
      <ProspectingSettings workspaceId='ws1' slug='acme' canManage />,
    )
    const button = await screen.findByRole('button', {
      name: 'Criar: roda a cada lead novo',
    })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Ligue a prospecção para criar o agente.')).toBeTruthy()
    unmount()

    mockFetch([
      { match: '/prospecting/agent', method: 'POST', status: 403, error: 'Sem permissão' },
      ...routes(),
    ])
    renderWithQuery(
      <ProspectingSettings workspaceId='ws1' slug='acme' canManage />,
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Criar: roda a cada lead novo' }),
    )
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
  })

  it('should show an error when the settings fail to load', async () => {
    mockFetch([
      { match: '/prospecting/settings', status: 500, error: 'x' },
      { match: '/prospecting/usage', data: USAGE },
    ])
    renderWithQuery(
      <ProspectingSettings workspaceId='ws1' slug='acme' canManage />,
    )
    expect(
      await screen.findByText('Não foi possível carregar as configurações.'),
    ).toBeTruthy()
  })
})

describe('<ProspectingPanel />', () => {
  it('should open on the drafts and switch to the settings', async () => {
    mockFetch([
      { match: '/prospecting/drafts', data: [] },
      { match: '/prospecting/settings', data: SETTINGS },
      { match: '/prospecting/usage', data: USAGE },
    ])
    renderWithQuery(
      <ProspectingPanel workspaceId='ws1' slug='acme' canManage />,
    )
    expect(await screen.findByText('Nenhum rascunho aqui')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Configurações' }))
    expect(await screen.findByLabelText('Pesquisas por mês')).toBeTruthy()
  })
})
