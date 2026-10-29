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
 * Marketing Messages Lite API (OWNER/ADMIN): desligada por padrão. Quando
 * ligada, os templates de marketing das conexões Meta saem pela API de
 * marketing da Meta, com entrega otimizada e métricas de clique.
 */
export function WhatsappSettingsMarketingLite({
  workspaceId,
}: {
  workspaceId: string
}) {
  const isAdmin = useIsPrivileged()
  const settings = useWhatsAppSettings(workspaceId, isAdmin)
  const update = useUpdateWhatsAppSettings(workspaceId)

  if (!isAdmin || !settings.data) return null
  const { marketingLiteEnabled, marketingLiteCloudFallback } = settings.data

  function save(patch: {
    marketingLiteEnabled?: boolean
    marketingLiteCloudFallback?: boolean
  }) {
    update.mutate(patch, {
      onSuccess: () => notify.success('Configuração salva'),
      onError: (error) => notify.error(error, 'Não foi possível salvar'),
    })
  }

  return (
    <div className='space-y-3 rounded-lg border p-4'>
      <div className='flex items-start justify-between gap-3'>
        <div>
          <Label htmlFor='marketingLiteEnabled'>
            Marketing Messages Lite (Meta)
          </Label>
          <p className='text-muted-foreground text-xs'>
            Envia os templates de categoria Marketing das conexões da API
            oficial pela API de marketing da Meta, com entrega otimizada e
            métricas de clique. Z-API e templates de outras categorias não
            mudam. Exige que a sua conta do WhatsApp Business tenha aceitado os
            termos de mensagens de marketing no Gerenciador da Meta.
          </p>
        </div>
        <Switch
          id='marketingLiteEnabled'
          checked={marketingLiteEnabled}
          disabled={update.isPending}
          onCheckedChange={(checked) => save({ marketingLiteEnabled: checked })}
        />
      </div>
      {marketingLiteEnabled ? (
        <div className='flex items-start justify-between gap-3 border-t pt-3'>
          <div>
            <Label htmlFor='marketingLiteCloudFallback'>
              Usar a API comum quando a Lite não entregar
            </Label>
            <p className='text-muted-foreground text-xs'>
              A Meta tenta a entrega pela Cloud API comum, pelo preço dela, em
              vez de deixar a mensagem sem envio.
            </p>
          </div>
          <Switch
            id='marketingLiteCloudFallback'
            checked={marketingLiteCloudFallback}
            disabled={update.isPending}
            onCheckedChange={(checked) =>
              save({ marketingLiteCloudFallback: checked })
            }
          />
        </div>
      ) : null}
    </div>
  )
}
