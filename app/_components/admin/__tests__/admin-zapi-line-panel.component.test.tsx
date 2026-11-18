import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { PlatformZapiLineDTO } from '@/types/platform-zapi-line'
import { AdminZapiLinePanel } from '../zapi-line/admin-zapi-line-panel'

const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))

const BASE = '/api/admin/zapi-line'

const NOT_CONFIGURED: PlatformZapiLineDTO = {
  configured: false,
  instanceIdMasked: null,
  hasClientToken: false,
  label: null,
  phone: null,
  status: null,
  statusError: null,
  connectedAt: null,
  statusCheckedAt: null,
  updatedAt: null,
}

function line(
  overrides: Partial<PlatformZapiLineDTO> = {},
): PlatformZapiLineDTO {
  return {
    configured: true,
    instanceIdMasked: '3C4A****9F00',
    hasClientToken: true,
    label: 'Verificação Stratus',
    phone: '5511999990000',
    status: 'CONNECTED',
    statusError: null,
    connectedAt: '2026-11-18T12:00:00.000Z',
    statusCheckedAt: '2026-11-18T12:05:00.000Z',
    updatedAt: '2026-11-18T12:00:00.000Z',
    ...overrides,
  }
}

const QR_IMAGE = 'data:image/png;base64,AAAA'

const dialogButton = (name: string) =>
  within(screen.getByRole('dialog')).getByRole('button', {
    name,
  }) as HTMLButtonElement

function fillReason(value = 'troca do número de verificação') {
  fireEvent.change(screen.getByLabelText('Motivo'), { target: { value } })
}

describe('<AdminZapiLinePanel /> without a line', () => {
  it('explains the feature, warns that nothing validates and shows the form', () => {
    renderWithQuery(<AdminZapiLinePanel initial={NOT_CONFIGURED} />)

    expect(screen.getByText('Nenhuma linha configurada')).toBeTruthy()
    expect(
      screen.getByText(/para todos os workspaces da plataforma/),
    ).toBeTruthy()
    expect(screen.getByText(/número dedicado/)).toBeTruthy()
    expect(screen.getByText(/nunca o nome/)).toBeTruthy()
    expect(screen.getByLabelText('ID da instância')).toBeTruthy()
    expect(screen.getByLabelText('Token da instância')).toBeTruthy()
  })

  it('keeps the submit disabled until the instance id and the token are filled', () => {
    renderWithQuery(<AdminZapiLinePanel initial={NOT_CONFIGURED} />)
    const submit = screen.getByRole('button', {
      name: 'Salvar credenciais',
    }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('ID da instância'), {
      target: { value: 'INST1' },
    })
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Token da instância'), {
      target: { value: 'tok1' },
    })
    expect(submit.disabled).toBe(false)
  })

  it('masks the token fields', () => {
    renderWithQuery(<AdminZapiLinePanel initial={NOT_CONFIGURED} />)
    expect(
      (screen.getByLabelText('Token da instância') as HTMLInputElement).type,
    ).toBe('password')
    expect(
      (screen.getByLabelText(/Client-Token/) as HTMLInputElement).type,
    ).toBe('password')
  })

  it('saves the credentials, then asks for the QR code scan', async () => {
    const spy = mockFetch([
      {
        method: 'PUT',
        match: BASE,
        data: line({ status: 'DISCONNECTED', phone: null, connectedAt: null }),
      },
      {
        match: `${BASE}/qr-code`,
        data: {
          status: 'awaiting_scan',
          qrCodeBase64: QR_IMAGE,
          line: line({ status: 'AWAITING_QR', phone: null }),
        },
      },
    ])
    renderWithQuery(<AdminZapiLinePanel initial={NOT_CONFIGURED} />)

    fireEvent.change(screen.getByLabelText('ID da instância'), {
      target: { value: ' INST1 ' },
    })
    fireEvent.change(screen.getByLabelText('Token da instância'), {
      target: { value: 'tok1' },
    })
    fireEvent.change(screen.getByLabelText(/Client-Token/), {
      target: { value: 'client1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar credenciais' }))

    const image = await screen.findByAltText(
      'QR Code de conexão da linha de verificação',
    )
    expect((image as HTMLImageElement).src).toBe(QR_IMAGE)
    expect(fetchBody(spy, BASE, 'PUT')).toEqual({
      instanceId: 'INST1',
      token: 'tok1',
      clientToken: 'client1',
    })
    expect(notify.success).toHaveBeenCalled()
    // The form fields do not linger once the line exists.
    expect(screen.queryByLabelText('Token da instância')).toBeNull()
  })

  it('reports a failed save', async () => {
    mockFetch([
      { method: 'PUT', match: BASE, status: 502, error: 'Z-API fora' },
    ])
    renderWithQuery(<AdminZapiLinePanel initial={NOT_CONFIGURED} />)
    fireEvent.change(screen.getByLabelText('ID da instância'), {
      target: { value: 'INST1' },
    })
    fireEvent.change(screen.getByLabelText('Token da instância'), {
      target: { value: 'tok1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar credenciais' }))
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
    expect(screen.getByText('Nenhuma linha configurada')).toBeTruthy()
  })
})

describe('<AdminZapiLinePanel /> waiting for the scan', () => {
  it('warns that nobody can validate and shows the QR code', async () => {
    mockFetch([
      {
        match: `${BASE}/qr-code`,
        data: {
          status: 'awaiting_scan',
          qrCodeBase64: QR_IMAGE,
          line: line({ status: 'AWAITING_QR', phone: null }),
        },
      },
    ])
    renderWithQuery(
      <AdminZapiLinePanel
        initial={line({ status: 'DISCONNECTED', phone: null })}
      />,
    )

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('desconectada')
    expect(alert.textContent).toContain('nenhum workspace consegue validar')
    expect(screen.getByText('Desconectada')).toBeTruthy()
    expect(await screen.findByAltText(/QR Code de conexão/)).toBeTruthy()
    expect(screen.getByText(/Aparelhos conectados/)).toBeTruthy()
    // Nothing to restart or disconnect while there is no pairing.
    expect(screen.queryByRole('button', { name: 'Desconectar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reconectar' })).toBeNull()
  })

  it('shows the pairing error from Z-API with a retry', async () => {
    const spy = mockFetch([
      {
        match: `${BASE}/qr-code`,
        status: 502,
        error: 'Client-Token inválido',
      },
    ])
    renderWithQuery(
      <AdminZapiLinePanel
        initial={line({
          status: 'ERROR',
          statusError: 'Client-Token inválido',
          phone: null,
        })}
      />,
    )

    expect(await screen.findByText(/Confira o ID da instância/)).toBeTruthy()
    expect(screen.getAllByText(/Client-Token inválido/).length).toBeGreaterThan(
      0,
    )
    const before = spy.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(before))
  })

  it('says it is connected as soon as Z-API reports the phone paired', async () => {
    mockFetch([
      {
        match: `${BASE}/qr-code`,
        data: { status: 'connected', line: line() },
      },
    ])
    renderWithQuery(
      <AdminZapiLinePanel
        initial={line({ status: 'AWAITING_QR', phone: null })}
      />,
    )

    expect(await screen.findByText('Conectada')).toBeTruthy()
    expect(screen.getByText('+5511999990000')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('<AdminZapiLinePanel /> connected', () => {
  it('shows the number, the masked instance and no warning or QR code', () => {
    const spy = mockFetch([])
    renderWithQuery(<AdminZapiLinePanel initial={line()} />)

    expect(screen.getByText('Conectada')).toBeTruthy()
    expect(screen.getByText('+5511999990000')).toBeTruthy()
    expect(screen.getByText('3C4A****9F00')).toBeTruthy()
    expect(screen.getByText('Verificação Stratus')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByAltText(/QR Code/)).toBeNull()
    expect(spy).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Reconectar' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Desconectar' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remover' })).toBeTruthy()
  })

  it('refreshes the status on demand', async () => {
    mockFetch([
      {
        match: `${BASE}/status`,
        data: line({ status: 'DISCONNECTED', phone: null }),
      },
      {
        match: `${BASE}/qr-code`,
        data: {
          status: 'awaiting_scan',
          qrCodeBase64: QR_IMAGE,
          line: line({ status: 'AWAITING_QR', phone: null }),
        },
      },
    ])
    renderWithQuery(<AdminZapiLinePanel initial={line()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Atualizar status' }))

    expect(await screen.findByText('Desconectada')).toBeTruthy()
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('requires a reason to disconnect, then shows the QR code again', async () => {
    const spy = mockFetch([
      {
        method: 'POST',
        match: `${BASE}/disconnect`,
        data: line({ status: 'DISCONNECTED', phone: null, connectedAt: null }),
      },
      {
        match: `${BASE}/qr-code`,
        data: {
          status: 'awaiting_scan',
          qrCodeBase64: QR_IMAGE,
          line: line({ status: 'AWAITING_QR', phone: null }),
        },
      },
    ])
    renderWithQuery(<AdminZapiLinePanel initial={line()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Desconectar' }))
    expect(screen.getByText(/nenhum workspace consegue validar/)).toBeTruthy()
    expect(dialogButton('Desconectar').disabled).toBe(true)

    fillReason()
    expect(dialogButton('Desconectar').disabled).toBe(false)
    fireEvent.click(dialogButton('Desconectar'))

    expect(await screen.findByAltText(/QR Code de conexão/)).toBeTruthy()
    expect(fetchBody(spy, `${BASE}/disconnect`)).toEqual({
      reason: 'troca do número de verificação',
    })
    expect(notify.success).toHaveBeenCalledWith('Linha desconectada')
  })

  it('restarts the line with a reason', async () => {
    const spy = mockFetch([
      { method: 'POST', match: `${BASE}/restart`, data: line() },
    ])
    renderWithQuery(<AdminZapiLinePanel initial={line()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Reconectar' }))
    fillReason('sessão travada')
    fireEvent.click(dialogButton('Reiniciar'))

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Linha reiniciada'),
    )
    expect(fetchBody(spy, `${BASE}/restart`)).toEqual({
      reason: 'sessão travada',
    })
  })

  it('removes the line only after typing the confirmation word', async () => {
    const spy = mockFetch([
      { method: 'DELETE', match: BASE, data: NOT_CONFIGURED },
    ])
    renderWithQuery(<AdminZapiLinePanel initial={line()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Remover' }))
    fillReason('linha aposentada')
    expect(dialogButton('Remover').disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/para confirmar/), {
      target: { value: 'remover' },
    })
    expect(dialogButton('Remover').disabled).toBe(false)
    fireEvent.click(dialogButton('Remover'))

    expect(await screen.findByText('Nenhuma linha configurada')).toBeTruthy()
    expect(fetchBody(spy, BASE, 'DELETE')).toEqual({
      reason: 'linha aposentada',
    })
  })

  it('reports an action that Z-API refused and keeps the dialog open', async () => {
    mockFetch([
      {
        method: 'POST',
        match: `${BASE}/disconnect`,
        status: 502,
        error: 'Z-API fora do ar',
      },
    ])
    renderWithQuery(<AdminZapiLinePanel initial={line()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Desconectar' }))
    fillReason()
    fireEvent.click(dialogButton('Desconectar'))

    await waitFor(() => expect(notify.error).toHaveBeenCalled())
    expect(screen.getByLabelText('Motivo')).toBeTruthy()
  })

  it('replaces the credentials through the same form and can cancel', () => {
    renderWithQuery(<AdminZapiLinePanel initial={line()} />)

    fireEvent.click(
      screen.getByRole('button', { name: 'Substituir credenciais' }),
    )
    expect(screen.getByText(/desconecta a linha atual/)).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Substituir credenciais' }),
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByLabelText('Token da instância')).toBeNull()
    expect(screen.getByText('+5511999990000')).toBeTruthy()
  })
})
