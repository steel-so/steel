'use client'

import { useMemo, useState } from 'react'
import {
  EXPORT_TIMEZONE,
  formatDateTime,
  formatInteger,
} from '@/app/_components/settings/worklogs/worklog-format'
import { H4 } from '@/components/typography/heading/h4'
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
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import {
  useRevokeWorkspaceIntegrationGrants,
  useWorkspaceIntegrationGrants,
  type WorkspaceGrantRevocation,
} from '@/src/hooks/use-workspace-integration-grants'
import { MCP_MODULE_LABELS } from '@/src/lib/mcp/consent-notice'
import type {
  McpUsageDTO,
  WorkspaceIntegrationClientDTO,
  WorkspaceIntegrationGrantDTO,
} from '@/types/integration-grant'

/**
 * Ajustes › Apps conectados (OWNER/ADMIN): the AI apps every member
 * authorized over MCP, per app (with call counts) and per member, with
 * revocation of one grant, of a member's or of an app's.
 */

type Pending = {
  target: WorkspaceGrantRevocation
  title: string
  description: string
}

type MemberGroup = {
  user: WorkspaceIntegrationGrantDTO['user']
  grants: WorkspaceIntegrationGrantDTO[]
}

function appName(client: { name: string | null }): string {
  return client.name?.trim() || 'App sem nome'
}

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

function lastUse(iso: string | null): string {
  return iso
    ? `Último uso em ${formatDateTime(iso, EXPORT_TIMEZONE)}`
    : 'Ainda não usado'
}

function calls(count: number): string {
  return count === 1 ? '1 chamada' : `${formatInteger(count)} chamadas`
}

function UsageLine({ usage }: { usage: McpUsageDTO }) {
  return (
    <Muted className='text-xs'>
      {calls(usage.last7Days)} em 7 dias · {calls(usage.last30Days)} em 30 dias
    </Muted>
  )
}

function groupByMember(grants: WorkspaceIntegrationGrantDTO[]): MemberGroup[] {
  const groups = new Map<string, MemberGroup>()
  for (const grant of grants) {
    const group = groups.get(grant.user.id) ?? { user: grant.user, grants: [] }
    group.grants.push(grant)
    groups.set(grant.user.id, group)
  }
  return [...groups.values()].sort((a, b) =>
    a.user.name.localeCompare(b.user.name, 'pt-BR'),
  )
}

function ClientCard({
  client,
  onRevoke,
}: {
  client: WorkspaceIntegrationClientDTO
  onRevoke: (pending: Pending) => void
}) {
  const name = appName(client.client)
  return (
    <Card size='sm'>
      <CardHeader>
        <CardTitle className='flex flex-wrap items-center gap-2 break-all'>
          {name}
          <Badge variant='secondary'>
            {client.canWrite ? 'Ler e alterar' : 'Somente ler'}
          </Badge>
        </CardTitle>
        {client.redirectHost && (
          <CardDescription className='font-mono text-xs break-all'>
            {client.redirectHost}
          </CardDescription>
        )}
        <CardDescription>
          {client.members === 1
            ? '1 membro conectado'
            : `${formatInteger(client.members)} membros conectados`}
        </CardDescription>
      </CardHeader>
      <CardContent className='flex flex-col gap-1'>
        <UsageLine usage={client.usage} />
        <Muted className='text-xs'>{lastUse(client.lastUsedAt)}</Muted>
      </CardContent>
      <CardFooter>
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() =>
            onRevoke({
              target: { kind: 'client', clientId: client.client.clientId },
              title: `Revogar ${name} de todos?`,
              description: `${name} perde o acesso de todos os membros a este workspace na próxima chamada. Cada pessoa pode conectar de novo depois, autorizando outra vez.`,
            })
          }
        >
          Revogar de todos
        </Button>
      </CardFooter>
    </Card>
  )
}

function GrantItem({
  grant,
  onRevoke,
}: {
  grant: WorkspaceIntegrationGrantDTO
  onRevoke: (pending: Pending) => void
}) {
  const name = appName(grant.client)
  return (
    <li className='flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-start sm:justify-between'>
      <div className='flex min-w-0 flex-col gap-1.5'>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='font-medium text-sm break-all'>{name}</span>
          <Badge variant='secondary'>
            {grant.scopes.includes('mcp:write')
              ? 'Ler e alterar'
              : 'Somente ler'}
          </Badge>
        </div>
        {grant.redirectHost && (
          <Muted className='text-xs font-mono break-all'>
            {grant.redirectHost}
          </Muted>
        )}
        <Muted className='text-xs break-words'>
          {grant.modules.map((m) => MCP_MODULE_LABELS[m]).join(', ') ||
            'Nenhum módulo'}
        </Muted>
        <Muted className='text-xs'>
          Conectado em {formatDateTime(grant.createdAt, EXPORT_TIMEZONE)} ·{' '}
          {lastUse(grant.lastUsedAt)}
        </Muted>
        <UsageLine usage={grant.usage} />
      </div>
      <Button
        type='button'
        variant='outline'
        size='sm'
        className='self-start shrink-0'
        onClick={() =>
          onRevoke({
            target: { kind: 'grant', grantId: grant.id },
            title: 'Revogar acesso?',
            description: `${name} perde o acesso de ${grant.user.name} a este workspace na próxima chamada. Para usar de novo, será preciso conectar e autorizar outra vez.`,
          })
        }
      >
        Revogar
      </Button>
    </li>
  )
}

function MemberSection({
  group,
  onRevoke,
}: {
  group: MemberGroup
  onRevoke: (pending: Pending) => void
}) {
  const { user, grants } = group
  return (
    <section className='flex flex-col gap-3 rounded-xl border border-border p-3 sm:p-4'>
      <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
        <div className='flex min-w-0 items-center gap-3'>
          <Avatar>
            {user.image && <AvatarImage src={user.image} alt='' />}
            <AvatarFallback>{initials(user.name)}</AvatarFallback>
          </Avatar>
          <div className='flex min-w-0 flex-col'>
            <span className='font-medium text-sm break-all'>{user.name}</span>
            <Muted className='text-xs break-all'>{user.email}</Muted>
          </div>
        </div>
        {grants.length > 1 && (
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='self-start sm:self-center'
            onClick={() =>
              onRevoke({
                target: { kind: 'member', userId: user.id },
                title: `Revogar todos os apps de ${user.name}?`,
                description: `Os ${grants.length} apps que ${user.name} conectou perdem o acesso a este workspace na próxima chamada.`,
              })
            }
          >
            Revogar todos
          </Button>
        )}
      </div>
      <ul className='flex flex-col gap-2'>
        {grants.map((grant) => (
          <GrantItem key={grant.id} grant={grant} onRevoke={onRevoke} />
        ))}
      </ul>
    </section>
  )
}

export function WorkspaceConnectedAppsPanel({
  workspaceId,
}: {
  workspaceId: string
}) {
  const query = useWorkspaceIntegrationGrants(workspaceId)
  const revoke = useRevokeWorkspaceIntegrationGrants(workspaceId)
  const [pending, setPending] = useState<Pending | null>(null)
  const members = useMemo(
    () => groupByMember(query.data?.grants ?? []),
    [query.data],
  )

  async function confirmRevoke() {
    if (!pending) return
    try {
      const result = await revoke.mutateAsync(pending.target)
      if ('revoked' in result) {
        notify.success(
          result.revoked === 1
            ? '1 acesso revogado'
            : `${formatInteger(result.revoked)} acessos revogados`,
        )
      } else {
        notify.success('Acesso revogado')
      }
      setPending(null)
    } catch (error) {
      notify.error(
        error instanceof Error ? error.message : 'Erro ao revogar o acesso',
      )
    }
  }

  if (query.isPending) {
    return (
      <div className='flex flex-col gap-3'>
        <Skeleton className='h-32 w-full rounded-xl' />
        <Skeleton className='h-24 w-full rounded-xl' />
      </div>
    )
  }

  if (query.isError) {
    return (
      <p role='alert' className='text-sm text-destructive'>
        Não foi possível carregar os apps conectados.
      </p>
    )
  }

  if (query.data.grants.length === 0) {
    return (
      <Card size='sm'>
        <CardHeader>
          <CardTitle>Nenhum app conectado</CardTitle>
          <CardDescription>
            Quando um membro autorizar o Claude, o ChatGPT, o Cursor ou outro
            app de IA a usar este workspace pelo MCP, ele aparece aqui.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className='flex flex-col gap-8'>
      <section className='flex flex-col gap-3'>
        <div>
          <H4>Por app</H4>
          <Muted className='text-xs'>
            Chamadas de ferramentas pelo MCP de todos os membros, contadas por
            dia no horário de Brasília.
          </Muted>
        </div>
        <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
          {query.data.clients.map((client) => (
            <ClientCard
              key={client.client.clientId}
              client={client}
              onRevoke={setPending}
            />
          ))}
        </div>
      </section>

      <section className='flex flex-col gap-3'>
        <div>
          <H4>Por membro</H4>
          <Muted className='text-xs'>
            Cada app age em nome de quem autorizou, com os módulos e o nível de
            acesso escolhidos no consentimento.
          </Muted>
        </div>
        <div className='flex flex-col gap-3'>
          {members.map((group) => (
            <MemberSection
              key={group.user.id}
              group={group}
              onRevoke={setPending}
            />
          ))}
        </div>
      </section>

      <AlertDialog
        open={!!pending}
        onOpenChange={(open) => {
          if (!open && !revoke.isPending) setPending(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.description}
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
