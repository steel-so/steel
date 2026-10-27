import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { drainInputOtpTimers } from '@/src/__tests__/helpers/input-otp'
import { SignUpForm } from '../sign-up-form'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
}))

const auth = vi.hoisted(() => ({
  signUpEmail: vi.fn(),
  verifyEmail: vi.fn(),
  sendVerificationOtp: vi.fn(),
  signInSocial: vi.fn(),
}))
vi.mock('@/src/lib/auth-client', () => ({
  authClient: {
    signIn: { social: auth.signInSocial },
    signUp: { email: auth.signUpEmail },
    emailOtp: {
      verifyEmail: auth.verifyEmail,
      sendVerificationOtp: auth.sendVerificationOtp,
    },
  },
}))

function fill({
  name = 'Ana Souza',
  email = 'ana@empresa.com',
  password = 'segredo123',
}: {
  name?: string
  email?: string
  password?: string
} = {}) {
  fireEvent.change(screen.getByPlaceholderText('Seu nome'), {
    target: { value: name },
  })
  fireEvent.change(screen.getByPlaceholderText('nome@empresa.com'), {
    target: { value: email },
  })
  fireEvent.change(screen.getByPlaceholderText('••••••'), {
    target: { value: password },
  })
}

function acceptBoth() {
  for (const checkbox of screen.getAllByRole('checkbox')) {
    fireEvent.click(checkbox)
  }
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
}

const CONSENT_ERROR =
  'Você precisa aceitar os Termos de Serviço e a Política de Privacidade'

describe('<SignUpForm />', () => {
  // The OTP step mounts `input-otp`, whose mount timers outlive the test.
  afterEach(drainInputOtpTimers)

  it('shows every pt-BR validation message on an empty submit', async () => {
    render(<SignUpForm />)
    submit()

    expect(
      await screen.findByText('Nome deve ter ao menos 2 caracteres'),
    ).toBeTruthy()
    expect(screen.getByText('E-mail é obrigatório')).toBeTruthy()
    expect(
      screen.getByText('Senha deve ter ao menos 8 caracteres'),
    ).toBeTruthy()
    expect(screen.getByText(CONSENT_ERROR)).toBeTruthy()
    expect(auth.signUpEmail).not.toHaveBeenCalled()
  })

  it('rejects short passwords even with everything else valid', async () => {
    render(<SignUpForm />)
    fill({ password: '1234567' })
    acceptBoth()
    submit()

    expect(
      await screen.findByText('Senha deve ter ao menos 8 caracteres'),
    ).toBeTruthy()
    expect(screen.queryByText(CONSENT_ERROR)).toBeNull()
    expect(auth.signUpEmail).not.toHaveBeenCalled()
  })

  it('requires both terms and privacy consent', async () => {
    render(<SignUpForm />)
    fill()
    // Only the terms checkbox.
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    submit()

    expect(await screen.findByText(CONSENT_ERROR)).toBeTruthy()
    expect(auth.signUpEmail).not.toHaveBeenCalled()

    // Checking the remaining box clears the consent error.
    fireEvent.click(screen.getAllByRole('checkbox')[1])
    await waitFor(() => expect(screen.queryByText(CONSENT_ERROR)).toBeNull())
  })

  it('creates the account with consent timestamps and moves to OTP', async () => {
    auth.signUpEmail.mockResolvedValue({ data: {}, error: null })
    render(<SignUpForm />)
    fill()
    acceptBoth()
    submit()

    expect(await screen.findByText('Confirme seu e-mail')).toBeTruthy()
    expect(screen.getByText('ana@empresa.com')).toBeTruthy()
    const payload = auth.signUpEmail.mock.calls[0][0]
    expect(payload).toMatchObject({
      name: 'Ana Souza',
      email: 'ana@empresa.com',
      password: 'segredo123',
    })
    expect(payload.acceptedTermsAt).toBeInstanceOf(Date)
    expect(payload.acceptedPrivacyAt).toBeInstanceOf(Date)
    expect(push).not.toHaveBeenCalled()
  })

  it('surfaces the translated API error and keeps the form', async () => {
    // O Better Auth responde em inglês; a tela mostra a versão pt-BR.
    auth.signUpEmail.mockResolvedValue({
      data: null,
      error: { code: 'USER_ALREADY_EXISTS', message: 'User already exists.' },
    })
    render(<SignUpForm />)
    fill()
    acceptBoth()
    submit()

    expect(
      await screen.findByText('Já existe uma conta com esse e-mail'),
    ).toBeTruthy()
    expect(screen.queryByText('Confirme seu e-mail')).toBeNull()
    expect(
      (screen.getByRole('button', { name: 'Criar conta' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
  })

  it('falls back to a generic message when the error has none', async () => {
    auth.signUpEmail.mockResolvedValue({ data: null, error: {} })
    render(<SignUpForm />)
    fill()
    acceptBoth()
    submit()

    expect(await screen.findByText('Erro ao criar conta')).toBeTruthy()
  })

  it('returns to the form from the OTP step', async () => {
    auth.signUpEmail.mockResolvedValue({ data: {}, error: null })
    render(<SignUpForm />)
    fill()
    acceptBoth()
    submit()

    fireEvent.click(await screen.findByRole('button', { name: /voltar/i }))
    expect(screen.getByRole('button', { name: 'Criar conta' })).toBeTruthy()
  })

  it('links legal documents in new tabs and sign-in with the redirect', () => {
    render(<SignUpForm redirectTo='/convite' />)

    const terms = screen.getByRole('link', { name: 'Termos de Serviço' })
    expect(terms.getAttribute('href')).toBe('/legals/terms')
    expect(terms.getAttribute('target')).toBe('_blank')
    expect(
      screen
        .getByRole('link', { name: 'Política de Privacidade' })
        .getAttribute('href'),
    ).toBe('/legals/privacy')

    const signInLinks = screen
      .getAllByRole('link', { name: 'Entre' })
      .map((a) => a.getAttribute('href'))
    // Todos os links "Entre" (inclusive o do cabeçalho) são absolutos e
    // preservam o destino do redirect.
    expect(signInLinks.length).toBeGreaterThan(1)
    for (const href of signInLinks) {
      expect(href).toBe(`/sign-in?redirect=${encodeURIComponent('/convite')}`)
    }
  })

  it('points the header sign-in link to /sign-in without a redirect by default', () => {
    render(<SignUpForm />)

    expect(screen.getAllByText(/Já tem conta\?/)).toHaveLength(2)
    for (const link of screen.getAllByRole('link', { name: 'Entre' })) {
      expect(link.getAttribute('href')).toBe('/sign-in')
    }
  })
})
