'use client'

import { type FormEvent, useEffect, useState } from 'react'
import { useIsPrivileged } from '@/app/_components/workspace/workspace-permissions'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import {
  useUpdateWhatsAppBoletoSettings,
  useWhatsAppBoletoSettings,
} from '@/src/hooks/use-whatsapp-boleto'

/**
 * Boleto na conversa, só OWNER/ADMIN: liga o envio de boleto para os
 * atendentes. Desligado por padrão.
 */
export function WhatsappSettingsBoleto({
  workspaceId,
}: {
  workspaceId: string
}) {
  const isAdmin = useIsPrivileged()
  const settings = useWhatsAppBoletoSettings(workspaceId, isAdmin)
  const update = useUpdateWhatsAppBoletoSettings(workspaceId)
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    if (settings.data) setEnabled(settings.data.enabled)
  }, [settings.data])

  if (!isAdmin) return null

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    update.mutate(
      { enabled },
      {
        onSuccess: () => notify.success('Configuração do boleto salva'),
        onError: (error) => notify.error(error, 'Não foi possível salvar'),
      },
    )
  }

  return (
    <form onSubmit={handleSubmit} className='max-w-lg space-y-4'>
      <div className='flex items-center justify-between gap-3 rounded-md border p-3'>
        <div>
          <p className='font-medium text-sm'>Enviar boleto na conversa</p>
          <p className='text-muted-foreground text-xs'>
            Os atendentes enviam o boleto (linha digitável e link) pelo botão de
            boleto da conversa. Quando o pagamento chega, o boleto aparece como
            pago e a oportunidade do CRM ligada recebe uma anotação.
          </p>
        </div>
        <Switch
          aria-label='Enviar boleto na conversa'
          checked={enabled}
          onCheckedChange={setEnabled}
        />
      </div>

      {settings.data?.isTestProvider ? (
        <p className='rounded-md bg-muted px-3 py-2 text-muted-foreground text-xs'>
          O provedor de boleto ainda não foi contratado: os boletos usam um
          provedor de teste, que nenhum banco liquida.
        </p>
      ) : null}

      <Button type='submit' disabled={update.isPending || settings.isLoading}>
        {update.isPending ? 'Salvando...' : 'Salvar boleto'}
      </Button>
    </form>
  )
}
