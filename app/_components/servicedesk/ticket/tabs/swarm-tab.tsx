'use client'

import { PlusSignIcon, UserGroupIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify'
import {
  useCloseSdSwarm,
  useInviteSdSwarm,
  useRespondSdSwarm,
  useSdSwarms,
  useStartSdSwarm,
} from '@/src/hooks/use-sd-swarms'
import { useSdTicketRealtime } from '@/src/hooks/use-sd-tickets'
import type {
  SdSwarmDTO,
  SdSwarmMemberStatusDTO,
  SdSwarmSlackStatusDTO,
} from '@/types/sd-swarm'
import { EmptyState } from '../../settings/sd-settings-kit'
import { SdUserAvatar } from '../sd-ticket-badges'
import { sdFormatDateTime } from '../sd-ticket-meta'
import { SdAgentOnlyNotice } from '../shared/sd-tab-bits'
import {
  SdSwarmCloseDialog,
  SdSwarmInviteDialog,
  SdSwarmStartDialog,
} from '../swarm/sd-swarm-dialogs'
import type { SdTicketTabProps } from './types'

export const SD_SWARM_MEMBER_LABEL: Record<SdSwarmMemberStatusDTO, string> = {
  INVITED: 'Aguardando',
  JOINED: 'Na equipe',
  DECLINED: 'Recusou',
}

const MEMBER_VARIANT: Record<
  SdSwarmMemberStatusDTO,
  'secondary' | 'default' | 'outline'
> = {
  INVITED: 'secondary',
  JOINED: 'default',
  DECLINED: 'outline',
}

export const SD_SWARM_SLACK_LABEL: Record<SdSwarmSlackStatusDTO, string> = {
  NONE: 'Sem canal no Slack',
  ACTIVE: 'Canal ativo no Slack',
  ARCHIVED: 'Canal arquivado no Slack',
  FAILED: 'Não foi possível abrir o canal',
}

function SwarmCard({
  swarm,
  meId,
  canManage,
  busy,
  onRespond,
  onInvite,
  onClose,
}: {
  swarm: SdSwarmDTO
  meId: string
  canManage: boolean
  busy: boolean
  onRespond: (response: 'JOIN' | 'DECLINE') => void
  onInvite: () => void
  onClose: () => void
}) {
  const open = swarm.status === 'OPEN'
  const mine = swarm.members.find((m) => m.user.id === meId)
  return (
    <section className='flex flex-col gap-3 rounded-lg border border-border bg-card p-4'>
      <header className='flex flex-wrap items-start justify-between gap-2'>
        <div className='flex min-w-0 flex-col gap-0.5'>
          <div className='flex items-center gap-2'>
            <Badge variant={open ? 'default' : 'secondary'}>
              {open ? 'Em andamento' : 'Encerrado'}
            </Badge>
            <span className='text-muted-foreground text-xs'>
              {swarm.startedBy ? `por ${swarm.startedBy.name} · ` : ''}
              {sdFormatDateTime(swarm.startedAt)}
            </span>
          </div>
          <p className='text-sm'>{swarm.reason}</p>
        </div>
        {open && canManage ? (
          <div className='flex gap-2'>
            <Button size='sm' variant='outline' onClick={onInvite}>
              <SteelIcon icon={PlusSignIcon} />
              Convidar
            </Button>
            <Button size='sm' variant='outline' onClick={onClose}>
              Encerrar
            </Button>
          </div>
        ) : null}
      </header>

      {open && mine?.status === 'INVITED' ? (
        <div className='flex flex-wrap items-center gap-2 rounded-md bg-muted/50 px-3 py-2'>
          <span className='flex-1 text-sm'>
            Você foi chamado como especialista.
          </span>
          <Button size='sm' disabled={busy} onClick={() => onRespond('JOIN')}>
            Entrar
          </Button>
          <Button
            size='sm'
            variant='outline'
            disabled={busy}
            onClick={() => onRespond('DECLINE')}
          >
            Recusar
          </Button>
        </div>
      ) : null}

      <ul className='flex flex-col gap-1.5'>
        {swarm.members.map((m) => (
          <li key={m.user.id} className='flex items-center gap-2 text-sm'>
            <SdUserAvatar user={m.user} className='size-6' />
            <span className='min-w-0 flex-1 truncate'>{m.user.name}</span>
            <Badge variant={MEMBER_VARIANT[m.status]}>
              {SD_SWARM_MEMBER_LABEL[m.status]}
            </Badge>
          </li>
        ))}
      </ul>

      <footer className='flex flex-col gap-1 text-muted-foreground text-xs'>
        <span>
          {SD_SWARM_SLACK_LABEL[swarm.slack.status]}
          {swarm.slack.channelName ? ` (#${swarm.slack.channelName})` : ''}
          {swarm.slack.error ? `: ${swarm.slack.error}` : ''}
        </span>
        {swarm.outcome ? (
          <span className='text-foreground'>Resultado: {swarm.outcome}</span>
        ) : null}
        {swarm.closedAt ? (
          <span>Encerrado em {sdFormatDateTime(swarm.closedAt)}</span>
        ) : null}
      </footer>
    </section>
  )
}

/** Swarming do chamado: especialistas chamados direto, sem N1/N2/N3. */
export function SdTicketSwarmTab({
  workspaceId,
  ticket,
  me,
  mode,
}: SdTicketTabProps) {
  const ticketRef = ticket.id
  const isAgent = mode === 'agent'
  useSdTicketRealtime(isAgent ? workspaceId : undefined)
  const query = useSdSwarms(isAgent ? workspaceId : '', ticketRef)
  const start = useStartSdSwarm(workspaceId, ticketRef)
  const invite = useInviteSdSwarm(workspaceId, ticketRef)
  const respond = useRespondSdSwarm(workspaceId, ticketRef)
  const close = useCloseSdSwarm(workspaceId, ticketRef)
  const [dialog, setDialog] = useState<
    'start' | { invite: SdSwarmDTO } | { close: SdSwarmDTO } | null
  >(null)

  if (!isAgent) return <SdAgentOnlyNotice />

  const items = query.data?.items ?? []
  const openSwarm = items.find((s) => s.status === 'OPEN') ?? null
  const maxMembers = query.data?.maxMembers ?? 10
  const busy = respond.isPending

  async function run(action: () => Promise<unknown>, done: string) {
    try {
      await action()
      setDialog(null)
      notify.success(done)
    } catch (error) {
      notify.error(error)
    }
  }

  return (
    <div className='flex flex-col gap-4 p-4'>
      <div className='flex items-center justify-between gap-2'>
        <div className='flex flex-col'>
          <h3 className='font-medium text-sm'>Swarming de especialistas</h3>
          <p className='text-muted-foreground text-xs'>
            Chame especialistas para dentro do chamado, sem escalonar por
            níveis.
          </p>
        </div>
        {me.isAgent && !openSwarm ? (
          <Button size='sm' onClick={() => setDialog('start')}>
            <SteelIcon icon={UserGroupIcon} />
            Chamar especialistas
          </Button>
        ) : null}
      </div>

      {query.error ? (
        <EmptyState>{query.error.message}</EmptyState>
      ) : !query.isLoading && items.length === 0 ? (
        <EmptyState>Nenhum swarming neste chamado.</EmptyState>
      ) : (
        items.map((swarm) => (
          <SwarmCard
            key={swarm.id}
            swarm={swarm}
            meId={me.userId}
            canManage={me.isAgent}
            busy={busy}
            onRespond={(response) =>
              run(
                () => respond.mutateAsync({ swarmId: swarm.id, response }),
                response === 'JOIN'
                  ? 'Você entrou no swarming'
                  : 'Convite recusado',
              )
            }
            onInvite={() => setDialog({ invite: swarm })}
            onClose={() => setDialog({ close: swarm })}
          />
        ))
      )}

      <SdSwarmStartDialog
        workspaceId={workspaceId}
        open={dialog === 'start'}
        maxMembers={maxMembers}
        slackAvailable={query.data?.slackAvailable ?? false}
        pending={start.isPending}
        onOpenChange={(open) => !open && setDialog(null)}
        onSubmit={(data) =>
          run(() => start.mutateAsync(data), 'Especialistas chamados')
        }
      />
      <SdSwarmInviteDialog
        workspaceId={workspaceId}
        open={
          typeof dialog === 'object' && dialog !== null && 'invite' in dialog
        }
        memberIds={
          typeof dialog === 'object' && dialog !== null && 'invite' in dialog
            ? dialog.invite.members.map((m) => m.user.id)
            : []
        }
        maxMembers={maxMembers}
        pending={invite.isPending}
        onOpenChange={(open) => !open && setDialog(null)}
        onSubmit={(userIds) => {
          if (typeof dialog !== 'object' || dialog === null) return
          if (!('invite' in dialog)) return
          void run(
            () => invite.mutateAsync({ swarmId: dialog.invite.id, userIds }),
            'Convites enviados',
          )
        }}
      />
      <SdSwarmCloseDialog
        open={
          typeof dialog === 'object' && dialog !== null && 'close' in dialog
        }
        hasSlack={
          typeof dialog === 'object' && dialog !== null && 'close' in dialog
            ? dialog.close.slack.status === 'ACTIVE'
            : false
        }
        pending={close.isPending}
        onOpenChange={(open) => !open && setDialog(null)}
        onSubmit={(outcome) => {
          if (typeof dialog !== 'object' || dialog === null) return
          if (!('close' in dialog)) return
          void run(
            () =>
              close.mutateAsync({
                swarmId: dialog.close.id,
                outcome: outcome.trim() || undefined,
              }),
            'Swarming encerrado',
          )
        }}
      />
    </div>
  )
}
