'use client'

import { Search01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import type { MemberSeatUsage } from '@/types/member'
import { WorkspaceSettingsMemberImportDialog } from './dialog/workspace-settings-member-import-dialog'
import { WorkspaceSettingsMemberInviteDialog } from './dialog/workspace-settings-member-invite-dialog'
import { WorkspaceSettingsMemberFilterRole } from './workspace-settings-member-filter-role'

interface WorkspaceSettingsMemberHeaderProps {
  workspaceId: string
  search: string
  onSearchChange: (value: string) => void
  roles: string[]
  onRolesChange: (values: string[]) => void
  resultCount: number
  seats?: MemberSeatUsage
}

export function isSeatLimitReached(seats?: MemberSeatUsage): boolean {
  return !!seats && seats.limit !== null && seats.used >= seats.limit
}

export function WorkspaceSettingsMemberHeader({
  workspaceId,
  search,
  onSearchChange,
  roles,
  onRolesChange,
  resultCount,
  seats,
}: WorkspaceSettingsMemberHeaderProps) {
  const full = isSeatLimitReached(seats)

  return (
    <div className='flex flex-col gap-1 pb-3.5'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex items-center gap-2' data-tour='members-seats'>
          <span>Pessoas</span>
          {seats && (
            <Badge
              variant={full ? 'destructive' : 'secondary'}
              title='Membros + convites pendentes'
            >
              {seats.limit === null
                ? `${seats.used} assentos · ilimitado`
                : `${seats.used}/${seats.limit} assentos`}
            </Badge>
          )}
        </div>
        <div className='flex w-full flex-wrap items-center gap-2 sm:w-auto'>
          <InputGroup className='h-8 w-full rounded-md sm:w-56'>
            <InputGroupAddon>
              <SteelIcon icon={Search01Icon} />
            </InputGroupAddon>
            <InputGroupInput
              aria-label='Pesquisar membros'
              placeholder='Pesquisa...'
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
            />
            <InputGroupAddon
              align='inline-end'
              className='text-xs whitespace-nowrap'
            >
              {resultCount} resultado{resultCount === 1 ? '' : 's'}
            </InputGroupAddon>
          </InputGroup>
          <WorkspaceSettingsMemberFilterRole
            selected={roles}
            onChange={onRolesChange}
          />
          <WorkspaceSettingsMemberImportDialog workspaceId={workspaceId} />
          <WorkspaceSettingsMemberInviteDialog
            workspaceId={workspaceId}
            disabled={full}
          />
        </div>
      </div>
      {full && (
        <p className='text-xs text-destructive'>
          Todos os assentos do plano estão em uso. Revogue um convite ou remova
          um membro para convidar outra pessoa.
        </p>
      )}
    </div>
  )
}
