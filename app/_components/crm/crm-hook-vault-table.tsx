'use client'

import { useMemo } from 'react'
import { DataTable } from '@/app/_components/crm/table/data-table'
import type { GridColumn } from '@/app/_components/crm/table/grid'
import { useCrmResourceList } from '@/src/hooks/use-crm-resource-list'
import {
  type LookupKind,
  useCrmWorkspaceLookups,
} from '@/src/hooks/use-crm-workspace-lookups'
import { CRM_SOCIAL_PLATFORM_LABELS } from '@/src/schemas/crm-social.schema'
import type { CrmHookVaultItemDTO } from '@/types/crm-hook-vault'
import type { CrmSocialPlatformDTO } from '@/types/crm-social'

/** Hooks só fazem sentido em plataformas de conteúdo (não GA/Ads). */
const PLATFORMS: CrmSocialPlatformDTO[] = [
  'FACEBOOK',
  'INSTAGRAM',
  'TIKTOK',
  'YOUTUBE',
]

const PLATFORM_LABELS = CRM_SOCIAL_PLATFORM_LABELS

const COLUMNS: GridColumn[] = [
  {
    key: 'text',
    header: 'Hook',
    kind: 'text',
    required: true,
    primary: true,
    placeholder: 'Você sabia que...',
  },
  {
    key: 'platform',
    header: 'Plataforma',
    kind: 'select',
    options: PLATFORMS.map((p) => ({ value: p, label: PLATFORM_LABELS[p] })),
  },
  { key: 'usageCount', header: 'Usos', kind: 'number' },
  { key: 'notes', header: 'Observações', kind: 'text' },
  { key: 'createdAt', header: 'Criado em', kind: 'readonly-date' },
  { key: 'updatedAt', header: 'Última atualização', kind: 'readonly-date' },
]

const LOOKUP_KINDS: LookupKind[] = []

export function CrmHookVaultTable({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const { items, isLoading, refetch } = useCrmResourceList<CrmHookVaultItemDTO>(
    workspaceId,
    'hook-vault',
  )
  const { lookups } = useCrmWorkspaceLookups(workspaceId, LOOKUP_KINDS)
  const columns = useMemo(() => COLUMNS, [])

  return (
    <DataTable
      columns={columns}
      data={items}
      workspaceId={workspaceId}
      slug={slug}
      resource='hook-vault'
      createTitle='hook'
      lookups={lookups}
      isLoading={isLoading}
      searchPlaceholder='Buscar hooks…'
      refetch={refetch}
    />
  )
}
