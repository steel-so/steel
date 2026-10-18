'use client'

import { useState } from 'react'
import {
  accessLabel,
  moduleList,
} from '@/app/_components/api-tokens/api-token-access-fields'
import {
  EXPORT_TIMEZONE,
  formatDateTime,
} from '@/app/_components/settings/worklogs/worklog-format'
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import {
  useRevokeWorkspaceApiToken,
  useWorkspaceApiTokens,
} from '@/src/hooks/use-workspace-api-tokens'
import type { WorkspaceApiTokenDTO } from '@/types/api-token'

/**
 * Ajustes › Apps conectados › Tokens de API (OWNER/ADMIN, ADR 0035): every
 * member's personal tokens for this workspace, with revocation.
 */

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts.length > 1 ? [parts[0], parts.at(-1)] : parts
  return (
    letters
      .map((part) => part?.[0] ?? '')
      .join('')
      .toUpperCase() || '?'
  )
}

function TokenItem({
  token,
  onRevoke,
}: {
  token: WorkspaceApiTokenDTO
  onRevoke: (token: WorkspaceApiTokenDTO) => void
}) {
  return (
    <li className='flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-start sm:justify-between'>
      <div className='flex min-w-0 flex-col gap-1.5'>
        <div className='flex min-w-0 items-center gap-2'>
          <Avatar size='sm'>
            {token.user.image && <AvatarImage src={token.user.image} alt='' />}
            <AvatarFallback>{initials(token.user.name)}</AvatarFallback>
          </Avatar>
          <div className='flex min-w-0 flex-col'>
            <span className='text-sm font-medium break-all'>
              {token.user.name}
            </span>
            <Muted className='text-xs break-all'>{token.user.email}</Muted>
          </div>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='text-sm break-all'>{token.name}</span>
          <Badge variant='secondary'>{accessLabel(token.scopes)}</Badge>
          {token.createdVia === 'DEVICE' && (
            <Badge variant='outline'>Steel CLI</Badge>
          )}
          {token.expired && <Badge variant='destructive'>Expirado</Badge>}
        </div>
        <code className='font-mono text-xs text-muted-foreground break-all'>
          {token.prefix}…
        </code>
        <Muted className='text-xs break-words'>
          {moduleList(token.modules)}
        </Muted>
        <Muted className='text-xs'>
          Criado em {formatDateTime(token.createdAt, EXPORT_TIMEZONE)} ·{' '}
          {token.expired ? 'Expirou' : 'Expira'} em{' '}
          {formatDateTime(token.expiresAt, EXPORT_TIMEZONE)} ·{' '}
          {token.lastUsedAt
            ? `Último uso em ${formatDateTime(token.lastUsedAt, EXPORT_TIMEZONE)}`
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

export function WorkspaceApiTokensPanel({
  workspaceId,
}: {
  workspaceId: string
}) {
  const query = useWorkspaceApiTokens(workspaceId)
  const revoke = useRevokeWorkspaceApiToken(workspaceId)
  const [pending, setPending] = useState<WorkspaceApiTokenDTO | null>(null)

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

  if (query.isPending) return <Skeleton className='h-24 w-full rounded-xl' />

  if (query.isError) {
    return (
      <p role='alert' className='text-sm text-destructive'>
        Não foi possível carregar os tokens de API.
      </p>
    )
  }

  if (query.data.length === 0) {
    return (
      <Card size='sm'>
        <CardHeader>
          <CardTitle>Nenhum token de API</CardTitle>
          <CardDescription>
            Quando um membro criar um token em Ajustes › Segurança ou entrar
            pelo Steel CLI, ele aparece aqui.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <>
      <ul className='flex flex-col gap-2'>
        {query.data.map((token) => (
          <TokenItem key={token.id} token={token} onRevoke={setPending} />
        ))}
      </ul>

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
              “{pending?.name}”, de {pending?.user.name}, perde o acesso a este
              workspace na próxima chamada. Não dá para desfazer.
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
    </>
  )
}
