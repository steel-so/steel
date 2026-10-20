'use client'

import { Delete02Icon, PlusSignIcon } from '@hugeicons-pro/core-stroke-rounded'
import { type FormEvent, useEffect, useState } from 'react'
import { useIsPrivileged } from '@/app/_components/workspace/workspace-permissions'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { notify } from '@/lib/notify'
import {
  useArchiveWhatsAppCloseStatus,
  useCreateWhatsAppCloseStatus,
  useRefreshWhatsAppCloseStatuses,
  useUpdateWhatsAppCloseStatus,
  useWhatsAppCloseStatuses,
} from '@/src/hooks/use-whatsapp-close-statuses'
import { useUpdateWhatsAppSettings } from '@/src/hooks/use-whatsapp-settings'
import type { WhatsAppCloseOutcomeDTO } from '@/types/whatsapp-close-status'
import { CLOSE_OUTCOME_LABEL } from '../whatsapp-close-outcome-badge'

const LABEL_MAX = 80
const MAX_SELECTIONS = 10

const OUTCOME_OPTIONS = (
  Object.keys(CLOSE_OUTCOME_LABEL) as WhatsAppCloseOutcomeDTO[]
).map((value) => ({ value, label: CLOSE_OUTCOME_LABEL[value] }))

function OutcomeSelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string
  value: WhatsAppCloseOutcomeDTO
  onChange: (value: WhatsAppCloseOutcomeDTO) => void
  disabled?: boolean
}) {
  return (
    <Select
      items={OUTCOME_OPTIONS}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next) onChange(next as WhatsAppCloseOutcomeDTO)
      }}
    >
      <SelectTrigger id={id} className='w-40' aria-label='Resultado'>
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        <SelectGroup>
          {OUTCOME_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

/**
 * Status de fechamento (OWNER/ADMIN): as opções de classificação que o
 * atendente escolhe ao fechar uma conversa (deu certo ou não) e quantas ele
 * precisa escolher.
 */
export function WhatsappSettingsCloseStatuses({
  workspaceId,
}: {
  workspaceId: string
}) {
  const isAdmin = useIsPrivileged()
  const options = useWhatsAppCloseStatuses(workspaceId, isAdmin)
  const createStatus = useCreateWhatsAppCloseStatus(workspaceId)
  const updateStatus = useUpdateWhatsAppCloseStatus(workspaceId)
  const archiveStatus = useArchiveWhatsAppCloseStatus(workspaceId)
  const updateSettings = useUpdateWhatsAppSettings(workspaceId)
  const refreshOptions = useRefreshWhatsAppCloseStatuses(workspaceId)

  const [label, setLabel] = useState('')
  const [outcome, setOutcome] = useState<WhatsAppCloseOutcomeDTO>('SUCCESS')
  const [min, setMin] = useState('0')
  const [max, setMax] = useState('1')

  useEffect(() => {
    if (!options.data) return
    setMin(String(options.data.minSelections))
    setMax(String(options.data.maxSelections))
  }, [options.data])

  if (!isAdmin) return null

  const statuses = options.data?.statuses ?? []

  function handleCreate(event: FormEvent) {
    event.preventDefault()
    const trimmed = label.trim()
    if (!trimmed) return
    createStatus.mutate(
      { label: trimmed, outcome },
      {
        onSuccess: () => {
          setLabel('')
          notify.success('Status de fechamento criado')
        },
        onError: (error) =>
          notify.error(error, 'Não foi possível criar o status'),
      },
    )
  }

  function handleRules(event: FormEvent) {
    event.preventDefault()
    const minValue = Number(min)
    const maxValue = Number(max)
    if (
      !Number.isInteger(minValue) ||
      !Number.isInteger(maxValue) ||
      minValue < 0 ||
      maxValue < 1 ||
      maxValue > MAX_SELECTIONS ||
      minValue > maxValue
    ) {
      notify.error(
        `Use um mínimo de 0 a ${MAX_SELECTIONS} e um máximo de 1 a ${MAX_SELECTIONS}, com o mínimo até o máximo`,
      )
      return
    }
    updateSettings.mutate(
      {
        closeStatusMinSelections: minValue,
        closeStatusMaxSelections: maxValue,
      },
      {
        onSuccess: () => {
          refreshOptions()
          notify.success('Regras de fechamento salvas')
        },
        onError: (error) => notify.error(error, 'Não foi possível salvar'),
      },
    )
  }

  return (
    <section className='max-w-lg space-y-4'>
      <div>
        <h3 className='font-medium text-sm'>Status de fechamento</h3>
        <p className='text-muted-foreground text-xs'>
          Opções que o atendente escolhe ao fechar uma conversa, marcando se o
          atendimento deu certo ou não. Sem status cadastrados, a conversa fecha
          sem classificação.
        </p>
      </div>

      <ul className='divide-y rounded-md border'>
        {statuses.length === 0 ? (
          <li className='p-3 text-muted-foreground text-sm'>
            Nenhum status cadastrado.
          </li>
        ) : (
          statuses.map((status) => (
            <li key={status.id} className='flex items-center gap-2 p-2'>
              <span className='min-w-0 flex-1 truncate text-sm'>
                {status.label}
              </span>
              <OutcomeSelect
                id={`closeStatusOutcome-${status.id}`}
                value={status.outcome}
                disabled={updateStatus.isPending}
                onChange={(next) =>
                  updateStatus.mutate(
                    { id: status.id, outcome: next },
                    {
                      onError: (error) =>
                        notify.error(error, 'Não foi possível atualizar'),
                    },
                  )
                }
              />
              <Button
                type='button'
                variant='ghost'
                size='icon-sm'
                aria-label={`Remover ${status.label}`}
                disabled={archiveStatus.isPending}
                onClick={() =>
                  archiveStatus.mutate(status.id, {
                    onSuccess: () => notify.success('Status removido'),
                    onError: (error) =>
                      notify.error(error, 'Não foi possível remover'),
                  })
                }
              >
                <SteelIcon icon={Delete02Icon} size={14} />
              </Button>
            </li>
          ))
        )}
      </ul>

      <form onSubmit={handleCreate} className='flex items-end gap-2'>
        <div className='min-w-0 flex-1 space-y-1.5'>
          <Label htmlFor='closeStatusLabel'>Novo status</Label>
          <Input
            id='closeStatusLabel'
            maxLength={LABEL_MAX}
            placeholder='Ex.: Venda realizada'
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </div>
        <OutcomeSelect
          id='closeStatusOutcome'
          value={outcome}
          onChange={setOutcome}
        />
        <Button
          type='submit'
          variant='outline'
          disabled={createStatus.isPending || !label.trim()}
        >
          <SteelIcon icon={PlusSignIcon} size={14} />
          Adicionar
        </Button>
      </form>

      <form onSubmit={handleRules} className='space-y-2'>
        <p className='font-medium text-sm'>Quantos status escolher ao fechar</p>
        <div className='flex items-end gap-3'>
          <div className='space-y-1.5'>
            <Label htmlFor='closeStatusMin'>Mínimo</Label>
            <Input
              id='closeStatusMin'
              type='number'
              min={0}
              max={MAX_SELECTIONS}
              step={1}
              value={min}
              onChange={(event) => setMin(event.target.value)}
              className='w-24'
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='closeStatusMax'>Máximo</Label>
            <Input
              id='closeStatusMax'
              type='number'
              min={1}
              max={MAX_SELECTIONS}
              step={1}
              value={max}
              onChange={(event) => setMax(event.target.value)}
              className='w-24'
            />
          </div>
          <Button
            type='submit'
            variant='outline'
            disabled={updateSettings.isPending || options.isLoading}
          >
            Salvar regras
          </Button>
        </div>
        <p className='text-muted-foreground text-xs'>
          Mínimo 0 = classificação opcional. Com mínimo 1 ou mais, a conversa só
          fecha depois de escolher os status.
        </p>
      </form>
    </section>
  )
}
