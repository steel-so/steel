'use client'

import { Delete02Icon, PlusSignIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useEffect, useState } from 'react'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { useQaConfig, useUpdateQaConfig } from '@/src/hooks/use-qa-review'
import type { QaConfigDTO, QaCriterionDTO } from '@/types/qa-review'

const MAX_CRITERIA = 12

const SCOPE_LABEL: Record<QaCriterionDTO['appliesTo'], string> = {
  BOTH: 'Zap e chamados',
  CONVERSATION: 'Só zap',
  TICKET: 'Só chamados',
}

function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

function SwitchRow({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string
  label: string
  hint?: string
  checked: boolean
  disabled: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className='flex items-start justify-between gap-4'>
      <div className='space-y-0.5'>
        <Label htmlFor={id}>{label}</Label>
        {hint ? (
          <p className='text-muted-foreground text-xs'>{hint}</p>
        ) : null}
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  )
}

function CriterionRow({
  criterion,
  canEdit,
  onChange,
  onRemove,
}: {
  criterion: QaCriterionDTO
  canEdit: boolean
  onChange: (patch: Partial<QaCriterionDTO>) => void
  onRemove: () => void
}) {
  return (
    <li className='space-y-2 rounded-xl border bg-card px-4 py-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <Input
          aria-label='Nome do critério'
          className='min-w-40 flex-1'
          value={criterion.name}
          disabled={!canEdit}
          maxLength={60}
          onChange={(event) => onChange({ name: event.target.value })}
        />
        <Input
          aria-label='Peso do critério'
          className='w-20'
          type='number'
          min={1}
          max={10}
          value={criterion.weight}
          disabled={!canEdit}
          onChange={(event) =>
            onChange({
              weight: Math.min(10, Math.max(1, Number(event.target.value) || 1)),
            })
          }
        />
        <Select
          value={criterion.appliesTo}
          disabled={!canEdit}
          onValueChange={(value) =>
            value && onChange({ appliesTo: value as QaCriterionDTO['appliesTo'] })
          }
        >
          <SelectTrigger className='w-40' aria-label='Onde vale'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {(Object.keys(SCOPE_LABEL) as QaCriterionDTO['appliesTo'][]).map(
                (key) => (
                  <SelectItem key={key} value={key}>
                    {SCOPE_LABEL[key]}
                  </SelectItem>
                ),
              )}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Switch
          aria-label='Critério ativo'
          checked={criterion.active}
          disabled={!canEdit}
          onCheckedChange={(active) => onChange({ active })}
        />
        {canEdit ? (
          <Button
            variant='ghost'
            size='icon'
            aria-label='Remover critério'
            onClick={onRemove}
          >
            <SteelIcon icon={Delete02Icon} strokeWidth={2} />
          </Button>
        ) : null}
      </div>
      <Textarea
        aria-label='O que avaliar'
        value={criterion.description}
        disabled={!canEdit}
        rows={2}
        maxLength={500}
        onChange={(event) => onChange({ description: event.target.value })}
      />
    </li>
  )
}

/** Switches, limits and the editable list of criteria. */
export function QaSettings({
  workspaceId,
  canEdit,
}: {
  workspaceId: string
  canEdit: boolean
}) {
  const config = useQaConfig(workspaceId)
  const update = useUpdateQaConfig(workspaceId)
  const [draft, setDraft] = useState<QaConfigDTO | null>(null)
  useEffect(() => setDraft(config.data ?? null), [config.data])

  if (config.isLoading || !draft) {
    return config.isError ? (
      <p className='text-destructive text-sm'>
        Não foi possível carregar a configuração.
      </p>
    ) : (
      <Skeleton className='h-64 w-full' />
    )
  }

  const set = <K extends keyof QaConfigDTO>(key: K, value: QaConfigDTO[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d))
  const setCriterion = (index: number, patch: Partial<QaCriterionDTO>) =>
    set(
      'criteria',
      draft.criteria.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    )
  const addCriterion = () => {
    const name = `Critério ${draft.criteria.length + 1}`
    set('criteria', [
      ...draft.criteria,
      {
        key: `${slugify(name)}-${Date.now().toString(36).slice(-4)}`,
        name,
        description: 'Descreva o que o avaliador deve procurar na conversa.',
        weight: 1,
        appliesTo: 'BOTH',
        active: true,
        position: draft.criteria.length,
      },
    ])
  }

  const save = () =>
    update.mutate(
      {
        enabled: draft.enabled,
        reviewConversations: draft.reviewConversations,
        reviewTickets: draft.reviewTickets,
        includeBots: draft.includeBots,
        minMessages: Math.max(1, draft.minMessages),
        lowScoreThreshold: Math.min(100, Math.max(1, draft.lowScoreThreshold)),
        alertLowScore: draft.alertLowScore,
        criteria: draft.criteria.map(({ position: _position, ...rest }) => rest),
      },
      {
        onSuccess: () => notify.success('Configuração do QA salva'),
        onError: (error) => notify.error(error.message),
      },
    )

  const hasActive = draft.criteria.some((c) => c.active)

  return (
    <div className='space-y-6'>
      <section className='space-y-4 rounded-xl border bg-card px-4 py-4'>
        <SwitchRow
          id='qa-enabled'
          label='Avaliar os atendimentos automaticamente'
          hint='Cada conversa encerrada e cada chamado resolvido ganha uma nota. O custo entra na cota mensal de IA.'
          checked={draft.enabled}
          disabled={!canEdit}
          onChange={(value) => set('enabled', value)}
        />
        <SwitchRow
          id='qa-conversations'
          label='Conversas do zap'
          checked={draft.reviewConversations}
          disabled={!canEdit}
          onChange={(value) => set('reviewConversations', value)}
        />
        <SwitchRow
          id='qa-tickets'
          label='Chamados do ServiceDesk'
          checked={draft.reviewTickets}
          disabled={!canEdit}
          onChange={(value) => set('reviewTickets', value)}
        />
        <SwitchRow
          id='qa-bots'
          label='Incluir atendimentos só do bot'
          hint='Avalia também o que o chatbot e a resposta automática atenderam sozinhos.'
          checked={draft.includeBots}
          disabled={!canEdit}
          onChange={(value) => set('includeBots', value)}
        />
        <SwitchRow
          id='qa-alert'
          label='Avisar os gestores de notas baixas'
          checked={draft.alertLowScore}
          disabled={!canEdit}
          onChange={(value) => set('alertLowScore', value)}
        />
        <div className='grid gap-4 sm:grid-cols-2'>
          <div className='space-y-1.5'>
            <Label htmlFor='qa-threshold'>Nota baixa abaixo de</Label>
            <Input
              id='qa-threshold'
              type='number'
              min={1}
              max={100}
              value={draft.lowScoreThreshold}
              disabled={!canEdit}
              onChange={(event) =>
                set('lowScoreThreshold', Number(event.target.value) || 1)
              }
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='qa-min-messages'>
              Mínimo de mensagens para avaliar
            </Label>
            <Input
              id='qa-min-messages'
              type='number'
              min={1}
              max={50}
              value={draft.minMessages}
              disabled={!canEdit}
              onChange={(event) =>
                set('minMessages', Number(event.target.value) || 1)
              }
            />
          </div>
        </div>
      </section>

      <section className='space-y-3'>
        <div className='flex items-center justify-between gap-2'>
          <div>
            <h2 className='font-medium text-sm'>Critérios</h2>
            <p className='text-muted-foreground text-xs'>
              A nota final é a média dos critérios ativos, ponderada pelo peso.
            </p>
          </div>
          {canEdit ? (
            <Button
              variant='outline'
              size='sm'
              disabled={draft.criteria.length >= MAX_CRITERIA}
              onClick={addCriterion}
            >
              <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
              Novo critério
            </Button>
          ) : null}
        </div>
        <ul className='grid gap-3'>
          {draft.criteria.map((criterion, index) => (
            <CriterionRow
              key={criterion.key}
              criterion={criterion}
              canEdit={canEdit}
              onChange={(patch) => setCriterion(index, patch)}
              onRemove={() =>
                set(
                  'criteria',
                  draft.criteria.filter((_, i) => i !== index),
                )
              }
            />
          ))}
        </ul>
        {!hasActive ? (
          <p className='text-destructive text-xs'>
            Mantenha ao menos um critério ativo.
          </p>
        ) : null}
      </section>

      {canEdit ? (
        <div className='flex justify-end'>
          <Button onClick={save} disabled={update.isPending || !hasActive}>
            {update.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      ) : (
        <p className='text-muted-foreground text-xs'>
          Só o dono e os administradores alteram a configuração.
        </p>
      )}
    </div>
  )
}
