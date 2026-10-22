import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { WhatsappNumberValidationDialog } from '../whatsapp-number-validation-dialog'

vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const CONNECTIONS = '/api/workspaces/ws_1/whatsapp/connections'
const VALIDATIONS = '/api/workspaces/ws_1/whatsapp/number-validations'

function connection(provider: 'ZAPI' | 'META') {
  return {
    id: `conn-${provider}`,
    workspaceId: 'ws_1',
    provider,
    label: provider,
    phoneNumber: '5511999990000',
    status: 'CONNECTED',
    statusError: null,
    zapiInstanceId: null,
    metaPhoneNumberId: null,
    metaWabaId: null,
    createdById: 'u1',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  }
}

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run1',
    workspaceId: 'ws_1',
    connectionId: 'conn-ZAPI',
    scope: 'CONTACTS',
    scopeId: null,
    status: 'DONE',
    total: 4,
    processed: 4,
    withWhatsapp: 2,
    withoutWhatsapp: 1,
    failed: 1,
    cached: 0,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-10-22T12:00:00.000Z',
    ...overrides,
  }
}

function renderDialog() {
  return renderWithQuery(
    <WhatsappNumberValidationDialog
      workspaceId='ws_1'
      open
      onOpenChange={vi.fn()}
      source={{ scope: 'CONTACTS', all: true }}
      subject='todos os contatos'
    />,
  )
}

describe('<WhatsappNumberValidationDialog />', () => {
  it('explains that the check needs Z-API and blocks the action without it', async () => {
    mockFetch([{ match: CONNECTIONS, data: [connection('META')] }])
    renderDialog()

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(/só funciona com uma conexão Z-API/)).toBeTruthy()
    expect(
      (
        screen.getByRole('button', {
          name: 'Validar números',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })

  it('starts the check and shows the counters when it finishes at once', async () => {
    const spy = mockFetch([
      { match: CONNECTIONS, data: [connection('ZAPI')] },
      { method: 'POST', match: VALIDATIONS, status: 201, data: run() },
      { match: `${VALIDATIONS}/run1`, data: run() },
      { match: '/whatsapp/contacts', data: [] },
    ])
    renderDialog()
    await waitFor(() =>
      expect(
        (
          screen.getByRole('button', {
            name: 'Validar números',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Validar números' }))

    expect(await screen.findByText('Validação concluída')).toBeTruthy()
    expect(fetchBody(spy, VALIDATIONS)).toEqual({
      scope: 'CONTACTS',
      all: true,
      force: false,
    })
    expect(screen.getByText('Com WhatsApp').previousSibling?.textContent).toBe(
      '2',
    )
    expect(screen.getByText('Sem resposta').previousSibling?.textContent).toBe(
      '1',
    )
    expect(screen.getByText(/podem ser conferidos de novo/)).toBeTruthy()
  })

  it('can force a re-check ignoring recent results', async () => {
    const spy = mockFetch([
      { match: CONNECTIONS, data: [connection('ZAPI')] },
      { method: 'POST', match: VALIDATIONS, status: 201, data: run() },
      { match: `${VALIDATIONS}/run1`, data: run() },
      { match: '/whatsapp/contacts', data: [] },
    ])
    renderDialog()
    const force = await screen.findByRole('checkbox')
    await waitFor(() =>
      expect(force.getAttribute('aria-disabled')).not.toBe('true'),
    )

    fireEvent.click(force)
    fireEvent.click(screen.getByRole('button', { name: 'Validar números' }))

    await screen.findByText('Validação concluída')
    expect(fetchBody(spy, VALIDATIONS)).toMatchObject({ force: true })
  })

  it('polls a background run until it ends', async () => {
    let polls = 0
    mockFetch([
      { match: CONNECTIONS, data: [connection('ZAPI')] },
      {
        method: 'POST',
        match: VALIDATIONS,
        status: 201,
        data: run({
          status: 'QUEUED',
          processed: 0,
          withWhatsapp: 0,
          withoutWhatsapp: 0,
          failed: 0,
        }),
      },
      {
        match: `${VALIDATIONS}/run1`,
        handler: () => {
          polls += 1
          return run({ status: 'DONE', failed: 0 })
        },
      },
      { match: '/whatsapp/contacts', data: [] },
    ])
    renderDialog()
    await waitFor(() =>
      expect(
        (
          screen.getByRole('button', {
            name: 'Validar números',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Validar números' }))

    expect(await screen.findByText('Na fila para validar')).toBeTruthy()
    expect(
      await screen.findByText('Validação concluída', undefined, {
        timeout: 6000,
      }),
    ).toBeTruthy()
    expect(polls).toBeGreaterThan(0)
  })

  it('shows the failure message of a failed run', async () => {
    mockFetch([
      { match: CONNECTIONS, data: [connection('ZAPI')] },
      {
        method: 'POST',
        match: VALIDATIONS,
        status: 201,
        data: run({
          status: 'FAILED',
          errorMessage: 'Não foi possível consultar a Z-API.',
        }),
      },
      {
        match: `${VALIDATIONS}/run1`,
        data: run({
          status: 'FAILED',
          errorMessage: 'Não foi possível consultar a Z-API.',
        }),
      },
      { match: '/whatsapp/contacts', data: [] },
    ])
    renderDialog()
    await waitFor(() =>
      expect(
        (
          screen.getByRole('button', {
            name: 'Validar números',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Validar números' }))

    expect(await screen.findByText('A validação falhou')).toBeTruthy()
    expect(screen.getByText('Não foi possível consultar a Z-API.')).toBeTruthy()
  })

  it('notifies when the server refuses to start', async () => {
    mockFetch([
      { match: CONNECTIONS, data: [connection('ZAPI')] },
      {
        method: 'POST',
        match: VALIDATIONS,
        status: 409,
        error: 'Já existe uma validação em andamento.',
      },
    ])
    renderDialog()
    await waitFor(() =>
      expect(
        (
          screen.getByRole('button', {
            name: 'Validar números',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Validar números' }))

    await waitFor(() => expect(notify.error).toHaveBeenCalled())
  })
})
