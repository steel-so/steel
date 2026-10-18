'use client'

import { Copy01Icon, PlusSignIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import {
  ApiTokenAccessFields,
  type ApiTokenAccessValue,
  accessLabel,
  canSubmitAccess,
  formatTokenDate,
  initialAccessValue,
  moduleList,
  scopesOf,
} from '@/app/_components/api-tokens/api-token-access-fields'
import { SteelIcon } from '@/components/icon/icon'
import { Muted } from '@/components/typography/text/muted'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import {
  useApiTokens,
  useApiTokenWorkspaces,
  useCreateApiToken,
  useRevokeApiToken,
} from '@/src/hooks/use-api-tokens'
import type { ApiTokenCreatedDTO, ApiTokenDTO } from '@/types/api-token'

const DESCRIPTION =
  'Tokens pessoais para scripts, CI e o Steel CLI usarem a API v1 em seu nome, num workspace, com os módulos e o nível de acesso que você escolher. O comando steel login cria um sozinho.'

function TokenRow({
  token,
  onRevoke,
}: {
  token: ApiTokenDTO
  onRevoke: (token: ApiTokenDTO) => void
}) {
  return (
    <li className='flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-start sm:justify-between'>
      <div className='flex min-w-0 flex-col gap-1.5'>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='font-medium text-sm break-all'>{token.name}</span>
          <Badge variant='secondary'>{accessLabel(token.scopes)}</Badge>
          {token.expired && <Badge variant='destructive'>Expirado</Badge>}
        </div>
        <code className='font-mono text-xs text-muted-foreground break-all'>
          {token.prefix}…
        </code>
        <Muted className='text-xs break-words'>
          {token.workspace.name} · {moduleList(token.modules)}
        </Muted>
        <Muted className='text-xs'>
          Criado em {formatTokenDate(token.createdAt)} ·{' '}
          {token.expired ? 'Expirou' : 'Expira'} em{' '}
          {formatTokenDate(token.expiresAt)} ·{' '}
          {token.lastUsedAt
            ? `Último uso em ${formatTokenDate(token.lastUsedAt)}`
            : 'Ainda não usado'}
        </Muted>
      </div>
      <Button
        type='button'
        variant='outline'
        size='sm'
        className='self-start shrink-0'
        onClick={() => onRevoke(token)}
      >
        Revogar
      </Button>
    </li>
  )
}

/** The value, once, with a copy button. */
export function ApiTokenReveal({ token }: { token: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(token)
      notify.success('Token copiado')
    } catch {
      notify.error('Não foi possível copiar. Selecione e copie à mão.')
    }
  }

  return (
    <div className='flex flex-col gap-2'>
      <code className='break-all rounded-md bg-muted p-3 font-mono text-xs select-all'>
        {token}
      </code>
      <Button
        type='button'
        variant='outline'
        size='sm'
        className='self-start'
        onClick={copy}
      >
        <SteelIcon icon={Copy01Icon} strokeWidth={2} />
        Copiar token
      </Button>
    </div>
  )
}

function CreateApiTokenDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const workspaces = useApiTokenWorkspaces(open)
  const create = useCreateApiToken()
  const [name, setName] = useState('')
  const [access, setAccess] = useState<ApiTokenAccessValue | null>(null)
  const [created, setCreated] = useState<ApiTokenCreatedDTO | null>(null)

  const options = workspaces.data ?? []
  const value = access ?? initialAccessValue(options)
  const canSubmit =
    name.trim().length > 0 && canSubmitAccess(value) && !create.isPending

  function close() {
    onOpenChange(false)
    setName('')
    setAccess(null)
    setCreated(null)
    create.reset()
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!value.workspaceId) return
    try {
      const result = await create.mutateAsync({
        name: name.trim(),
        workspaceId: value.workspaceId,
        modules: value.modules,
        scopes: scopesOf(value.access),
        expiresInDays: value.expiresInDays,
      })
      setCreated(result)
    } catch (error) {
      notify.error(
        error instanceof Error ? error.message : 'Erro ao criar o token',
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : close())}>
      <DialogContent className='w-full sm:max-w-lg max-h-[90dvh] overflow-y-auto'>
        {created ? (
          <div className='flex flex-col gap-4'>
            <DialogHeader>
              <DialogTitle>Token criado</DialogTitle>
              <DialogDescription>
                Copie o token agora. Por segurança, ele não aparece de novo.
              </DialogDescription>
            </DialogHeader>
            <ApiTokenReveal token={created.token} />
            <Muted className='text-xs'>
              Use no cabeçalho{' '}
              <code className='font-mono'>Authorization: Bearer …</code> ou na
              variável <code className='font-mono'>STEEL_TOKEN</code> do CLI.
            </Muted>
            <DialogFooter>
              <Button type='button' size='sm' onClick={close}>
                Concluir
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className='flex flex-col gap-4'>
            <DialogHeader>
              <DialogTitle>Criar token de API</DialogTitle>
              <DialogDescription>
                O token age em seu nome, com as suas permissões no workspace.
              </DialogDescription>
            </DialogHeader>
            {workspaces.isPending ? (
              <Skeleton className='h-40 w-full rounded-lg' />
            ) : workspaces.isError ? (
              <p role='alert' className='text-sm text-destructive'>
                Não foi possível carregar os seus workspaces.
              </p>
            ) : options.length === 0 ? (
              <Muted>
                Nenhum workspace seu tem módulos habilitados. Peça a um
                administrador para habilitar o ServiceDesk, o CRM ou a
                Comunicação.
              </Muted>
            ) : (
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor='api-token-name'>Nome</FieldLabel>
                  <Input
                    id='api-token-name'
                    placeholder='Ex.: Deploy no GitHub Actions'
                    value={name}
                    maxLength={100}
                    onChange={(event) => setName(event.target.value)}
                    disabled={create.isPending}
                  />
                </Field>
                <ApiTokenAccessFields
                  idPrefix='api-token'
                  workspaces={options}
                  value={value}
                  onChange={setAccess}
                  disabled={create.isPending}
                />
              </FieldGroup>
            )}
            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={close}
                disabled={create.isPending}
              >
                Cancelar
              </Button>
              <Button type='submit' size='sm' disabled={!canSubmit}>
                {create.isPending ? 'Criando...' : 'Criar token'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Configurações › Segurança › Tokens de API (ADR 0035): the user's personal
 * tokens, creation (value shown once) and revocation.
 */
export function UserModalApiTokens() {
  const tokens = useApiTokens()
  const revoke = useRevokeApiToken()
  const [creating, setCreating] = useState(false)
  const [pending, setPending] = useState<ApiTokenDTO | null>(null)

  async function confirmRevoke() {
    if (!pending) return
    try {
      await revoke.mutateAsync(pending.id)
      notify.success('Token revogado')
      setPending(null)
    } catch (error) {
      notify.error(
        error instanceof Error ? error.message : 'Erro ao revogar o token',
      )
    }
  }

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
        <Field>
          <FieldContent>
            <FieldLabel>Tokens de API</FieldLabel>
            <FieldDescription>{DESCRIPTION}</FieldDescription>
          </FieldContent>
        </Field>
        <Button
          type='button'
          variant='outline'
          size='sm'
          className='self-start shrink-0'
          onClick={() => setCreating(true)}
        >
          <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
          Criar token
        </Button>
      </div>

      {tokens.isPending ? (
        <Skeleton className='h-16 w-full rounded-lg' />
      ) : tokens.isError ? (
        <p role='alert' className='text-sm text-destructive'>
          Não foi possível carregar os tokens de API.
        </p>
      ) : tokens.data.length === 0 ? (
        <Muted className='text-xs'>Nenhum token criado.</Muted>
      ) : (
        <ul className='flex flex-col gap-2'>
          {tokens.data.map((token) => (
            <TokenRow key={token.id} token={token} onRevoke={setPending} />
          ))}
        </ul>
      )}

      <CreateApiTokenDialog open={creating} onOpenChange={setCreating} />

      <AlertDialog
        open={!!pending}
        onOpenChange={(open) => {
          if (!open && !revoke.isPending) setPending(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revogar token?</AlertDialogTitle>
            <AlertDialogDescription>
              Scripts e terminais que usam “{pending?.name}” perdem o acesso ao
              workspace {pending?.workspace.name} na próxima chamada. Não dá
              para desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoke.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={confirmRevoke}
              disabled={revoke.isPending}
            >
              {revoke.isPending ? 'Revogando...' : 'Revogar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
