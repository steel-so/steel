'use client'

import { type FormEvent, useEffect, useState } from 'react'
import { useIsPrivileged } from '@/app/_components/workspace/workspace-permissions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { notify } from '@/lib/notify'
import {
  useUpdateWhatsAppSettings,
  useWhatsAppSettings,
} from '@/src/hooks/use-whatsapp-settings'

/**
 * Validade da checagem "tem WhatsApp?" (OWNER/ADMIN): por quantos dias o
 * resultado de um contato é reaproveitado antes de consultar a Z-API de novo.
 */
export function WhatsappSettingsNumberCheck({
  workspaceId,
}: {
  workspaceId: string
}) {
  const isAdmin = useIsPrivileged()
  const settings = useWhatsAppSettings(workspaceId, isAdmin)
  const update = useUpdateWhatsAppSettings(workspaceId)
  const [days, setDays] = useState(30)

  useEffect(() => {
    if (settings.data) setDays(settings.data.whatsappCheckTtlDays)
  }, [settings.data])

  if (!isAdmin) return null

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      notify.error('Informe de 1 a 365 dias')
      return
    }
    update.mutate(
      { whatsappCheckTtlDays: days },
      {
        onSuccess: () => notify.success('Validade da checagem salva'),
        onError: (error) => notify.error(error, 'Não foi possível salvar'),
      },
    )
  }

  return (
    <form onSubmit={handleSubmit} className='max-w-lg space-y-3'>
      <div>
        <p className='font-medium text-sm'>Checagem "tem WhatsApp?"</p>
        <p className='text-muted-foreground text-xs'>
          Ao validar uma base pela conexão Z-API, o resultado fica salvo no
          contato e é reaproveitado por este prazo. Depois dele, o contato é
          consultado de novo na próxima validação.
        </p>
      </div>
      <div className='space-y-1.5'>
        <Label htmlFor='whatsappCheckTtlDays'>
          Validade do resultado (dias)
        </Label>
        <Input
          id='whatsappCheckTtlDays'
          type='number'
          min={1}
          max={365}
          required
          value={days}
          onChange={(event) => setDays(Number(event.target.value))}
          className='w-32'
        />
      </div>
      <Button type='submit' disabled={update.isPending || settings.isLoading}>
        {update.isPending ? 'Salvando...' : 'Salvar validade'}
      </Button>
    </form>
  )
}
