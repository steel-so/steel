'use client'

import { type FormEvent, useEffect, useState } from 'react'
import { useIsPrivileged } from '@/app/_components/workspace/workspace-permissions'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import {
  useUpdateWhatsAppPixSettings,
  useWhatsAppPixSettings,
} from '@/src/hooks/use-whatsapp-pix'
import { PIX_EXPIRY_OPTIONS } from '@/src/lib/whatsapp/pix-amount'

/**
 * Pix na conversa (Z1), só OWNER/ADMIN: liga a cobrança Pix para os
 * atendentes e para as campanhas de IA e define a validade padrão.
 */
export function WhatsappSettingsPix({ workspaceId }: { workspaceId: string }) {
  const isAdmin = useIsPrivileged()
  const settings = useWhatsAppPixSettings(workspaceId, isAdmin)
  const update = useUpdateWhatsAppPixSettings(workspaceId)

  const [enabled, setEnabled] = useState(false)
  const [minutes, setMinutes] = useState(60)

  useEffect(() => {
    const data = settings.data
    if (!data) return
    setEnabled(data.enabled)
    setMinutes(data.defaultExpiresMinutes)
  }, [settings.data])

  if (!isAdmin) return null

  const items = PIX_EXPIRY_OPTIONS.some((option) => option.minutes === minutes)
    ? PIX_EXPIRY_OPTIONS.map((option) => ({
        value: String(option.minutes),
        label: option.label,
      }))
    : [
        { value: String(minutes), label: `${minutes} minutos` },
        ...PIX_EXPIRY_OPTIONS.map((option) => ({
          value: String(option.minutes),
          label: option.label,
        })),
      ]

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    update.mutate(
      { enabled, defaultExpiresMinutes: minutes },
      {
        onSuccess: () => notify.success('Configuração do Pix salva'),
        onError: (error) => notify.error(error, 'Não foi possível salvar'),
      },
    )
  }

  return (
    <form onSubmit={handleSubmit} className='max-w-lg space-y-4'>
      <div className='flex items-center justify-between gap-3 rounded-md border p-3'>
        <div>
          <p className='font-medium text-sm'>Cobrar via Pix na conversa</p>
          <p className='text-muted-foreground text-xs'>
            Os atendentes enviam o Pix "copia e cola" pelo botão de cobrança da
            conversa, e as campanhas de IA podem ter a ação "Enviar cobrança
            Pix". Quando o pagamento chega, a conversa mostra o aviso e a
            oportunidade do CRM ligada recebe uma anotação.
          </p>
        </div>
        <Switch
          aria-label='Cobrar via Pix na conversa'
          checked={enabled}
          onCheckedChange={setEnabled}
        />
      </div>

      {settings.data?.isTestProvider ? (
        <p className='rounded-md bg-muted px-3 py-2 text-muted-foreground text-xs'>
          O provedor de Pix ainda não foi contratado: as cobranças usam um
          provedor de teste, cujo código nenhum banco liquida. Dá para
          experimentar o fluxo todo simulando o pagamento na própria cobrança.
        </p>
      ) : null}

      {enabled ? (
        <div className='space-y-1.5'>
          <Label htmlFor='pixDefaultExpiry'>Validade padrão da cobrança</Label>
          <Select
            items={items}
            value={String(minutes)}
            onValueChange={(next) => {
              if (next) setMinutes(Number(next))
            }}
          >
            <SelectTrigger id='pixDefaultExpiry' className='w-48'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {items.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <p className='text-muted-foreground text-xs'>
            O atendente pode escolher outra validade em cada cobrança.
          </p>
        </div>
      ) : null}

      <Button type='submit' disabled={update.isPending || settings.isLoading}>
        {update.isPending ? 'Salvando...' : 'Salvar Pix'}
      </Button>
    </form>
  )
}
