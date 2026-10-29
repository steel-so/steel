import { fireEvent, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { mockFetch, renderWithQuery } from '@/src/__tests__/component-utils'
import { EmailSenderPicker } from '../email-sender-picker'

const PLATFORM = 'notificacoes@stratustelecom.com.br'

function Harness({
  initial,
  onChange,
}: {
  initial: string
  onChange: (email: string) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <EmailSenderPicker
      workspaceId='ws1'
      workspaceSlug='acme'
      value={value}
      onChange={(email) => {
        setValue(email)
        onChange(email)
      }}
    />
  )
}

function setup(initial: string, verifiedDomains = ['news.acme.com.br']) {
  mockFetch([
    {
      match: '/crm/email-senders',
      data: { platformAddress: PLATFORM, verifiedDomains },
    },
  ])
  const onChange = vi.fn()
  renderWithQuery(<Harness initial={initial} onChange={onChange} />)
  return onChange
}

describe('<EmailSenderPicker />', () => {
  it('composes the local part with the verified domain', async () => {
    const onChange = setup('')
    const local = await screen.findByLabelText('Remetente')
    fireEvent.change(local, { target: { value: 'marketing' } })
    expect(onChange).toHaveBeenLastCalledWith('marketing@news.acme.com.br')
    // Typing a whole address keeps only the local part.
    fireEvent.change(local, { target: { value: 'vendas@outro.com' } })
    expect(onChange).toHaveBeenLastCalledWith('vendas@news.acme.com.br')
    fireEvent.change(local, { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith('')
    expect(screen.getByText('Ajustes › Domínios de e-mail')).toBeTruthy()
    expect(
      screen
        .getByText('Ajustes › Domínios de e-mail')
        .closest('a')
        ?.getAttribute('href'),
    ).toBe('/acme/settings/email-domains')
  })

  it('shows the saved address on a verified domain', async () => {
    setup('mkt@news.acme.com.br')
    const local = (await screen.findByLabelText(
      'Remetente',
    )) as HTMLInputElement
    expect(local.value).toBe('mkt')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('uses the platform address when there is no verified domain', async () => {
    setup(PLATFORM, [])
    await waitFor(() =>
      expect(screen.getByText(/Nenhum domínio verificado ainda/)).toBeTruthy(),
    )
    // No local-part input for the platform address.
    expect(screen.queryByPlaceholderText('marketing')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('warns about a saved address outside the verified domains', async () => {
    const onChange = setup('mkt@acme.com')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('mkt@acme.com')
    fireEvent.change(screen.getByLabelText('Remetente'), {
      target: { value: 'vendas' },
    })
    expect(onChange).toHaveBeenLastCalledWith('vendas@news.acme.com.br')
  })

  it('falls back to a plain input when the options fail to load', async () => {
    mockFetch([])
    const onChange = vi.fn()
    renderWithQuery(<Harness initial='' onChange={onChange} />)
    await waitFor(() =>
      expect(
        screen.getByText('Não foi possível carregar os domínios verificados.'),
      ).toBeTruthy(),
    )
    fireEvent.change(screen.getByLabelText('Remetente'), {
      target: { value: 'a@b.com' },
    })
    expect(onChange).toHaveBeenLastCalledWith('a@b.com')
  })
})
