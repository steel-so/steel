import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { drainInputOtpTimers } from '@/src/__tests__/helpers/input-otp'
import { SignInForm } from '../sign-in-form'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
}))

const auth = vi.hoisted(() => ({
  signInEmail: vi.fn(),
  sendOtp: vi.fn(),
  verifyOtp: vi.fn(),
  verifyTotp: vi.fn(),
  verifyBackupCode: vi.fn(),
  signInSocial: vi.fn(),
}))
vi.mock('@/src/lib/auth-client', () => ({
  authClient: {
    signIn: { email: auth.signInEmail, social: auth.signInSocial },
    twoFactor: {
      sendOtp: auth.sendOtp,
      verifyOtp: auth.verifyOtp,
      verifyTotp: auth.verifyTotp,
      verifyBackupCode: auth.verifyBackupCode,
    },
  },
}))

// A dica de fator decide em qual etapa o segundo fator abre. Mockada para
// cada caso declarar o que este navegador "lembra" — e para as asserções não
// dependerem do localStorage do jsdom entre arquivos.
const hint = vi.hoisted(() => ({
  lastTwoFactorMethod: vi.fn<() => 'otp' | 'totp' | null>(() => null),
  rememberTwoFactorMethod: vi.fn(),
}))
vi.mock('@/src/lib/two-factor-method-hint', () => hint)

function fillAndSubmit(email: string, password: string) {
  fireEvent.change(screen.getByPlaceholderText('nome@empresa.com'), {
    target: { value: email },
  })
  fireEvent.change(screen.getByPlaceholderText('••••••'), {
    target: { value: password },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
}

describe('<SignInForm />', () => {
  beforeEach(() => {
    auth.sendOtp.mockResolvedValue({ data: {}, error: null })
    hint.lastTwoFactorMethod.mockReturnValue(null)
  })

  // The OTP steps mount `input-otp`, whose mount timers outlive the test.
  afterEach(drainInputOtpTimers)

  it('shows pt-BR required-field errors and does not call the API', async () => {
    render(<SignInForm />)
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    expect(await screen.findByText('E-mail é obrigatório')).toBeTruthy()
    expect(screen.getByText('Senha é obrigatória')).toBeTruthy()
    expect(auth.signInEmail).not.toHaveBeenCalled()
  })

  it('signs in and redirects to the requested destination', async () => {
    auth.signInEmail.mockResolvedValue({ data: { user: {} }, error: null })
    render(<SignInForm redirectTo='/acme' />)

    fillAndSubmit('ana@empresa.com', 'segredo123')

    await waitFor(() => expect(push).toHaveBeenCalledWith('/acme'))
    expect(auth.signInEmail).toHaveBeenCalledWith({
      email: 'ana@empresa.com',
      password: 'segredo123',
    })
  })

  it('renders the fallback error when credentials are rejected', async () => {
    auth.signInEmail.mockResolvedValue({ data: null, error: {} })
    render(<SignInForm />)

    fillAndSubmit('ana@empresa.com', 'errada')

    expect(await screen.findByText('E-mail ou senha inválidos')).toBeTruthy()
    expect(push).not.toHaveBeenCalled()
    // Form stays usable after the failure.
    expect(
      (screen.getByRole('button', { name: 'Continuar' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
  })

  it('moves to the OTP step when two-factor is required', async () => {
    auth.signInEmail.mockResolvedValue({
      data: { twoFactorRedirect: true },
      error: null,
    })
    render(<SignInForm />)

    fillAndSubmit('ana@empresa.com', 'segredo123')

    expect(await screen.findByText('Confirme seu e-mail')).toBeTruthy()
    expect(screen.getByText('ana@empresa.com')).toBeTruthy()
    expect(auth.sendOtp).toHaveBeenCalledTimes(1)
    expect(push).not.toHaveBeenCalled()
  })

  it('validates and verifies a backup code', async () => {
    auth.signInEmail.mockResolvedValue({
      data: { twoFactorRedirect: true },
      error: null,
    })
    auth.verifyBackupCode.mockResolvedValue({ data: {}, error: null })
    render(<SignInForm />)
    fillAndSubmit('ana@empresa.com', 'segredo123')

    fireEvent.click(
      await screen.findByRole('button', {
        name: /usar um código de recuperação/i,
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Verificar código' }))
    expect(await screen.findByText('Informe um código de backup')).toBeTruthy()
    expect(auth.verifyBackupCode).not.toHaveBeenCalled()

    fireEvent.change(screen.getByPlaceholderText('xxxxxxxx'), {
      target: { value: '  abcd1234 ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Verificar código' }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/'))
    expect(auth.verifyBackupCode).toHaveBeenCalledWith({ code: 'abcd1234' })
  })

  it('opens on the authenticator step, and mails nothing, when that was the last factor used', async () => {
    hint.lastTwoFactorMethod.mockReturnValue('totp')
    auth.signInEmail.mockResolvedValue({
      data: { twoFactorRedirect: true },
      error: null,
    })
    render(<SignInForm />)

    fillAndSubmit('ana@empresa.com', 'segredo123')

    expect(
      await screen.findByText('Abra seu aplicativo autenticador.'),
    ).toBeTruthy()
    // É este o ponto da dica: quem usa aplicativo recebia um e-mail que
    // nunca ia abrir em todo login.
    expect(auth.sendOtp).not.toHaveBeenCalled()
  })

  it('validates and verifies the authenticator code, then remembers the factor', async () => {
    hint.lastTwoFactorMethod.mockReturnValue('totp')
    auth.signInEmail.mockResolvedValue({
      data: { twoFactorRedirect: true },
      error: null,
    })
    auth.verifyTotp.mockResolvedValue({ data: {}, error: null })
    render(<SignInForm redirectTo='/acme' />)
    fillAndSubmit('ana@empresa.com', 'segredo123')

    fireEvent.click(
      await screen.findByRole('button', { name: 'Verificar código' }),
    )
    expect(
      await screen.findByText('Informe o código do aplicativo'),
    ).toBeTruthy()
    expect(auth.verifyTotp).not.toHaveBeenCalled()

    fireEvent.change(screen.getByPlaceholderText('000000'), {
      target: { value: ' 123456 ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Verificar código' }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/acme'))
    expect(auth.verifyTotp).toHaveBeenCalledWith({ code: '123456' })
    expect(hint.rememberTwoFactorMethod).toHaveBeenCalledWith('totp')
  })

  it('shows the pt-BR message when the authenticator code is refused', async () => {
    hint.lastTwoFactorMethod.mockReturnValue('totp')
    auth.signInEmail.mockResolvedValue({
      data: { twoFactorRedirect: true },
      error: null,
    })
    auth.verifyTotp.mockResolvedValue({
      data: null,
      error: { code: 'INVALID_CODE' },
    })
    render(<SignInForm />)
    fillAndSubmit('ana@empresa.com', 'segredo123')

    fireEvent.change(await screen.findByPlaceholderText('000000'), {
      target: { value: '000000' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Verificar código' }))

    expect(await screen.findByText('Código inválido')).toBeTruthy()
    expect(push).not.toHaveBeenCalled()
  })

  it('falls back from the authenticator to the e-mail code on demand', async () => {
    hint.lastTwoFactorMethod.mockReturnValue('totp')
    auth.signInEmail.mockResolvedValue({
      data: { twoFactorRedirect: true },
      error: null,
    })
    render(<SignInForm />)
    fillAndSubmit('ana@empresa.com', 'segredo123')

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Receber o código por e-mail',
      }),
    )

    expect(await screen.findByText('Confirme seu e-mail')).toBeTruthy()
    // O código não havia sido enviado: a etapa do app não manda e-mail.
    await waitFor(() => expect(auth.sendOtp).toHaveBeenCalledTimes(1))
  })

  it('reaches the authenticator step from the e-mail step', async () => {
    auth.signInEmail.mockResolvedValue({
      data: { twoFactorRedirect: true },
      error: null,
    })
    render(<SignInForm />)
    fillAndSubmit('ana@empresa.com', 'segredo123')

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Usar o código do aplicativo autenticador',
      }),
    )

    expect(
      await screen.findByText('Abra seu aplicativo autenticador.'),
    ).toBeTruthy()
  })

  it('offers a recovery code from the authenticator step', async () => {
    hint.lastTwoFactorMethod.mockReturnValue('totp')
    auth.signInEmail.mockResolvedValue({
      data: { twoFactorRedirect: true },
      error: null,
    })
    render(<SignInForm />)
    fillAndSubmit('ana@empresa.com', 'segredo123')

    fireEvent.click(
      await screen.findByRole('button', {
        name: /perdeu o aplicativo\? usar um código de recuperação/i,
      }),
    )

    expect(
      await screen.findByText('Use um código de recuperação.'),
    ).toBeTruthy()
  })

  it('links to sign-up preserving the redirect target', () => {
    render(<SignInForm redirectTo='/convite?x=1' />)
    const link = screen.getByRole('link', { name: 'Cadastre-se' })
    expect(link.getAttribute('href')).toBe(
      `/sign-up?redirect=${encodeURIComponent('/convite?x=1')}`,
    )
  })
})
