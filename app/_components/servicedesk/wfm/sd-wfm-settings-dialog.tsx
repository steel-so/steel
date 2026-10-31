'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { notify } from '@/lib/notify'
import { useUpdateSdWfmSettings } from '@/src/hooks/use-sd-wfm'
import type { SdWfmSettingsDTO } from '@/types/sd-wfm'
import { FieldBlock } from '../settings/sd-settings-kit'

/** Ajustes da previsão: produtividade, ocupação alvo, mínimo e turnos. */
export function SdWfmSettingsDialog({
  workspaceId,
  settings,
  onClose,
}: {
  workspaceId: string
  settings: SdWfmSettingsDTO
  onClose: () => void
}) {
  const update = useUpdateSdWfmSettings(workspaceId)
  const [draft, setDraft] = useState(settings)

  const setNumber =
    (key: keyof Omit<SdWfmSettingsDTO, 'shifts'>) => (value: string) =>
      setDraft((d) => ({ ...d, [key]: Number(value) }))
  const setShift = (
    index: number,
    key: 'name' | 'startHour' | 'endHour',
    value: string,
  ) =>
    setDraft((d) => ({
      ...d,
      shifts: d.shifts.map((s, i) =>
        i === index
          ? { ...s, [key]: key === 'name' ? value : Number(value) }
          : s,
      ),
    }))

  function save() {
    update.mutate(draft, {
      onSuccess: () => {
        notify.success('Ajustes salvos')
        onClose()
      },
      onError: (error) => notify.error(error.message),
    })
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className='sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>Ajustes da previsão</DialogTitle>
          <DialogDescription>
            A previsão usa o histórico de chamados; estes valores definem
            quantos atendentes cada volume exige.
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-4 sm:grid-cols-2'>
          <FieldBlock label='Semanas de histórico' hint='De 2 a 26.'>
            <Input
              type='number'
              min={2}
              max={26}
              value={draft.historyWeeks}
              onChange={(e) => setNumber('historyWeeks')(e.target.value)}
            />
          </FieldBlock>
          <FieldBlock
            label='Chamados por atendente por hora'
            hint='Quanto um atendente resolve numa hora de trabalho.'
          >
            <Input
              type='number'
              min={0.1}
              step={0.1}
              value={draft.ticketsPerAgentHour}
              onChange={(e) => setNumber('ticketsPerAgentHour')(e.target.value)}
            />
          </FieldBlock>
          <FieldBlock
            label='Ocupação alvo (%)'
            hint='O restante é folga para picos, pausas e reuniões.'
          >
            <Input
              type='number'
              min={10}
              max={100}
              value={draft.targetOccupancyPercent}
              onChange={(e) =>
                setNumber('targetOccupancyPercent')(e.target.value)
              }
            />
          </FieldBlock>
          <FieldBlock label='Mínimo de agentes por turno'>
            <Input
              type='number'
              min={0}
              max={50}
              value={draft.minAgentsPerShift}
              onChange={(e) => setNumber('minAgentsPerShift')(e.target.value)}
            />
          </FieldBlock>
        </div>
        <div className='flex flex-col gap-2'>
          <span className='font-medium text-muted-foreground text-xs'>
            Turnos (hora local; um turno que termina antes de começar vira a
            meia-noite)
          </span>
          {draft.shifts.map((shift, index) => (
            <div key={index} className='flex items-center gap-2'>
              <Input
                aria-label={`Nome do turno ${index + 1}`}
                value={shift.name}
                onChange={(e) => setShift(index, 'name', e.target.value)}
              />
              <Input
                aria-label={`Início do turno ${index + 1}`}
                type='number'
                min={0}
                max={23}
                className='w-20'
                value={shift.startHour}
                onChange={(e) => setShift(index, 'startHour', e.target.value)}
              />
              <Input
                aria-label={`Fim do turno ${index + 1}`}
                type='number'
                min={1}
                max={24}
                className='w-20'
                value={shift.endHour}
                onChange={(e) => setShift(index, 'endHour', e.target.value)}
              />
              <Button
                variant='ghost'
                size='sm'
                disabled={draft.shifts.length <= 1}
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    shifts: d.shifts.filter((_, i) => i !== index),
                  }))
                }
              >
                Remover
              </Button>
            </div>
          ))}
          {draft.shifts.length < 6 ? (
            <Button
              variant='outline'
              size='sm'
              className='self-start'
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  shifts: [
                    ...d.shifts,
                    {
                      name: `Turno ${d.shifts.length + 1}`,
                      startHour: 22,
                      endHour: 6,
                    },
                  ],
                }))
              }
            >
              Adicionar turno
            </Button>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={update.isPending}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
