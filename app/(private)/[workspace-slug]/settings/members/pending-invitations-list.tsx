'use client'

import { ArrowDown01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { memberRoleLabel } from '@/app/_components/workspace/settings/members/member-roles'
import { SteelIcon } from '@/components/icon/icon'
import { Muted } from '@/components/typography/text/muted'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import { getInitials } from '@/lib/user-name-initials'
import {
  useInvitations,
  useResendInvitation,
  useRevokeInvitation,
  useUpdateInvitationRole,
} from '@/src/hooks/use-invitation'
import { InvitableRoleValues } from '@/src/schemas/invitation.schema'

// Fixed zone: the expiry date must not shift with the viewer's browser zone.
const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  timeZone: 'America/Sao_Paulo',
})

/** Invitations still waiting on the invitee (expired ones can be resent). */
const OPEN_STATUSES = new Set(['PENDING', 'EXPIRED'])

export function PendingInvitationsList({
  workspaceId,
}: {
  workspaceId: string
}) {
  const { data: invitations, isLoading } = useInvitations(workspaceId)
  const revokeInvitation = useRevokeInvitation(workspaceId)
  const resendInvitation = useResendInvitation(workspaceId)
  const updateRole = useUpdateInvitationRole(workspaceId)

  const open = (invitations ?? []).filter((invitation) =>
    OPEN_STATUSES.has(invitation.status),
  )

  function handleRevoke(invitationId: string) {
    revokeInvitation.mutate(invitationId, {
      onSuccess: () => notify.success('Convite excluído'),
      onError: (error) =>
        notify.error(error, 'Não foi possível excluir o convite'),
    })
  }

  function handleResend(invitationId: string) {
    resendInvitation.mutate(invitationId, {
      onSuccess: () => notify.success('Convite reenviado'),
      onError: (error) =>
        notify.error(error, 'Não foi possível reenviar o convite'),
    })
  }

  function handleRoleChange(invitationId: string, role: string) {
    updateRole.mutate(
      { invitationId, role },
      {
        onSuccess: () => notify.success('Cargo do convite atualizado'),
        onError: (error) =>
          notify.error(error, 'Não foi possível atualizar o cargo'),
      },
    )
  }

  if (isLoading) {
    return (
      <div className='space-y-2' data-testid='invitations-loading'>
        <Skeleton className='h-4 w-32' />
        <Skeleton className='h-10 w-full rounded-sm' />
      </div>
    )
  }
  if (open.length === 0) return null

  return (
    <div className='space-y-2' data-tour='members-pending'>
      <div className='flex items-center gap-2'>
        <Muted className='text-base text-primary'>Convites pendentes</Muted>
        <Badge variant='secondary'>{open.length}</Badge>
      </div>
      <div className='divide-y'>
        {open.map((invitation) => {
          const isPending = invitation.status === 'PENDING'
          // A PENDING row past its date is only marked EXPIRED when touched.
          const isExpired =
            !isPending || new Date(invitation.expiresAt).getTime() < Date.now()
          return (
            <div
              key={invitation.id}
              className='flex flex-col gap-2 rounded-sm px-3 py-4 hover:bg-accent/30 sm:flex-row sm:items-center sm:justify-between'
            >
              <div className='flex min-w-0 items-center gap-4'>
                <Avatar size='lg'>
                  <AvatarFallback>
                    {getInitials(invitation.email)}
                  </AvatarFallback>
                </Avatar>
                <div className='min-w-0'>
                  <Muted className='truncate text-primary'>
                    {invitation.email}
                  </Muted>
                  <Muted className='text-xs'>
                    {isExpired ? 'Expirou em ' : 'Expira em '}
                    {dateFmt.format(new Date(invitation.expiresAt))}
                  </Muted>
                </div>
              </div>
              <div className='flex flex-wrap items-center gap-2 pl-14 sm:pl-0'>
                <Badge variant={isExpired ? 'destructive' : 'outline'}>
                  {isExpired ? 'Expirado' : 'Pendente'}
                </Badge>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    disabled={!isPending}
                    render={
                      <Button
                        variant='ghost'
                        size='sm'
                        className='h-7'
                        aria-label={`Cargo do convite de ${invitation.email}`}
                      />
                    }
                  >
                    {memberRoleLabel(invitation.role)}
                    <SteelIcon icon={ArrowDown01Icon} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end'>
                    {InvitableRoleValues.map((role) => (
                      <DropdownMenuItem
                        key={role}
                        onClick={() => handleRoleChange(invitation.id, role)}
                      >
                        {memberRoleLabel(role)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  variant='ghost'
                  size='sm'
                  className='h-7'
                  disabled={resendInvitation.isPending}
                  onClick={() => handleResend(invitation.id)}
                >
                  Reenviar
                </Button>
                {isPending && (
                  <Button
                    variant='ghost'
                    size='sm'
                    className='h-7'
                    disabled={revokeInvitation.isPending}
                    onClick={() => handleRevoke(invitation.id)}
                  >
                    Excluir
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
