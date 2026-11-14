'use client'

import { RefreshIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CrmCompetitorMetricsPanel } from '@/app/_components/crm/crm-competitor-metrics-panel'
import { CrmCompetitorQuickAdd } from '@/app/_components/crm/crm-competitor-quick-add'
import { DataTable } from '@/app/_components/crm/table/data-table'
import type { GridColumn } from '@/app/_components/crm/table/grid'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/src/hooks/_fetch'
import { useCrmResourceList } from '@/src/hooks/use-crm-resource-list'
import {
  type LookupKind,
  useCrmWorkspaceLookups,
} from '@/src/hooks/use-crm-workspace-lookups'
import { CRM_COMPETITOR_SYNCABLE_PLATFORMS } from '@/src/schemas/crm-competitor.schema'
import { CRM_SOCIAL_PLATFORM_LABELS } from '@/src/schemas/crm-social.schema'
import type { CrmCompetitorDTO } from '@/types/crm-competitor'

type SyncResult = { processed: number; synced: number; failed: number }

/**
 * Só Instagram/YouTube: são as únicas plataformas com autofill/sync
 * automático via API pública (ver `src/lib/social/discovery/`). As demais
 * não têm uma forma viável de descoberta pública de dados.
 */
const PLATFORMS = CRM_COMPETITOR_SYNCABLE_PLATFORMS
const PLATFORM_LABELS = CRM_SOCIAL_PLATFORM_LABELS

const COLUMNS: GridColumn[] = [
  {
    key: 'handle',
    header: 'Perfil',
    kind: 'text',
    required: true,
    primary: true,
    placeholder: '@concorrente',
  },
  {
    key: 'platform',
    header: 'Plataforma',
    kind: 'select',
    required: true,
    defaultValue: 'INSTAGRAM',
    options: PLATFORMS.map((p) => ({ value: p, label: PLATFORM_LABELS[p] })),
  },
  { key: 'profileUrl', header: 'URL do perfil', kind: 'text' },
  { key: 'followersCount', header: 'Seguidores', kind: 'number' },
  { key: 'notes', header: 'Observações', kind: 'text' },
  {
    key: 'lastSyncedAt',
    header: 'Última sincronização',
    kind: 'readonly-date',
  },
  { key: 'createdAt', header: 'Criado em', kind: 'readonly-date' },
  { key: 'updatedAt', header: 'Última atualização', kind: 'readonly-date' },
]

const LOOKUP_KINDS: LookupKind[] = []

export function CrmCompetitorsTable({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const list = useCrmResourceList<CrmCompetitorDTO>(workspaceId, 'competitors')
  const { items, isLoading, error, refetch } = list
  const { lookups } = useCrmWorkspaceLookups(workspaceId, LOOKUP_KINDS)
  const columns = useMemo(() => COLUMNS, [])
  const [isSyncing, setIsSyncing] = useState(false)

  async function handleSyncNow() {
    setIsSyncing(true)
    try {
      const result = await apiFetch<SyncResult>(
        `/api/workspaces/${workspaceId}/crm/competitors/sync`,
        { method: 'POST' },
        'Não foi possível sincronizar agora.',
      )
      if (result.processed === 0) {
        toast.info('Nenhum concorrente do Instagram/YouTube para sincronizar.')
      } else {
        toast.success(
          `Sincronizado: ${result.synced} de ${result.processed} concorrente(s)${result.failed > 0 ? ` (${result.failed} falharam)` : ''}.`,
        )
      }
      refetch()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Não foi possível sincronizar agora.',
      )
    } finally {
      setIsSyncing(false)
    }
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-3'>
      <div className='flex items-center justify-between'>
        <p className='text-muted-foreground text-xs'>
          Clique em um concorrente para ver o comparativo com a sua conta e
          abrir a análise completa.
        </p>
        <div className='flex items-center gap-2'>
          <Button
            variant='outline'
            size='sm'
            disabled={isSyncing}
            onClick={handleSyncNow}
          >
            <SteelIcon icon={RefreshIcon} size={14} />
            {isSyncing ? 'Sincronizando…' : 'Sincronizar agora'}
          </Button>
          <CrmCompetitorQuickAdd workspaceId={workspaceId} onAdded={refetch} />
        </div>
      </div>
      <DataTable
        columns={columns}
        data={items}
        workspaceId={workspaceId}
        slug={slug}
        resource='competitors'
        createTitle='concorrente'
        lookups={lookups}
        isLoading={isLoading}
        error={error}
        searchPlaceholder='Buscar concorrentes…'
        refetch={refetch}
        renderRecordExtra={(record) => (
          <CrmCompetitorMetricsPanel
            workspaceId={workspaceId}
            competitorId={record.id}
            slug={slug}
          />
        )}
      />
    </div>
  )
}
