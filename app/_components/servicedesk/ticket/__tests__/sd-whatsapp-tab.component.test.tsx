import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import {
  WA_TICKET_URL,
  WA_URL,
  waConversation,
  waMessage,
  waState,
  waTemplate,
} from '../../ai/__tests__/sd-ai-fixtures'
import { formatSdWaId, SdTicketWhatsappTab } from '../tabs/whatsapp-tab'
import { stubEventSource, tabProps } from './sd-ticket-tab-fixtures'

beforeEach(() => {
  stubEventSource()
})

describe('formatSdWaId', () => {
  it('formats a brazilian number and keeps other digit strings as they are', () => {
    expect(formatSdWaId('5511999998888')).toBe('+55 (11) 99999-8888')
    expect(formatSdWaId('551133334444')).toBe('+55 (11) 3333-4444')
    expect(formatSdWaId('12345')).toBe('12345')
  })

  it('shows a contact known only by its BSUID as having no phone', () => {
    expect(formatSdWaId('BR.13491208655302741918')).toBe('Sem telefone')
  })
})

describe('<SdTicketWhatsappTab />', () => {
  it('is restricted to agents', () => {
    mockFetch([])
    renderWithQuery(<SdTicketWhatsappTab {...tabProps('requester')} />)
    expect(
      screen.getByText('Esta aba é restrita aos agentes do ServiceDesk.'),
    ).toBeTruthy()
  })

  it('explains that no connection is configured and links to the settings', async () => {
    mockFetch([
      {
        match: WA_TICKET_URL,
        data: waState({
          configured: false,
          connection: null,
          conversation: null,
        }),
      },
    ])
    renderWithQuery(<SdTicketWhatsappTab {...tabProps()} />)

    expect(
      await screen.findByText('Nenhuma conexão de WhatsApp configurada'),
    ).toBeTruthy()
    const link = screen.getByRole('link', { name: /Abrir as configurações/ })
    expect(link.getAttribute('href')).toBe(
      '/acme/servicedesk/settings?tab=whatsapp',
    )
  })

  it('surfaces the error of the state query', async () => {
    mockFetch([
      { match: WA_TICKET_URL, status: 403, error: 'Você não é agente' },
    ])
    renderWithQuery(<SdTicketWhatsappTab {...tabProps()} />)
    expect(await screen.findByText('Você não é agente')).toBeTruthy()
  })

  it('starts a conversation with the contact number already filled in', async () => {
    const spy = mockFetch([
      {
        method: 'POST',
        match: `${WA_TICKET_URL}/start`,
        data: waState(),
      },
      { match: `${WA_URL}/conversations`, data: [] },
      { match: WA_TICKET_URL, data: waState({ conversation: null }) },
    ])
    renderWithQuery(<SdTicketWhatsappTab {...tabProps()} />)

    const input = (await screen.findByLabelText(
      'Número do WhatsApp',
    )) as HTMLInputElement
    expect(input.value).toBe('5511999998888')
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar' }))

    await waitFor(() =>
      expect(fetchBody(spy, '/start')).toEqual({ waId: '5511999998888' }),
    )
  })

  it('links an existing conversation from the picker', async () => {
    const spy = mockFetch([
      { method: 'POST', match: `${WA_TICKET_URL}/link`, data: waState() },
      {
        match: `${WA_URL}/conversations`,
        data: [waConversation({ id: 'conv-9' })],
      },
      { match: WA_TICKET_URL, data: waState({ conversation: null }) },
    ])
    renderWithQuery(<SdTicketWhatsappTab {...tabProps()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Vincular' }))
    await waitFor(() =>
      expect(fetchBody(spy, '/link')).toEqual({ conversationId: 'conv-9' }),
    )
  })

  it('shows the conversation and sends a free text message', async () => {
    const spy = mockFetch([
      {
        method: 'POST',
        match: `${WA_TICKET_URL}/messages`,
        data: waMessage({ id: 'm2', direction: 'OUT' }),
      },
      {
        match: `${WA_TICKET_URL}/messages`,
        data: [waMessage(), waMessage({ id: 'm9', text: 'Já olhamos' })],
      },
      { match: WA_TICKET_URL, data: waState() },
    ])
    renderWithQuery(<SdTicketWhatsappTab {...tabProps()} />)

    expect(await screen.findByText('O sistema caiu')).toBeTruthy()
    expect(screen.getByText('Já olhamos')).toBeTruthy()
    expect(screen.getByText(/Janela de 24 h aberta até/)).toBeTruthy()

    const box = screen.getByLabelText('Mensagem do WhatsApp')
    fireEvent.change(box, { target: { value: 'Estamos verificando' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }))

    await waitFor(() =>
      expect(fetchBody(spy, '/messages')).toEqual({
        text: 'Estamos verificando',
      }),
    )
  })

  it('requires an approved template outside the 24h window', async () => {
    const spy = mockFetch([
      {
        method: 'POST',
        match: `${WA_TICKET_URL}/template`,
        data: waMessage({ id: 'm3', type: 'TEMPLATE', direction: 'OUT' }),
      },
      { match: `${WA_TICKET_URL}/templates`, data: [waTemplate()] },
      { match: `${WA_TICKET_URL}/messages`, data: [] },
      {
        match: WA_TICKET_URL,
        data: waState({
          window: { open: false, expiresAt: null, requiresTemplate: true },
        }),
      },
    ])
    renderWithQuery(<SdTicketWhatsappTab {...tabProps()} />)

    expect(
      await screen.findByText(/Fora da janela de 24 h do WhatsApp/),
    ).toBeTruthy()
    expect(screen.queryByLabelText('Mensagem do WhatsApp')).toBeNull()

    fireEvent.change(await screen.findByLabelText('Modelo aprovado'), {
      target: { value: 'tpl-1' },
    })
    fireEvent.change(screen.getByLabelText('Variável 1'), {
      target: { value: 'Rui' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar modelo' }))

    await waitFor(() =>
      expect(fetchBody(spy, '/template')).toEqual({
        templateName: 'retomada_atendimento',
        language: 'pt_BR',
        components: [
          { type: 'body', parameters: [{ type: 'text', text: 'Rui' }] },
        ],
      }),
    )
  })

  it('warns when the connection has no approved template', async () => {
    mockFetch([
      { match: `${WA_TICKET_URL}/templates`, data: [] },
      { match: `${WA_TICKET_URL}/messages`, data: [] },
      {
        match: WA_TICKET_URL,
        data: waState({
          window: { open: false, expiresAt: null, requiresTemplate: true },
        }),
      },
    ])
    renderWithQuery(<SdTicketWhatsappTab {...tabProps()} />)
    expect(
      await screen.findByText(/Nenhum modelo aprovado nesta conexão/),
    ).toBeTruthy()
  })

  it('sends a file through the media endpoint', async () => {
    const spy = mockFetch([
      {
        method: 'POST',
        match: `${WA_TICKET_URL}/media`,
        data: waMessage({ id: 'm4', type: 'DOCUMENT', direction: 'OUT' }),
      },
      { match: `${WA_TICKET_URL}/messages`, data: [] },
      { match: WA_TICKET_URL, data: waState() },
    ])
    renderWithQuery(<SdTicketWhatsappTab {...tabProps()} />)

    const file = new File(['abc'], 'laudo.pdf', { type: 'application/pdf' })
    const input = (await screen.findByLabelText(
      'Arquivo para enviar',
    )) as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      const call = spy.mock.calls.find(([url]) =>
        String(url).includes('/media'),
      )
      expect(call).toBeTruthy()
      expect((call?.[1]?.body as FormData)?.get('file')).toBe(file)
    })
  })

  it('warns instead of uploading a file over 16 MB', async () => {
    const spy = mockFetch([
      { match: `${WA_TICKET_URL}/messages`, data: [] },
      { match: WA_TICKET_URL, data: waState() },
    ])
    renderWithQuery(<SdTicketWhatsappTab {...tabProps()} />)

    const file = new File(['x'], 'enorme.pdf', { type: 'application/pdf' })
    Object.defineProperty(file, 'size', { value: 17 * 1024 * 1024 })
    fireEvent.change(await screen.findByLabelText('Arquivo para enviar'), {
      target: { files: [file] },
    })

    await waitFor(() =>
      expect(
        spy.mock.calls.some(([url]) => String(url).includes('/media')),
      ).toBe(false),
    )
  })

  it('unlinks the conversation after confirmation', async () => {
    const spy = mockFetch([
      {
        method: 'DELETE',
        match: WA_TICKET_URL,
        data: waState({ conversation: null }),
      },
      { match: `${WA_TICKET_URL}/messages`, data: [] },
      { match: WA_TICKET_URL, data: waState() },
    ])
    renderWithQuery(<SdTicketWhatsappTab {...tabProps()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Desvincular' }))
    const alert = await screen.findByRole('alertdialog')
    expect(
      within(alert).getByText(/O chamado deixa de receber as mensagens/),
    ).toBeTruthy()
    fireEvent.click(within(alert).getByRole('button', { name: 'Desvincular' }))

    await waitFor(() =>
      expect(
        spy.mock.calls.some(
          ([url, init]) =>
            init?.method === 'DELETE' && String(url).endsWith(WA_TICKET_URL),
        ),
      ).toBe(true),
    )
  })

  it('flags a disconnected connection and the AI answering the conversation', async () => {
    mockFetch([
      { match: `${WA_TICKET_URL}/messages`, data: [] },
      {
        match: WA_TICKET_URL,
        data: waState({
          connection: {
            id: 'conn-1',
            label: 'Suporte',
            provider: 'ZAPI',
            phoneNumber: '5511988887777',
            status: 'ERROR',
          },
          conversation: waConversation({ aiActive: true }),
        }),
      },
    ])
    renderWithQuery(<SdTicketWhatsappTab {...tabProps()} />)

    expect(await screen.findByText('IA atendendo')).toBeTruthy()
    expect(screen.getByText('Com erro')).toBeTruthy()
    expect(screen.getByText(/A conexão Suporte está com erro/)).toBeTruthy()
  })
})
