'use client'

import type { SortingState } from '@tanstack/react-table'
import { useEffect, useMemo, useState } from 'react'
import { WorkspaceSettingsMemberHeader } from '@/app/_components/workspace/settings/members/workspace-settings-member-header'
import { DataTable } from '@/components/ui/data-table/data-table'
import { useMembers } from '@/src/hooks/use-member'
import type { MemberRole } from '@/types/member'
import { buildMemberColumns } from './columns'
import { PendingInvitationsList } from './pending-invitations-list'

const PAGE_SIZE = 20

export function MembersManager({
  workspaceId,
  currentUserId,
  actorRole,
}: {
  workspaceId: string
  currentUserId: string
  actorRole: MemberRole
}) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [roles, setRoles] = useState<string[]>([])
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'joinedAt', desc: true },
  ])
  const [page, setPage] = useState(1)

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timeout)
  }, [search])

  // A new filter or sort starts again at page 1.
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, roles, sorting])

  const sort = sorting[0]

  const { data, isLoading } = useMembers(workspaceId, {
    search: debouncedSearch || undefined,
    roles: roles.length ? roles : undefined,
    sortBy: sort?.id ?? 'joinedAt',
    sortOrder: sort?.desc ? 'desc' : 'asc',
    page,
    pageSize: PAGE_SIZE,
  })

  const columns = useMemo(
    () => buildMemberColumns({ workspaceId, currentUserId, actorRole }),
    [workspaceId, currentUserId, actorRole],
  )

  return (
    <div className='flex flex-col gap-6'>
      <div className='flex flex-col'>
        <WorkspaceSettingsMemberHeader
          workspaceId={workspaceId}
          search={search}
          onSearchChange={setSearch}
          roles={roles}
          onRolesChange={setRoles}
          resultCount={data?.total ?? 0}
          seats={data?.seats}
        />
        <div data-tour='members-table'>
          <DataTable
            columns={columns}
            data={data?.members ?? []}
            sorting={sorting}
            onSortingChange={setSorting}
            page={page}
            pageSize={PAGE_SIZE}
            total={data?.total ?? 0}
            onPageChange={setPage}
            isLoading={isLoading}
            loadingMessage='Carregando membros...'
            emptyMessage='Nenhum membro encontrado.'
            itemLabel={{ one: 'membro', other: 'membros' }}
          />
        </div>
      </div>
      <PendingInvitationsList workspaceId={workspaceId} />
    </div>
  )
}
