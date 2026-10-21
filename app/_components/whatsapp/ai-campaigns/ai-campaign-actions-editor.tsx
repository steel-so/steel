'use client'

import { Delete02Icon, PlusSignIcon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Textarea } from '@/components/ui/textarea'
import { useCrmWorkflows } from '@/src/hooks/use-crm-workflow'
import { useWhatsAppCloseStatuses } from '@/src/hooks/use-whatsapp-close-statuses'
import { useWhatsAppAssignableMembers } from '@/src/hooks/use-whatsapp-conversations'
import { useWhatsAppTeams } from '@/src/hooks/use-whatsapp-teams'
import { AI_CAMPAIGN_ACTION_KIND_LABEL } from '@/src/lib/whatsapp/ai-campaign-actions'
import {
  AI_CAMPAIGN_ACTION_KINDS,
  type AiCampaignActionKind,
} from '@/src/schemas/whatsapp-ai-campaign.schema'
import { CLOSE_OUTCOME_LABEL } from '../whatsapp-close-outcome-badge'

/**
 * An action being edited: every config field is optional until saved (the
 * API validates the complete shape).
 */
export interface AiCampaignActionDraft {
  id: string
  kind: AiCampaignActionKind
  label: string
  when: string
  userId?: string
  teamId?: string
  statusIds?: string[]
  delayHours?: number
  workflowId?: string
  url?: string
  secret?: string
  fields?: { key: string; description: string }[]
}

export const AI_CAMPAIGN_ACTION_HINT: Record<AiCampaignActionKind, string> = {
  TRANSFER_USER: 'Tira a conversa da IA e entrega para um atendente.',
  TRANSFER_TEAM: 'Tira a conversa da IA e coloca na fila de uma equipe.',
  CLOSE: 'Encerra a conversa com os status de fechamento escolhidos.',
  OPT_OUT: 'O contato deixa de receber mensagens automáticas.',
  ADD_NOTE: 'A IA escreve uma anotação no cadastro do contato.',
  FOLLOW_UP:
    'Se o contato não responder, a IA volta a falar depois de X horas.',
  CRM_WORKFLOW: 'Dispara um workflow do CRM (criar lead, tarefa, etapa...).',
  WEBHOOK: 'Envia os dados para o seu sistema (POST assinado).',
}

export function newActionId(): string {
  return `a${Math.random().toString(36).slice(2, 10)}`
}

/** What is still missing before the action can be saved, or null. */
export function actionDraftProblem(
  action: AiCampaignActionDraft,
): string | null {
  if (!action.label.trim()) return 'Dê um nome para cada ação'
  if (!action.when.trim()) return `Diga quando a IA deve usar "${action.label}"`
  switch (action.kind) {
    case 'TRANSFER_USER':
      return action.userId ? null : `Escolha o atendente de "${action.label}"`
    case 'TRANSFER_TEAM':
      return action.teamId ? null : `Escolha a equipe de "${action.label}"`
    case 'FOLLOW_UP':
      return action.delayHours &&
        action.delayHours >= 1 &&
        action.delayHours <= 168
        ? null
        : `Use de 1 a 168 horas em "${action.label}"`
    case 'CRM_WORKFLOW':
      return action.workflowId
        ? null
        : `Escolha o workflow de "${action.label}"`
    case 'WEBHOOK':
      if (!action.url?.startsWith('https://')) {
        return `Informe uma URL https:// em "${action.label}"`
      }
      return (action.fields ?? []).every(
        (field) =>
          /^[a-z][a-z0-9_]{0,39}$/.test(field.key) && field.description.trim(),
      )
        ? null
        : `Revise os campos do webhook "${action.label}" (nome em minúsculas e descrição)`
    default:
      return null
  }
}

function PickerSelect({
  id,
  label,
  value,
  items,
  placeholder,
  onChange,
}: {
  id: string
  label: string
  value: string | undefined
  items: { value: string; label: string }[]
  placeholder: string
  onChange: (value: string) => void
}) {
  return (
    <div className='space-y-1.5'>
      <Label htmlFor={id}>{label}</Label>
      <Select
        items={items}
        value={value ?? null}
        onValueChange={(next) => {
          if (next) onChange(next as string)
        }}
      >
        <SelectTrigger id={id} className='w-full'>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectGroup>
            {items.length === 0 ? (
              <SelectItem value='' disabled>
                Nada para escolher
              </SelectItem>
            ) : (
              items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))
            )}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}

function ActionConfig({
  workspaceId,
  action,
  onChange,
}: {
  workspaceId: string
  action: AiCampaignActionDraft
  onChange: (patch: Partial<AiCampaignActionDraft>) => void
}) {
  const members = useWhatsAppAssignableMembers(workspaceId)
  const teams = useWhatsAppTeams(workspaceId)
  const statuses = useWhatsAppCloseStatuses(
    workspaceId,
    action.kind === 'CLOSE',
  )
  const workflows = useCrmWorkflows(
    action.kind === 'CRM_WORKFLOW' ? workspaceId : '',
  )

  switch (action.kind) {
    case 'TRANSFER_USER':
      return (
        <PickerSelect
          id={`action-${action.id}-user`}
          label='Atendente'
          value={action.userId}
          placeholder='Escolha quem recebe'
          items={(members.data ?? []).map((m) => ({
            value: m.id,
            label: m.name,
          }))}
          onChange={(userId) => onChange({ userId })}
        />
      )
    case 'TRANSFER_TEAM':
      return (
        <PickerSelect
          id={`action-${action.id}-team`}
          label='Equipe'
          value={action.teamId}
          placeholder='Escolha a equipe'
          items={(teams.data ?? []).map((t) => ({
            value: t.id,
            label: t.name,
          }))}
          onChange={(teamId) => onChange({ teamId })}
        />
      )
    case 'CLOSE': {
      const options = statuses.data?.statuses ?? []
      const selected = new Set(action.statusIds ?? [])
      return (
        <fieldset className='space-y-1.5'>
          <legend className='mb-1 font-medium text-sm'>
            Status de fechamento aplicados
          </legend>
          {options.length === 0 ? (
            <p className='text-muted-foreground text-xs'>
              Nenhum status cadastrado (Configurações › Atendimento): a conversa
              fecha sem classificação.
            </p>
          ) : (
            <div className='flex flex-wrap gap-2'>
              {options.map((status) => (
                <label
                  key={status.id}
                  htmlFor={`action-${action.id}-status-${status.id}`}
                  className='flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm'
                >
                  <Checkbox
                    id={`action-${action.id}-status-${status.id}`}
                    checked={selected.has(status.id)}
                    onCheckedChange={() => {
                      const next = new Set(selected)
                      if (next.has(status.id)) next.delete(status.id)
                      else next.add(status.id)
                      onChange({ statusIds: [...next] })
                    }}
                  />
                  {status.label}
                  <span className='text-muted-foreground text-xs'>
                    ({CLOSE_OUTCOME_LABEL[status.outcome].toLowerCase()})
                  </span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
      )
    }
    case 'FOLLOW_UP':
      return (
        <div className='space-y-1.5'>
          <Label htmlFor={`action-${action.id}-hours`}>
            Voltar a falar depois de (horas)
          </Label>
          <Input
            id={`action-${action.id}-hours`}
            type='number'
            min={1}
            max={168}
            className='w-32'
            value={action.delayHours ?? ''}
            onChange={(event) =>
              onChange({ delayHours: Number(event.target.value) || undefined })
            }
          />
        </div>
      )
    case 'CRM_WORKFLOW':
      return (
        <PickerSelect
          id={`action-${action.id}-workflow`}
          label='Workflow do CRM'
          value={action.workflowId}
          placeholder='Escolha o workflow'
          items={(workflows.data ?? [])
            .filter((w) => w.status === 'ACTIVE')
            .map((w) => ({ value: w.id, label: w.name }))}
          onChange={(workflowId) => onChange({ workflowId })}
        />
      )
    case 'WEBHOOK': {
      const fields = action.fields ?? []
      return (
        <div className='space-y-3'>
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-1.5'>
              <Label htmlFor={`action-${action.id}-url`}>URL (https)</Label>
              <Input
                id={`action-${action.id}-url`}
                placeholder='https://seu-sistema.com/webhook'
                value={action.url ?? ''}
                onChange={(event) => onChange({ url: event.target.value })}
              />
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor={`action-${action.id}-secret`}>
                Segredo para assinatura (opcional)
              </Label>
              <Input
                id={`action-${action.id}-secret`}
                type='password'
                value={action.secret ?? ''}
                onChange={(event) => onChange({ secret: event.target.value })}
              />
            </div>
          </div>
          <div className='space-y-1.5'>
            <p className='font-medium text-sm'>Campos que a IA preenche</p>
            {fields.map((field, index) => (
              <div key={`${action.id}-field-${index}`} className='flex gap-2'>
                <Input
                  aria-label='Nome do campo'
                  placeholder='cpf'
                  className='w-40'
                  value={field.key}
                  onChange={(event) =>
                    onChange({
                      fields: fields.map((f, i) =>
                        i === index ? { ...f, key: event.target.value } : f,
                      ),
                    })
                  }
                />
                <Input
                  aria-label='O que a IA deve preencher'
                  placeholder='O CPF informado pelo cliente'
                  value={field.description}
                  onChange={(event) =>
                    onChange({
                      fields: fields.map((f, i) =>
                        i === index
                          ? { ...f, description: event.target.value }
                          : f,
                      ),
                    })
                  }
                />
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-sm'
                  aria-label='Remover campo'
                  onClick={() =>
                    onChange({ fields: fields.filter((_, i) => i !== index) })
                  }
                >
                  <SteelIcon icon={Delete02Icon} size={14} />
                </Button>
              </div>
            ))}
            <Button
              type='button'
              size='xs'
              variant='outline'
              disabled={fields.length >= 10}
              onClick={() =>
                onChange({ fields: [...fields, { key: '', description: '' }] })
              }
            >
              <SteelIcon icon={PlusSignIcon} size={12} />
              Adicionar campo
            </Button>
          </div>
        </div>
      )
    }
    default:
      return null
  }
}

const KIND_ITEMS = AI_CAMPAIGN_ACTION_KINDS.map((kind) => ({
  value: kind,
  label: AI_CAMPAIGN_ACTION_KIND_LABEL[kind],
}))

export function AiCampaignActionsEditor({
  workspaceId,
  actions,
  onChange,
}: {
  workspaceId: string
  actions: AiCampaignActionDraft[]
  onChange: (actions: AiCampaignActionDraft[]) => void
}) {
  function patch(id: string, change: Partial<AiCampaignActionDraft>) {
    onChange(
      actions.map((action) =>
        action.id === id ? { ...action, ...change } : action,
      ),
    )
  }

  function add(kind: AiCampaignActionKind) {
    onChange([
      ...actions,
      {
        id: newActionId(),
        kind,
        label: AI_CAMPAIGN_ACTION_KIND_LABEL[kind],
        when: '',
        ...(kind === 'FOLLOW_UP' ? { delayHours: 24 } : {}),
        ...(kind === 'CLOSE' ? { statusIds: [] } : {}),
        ...(kind === 'WEBHOOK' ? { fields: [] } : {}),
      },
    ])
  }

  return (
    <div className='space-y-3'>
      {actions.length === 0 ? (
        <p className='rounded-lg border border-dashed p-4 text-center text-muted-foreground text-sm'>
          Nenhuma ação: a IA só conversa (e transfere para um humano quando não
          souber ajudar).
        </p>
      ) : null}

      {actions.map((action, index) => (
        <article
          key={action.id}
          className='space-y-3 rounded-lg border bg-card p-4'
        >
          <header className='flex items-start justify-between gap-2'>
            <div>
              <p className='font-medium text-muted-foreground text-xs uppercase tracking-wide'>
                Ação {index + 1} · {AI_CAMPAIGN_ACTION_KIND_LABEL[action.kind]}
              </p>
              <p className='text-muted-foreground text-xs'>
                {AI_CAMPAIGN_ACTION_HINT[action.kind]}
              </p>
            </div>
            <Button
              type='button'
              variant='ghost'
              size='icon-sm'
              aria-label={`Remover ação ${action.label || index + 1}`}
              onClick={() =>
                onChange(actions.filter((a) => a.id !== action.id))
              }
            >
              <SteelIcon icon={Delete02Icon} size={14} />
            </Button>
          </header>

          <div className='grid gap-3 sm:grid-cols-[1fr_2fr]'>
            <div className='space-y-1.5'>
              <Label htmlFor={`action-${action.id}-label`}>Nome</Label>
              <Input
                id={`action-${action.id}-label`}
                maxLength={80}
                value={action.label}
                onChange={(event) =>
                  patch(action.id, { label: event.target.value })
                }
              />
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor={`action-${action.id}-when`}>
                Quando a IA deve usar
              </Label>
              <Textarea
                id={`action-${action.id}-when`}
                rows={2}
                maxLength={1000}
                placeholder='Ex.: o cliente disse que já pagou'
                value={action.when}
                onChange={(event) =>
                  patch(action.id, { when: event.target.value })
                }
              />
            </div>
          </div>

          <ActionConfig
            workspaceId={workspaceId}
            action={action}
            onChange={(change) => patch(action.id, change)}
          />
        </article>
      ))}

      <div className='flex items-center gap-2'>
        <Select
          items={KIND_ITEMS}
          value={null}
          onValueChange={(kind) => {
            if (kind) add(kind as AiCampaignActionKind)
          }}
        >
          <SelectTrigger
            aria-label='Adicionar ação'
            className='w-64'
            disabled={actions.length >= 15}
          >
            <span className='flex items-center gap-1.5'>
              <SteelIcon icon={PlusSignIcon} size={14} />
              Adicionar ação
            </span>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {KIND_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <span className='text-muted-foreground text-xs'>
          {actions.length}/15 ações
        </span>
      </div>
    </div>
  )
}
