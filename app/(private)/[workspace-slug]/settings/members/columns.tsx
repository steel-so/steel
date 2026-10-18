'use client'

import type { ColumnDef } from '@tanstack/react-table'
import { MEMBER_ROLE_LABEL } from '@/app/_components/workspace/settings/members/member-roles'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import type { DataTableFeatures } from '@/components/ui/data-table/data-table'
import { DataTableColumnHeader } from '@/components/ui/data-table/data-table-column-header'
import type { MemberDTO, MemberRole } from '@/types/member'
import { MemberRowActions } from './member-row-actions'

const STATUS_LABEL: Record<MemberDTO['accountStatus'], string> = {
  ACTIVE: 'Ativo',
  UNVERIFIED: 'Não verificado',
  PENDING_DELETION: 'Exclusão agendada',
}

const STATUS_VARIANT: Record<
  MemberDTO['accountStatus'],
  'secondary' | 'outline' | 'destructive'
> = {
  ACTIVE: 'secondary',
  UNVERIFIED: 'outline',
  PENDING_DELETION: 'destructive',
}

const AUTH_METHOD_LABEL: Record<string, string> = {
  EMAIL_PASSWORD: 'E-mail e senha',
  GOOGLE: 'Google',
  GITHUB: 'GitHub',
}

// Fixed zone: the join date must not shift with the viewer's browser zone.
const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'America/Sao_Paulo',
})

export interface MemberColumnsContext {
  workspaceId: string
  currentUserId: string
  actorRole: MemberRole
}

/**
 * Who the actor may change: never themselves or the owner, and admins only
 * when the actor is the owner (mirrors `MemberService`).
 */
export function canManageMember(
  member: Pick<MemberDTO, 'userId' | 'role'>,
  ctx: Pick<MemberColumnsContext, 'currentUserId' | 'actorRole'>,
): boolean {
  if (ctx.actorRole !== 'OWNER' && ctx.actorRole !== 'ADMIN') return false
  if (member.userId === ctx.currentUserId) return false
  if (member.role === 'OWNER') return false
  if (member.role === 'ADMIN') return ctx.actorRole === 'OWNER'
  return true
}

export function buildMemberColumns(
  ctx: MemberColumnsContext,
): ColumnDef<DataTableFeatures, MemberDTO>[] {
  return [
    {
      accessorKey: 'name',
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title='Nome completo'
          ascLabel='A-Z'
          descLabel='Z-A'
        />
      ),
      cell: ({ row }) => (
        <div className='flex items-center gap-2'>
          <Avatar size='sm'>
            <AvatarImage
              src={row.original.image || ''}
              alt={row.original.name}
            />
            <AvatarFallback>
              {row.original.name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className='font-medium'>{row.original.name}</span>
          {row.original.userId === ctx.currentUserId && (
            <Badge variant='outline'>Você</Badge>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'username',
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title='Username'
          ascLabel='A-Z'
          descLabel='Z-A'
        />
      ),
      cell: ({ row }) => (
        <span className='text-primary'>@{row.original.username}</span>
      ),
    },
    {
      accessorKey: 'email',
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title='E-mail'
          ascLabel='A-Z'
          descLabel='Z-A'
        />
      ),
    },
    {
      accessorKey: 'role',
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title='Cargo'
          ascLabel='Visualizador-Dono'
          descLabel='Dono-Visualizador'
        />
      ),
      cell: ({ row }) => MEMBER_ROLE_LABEL[row.original.role],
    },
    {
      accessorKey: 'accountStatus',
      enableSorting: false,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='Status' />
      ),
      cell: ({ row }) => (
        <Badge variant={STATUS_VARIANT[row.original.accountStatus]}>
          {STATUS_LABEL[row.original.accountStatus]}
        </Badge>
      ),
    },
    {
      accessorKey: 'authMethods',
      enableSorting: false,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='Autenticação' />
      ),
      cell: ({ row }) => (
        <div className='flex gap-1'>
          {row.original.authMethods.map((method) => (
            <Badge key={method} variant='outline'>
              {AUTH_METHOD_LABEL[method] ?? method}
            </Badge>
          ))}
          {row.original.twoFactorEnabled && (
            <Badge variant='outline'>2FA</Badge>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'joinedAt',
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title='Data de entrada'
          ascLabel='Mais antigo'
          descLabel='Mais recente'
        />
      ),
      cell: ({ row }) => dateFmt.format(new Date(row.original.joinedAt)),
    },
    {
      id: 'actions',
      enableSorting: false,
      // Pinned right so the menu stays reachable while the table scrolls.
      meta: { className: 'sticky right-0 w-10 bg-background' },
      header: () => <span className='sr-only'>Ações</span>,
      cell: ({ row }) =>
        canManageMember(row.original, ctx) ? (
          <div className='flex justify-end'>
            <MemberRowActions
              workspaceId={ctx.workspaceId}
              member={row.original}
            />
          </div>
        ) : null,
    },
  ]
}
