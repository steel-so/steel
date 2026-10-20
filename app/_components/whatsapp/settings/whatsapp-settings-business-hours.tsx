'use client'

import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useState } from 'react'
import { useIsPrivileged } from '@/app/_components/workspace/workspace-permissions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import { WHATSAPP_BUSINESS_HOURS_KEY } from '@/src/hooks/use-whatsapp-business-hours'
import {
  useUpdateWhatsAppSettings,
  useWhatsAppSettings,
} from '@/src/hooks/use-whatsapp-settings'

const WEEKDAYS = [
  { value: 1, label: 'Seg' },
  { value: 2, label: 'Ter' },
  { value: 3, label: 'Qua' },
  { value: 4, label: 'Qui' },
  { value: 5, label: 'Sex' },
  { value: 6, label: 'Sáb' },
  { value: 0, label: 'Dom' },
]

/**
 * Horário de atendimento (OWNER/ADMIN): fora dele os envios de atendentes,
 * da IA e do disparo automático ficam travados.
 */
export function WhatsappSettingsBusinessHours({
  workspaceId,
}: {
  workspaceId: string
}) {
  const isAdmin = useIsPrivileged()
  const settings = useWhatsAppSettings(workspaceId, isAdmin)
  const update = useUpdateWhatsAppSettings(workspaceId)
  const queryClient = useQueryClient()

  const [enabled, setEnabled] = useState(false)
  const [start, setStart] = useState('08:00')
  const [end, setEnd] = useState('18:00')
  const [days, setDays] = useState<Set<number>>(new Set([1, 2, 3, 4, 5]))

  useEffect(() => {
    const data = settings.data
    if (!data) return
    setEnabled(data.businessHoursEnabled)
    setStart(data.businessHoursStart)
    setEnd(data.businessHoursEnd)
    setDays(new Set(data.businessHoursDays))
  }, [settings.data])

  if (!isAdmin) return null

  function toggleDay(day: number) {
    setDays((current) => {
      const next = new Set(current)
      if (next.has(day)) next.delete(day)
      else next.add(day)
      return next
    })
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (start === end) {
      notify.error('O início e o fim do horário devem ser diferentes')
      return
    }
    if (enabled && days.size === 0) {
      notify.error('Escolha ao menos um dia de atendimento')
      return
    }
    update.mutate(
      {
        businessHoursEnabled: enabled,
        businessHoursStart: start,
        businessHoursEnd: end,
        businessHoursDays: Array.from(days),
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: WHATSAPP_BUSINESS_HOURS_KEY(workspaceId),
          })
          notify.success('Horário de atendimento salvo')
        },
        onError: (error) => notify.error(error, 'Não foi possível salvar'),
      },
    )
  }

  return (
    <form onSubmit={handleSubmit} className='max-w-lg space-y-4'>
      <div className='flex items-center justify-between gap-3 rounded-md border p-3'>
        <div>
          <p className='font-medium text-sm'>Horário de atendimento</p>
          <p className='text-muted-foreground text-xs'>
            Fora deste horário ninguém envia mensagens: atendentes, IA e disparo
            automático ficam travados. A IA responde e o disparo continua quando
            o horário abrir. Horário de Brasília.
          </p>
        </div>
        <Switch
          aria-label='Horário de atendimento'
          checked={enabled}
          onCheckedChange={setEnabled}
        />
      </div>

      {enabled ? (
        <div className='space-y-4'>
          <div className='flex items-end gap-3'>
            <div className='space-y-1.5'>
              <Label htmlFor='businessHoursStart'>Início</Label>
              <Input
                id='businessHoursStart'
                type='time'
                required
                value={start}
                onChange={(event) => setStart(event.target.value)}
                className='w-32'
              />
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='businessHoursEnd'>Fim</Label>
              <Input
                id='businessHoursEnd'
                type='time'
                required
                value={end}
                onChange={(event) => setEnd(event.target.value)}
                className='w-32'
              />
            </div>
          </div>
          <fieldset className='space-y-1.5'>
            <legend className='mb-1 font-medium text-sm'>Dias</legend>
            <div className='flex flex-wrap gap-1.5'>
              {WEEKDAYS.map((day) => (
                <Button
                  key={day.value}
                  type='button'
                  size='xs'
                  variant={days.has(day.value) ? 'default' : 'outline'}
                  aria-pressed={days.has(day.value)}
                  onClick={() => toggleDay(day.value)}
                >
                  {day.label}
                </Button>
              ))}
            </div>
            <p className='text-muted-foreground text-xs'>
              Fim antes do início = janela que atravessa a meia-noite.
            </p>
          </fieldset>
        </div>
      ) : null}

      <Button type='submit' disabled={update.isPending || settings.isLoading}>
        {update.isPending ? 'Salvando...' : 'Salvar horário'}
      </Button>
    </form>
  )
}
