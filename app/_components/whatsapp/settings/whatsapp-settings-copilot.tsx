'use client'

import { useIsPrivileged } from '@/app/_components/workspace/workspace-permissions'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import {
  useUpdateWhatsAppSettings,
  useWhatsAppSettings,
} from '@/src/hooks/use-whatsapp-settings'

/**
 * Copiloto do atendente (Z7), só OWNER/ADMIN. O resumo na transferência vem
 * desligado: cada transferência consome uma chamada da cota de IA do
 * workspace, então a decisão fica com quem administra.
 */
export function WhatsappSettingsCopilot({
  workspaceId,
}: {
  workspaceId: string
}) {
  const isAdmin = useIsPrivileged()
  const settings = useWhatsAppSettings(workspaceId, isAdmin)
  const update = useUpdateWhatsAppSettings(workspaceId)

  if (!isAdmin || !settings.data) return null

  return (
    <section className='space-y-3 rounded-lg border p-4'>
      <h3 className='font-medium text-sm'>Copiloto do atendente</h3>
      <div className='flex items-start justify-between gap-3'>
        <div>
          <Label htmlFor='copilotSummaryOnTransfer'>
            Resumir a conversa ao transferir
          </Label>
          <p className='text-muted-foreground text-xs'>
            Quando a conversa passa para outro atendente ou para outra equipe, o
            Steel AI escreve na linha do tempo um resumo e os pendentes, só para
            a equipe (o contato não recebe). Cada resumo usa a cota mensal de IA
            do workspace. Se a IA falhar ou a cota acabar, a transferência
            acontece do mesmo jeito.
          </p>
        </div>
        <Switch
          id='copilotSummaryOnTransfer'
          checked={settings.data.copilotSummaryOnTransfer}
          disabled={update.isPending}
          onCheckedChange={(checked) =>
            update.mutate(
              { copilotSummaryOnTransfer: checked },
              {
                onSuccess: () => notify.success('Configuração salva'),
                onError: (error) =>
                  notify.error(error, 'Não foi possível salvar'),
              },
            )
          }
        />
      </div>
    </section>
  )
}
