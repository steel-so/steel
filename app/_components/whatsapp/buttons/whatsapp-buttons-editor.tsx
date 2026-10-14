'use client'

import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  ArrowUpRight01Icon,
  Delete02Icon,
  Link01Icon,
  PlusSignIcon,
  TouchInteraction01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useQuery } from '@tanstack/react-query'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { cn } from '@/lib/utils'
import { apiFetch } from '@/src/hooks/_fetch'
import { useCrmWorkflows } from '@/src/hooks/use-crm-workflow'
import { useWhatsAppAssignableMembers } from '@/src/hooks/use-whatsapp-conversations'
import {
  BUTTON_ACTION_OPTIONS,
  buttonActionLabel,
  changeButtonType,
  emptyButtonAction,
  moveItem,
  newButton,
  WHATSAPP_BUTTON_ACTIONS_MAX,
  WHATSAPP_BUTTON_LABEL_MAX,
  WHATSAPP_BUTTONS_MAX,
} from '@/src/lib/whatsapp/button-editor'
import type {
  WhatsAppButtonAction,
  WhatsAppButtonDTO,
} from '@/types/whatsapp-button'
import type { WhatsAppTeamDTO } from '@/types/whatsapp-team'

/** Teams for the "move to team" picker. The teams slice owns
 * `use-whatsapp-teams.ts`; this read shares its query key so both stay in
 * sync, and a missing endpoint just reads as "no teams yet". */
function useTeamsForPicker(workspaceId: string) {
  return useQuery({
    queryKey: ['whatsapp-teams', workspaceId],
    queryFn: () =>
      apiFetch<WhatsAppTeamDTO[]>(
        `/api/workspaces/${workspaceId}/whatsapp/teams`,
        undefined,
        'Erro ao buscar equipes',
      ),
    staleTime: 60 * 1000,
    retry: false,
  })
}

export function WhatsappButtonsEditor({
  workspaceId,
  value,
  onChange,
  lockStructure = false,
}: {
  workspaceId: string
  value: WhatsAppButtonDTO[]
  onChange: (buttons: WhatsAppButtonDTO[]) => void
  /** Approved template: labels, types and links are fixed by Meta — only the
   * click actions can change. */
  lockStructure?: boolean
}) {
  const canAdd = !lockStructure && value.length < WHATSAPP_BUTTONS_MAX

  function update(index: number, button: WhatsAppButtonDTO) {
    onChange(value.map((current, i) => (i === index ? button : current)))
  }

  return (
    <div className='space-y-2'>
      <div className='flex items-center justify-between gap-2'>
        <div className='flex items-center gap-2'>
          <Label>Botões</Label>
          <span className='text-muted-foreground text-xs tabular-nums'>
            {value.length}/{WHATSAPP_BUTTONS_MAX}
          </span>
        </div>
        {canAdd ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button type='button' variant='outline' size='xs'>
                  <SteelIcon icon={PlusSignIcon} size={14} />
                  Adicionar botão
                </Button>
              }
            />
            <DropdownMenuContent align='end' className='w-64'>
              <DropdownMenuItem
                onClick={() => onChange([...value, newButton('REPLY', value)])}
              >
                <SteelIcon icon={TouchInteraction01Icon} size={16} />
                <div className='flex flex-col'>
                  <span>Resposta</span>
                  <span className='text-muted-foreground text-xs'>
                    Dispara ações quando o contato clica
                  </span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onChange([...value, newButton('URL', value)])}
              >
                <SteelIcon icon={Link01Icon} size={16} />
                <div className='flex flex-col'>
                  <span>Link</span>
                  <span className='text-muted-foreground text-xs'>
                    Abre um endereço no navegador
                  </span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {value.length === 0 ? (
        <p className='rounded-lg border border-dashed px-3 py-4 text-center text-muted-foreground text-xs'>
          {lockStructure
            ? 'Este template não tem botões de resposta.'
            : `Sem botões. Adicione até ${WHATSAPP_BUTTONS_MAX}: resposta (com ações ao clicar) ou link.`}
        </p>
      ) : null}

      {value.map((button, index) => (
        <ButtonCard
          key={button.id}
          workspaceId={workspaceId}
          index={index}
          button={button}
          lockStructure={lockStructure}
          onChange={(next) => update(index, next)}
          onRemove={() => onChange(value.filter((_, i) => i !== index))}
        />
      ))}
    </div>
  )
}

function ButtonCard({
  workspaceId,
  index,
  button,
  lockStructure,
  onChange,
  onRemove,
}: {
  workspaceId: string
  index: number
  button: WhatsAppButtonDTO
  lockStructure: boolean
  onChange: (button: WhatsAppButtonDTO) => void
  onRemove: () => void
}) {
  const position = index + 1
  const labelLength = button.label.length

  return (
    <section
      aria-label={`Botão ${position}`}
      className='space-y-3 rounded-lg border bg-card p-3'
    >
      <div className='flex flex-wrap items-center gap-2'>
        <span className='flex size-6 shrink-0 items-center justify-center rounded-md bg-muted font-medium text-muted-foreground text-xs'>
          {position}
        </span>
        {lockStructure ? (
          <>
            <span className='min-w-0 flex-1 truncate font-medium text-sm'>
              {button.label}
            </span>
            <Badge variant='secondary'>
              {button.type === 'URL' ? 'Link' : 'Resposta'}
            </Badge>
          </>
        ) : (
          <>
            <Select
              value={button.type}
              onValueChange={(type) =>
                type && onChange(changeButtonType(button, type))
              }
            >
              <SelectTrigger
                size='sm'
                className='w-32'
                aria-label={`Tipo do botão ${position}`}
              >
                <SelectValue>
                  {(type: WhatsAppButtonDTO['type']) =>
                    type === 'URL' ? 'Link' : 'Resposta'
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  <SelectItem value='REPLY'>Resposta</SelectItem>
                  <SelectItem value='URL'>Link</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <div className='relative min-w-32 flex-1'>
              <Input
                value={button.label}
                maxLength={WHATSAPP_BUTTON_LABEL_MAX}
                onChange={(event) =>
                  onChange({ ...button, label: event.target.value })
                }
                placeholder={
                  button.type === 'URL' ? 'Ver detalhes' : 'Confirmar'
                }
                aria-label={`Texto do botão ${position}`}
                className='h-8 pr-12'
              />
              <span className='-translate-y-1/2 pointer-events-none absolute top-1/2 right-2.5 text-muted-foreground text-xs tabular-nums'>
                {labelLength}/{WHATSAPP_BUTTON_LABEL_MAX}
              </span>
            </div>
            <Button
              type='button'
              variant='ghost'
              size='icon-sm'
              aria-label={`Remover botão ${position}`}
              onClick={onRemove}
            >
              <SteelIcon icon={Delete02Icon} size={16} />
            </Button>
          </>
        )}
      </div>

      {button.type === 'URL' ? (
        lockStructure ? (
          <p className='flex items-center gap-1.5 text-muted-foreground text-xs'>
            <SteelIcon icon={ArrowUpRight01Icon} size={14} />
            <span className='truncate'>{button.url}</span>
            <span className='shrink-0'>
              · links só abrem o endereço, sem ações
            </span>
          </p>
        ) : (
          <div className='space-y-1'>
            <Input
              type='url'
              value={button.url}
              onChange={(event) =>
                onChange({ ...button, url: event.target.value })
              }
              placeholder='https://suaempresa.com.br/pedido'
              aria-label={`Link do botão ${position}`}
              className='h-8'
            />
            <p className='text-muted-foreground text-xs'>
              O WhatsApp não avisa quando um link é aberto, então botões de link
              não disparam ações.
            </p>
          </div>
        )
      ) : (
        <ActionsList
          workspaceId={workspaceId}
          position={position}
          actions={button.actions}
          onChange={(actions) => onChange({ ...button, actions })}
        />
      )}
    </section>
  )
}

function ActionsList({
  workspaceId,
  position,
  actions,
  onChange,
}: {
  workspaceId: string
  position: number
  actions: WhatsAppButtonAction[]
  onChange: (actions: WhatsAppButtonAction[]) => void
}) {
  const canAdd = actions.length < WHATSAPP_BUTTON_ACTIONS_MAX

  return (
    <div className='space-y-2 border-t pt-3'>
      <div className='flex items-center justify-between gap-2'>
        <p className='font-medium text-muted-foreground text-xs'>
          Ao clicar ({actions.length}/{WHATSAPP_BUTTON_ACTIONS_MAX})
        </p>
        {canAdd ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type='button'
                  variant='ghost'
                  size='xs'
                  aria-label={`Adicionar ação ao botão ${position}`}
                >
                  <SteelIcon icon={PlusSignIcon} size={14} />
                  Ação
                </Button>
              }
            />
            <DropdownMenuContent align='end' className='w-72'>
              {BUTTON_ACTION_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option.kind}
                  onClick={() =>
                    onChange([...actions, emptyButtonAction(option.kind)])
                  }
                >
                  <div className='flex flex-col'>
                    <span>{option.label}</span>
                    <span className='text-muted-foreground text-xs'>
                      {option.description}
                    </span>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {actions.length === 0 ? (
        <p className='text-muted-foreground text-xs'>
          Nenhuma ação: o clique só aparece na conversa.
        </p>
      ) : (
        <ol className='space-y-2'>
          {actions.map((action, index) => (
            <li
              // Actions have no id; the position is their identity here.
              key={index}
              className='space-y-2 rounded-md border bg-background p-2.5'
            >
              <div className='flex items-center gap-1'>
                <span className='text-muted-foreground text-xs tabular-nums'>
                  {index + 1}.
                </span>
                <span className='min-w-0 flex-1 truncate font-medium text-xs'>
                  {buttonActionLabel(action.kind)}
                </span>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-xs'
                  aria-label={`Subir ação ${index + 1}`}
                  disabled={index === 0}
                  onClick={() => onChange(moveItem(actions, index, index - 1))}
                >
                  <SteelIcon icon={ArrowUp01Icon} size={14} />
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-xs'
                  aria-label={`Descer ação ${index + 1}`}
                  disabled={index === actions.length - 1}
                  onClick={() => onChange(moveItem(actions, index, index + 1))}
                >
                  <SteelIcon icon={ArrowDown01Icon} size={14} />
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-xs'
                  aria-label={`Remover ação ${index + 1}`}
                  onClick={() =>
                    onChange(actions.filter((_, i) => i !== index))
                  }
                >
                  <SteelIcon icon={Delete02Icon} size={14} />
                </Button>
              </div>
              <ActionFields
                workspaceId={workspaceId}
                action={action}
                onChange={(next) =>
                  onChange(actions.map((a, i) => (i === index ? next : a)))
                }
              />
            </li>
          ))}
        </ol>
      )}
      {actions.length > 1 ? (
        <p className='text-muted-foreground text-xs'>
          As ações rodam nesta ordem; se uma falhar, as seguintes continuam.
        </p>
      ) : null}
    </div>
  )
}

function ActionFields({
  workspaceId,
  action,
  onChange,
}: {
  workspaceId: string
  action: WhatsAppButtonAction
  onChange: (action: WhatsAppButtonAction) => void
}) {
  switch (action.kind) {
    case 'REPLY':
      return (
        <Textarea
          rows={2}
          value={action.text}
          onChange={(event) =>
            onChange({ ...action, text: event.target.value })
          }
          placeholder='Perfeito! Seu pedido foi confirmado.'
          aria-label='Texto da resposta'
        />
      )
    case 'AI_INSTRUCTION':
      return (
        <Textarea
          rows={2}
          value={action.instruction}
          onChange={(event) =>
            onChange({ ...action, instruction: event.target.value })
          }
          placeholder='Pergunte o melhor horário e ofereça os três próximos disponíveis.'
          aria-label='Instrução para a IA'
        />
      )
    case 'ASSIGN_USER':
      return (
        <MemberPicker
          workspaceId={workspaceId}
          value={action.userId}
          onChange={(userId) => onChange({ ...action, userId })}
        />
      )
    case 'ASSIGN_TEAM':
      return (
        <TeamPicker
          workspaceId={workspaceId}
          value={action.teamId}
          onChange={(teamId) => onChange({ ...action, teamId })}
        />
      )
    case 'CRM_WORKFLOW':
      return (
        <WorkflowPicker
          workspaceId={workspaceId}
          value={action.workflowId}
          onChange={(workflowId) => onChange({ ...action, workflowId })}
        />
      )
    case 'SET_STATUS':
      return (
        <div className='grid gap-2 sm:grid-cols-2'>
          <PickerSelect
            label='Novo status'
            value={action.status}
            options={[
              { value: 'IN_PROGRESS', label: 'Em atendimento' },
              { value: 'CLOSED', label: 'Fechada' },
            ]}
            onChange={(status) =>
              onChange({
                ...action,
                status: status as 'IN_PROGRESS' | 'CLOSED',
              })
            }
          />
          {action.status === 'CLOSED' ? (
            <Input
              value={action.reason ?? ''}
              maxLength={500}
              onChange={(event) =>
                onChange({ ...action, reason: event.target.value })
              }
              placeholder='Motivo (opcional)'
              aria-label='Motivo do fechamento'
              className='h-8'
            />
          ) : null}
        </div>
      )
    case 'HTTP_WEBHOOK':
      return (
        <div className='space-y-2'>
          <Input
            type='url'
            value={action.url}
            onChange={(event) =>
              onChange({ ...action, url: event.target.value })
            }
            placeholder='https://api.suaempresa.com.br/webhooks/whatsapp'
            aria-label='URL do webhook'
            className='h-8'
          />
          <Input
            type='password'
            autoComplete='off'
            value={action.secret ?? ''}
            maxLength={200}
            onChange={(event) =>
              onChange({ ...action, secret: event.target.value })
            }
            placeholder='Segredo para assinar (opcional)'
            aria-label='Segredo do webhook'
            className='h-8'
          />
          <p className='text-muted-foreground text-xs'>
            Enviamos um POST em JSON com o contato, o botão e a conversa. Com
            segredo, o corpo vai assinado em <code>X-Steel-Signature</code>{' '}
            (HMAC-SHA256).
          </p>
        </div>
      )
  }
}

function PickerSelect({
  label,
  value,
  options,
  onChange,
  placeholder = 'Selecione',
  disabled,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <Select
      value={value || null}
      onValueChange={(next) => next && onChange(next)}
      disabled={disabled}
    >
      <SelectTrigger size='sm' className='w-full' aria-label={label}>
        <SelectValue>
          {(current: string | null) =>
            options.find((option) => option.value === current)?.label ?? (
              <span className='text-muted-foreground'>{placeholder}</span>
            )
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function PickerEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p className='rounded-md bg-muted px-2.5 py-2 text-muted-foreground text-xs'>
      {children}
    </p>
  )
}

function MemberPicker({
  workspaceId,
  value,
  onChange,
}: {
  workspaceId: string
  value: string
  onChange: (value: string) => void
}) {
  const members = useWhatsAppAssignableMembers(workspaceId)
  if (members.data && members.data.length === 0) {
    return <PickerEmpty>Nenhum membro pode receber conversas.</PickerEmpty>
  }
  return (
    <PickerSelect
      label='Atendente'
      value={value}
      placeholder={members.isLoading ? 'Carregando…' : 'Escolha o atendente'}
      disabled={!members.data}
      options={(members.data ?? []).map((member) => ({
        value: member.id,
        label: member.name,
      }))}
      onChange={onChange}
    />
  )
}

function TeamPicker({
  workspaceId,
  value,
  onChange,
}: {
  workspaceId: string
  value: string
  onChange: (value: string) => void
}) {
  const teams = useTeamsForPicker(workspaceId)
  if (teams.isLoading) {
    return <PickerEmpty>Carregando equipes…</PickerEmpty>
  }
  if (!teams.data || teams.data.length === 0) {
    return (
      <PickerEmpty>
        Nenhuma equipe criada ainda. Crie em WhatsApp › Equipes e volte aqui.
      </PickerEmpty>
    )
  }
  return (
    <PickerSelect
      label='Equipe'
      value={value}
      placeholder='Escolha a equipe'
      options={teams.data.map((team) => ({ value: team.id, label: team.name }))}
      onChange={onChange}
    />
  )
}

function WorkflowPicker({
  workspaceId,
  value,
  onChange,
}: {
  workspaceId: string
  value: string
  onChange: (value: string) => void
}) {
  const workflows = useCrmWorkflows(workspaceId)
  if (workflows.isLoading) {
    return <PickerEmpty>Carregando workflows…</PickerEmpty>
  }
  if (workflows.isError) {
    return (
      <PickerEmpty>
        Não foi possível listar os workflows — o módulo CRM precisa estar ativo.
      </PickerEmpty>
    )
  }
  const list = (workflows.data ?? []).filter((workflow) => !workflow.deletedAt)
  if (list.length === 0) {
    return (
      <PickerEmpty>
        Nenhum workflow no CRM. Crie um em CRM › Workflows.
      </PickerEmpty>
    )
  }
  return (
    <div className='space-y-1'>
      <PickerSelect
        label='Workflow'
        value={value}
        placeholder='Escolha o workflow'
        options={list.map((workflow) => ({
          value: workflow.id,
          label:
            workflow.status === 'ACTIVE'
              ? workflow.name
              : `${workflow.name} (inativo)`,
        }))}
        onChange={onChange}
      />
      <p className='text-muted-foreground text-xs'>
        O workflow precisa estar ativo e usar o gatilho “Iniciar manualmente”.
      </p>
    </div>
  )
}

export function buttonSummary(button: WhatsAppButtonDTO): string {
  if (button.type === 'URL') return 'Abre o link'
  if (button.actions.length === 0) return 'Sem ações'
  return button.actions
    .map((action) => buttonActionLabel(action.kind))
    .join(' → ')
}

/** Compact chips of the buttons, for tables. */
export function WhatsappButtonsSummary({
  buttons,
  className,
}: {
  buttons: WhatsAppButtonDTO[]
  className?: string
}) {
  if (buttons.length === 0) {
    return <span className='text-muted-foreground text-xs'>—</span>
  }
  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {buttons.map((button) => (
        <span
          key={button.id}
          title={buttonSummary(button)}
          className='inline-flex max-w-40 items-center gap-1 rounded-md border bg-muted/50 px-1.5 py-0.5 text-xs'
        >
          <SteelIcon
            icon={button.type === 'URL' ? Link01Icon : TouchInteraction01Icon}
            size={12}
            className='shrink-0 text-muted-foreground'
          />
          <span className='truncate'>{button.label}</span>
          {button.type === 'REPLY' && button.actions.length > 0 ? (
            <span className='shrink-0 text-muted-foreground tabular-nums'>
              · {button.actions.length}
            </span>
          ) : null}
        </span>
      ))}
    </div>
  )
}
