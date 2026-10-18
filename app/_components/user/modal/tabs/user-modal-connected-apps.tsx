'use client'

import { useState } from 'react'
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
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import {
  useIntegrationGrants,
  useRevokeIntegrationGrant,
} from '@/src/hooks/use-integration-grants'
import { MCP_MODULE_LABELS } from '@/src/lib/mcp/consent-notice'
import type { IntegrationGrantDTO } from '@/types/integration-grant'

const DESCRIPTION =
  'Apps de IA (Claude, ChatGPT, Cursor…) que você autorizou a acessar o Steel pelo MCP. Cada um age em seu nome, num workspace, com os módulos e o nível de acesso que você escolheu.'

/** Relative-free absolute date: "17 de out. de 2026". */
function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso))
}

function accessLabel(grant: IntegrationGrantDTO): string {
  return grant.scopes.includes('mcp:write') ? 'Ler e alterar' : 'Somente ler'
}

function GrantRow({
  grant,
  onRevoke,
}: {
  grant: IntegrationGrantDTO
  onRevoke: (grant: IntegrationGrantDTO) => void
}) {
  const name = grant.client.name?.trim() || 'App sem nome'
  return (
    <li className='flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-start sm:justify-between'>
      <div className='flex min-w-0 flex-col gap-1.5'>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='font-medium text-sm break-all'>{name}</span>
          <Badge variant='secondary'>{accessLabel(grant)}</Badge>
        </div>
        {grant.redirectHost && (
          <Muted className='text-xs font-mono break-all'>
            {grant.redirectHost}
          </Muted>
        )}
        <Muted className='text-xs break-words'>
          {grant.workspace.name} ·{' '}
          {grant.modules.map((m) => MCP_MODULE_LABELS[m]).join(', ') ||
            'Nenhum módulo'}
        </Muted>
        <Muted className='text-xs'>
          Conectado em {formatDate(grant.createdAt)} ·{' '}
          {grant.lastUsedAt
            ? `Último uso em ${formatDate(grant.lastUsedAt)}`
            : 'Ainda não usado'}
        </Muted>
      </div>
      <Button
        type='button'
        variant='outline'
        size='sm'
        className='self-start shrink-0'
        onClick={() => onRevoke(grant)}
      >
        Revogar
      </Button>
    </li>
  )
}

/**
 * "Apps conectados" (ADR 0033): the user's OAuth grants, with revocation.
 * Revoking cuts the app on its next call.
 */
export function UserModalConnectedApps() {
  const grants = useIntegrationGrants()
  const revoke = useRevokeIntegrationGrant()
  const [pending, setPending] = useState<IntegrationGrantDTO | null>(null)

  async function confirmRevoke() {
    if (!pending) return
    try {
      await revoke.mutateAsync(pending.id)
      notify.success('Acesso revogado')
      setPending(null)
    } catch (error) {
      notify.error(
        error instanceof Error ? error.message : 'Erro ao revogar o app',
      )
    }
  }

  return (
    <div className='flex flex-col gap-3'>
      <Field>
        <FieldContent>
          <FieldLabel>Apps conectados</FieldLabel>
          <FieldDescription>{DESCRIPTION}</FieldDescription>
        </FieldContent>
      </Field>

      {grants.isPending ? (
        <Skeleton className='h-16 w-full rounded-lg' />
      ) : grants.isError ? (
        <p role='alert' className='text-sm text-destructive'>
          Não foi possível carregar os apps conectados.
        </p>
      ) : grants.data.length === 0 ? (
        <Muted className='text-xs'>Nenhum app conectado.</Muted>
      ) : (
        <ul className='flex flex-col gap-2'>
          {grants.data.map((grant) => (
            <GrantRow key={grant.id} grant={grant} onRevoke={setPending} />
          ))}
        </ul>
      )}

      <AlertDialog
        open={!!pending}
        onOpenChange={(open) => {
          if (!open && !revoke.isPending) setPending(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revogar acesso?</AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.client.name?.trim() || 'O app'} perde o acesso ao
              workspace {pending?.workspace.name} na próxima chamada. Para usar
              de novo, será preciso conectar e autorizar outra vez.
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
