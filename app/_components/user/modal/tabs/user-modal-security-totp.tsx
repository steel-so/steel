'use client'

import { useId, useMemo, useState } from 'react'
import { renderSVG } from 'uqr'
import { Muted } from '@/components/typography/text/muted'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { notify } from '@/lib/notify'
import {
  useConfirmTwoFactorTotp,
  useDisableTwoFactorTotp,
  useTwoFactorTotp,
} from '@/src/hooks/use-two-factor-totp'
import { authClient } from '@/src/lib/auth-client'
import { authErrorMessage } from '@/src/lib/auth-error-messages'
import { rememberTwoFactorMethod } from '@/src/lib/two-factor-method-hint'

type Step = 'idle' | 'password' | 'scan' | 'codes' | 'disabling'

interface UserModalSecurityTotpProps {
  /** `false` enquanto a conta não tiver senha (login social puro). */
  canUsePassword: boolean
  /** Interruptor único da 2FA — o aplicativo só faz sentido acima dele. */
  twoFactorEnabled: boolean
  /** Recarrega a sessão depois de um passo que muda `twoFactorEnabled`. */
  onSessionChanged: () => void | Promise<void>
}

/**
 * Cadastro do **aplicativo autenticador** (TOTP).
 *
 * O caminho tem três passos e nenhum deles pode ser pulado:
 *
 * 1. **Senha.** Com ela buscamos a `totpURI`. Se a conta ainda não tem
 *    segredo, `twoFactor.enable()` grava um e devolve os códigos de
 *    recuperação de uma vez; se já tem (porque a 2FA por e-mail estava
 *    ligada), `twoFactor.getTotpUri()` devolve a URI do segredo que existe —
 *    sem rotacionar os códigos de recuperação de quem já os guardou.
 * 2. **QR.** O usuário escaneia (ou digita a chave) e manda o primeiro
 *    código.
 * 3. **Confirmação.** `POST /api/users/me/two-factor/totp` verifica o código
 *    pelo plugin e só então liga `twoFactorTotpEnabled`. Uma conta nunca
 *    aparece como "aplicativo ativo" por um QR que ninguém escaneou — é assim
 *    que as pessoas se trancam fora da conta no próximo login.
 *
 * Desligar exige a senha de novo, como desativar a 2FA já exige.
 */
export function UserModalSecurityTotp({
  canUsePassword,
  twoFactorEnabled,
  onSessionChanged,
}: UserModalSecurityTotpProps) {
  const fieldId = useId()
  const status = useTwoFactorTotp()
  const confirm = useConfirmTwoFactorTotp()
  const disable = useDisableTwoFactorTotp()

  const [step, setStep] = useState<Step>('idle')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [totpUri, setTotpUri] = useState<string | null>(null)
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const totpEnabled = !!status.data?.totpEnabled

  const qrSvg = useMemo(
    () => (totpUri ? renderSVG(totpUri, { border: 1 }) : null),
    [totpUri],
  )

  // Aplicativos que não conseguem escanear aceitam a chave digitada à mão.
  const manualSecret = useMemo(() => {
    if (!totpUri) return null
    try {
      return new URL(totpUri).searchParams.get('secret')
    } catch {
      return null
    }
  }, [totpUri])

  function reset(next: Step) {
    setError(null)
    setPassword('')
    setCode('')
    setStep(next)
  }

  async function handleRequestUri(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!password) {
      setError('Informe sua senha para continuar')
      return
    }
    setError(null)
    setBusy(true)

    // Conta que já tem 2FA (por e-mail) já tem segredo: pedir a URI dele em
    // vez de chamar `enable()` de novo evita invalidar os códigos de
    // recuperação que a pessoa guardou.
    const hasSecret = !!status.data?.hasSecret
    const { data, error: uriError } = hasSecret
      ? await authClient.twoFactor.getTotpUri({ password })
      : await authClient.twoFactor.enable({ password })

    setBusy(false)

    // Better Auth 1.7 answers `enable()` with a union on `method`: the `otp`
    // branch has no `totpURI`. We always ask for the default `totp` method,
    // so a response without it is treated like any other failure.
    if (uriError || !data || !('totpURI' in data)) {
      setError(
        authErrorMessage(
          uriError,
          'Não foi possível preparar o aplicativo autenticador',
        ),
      )
      return
    }

    setPassword('')
    setTotpUri(data.totpURI)
    // `enable()` devolve códigos de recuperação novos; `getTotpUri()` não —
    // daí o estreitamento, que o tipo do `data` unido não faz sozinho.
    const fresh = 'backupCodes' in data ? data.backupCodes : []
    setBackupCodes(Array.isArray(fresh) ? fresh.map(String) : [])
    setStep('scan')
    if (!hasSecret) await onSessionChanged()
  }

  async function handleConfirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!code.trim()) {
      setError('Informe o código do aplicativo')
      return
    }
    setError(null)
    try {
      await confirm.mutateAsync(code.trim())
    } catch (confirmError) {
      setError(
        confirmError instanceof Error
          ? confirmError.message
          : 'Código inválido ou expirado',
      )
      return
    }

    setCode('')
    // Diz ao próximo login neste navegador em qual etapa abrir, para quem usa
    // aplicativo não receber um e-mail que não vai ler.
    rememberTwoFactorMethod('totp')
    await onSessionChanged()
    // Sem códigos novos para mostrar, o cadastro termina aqui.
    setStep(backupCodes.length > 0 ? 'codes' : 'idle')
    notify.success('Aplicativo autenticador ativado')
  }

  async function handleDisable(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!password) {
      setError('Informe sua senha para continuar')
      return
    }
    setError(null)
    try {
      await disable.mutateAsync(password)
    } catch (disableError) {
      setError(
        disableError instanceof Error
          ? disableError.message
          : 'Não foi possível desligar o aplicativo autenticador',
      )
      return
    }
    setPassword('')
    setTotpUri(null)
    setBackupCodes([])
    rememberTwoFactorMethod('otp')
    setStep('idle')
    notify.success('Aplicativo autenticador desligado')
  }

  async function copyBackupCodes() {
    try {
      await navigator.clipboard.writeText(backupCodes.join('\n'))
      notify.success('Códigos de recuperação copiados')
    } catch {
      // O clipboard pode ser negado; os códigos seguem na tela de todo jeito.
    }
  }

  if (step === 'codes') {
    return (
      <div className='flex flex-col gap-3 border-t border-border pt-4'>
        <div>
          <p className='text-sm font-medium'>Códigos de recuperação</p>
          <Muted>
            Guarde estes códigos em local seguro. Cada um só pode ser usado uma
            vez e não serão exibidos novamente.
          </Muted>
        </div>
        <div className='grid grid-cols-2 gap-2 rounded-md border border-border p-3 font-mono text-sm'>
          {backupCodes.map((backupCode) => (
            <span key={backupCode}>{backupCode}</span>
          ))}
        </div>
        <div className='flex justify-end gap-2'>
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={copyBackupCodes}
          >
            Copiar códigos
          </Button>
          <Button
            type='button'
            size='sm'
            onClick={() => {
              setBackupCodes([])
              reset('idle')
            }}
          >
            Concluir
          </Button>
        </div>
      </div>
    )
  }

  if (step === 'scan') {
    return (
      <form
        onSubmit={handleConfirm}
        className='flex flex-col gap-3 border-t border-border pt-4'
      >
        <div>
          <p className='text-sm font-medium'>
            Escaneie o QR code no seu aplicativo
          </p>
          <Muted>
            Use o Google Authenticator, o 1Password, o Bitwarden ou qualquer app
            compatível e digite o código de 6 dígitos que ele mostrar.
          </Muted>
        </div>

        {qrSvg && (
          <div
            aria-label='QR code para o aplicativo autenticador'
            role='img'
            className='mx-auto w-44 [&_svg]:h-full [&_svg]:w-full'
            // O uqr gera um SVG autocontido a partir da URI otpauth: string
            // local, sem entrada do usuário.
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
        )}

        {manualSecret && (
          <p className='text-center text-xs text-muted-foreground'>
            Não consegue escanear? Use a chave{' '}
            <code className='font-mono'>{manualSecret}</code>
          </p>
        )}

        <Field data-invalid={!!error || undefined}>
          <FieldLabel htmlFor={`${fieldId}-code`}>
            Código do aplicativo
          </FieldLabel>
          <Input
            id={`${fieldId}-code`}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder='000000'
            inputMode='numeric'
            autoComplete='one-time-code'
            disabled={confirm.isPending}
          />
          {error && <FieldError>{error}</FieldError>}
        </Field>

        <div className='flex justify-end gap-2'>
          <Button
            type='button'
            variant='ghost'
            onClick={() => reset('idle')}
            disabled={confirm.isPending}
          >
            Cancelar
          </Button>
          <Button type='submit' disabled={confirm.isPending}>
            {confirm.isPending ? 'Verificando...' : 'Confirmar código'}
          </Button>
        </div>
      </form>
    )
  }

  if (step === 'password' || step === 'disabling') {
    const disabling = step === 'disabling'
    return (
      <form
        onSubmit={disabling ? handleDisable : handleRequestUri}
        className='flex flex-col gap-3 border-t border-border pt-4'
      >
        <Field data-invalid={!!error || undefined}>
          <FieldLabel htmlFor={`${fieldId}-password`}>
            {disabling
              ? 'Senha para desligar o aplicativo'
              : 'Senha para ativar o aplicativo'}
          </FieldLabel>
          <Input
            id={`${fieldId}-password`}
            type='password'
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder='••••••'
            disabled={busy || disable.isPending}
            autoFocus
          />
          {error && <FieldError>{error}</FieldError>}
        </Field>
        <div className='flex justify-end gap-2'>
          <Button
            type='button'
            variant='ghost'
            onClick={() => reset('idle')}
            disabled={busy || disable.isPending}
          >
            Cancelar
          </Button>
          <Button type='submit' disabled={busy || disable.isPending}>
            {busy || disable.isPending
              ? 'Processando...'
              : disabling
                ? 'Desligar'
                : 'Continuar'}
          </Button>
        </div>
      </form>
    )
  }

  return (
    <div className='flex items-start justify-between gap-3 border-t border-border pt-4'>
      <div>
        <p className='text-sm font-medium'>Aplicativo autenticador</p>
        <Muted>
          {!canUsePassword
            ? 'Defina uma senha antes de cadastrar um aplicativo autenticador.'
            : totpEnabled
              ? 'Ativo. No login, digite o código de 6 dígitos que o aplicativo mostra. O código por e-mail continua disponível como alternativa.'
              : 'Gera códigos offline, sem depender do e-mail. Funciona com Google Authenticator, 1Password, Bitwarden e similares.'}
        </Muted>
      </div>
      <Button
        type='button'
        variant={totpEnabled ? 'outline' : 'default'}
        size='sm'
        disabled={!canUsePassword || status.isPending}
        onClick={() => reset(totpEnabled ? 'disabling' : 'password')}
      >
        {totpEnabled ? 'Desligar' : twoFactorEnabled ? 'Cadastrar' : 'Ativar'}
      </Button>
    </div>
  )
}
