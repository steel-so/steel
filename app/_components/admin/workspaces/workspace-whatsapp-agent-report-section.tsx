'use client'

import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import {
  useAdminWhatsAppAgentReport,
  useUpdateAdminWhatsAppAgentReport,
} from '@/src/hooks/use-whatsapp-agent-report'
import { AdminPanel, ErrorState, TableSkeleton } from '../shell/admin-ui'

/**
 * Relatório de desempenho dos atendentes (ADR 0062): liga e desliga por
 * workspace. Desligado por padrão; ligado, aparece a aba "Atendentes" em
 * Comunicação › Relatórios.
 */
export function WorkspaceWhatsappAgentReportSection({
  workspaceId,
  disabled = false,
}: {
  workspaceId: string
  disabled?: boolean
}) {
  const settings = useAdminWhatsAppAgentReport(workspaceId)
  const update = useUpdateAdminWhatsAppAgentReport(workspaceId)

  function toggle(enabled: boolean) {
    update.mutate(
      { enabled },
      {
        onSuccess: () =>
          notify.success(
            enabled
              ? 'Relatório de atendentes ativado'
              : 'Relatório de atendentes desativado',
          ),
        onError: (error) => notify.error(error),
      },
    )
  }

  return (
    <AdminPanel
      title='Relatório de atendentes (WhatsApp)'
      description='Desempenho da tabulação por atendente, em Comunicação › Relatórios › Atendentes'
    >
      {settings.isLoading ? (
        <TableSkeleton rows={1} />
      ) : settings.isError || !settings.data ? (
        <ErrorState message='Não foi possível carregar o relatório de atendentes.' />
      ) : (
        <div className='flex items-center justify-between gap-3 rounded-md border p-3'>
          <div className='min-w-0'>
            <p className='font-medium text-sm'>Relatório de atendentes</p>
            <p className='text-muted-foreground text-xs'>
              Desligado por padrão. Ligado, OWNER/ADMIN veem todos os
              atendentes, líderes veem as equipes que lideram e cada atendente
              vê só o próprio desempenho.
            </p>
          </div>
          <Switch
            aria-label='Relatório de atendentes'
            checked={settings.data.enabled}
            disabled={disabled || update.isPending}
            onCheckedChange={toggle}
          />
        </div>
      )}
    </AdminPanel>
  )
}
