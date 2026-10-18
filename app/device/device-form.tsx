'use client'

import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  CommandLineIcon,
  Shield01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  ApiTokenAccessFields,
  type ApiTokenAccessValue,
  canSubmitAccess,
  initialAccessValue,
  moduleList,
  scopesOf,
} from '@/app/_components/api-tokens/api-token-access-fields'
import { SteelIcon } from '@/components/icon/icon'
import { Muted } from '@/components/typography/text/muted'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { notify } from '@/lib/notify'
import { useAuthorizeDevice } from '@/src/hooks/use-api-tokens'
import type { DeviceAuthorizationContextDTO } from '@/types/api-token'

function DeviceCard({ children }: { children: React.ReactNode }) {
  return (
    <div className='w-full max-w-lg rounded-xl border border-border bg-card text-card-foreground shadow-sm'>
      {children}
    </div>
  )
}

function Brand() {
  return (
    <div className='flex items-center gap-3'>
      <Image
        src='/brand/logo.svg'
        alt='Steel'
        width={72}
        height={32}
        style={{ height: 'auto' }}
        className='invert dark:invert-0'
        priority
      />
      <div
        aria-hidden
        className='flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground'
      >
        <SteelIcon icon={CommandLineIcon} size={18} />
      </div>
    </div>
  )
}

export function DeviceError({ message }: { message: string }) {
  return (
    <DeviceCard>
      <div className='flex flex-col items-start gap-4 p-6'>
        <div className='flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive'>
          <SteelIcon icon={AlertCircleIcon} size={20} />
        </div>
        <div className='flex flex-col gap-1'>
          <h1 className='text-lg font-semibold'>Não foi possível continuar</h1>
          <Muted>{message}</Muted>
        </div>
        <Button variant='outline' size='sm' render={<Link href='/' />}>
          Ir para o Steel
        </Button>
      </div>
    </DeviceCard>
  )
}

/** Without a code in the link: the user types the one the terminal shows. */
export function DeviceCodeEntry({
  initialCode = '',
  error,
}: {
  initialCode?: string
  error?: string
}) {
  const router = useRouter()
  const [code, setCode] = useState(initialCode)
  const [busy, setBusy] = useState(false)

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = code.trim()
    if (!value) return
    setBusy(true)
    router.push(`/device?code=${encodeURIComponent(value)}`)
  }

  return (
    <DeviceCard>
      <form onSubmit={submit} className='flex flex-col gap-6 p-6'>
        <Brand />
        <div className='flex flex-col gap-1'>
          <h1 className='text-lg font-semibold text-balance'>
            Entrar no Steel CLI
          </h1>
          <Muted>
            Digite o código que apareceu no terminal depois de “steel login”.
          </Muted>
        </div>
        <FieldGroup>
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor='device-code'>Código</FieldLabel>
            <Input
              id='device-code'
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder='BCDF-GH23'
              autoComplete='one-time-code'
              autoCapitalize='characters'
              spellCheck={false}
              maxLength={16}
              className='font-mono uppercase tracking-widest'
              aria-invalid={error ? true : undefined}
              autoFocus
            />
            {error ? (
              <FieldError>{error}</FieldError>
            ) : (
              <FieldDescription>
                O código vale 10 minutos. Maiúsculas e o hífen não importam.
              </FieldDescription>
            )}
          </Field>
        </FieldGroup>
        <div className='flex justify-end'>
          <Button type='submit' disabled={busy || !code.trim()}>
            {busy ? 'Verificando...' : 'Continuar'}
          </Button>
        </div>
      </form>
    </DeviceCard>
  )
}

function DeviceDone({ approved }: { approved: boolean }) {
  return (
    <DeviceCard>
      <div className='flex flex-col items-start gap-4 p-6'>
        <div
          className={
            approved
              ? 'flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary'
              : 'flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground'
          }
        >
          <SteelIcon
            icon={approved ? CheckmarkCircle02Icon : AlertCircleIcon}
            size={20}
          />
        </div>
        <div className='flex flex-col gap-1'>
          <h1 className='text-lg font-semibold'>
            {approved ? 'Pronto! Volte ao terminal' : 'Login recusado'}
          </h1>
          <Muted>
            {approved
              ? 'O Steel CLI já pode usar o seu acesso. Você pode fechar esta aba. O token aparece em Ajustes › Segurança › Tokens de API, onde dá para revogá-lo.'
              : 'O terminal não recebeu acesso. Se foi engano, rode “steel login” de novo.'}
          </Muted>
        </div>
      </div>
    </DeviceCard>
  )
}

export function DeviceAuthorizeForm({
  context,
  userEmail,
}: {
  context: DeviceAuthorizationContextDTO
  userEmail: string
}) {
  const authorize = useAuthorizeDevice()
  const [value, setValue] = useState<ApiTokenAccessValue>(() =>
    initialAccessValue(context.workspaces),
  )
  const [done, setDone] = useState<'approved' | 'denied' | null>(null)
  const workspace = context.workspaces.find((ws) => ws.id === value.workspaceId)
  const busy = authorize.isPending
  const canAccept = canSubmitAccess(value) && !busy

  async function submit(accept: boolean) {
    try {
      const result = await authorize.mutateAsync(
        accept && value.workspaceId
          ? {
              accept: true,
              userCode: context.userCode,
              workspaceId: value.workspaceId,
              modules: value.modules,
              scopes: scopesOf(value.access),
              expiresInDays: value.expiresInDays,
            }
          : { accept: false, userCode: context.userCode },
      )
      setDone(result.status)
    } catch (error) {
      notify.error(
        error instanceof Error
          ? error.message
          : 'Não foi possível concluir o login',
      )
    }
  }

  if (done) return <DeviceDone approved={done === 'approved'} />

  return (
    <DeviceCard>
      <div className='flex flex-col gap-6 p-6'>
        <Brand />

        <div className='flex flex-col gap-1'>
          <h1 className='text-lg font-semibold text-balance'>
            Entrar no Steel CLI
            {context.deviceName ? ` em ${context.deviceName}` : ''}
          </h1>
          <Muted>
            Confira se o código abaixo é o mesmo do terminal. Se você não rodou
            “steel login” agora, recuse.
          </Muted>
          <p className='mt-2 self-start rounded-md bg-muted px-3 py-1.5 font-mono text-lg font-semibold tracking-widest'>
            {context.userCode}
          </p>
          <Muted className='text-xs'>
            Conectado como{' '}
            <span className='font-medium text-foreground [overflow-wrap:anywhere]'>
              {userEmail}
            </span>
          </Muted>
        </div>

        {context.workspaces.length === 0 ? (
          <div className='rounded-lg border border-border bg-muted/40 p-4'>
            <Muted>
              Nenhum workspace seu tem módulos habilitados. Peça a um
              administrador para habilitar o ServiceDesk, o CRM ou a Comunicação
              e tente de novo.
            </Muted>
          </div>
        ) : (
          <FieldGroup>
            <ApiTokenAccessFields
              idPrefix='device'
              workspaces={context.workspaces}
              value={value}
              onChange={setValue}
              disabled={busy}
            />
          </FieldGroup>
        )}

        {workspace && value.modules.length > 0 && (
          <div className='flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3'>
            <SteelIcon
              icon={Shield01Icon}
              className='mt-0.5 shrink-0 text-muted-foreground'
            />
            <Muted className='text-xs'>
              Ao permitir, o terminal recebe um token pessoal que age em seu
              nome no workspace {workspace.name} ({moduleList(value.modules)}),
              sempre com as suas permissões no Steel. Cada chamada fica
              registrada e você pode revogar o token quando quiser em Ajustes ›
              Segurança › Tokens de API.
            </Muted>
          </div>
        )}

        <div className='flex flex-col-reverse gap-2 sm:flex-row sm:justify-end'>
          <Button
            type='button'
            variant='outline'
            onClick={() => submit(false)}
            disabled={busy}
          >
            Recusar
          </Button>
          <Button
            type='button'
            onClick={() => submit(true)}
            disabled={!canAccept}
          >
            {busy ? 'Autorizando...' : 'Permitir acesso'}
          </Button>
        </div>
      </div>
    </DeviceCard>
  )
}
