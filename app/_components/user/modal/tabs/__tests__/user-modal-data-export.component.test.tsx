import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mockFetch } from '@/src/__tests__/component-utils'
import { UserModalDataExport } from '../user-modal-data-export'

function clickExport() {
  fireEvent.click(screen.getByRole('button', { name: 'Exportar meus dados' }))
}

describe('<UserModalDataExport />', () => {
  it('should explain that the link arrives by e-mail', () => {
    render(<UserModalDataExport />)
    expect(screen.getByText(/enviamos para o seu e-mail um link/)).toBeTruthy()
  })

  it('should request the export and confirm it, then lock the button', async () => {
    const spy = mockFetch([
      {
        method: 'POST',
        match: '/api/users/me/export',
        status: 202,
        data: { requestedAt: '2026-10-09T12:00:00.000Z' },
      },
    ])
    render(<UserModalDataExport />)
    clickExport()

    expect(await screen.findByRole('status')).toBeTruthy()
    expect(screen.getByText(/chega no seu e-mail/)).toBeTruthy()
    expect(spy).toHaveBeenCalledWith('/api/users/me/export', {
      method: 'POST',
    })
    const button = screen.getByRole('button', {
      name: 'Exportar meus dados',
    }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('should tell the user about the daily limit on 429', async () => {
    mockFetch([
      {
        method: 'POST',
        match: '/api/users/me/export',
        status: 429,
        error: 'RATE_LIMITED',
      },
    ])
    render(<UserModalDataExport />)
    clickExport()

    expect((await screen.findByRole('alert')).textContent).toMatch(
      /últimas 24 horas/,
    )
  })

  it('should show a generic error on other failures and allow a retry', async () => {
    mockFetch([
      {
        method: 'POST',
        match: '/api/users/me/export',
        status: 500,
        error: 'DATABASE_ERROR',
      },
    ])
    render(<UserModalDataExport />)
    clickExport()

    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Não foi possível/,
    )
    const button = screen.getByRole('button', {
      name: 'Exportar meus dados',
    }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
  })

  it('should report network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    render(<UserModalDataExport />)
    clickExport()

    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Erro de rede/,
    )
  })
})
