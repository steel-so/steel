'use client'

import { Archive02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { type FormEvent, useEffect, useState } from 'react'
import { WhatsAppArchiveList } from '@/app/_components/whatsapp/archive/whatsapp-archive-list'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import {
  useAdminWhatsAppArchive,
  useTriggerAdminWhatsAppArchive,
  useUpdateAdminWhatsAppArchive,
} from '@/src/hooks/use-whatsapp-archive'
import { WhatsAppArchiveRootFolderSchema } from '@/src/schemas/whatsapp-archive.schema'
import type { WhatsAppArchiveKind } from '@/types/whatsapp-archive'
import { AdminPanel, ErrorState, TableSkeleton } from '../shell/admin-ui'

const KIND_DONE: Record<WhatsAppArchiveKind, string> = {
  WEEKLY: 'Pacote semanal na fila',
  MONTHLY_FULL: 'Pacote completo na fila',
}

/**
 * Arquivamento de conversas do WhatsApp para bancos (ADR 0052): liga e
 * desliga por workspace, define a pasta raiz do .zip e gera um pacote na
 * hora. Desligado por padrão.
 */
export function WorkspaceWhatsappArchiveSection({
  workspaceId,
  disabled = false,
}: {
  workspaceId: string
  disabled?: boolean
}) {
  const overview = useAdminWhatsAppArchive(workspaceId)
  const update = useUpdateAdminWhatsAppArchive(workspaceId)
  const trigger = useTriggerAdminWhatsAppArchive(workspaceId)
  const [root, setRoot] = useState('')

  const settings = overview.data?.settings
  useEffect(() => {
    if (settings) setRoot(settings.rootFolderName ?? '')
  }, [settings])

  function toggle(enabled: boolean) {
    update.mutate(
      { enabled },
      {
        onSuccess: () =>
          notify.success(
            enabled ? 'Arquivamento ativado' : 'Arquivamento desativado',
          ),
        onError: (error) => notify.error(error),
      },
    )
  }

  function saveRoot(event: FormEvent) {
    event.preventDefault()
    const value = root.trim()
    if (value) {
      const parsed = WhatsAppArchiveRootFolderSchema.safeParse(value)
      if (!parsed.success) {
        notify.error(parsed.error.issues[0]?.message ?? 'Nome inválido')
        return
      }
    }
    update.mutate(
      { rootFolderName: value || null },
      {
        onSuccess: () => notify.success('Pasta raiz salva'),
        onError: (error) => notify.error(error),
      },
    )
  }

  function generate(kind: WhatsAppArchiveKind) {
    trigger.mutate(
      { kind },
      {
        onSuccess: () => notify.success(KIND_DONE[kind]),
        onError: (error) => notify.error(error),
      },
    )
  }

  const enabled = settings?.enabled ?? false
  const busy = disabled || update.isPending || trigger.isPending

  return (
    <AdminPanel
      title='Arquivamento de conversas (WhatsApp)'
      description='Pacotes .zip com um PDF por atendimento, para bancos: semanal (segunda 02:00) e completo (dia 1, 02:30)'
      actions={
        <>
          <Button
            size='sm'
            variant='outline'
            disabled={busy || !enabled}
            onClick={() => generate('WEEKLY')}
          >
            <SteelIcon icon={Archive02Icon} strokeWidth={2} />
            Gerar semanal agora
          </Button>
          <Button
            size='sm'
            variant='outline'
            disabled={busy || !enabled}
            onClick={() => generate('MONTHLY_FULL')}
          >
            <SteelIcon icon={Archive02Icon} strokeWidth={2} />
            Gerar completo agora
          </Button>
        </>
      }
    >
      {overview.isLoading ? (
        <TableSkeleton rows={3} />
      ) : overview.isError || !overview.data || !settings ? (
        <ErrorState message='Não foi possível carregar o arquivamento.' />
      ) : (
        <div className='space-y-4'>
          <div className='flex items-center justify-between gap-3 rounded-md border p-3'>
            <div className='min-w-0'>
              <p className='font-medium text-sm'>Arquivar conversas</p>
              <p className='text-muted-foreground text-xs'>
                Desligado por padrão. Ligado, o worker gera os pacotes nos
                horários acima e o OWNER/ADMIN baixa em Comunicação ›
                Configurações.
              </p>
            </div>
            <Switch
              aria-label='Arquivar conversas'
              checked={enabled}
              disabled={busy}
              onCheckedChange={toggle}
            />
          </div>

          <form onSubmit={saveRoot} className='flex flex-wrap items-end gap-2'>
            <div className='min-w-0 flex-1 space-y-1.5'>
              <Label htmlFor={`archive-root-${workspaceId}`}>
                Pasta raiz do .zip
              </Label>
              <Input
                id={`archive-root-${workspaceId}`}
                value={root}
                maxLength={40}
                placeholder={settings.effectiveRootFolderName}
                onChange={(event) => setRoot(event.target.value)}
              />
              <p className='text-muted-foreground text-xs'>
                Vazio usa o padrão ({settings.effectiveRootFolderName}). Só
                letras sem acento, números, hífen e sublinhado.
              </p>
            </div>
            <Button type='submit' size='sm' disabled={busy}>
              Salvar pasta
            </Button>
          </form>

          {!overview.data.offsiteConfigured ? (
            <p className='rounded-md border border-dashed px-3 py-2 text-muted-foreground text-xs'>
              BACKUP_OFFSITE_* não está configurado: os pacotes ficam só no
              MinIO deste servidor.
            </p>
          ) : null}

          <WhatsAppArchiveList archives={overview.data.archives} />
        </div>
      )}
    </AdminPanel>
  )
}
