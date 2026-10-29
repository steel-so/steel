'use client'

import {
  AiMagicIcon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { type ReactNode, useState } from 'react'
import { SdAiCopilotPanel } from '@/app/_components/servicedesk/ai/copilot-panel'
import { SdPortalAccessButton } from '@/app/_components/servicedesk/external-portal'
import { SdTicketIntegrationLinks } from '@/app/_components/servicedesk/integrations/sd-ticket-integration-links'
import { SdTicketMonitorBlock } from '@/app/_components/servicedesk/monitoring/sd-ticket-monitor-block'
import { SteelAgentAssignSelect } from '@/app/_components/steel-agents/steel-agent-assign-select'
import { SteelIcon } from '@/components/icon/icon'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { useSdTicketKbLinks } from '@/src/hooks/use-sd-knowledge'
import { useSdTicketApprovals } from '@/src/hooks/use-sd-ticket-approvals'
import { useSdTicketCosts } from '@/src/hooks/use-sd-ticket-costs'
import { useSdTicketTasks } from '@/src/hooks/use-sd-ticket-tasks'
import {
  type UpdateSdTicketInput,
  useAddSdTicketParticipant,
  useRemoveSdTicketParticipant,
  useUpdateSdTicket,
} from '@/src/hooks/use-sd-tickets'
import { useSdTimeEntries } from '@/src/hooks/use-sd-time-entries'
import { SD_RISK_LEVEL_LABEL } from '@/src/lib/servicedesk/risk'
import type { SdAgentDTO, SdConfigBootstrapDTO } from '@/types/sd-config'
import type { SdTicketDTO } from '@/types/sd-ticket'
import { sdApplicableCustomFields } from '../custom-fields/sd-custom-fields-utils'
import { SdRiskFactorList } from '../risk/sd-risk-badge'
import { SD_APPROVAL_STATUS_LABEL } from './approvals/sd-approval-labels'
import { SdOnCallBadge } from './sd-oncall-badge'
import { SdOptionSelect } from './sd-option-select'
import { SdSlaIndicator, SdUserAvatar, useSdNow } from './sd-ticket-badges'
import { SdTicketFieldControl, sdIsDraftField } from './sd-ticket-field-control'
import {
  SD_CHANNEL_LABEL,
  SD_TICKET_TYPE_LABEL,
  SD_TONE_TEXT,
  sdFormatDateTime,
  sdFormatDuration,
  sdLiveSla,
  sdRelativeTime,
} from './sd-ticket-meta'
import { sdTicketFieldLabel, sdTicketFieldValue } from './sd-ticket-options'
import { formatBRL } from './shared/sd-tab-format'

/** Campo → corpo do PATCH (cascata do catálogo, campos customizados, vazios). */
export function sdFieldPatch(
  field: string,
  value: unknown,
): UpdateSdTicketInput {
  const normalized =
    typeof value === 'string' && value.trim() === '' ? null : value
  if (field.startsWith('customFields.')) {
    return { customFields: { [field.slice(13)]: normalized } }
  }
  const patch: Record<string, unknown> = { [field]: normalized }
  if (field === 'categoryId') {
    patch.subcategoryId = null
    patch.serviceId = null
  }
  if (field === 'subcategoryId') patch.serviceId = null
  return patch as UpdateSdTicketInput
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/**
 * Controles "silenciosos": selects, pickers e inputs da coluna aparecem
 * como texto (sem borda nem fundo) e só mostram a moldura no hover/foco —
 * a coluna lê como pares rótulo/valor e continua editável no lugar.
 */
const QUIET_CONTROLS = cn(
  '[&_[data-slot=select-trigger]]:border-transparent [&_[data-slot=select-trigger]]:bg-transparent [&_[data-slot=select-trigger]]:px-1.5 [&_[data-slot=select-trigger]]:shadow-none dark:[&_[data-slot=select-trigger]]:bg-transparent',
  '[&_[data-slot=select-trigger]:hover]:bg-muted/70 [&_[data-slot=select-trigger]:focus-visible]:border-ring',
  '[&_[data-slot=button]]:border-transparent [&_[data-slot=button]]:bg-transparent [&_[data-slot=button]]:px-1.5 [&_[data-slot=button]]:shadow-none dark:[&_[data-slot=button]]:bg-transparent',
  '[&_[data-slot=button]:hover]:bg-muted/70 [&_[data-slot=button]:focus-visible]:border-ring',
  '[&_[data-slot=input]]:border-transparent [&_[data-slot=input]]:bg-transparent [&_[data-slot=input]]:px-1.5 [&_[data-slot=input]]:shadow-none dark:[&_[data-slot=input]]:bg-transparent',
  '[&_[data-slot=input]:hover]:border-input [&_[data-slot=input]:focus-visible]:border-ring',
  // Setas dos seletores bem apagadas; voltam no hover/foco.
  '[&_[data-slot=select-trigger]>svg:last-child]:opacity-40 [&_[data-slot=select-trigger]:hover>svg:last-child]:opacity-100 [&_[data-slot=select-trigger]:focus-visible>svg:last-child]:opacity-100',
  // Pickers assíncronos (cliente, empresa, contato, CI): gatilho de popover.
  '[&_[data-slot=popover-trigger]]:border-transparent [&_[data-slot=popover-trigger]]:bg-transparent [&_[data-slot=popover-trigger]]:pl-1.5 [&_[data-slot=popover-trigger]]:shadow-none dark:[&_[data-slot=popover-trigger]]:bg-transparent',
  '[&_[data-slot=popover-trigger]:hover]:bg-muted/70 [&_[data-slot=popover-trigger]:focus-visible]:border-ring',
  '[&_[data-slot=popover-trigger]>svg:last-child]:opacity-40 [&_[data-slot=popover-trigger]:hover>svg:last-child]:opacity-100',
)

const ROW = 'grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-x-2'
const LABEL = 'pt-1.5 text-muted-foreground text-xs leading-tight'

interface FieldProps {
  workspaceId: string
  ticket: SdTicketDTO
  config: SdConfigBootstrapDTO
  agents: SdAgentDTO[]
  field: string
  label: string
  error?: string
  saving: boolean
  onSave: (field: string, value: unknown) => void
  disabled?: boolean
}

/** Linha editável da coluna (salva ao escolher ou ao sair do campo). */
function SidebarField({
  workspaceId,
  ticket,
  config,
  agents,
  field,
  label,
  error,
  saving,
  onSave,
  disabled,
}: FieldProps) {
  const server = sdTicketFieldValue(ticket, field)
  const [draft, setDraft] = useState<unknown>(server)
  const [synced, setSynced] = useState<unknown>(server)
  if (!same(server, synced)) {
    setSynced(server)
    setDraft(server)
  }
  const draftMode = sdIsDraftField(field, config)
  const id = `sd-side-${field.replace('.', '-')}`
  const wide =
    draftMode &&
    (field === 'solution' ||
      field.endsWith('Plan') ||
      field === 'rootCause' ||
      field === 'workaround')

  return (
    <div className={cn(wide ? 'flex flex-col gap-1' : ROW)}>
      <label
        htmlFor={id}
        className={wide ? 'text-muted-foreground text-xs' : LABEL}
      >
        {label}
      </label>
      <div className='min-w-0'>
        <SdTicketFieldControl
          id={id}
          workspaceId={workspaceId}
          config={config}
          field={field}
          context={{
            type: ticket.type,
            categoryId: ticket.category?.id,
            subcategoryId: ticket.subcategory?.id,
            customerId: ticket.customer?.id,
            companyId: ticket.company?.id,
          }}
          agents={agents}
          value={draftMode ? draft : server}
          selectedLabel={sdTicketFieldLabel(ticket, field)}
          disabled={disabled || saving}
          invalid={Boolean(error)}
          onChange={(value) => {
            if (draftMode) setDraft(value)
            else if (!same(value, server)) onSave(field, value)
          }}
          onCommit={
            draftMode
              ? () => {
                  if (!same(draft, server)) onSave(field, draft)
                }
              : undefined
          }
        />
        {error ? (
          <p className='mt-1 text-destructive text-xs' role='alert'>
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}

/** Seção recolhível da coluna: título discreto, sem moldura. */
export function SdSidebarSection({
  title,
  children,
  defaultOpen = true,
  icon,
  aside,
}: {
  title: string
  children: ReactNode
  defaultOpen?: boolean
  icon?: ReactNode
  /** Resumo à direita do título (ex.: "2/3"). */
  aside?: ReactNode
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className='px-2 py-1'>
      <CollapsibleTrigger className='group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50'>
        <SteelIcon
          icon={ArrowDown01Icon}
          strokeWidth={2}
          className='-rotate-90 size-3.5 text-muted-foreground transition-transform group-data-[panel-open]:rotate-0'
        />
        {icon}
        <span className='font-medium text-muted-foreground text-xs'>
          {title}
        </span>
        {aside ? (
          <span className='ml-auto text-muted-foreground text-xs tabular-nums'>
            {aside}
          </span>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent
        className={cn('flex flex-col gap-1 px-2 pt-1 pb-3', QUIET_CONTROLS)}
      >
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}

function ReadRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={cn(ROW, 'items-baseline')}>
      <span className={cn(LABEL, 'pt-0')}>{label}</span>
      <span className='min-w-0 px-1.5 py-1 text-sm'>{children}</span>
    </div>
  )
}

/** Atalho da coluna para uma aba (Tarefas, Aprovação, Custos…). */
function TabLink({
  label,
  value,
  onClick,
}: {
  label: string
  value: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      className={cn(
        ROW,
        'group items-center rounded-md py-1 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50',
      )}
    >
      <span className='pl-0 text-muted-foreground text-xs'>{label}</span>
      <span className='flex min-w-0 items-center gap-1 px-1.5 text-sm'>
        <span className='truncate'>{value}</span>
        <SteelIcon
          icon={ArrowRight01Icon}
          strokeWidth={2}
          className='ml-auto size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
        />
      </span>
    </button>
  )
}

/** Resumo do trabalho no chamado; cada linha abre a aba correspondente. */
function WorkSummary({
  workspaceId,
  ticket,
  onTab,
}: {
  workspaceId: string
  ticket: SdTicketDTO
  onTab: (tab: string) => void
}) {
  const tasks = useSdTicketTasks(workspaceId, ticket.id)
  const approvals = useSdTicketApprovals(workspaceId, ticket.id)
  const costs = useSdTicketCosts(workspaceId, ticket.id)
  const hours = useSdTimeEntries(workspaceId, ticket.id)
  const kb = useSdTicketKbLinks(workspaceId, ticket.id)

  const progress = tasks.data?.progress
  const latestApproval = approvals.data?.[0]
  const pendingApprovals =
    approvals.data?.filter((a) => a.status === 'PENDING').length ?? 0
  const minutes = hours.data?.summary.totalMinutes ?? 0
  const kbCount = kb.data?.length ?? 0

  /** Enquanto carrega (ou se falhar) não afirma "nenhuma". */
  const show = (
    query: { isLoading: boolean; error: unknown },
    value: () => string,
  ) => (query.isLoading ? '…' : query.error ? '—' : value())

  return (
    <>
      <TabLink
        label='Tarefas'
        value={show(tasks, () =>
          progress && progress.total > 0
            ? `${progress.done} de ${progress.total} concluídas`
            : 'Nenhuma',
        )}
        onClick={() => onTab('tasks')}
      />
      <TabLink
        label='Aprovação'
        value={show(approvals, () =>
          pendingApprovals > 0
            ? `${pendingApprovals} pendente${pendingApprovals > 1 ? 's' : ''}`
            : latestApproval
              ? SD_APPROVAL_STATUS_LABEL[latestApproval.status]
              : 'Nenhuma',
        )}
        onClick={() => onTab('approvals')}
      />
      <TabLink
        label='Horas'
        value={show(hours, () =>
          minutes > 0 ? sdFormatDuration(minutes) : 'Nenhuma',
        )}
        onClick={() => onTab('hours')}
      />
      <TabLink
        label='Custos'
        value={show(costs, () =>
          costs.data && costs.data.items.length > 0
            ? formatBRL(costs.data.summary.total)
            : 'Nenhum',
        )}
        onClick={() => onTab('costs')}
      />
      <TabLink
        label='Conhecimento'
        value={show(kb, () =>
          kbCount > 0
            ? `${kbCount} artigo${kbCount > 1 ? 's' : ''}`
            : 'Nenhum artigo',
        )}
        onClick={() => onTab('knowledge')}
      />
    </>
  )
}

function Participants({
  workspaceId,
  ticket,
  agents,
}: {
  workspaceId: string
  ticket: SdTicketDTO
  agents: SdAgentDTO[]
}) {
  const add = useAddSdTicketParticipant(workspaceId, ticket.id)
  const remove = useRemoveSdTicketParticipant(workspaceId, ticket.id)
  const current = new Set(ticket.participants.map((p) => p.id))
  return (
    <div className={ROW}>
      <span className={LABEL}>Participantes</span>
      <div className='flex min-w-0 flex-col gap-1'>
        {ticket.participants.length > 0 ? (
          <ul className='flex flex-col gap-0.5 px-1.5 pt-1'>
            {ticket.participants.map((p) => (
              <li
                key={p.id}
                className='group/p flex items-center gap-1.5 text-sm'
              >
                <SdUserAvatar user={p} className='size-4' />
                <span className='min-w-0 flex-1 truncate'>{p.name}</span>
                <button
                  type='button'
                  aria-label={`Remover ${p.name}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(p.id, { onError: notify.error })}
                  className='rounded p-0.5 text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/p:opacity-100'
                >
                  <SteelIcon
                    icon={Cancel01Icon}
                    strokeWidth={2}
                    className='size-3'
                  />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <SdOptionSelect
          aria-label='Adicionar participante'
          value={null}
          allowClear={false}
          placeholder='Adicionar…'
          disabled={add.isPending}
          onChange={(userId) =>
            userId && add.mutate(userId, { onError: notify.error })
          }
          options={agents
            .filter((a) => !current.has(a.id))
            .map((a) => ({ value: a.id, label: a.name }))}
        />
      </div>
    </div>
  )
}

/**
 * Coluna de detalhes da tela do chamado (ou conteúdo do Sheet "Detalhes"
 * abaixo de `lg`): SLA em texto, campos editáveis no lugar (salvam com
 * `useUpdateSdTicket`, erro da API embaixo do campo) em seções recolhíveis,
 * resumo do trabalho com atalho para as abas, risco, integrações, datas e
 * o copiloto de IA.
 */
export function SdTicketSidebar({
  workspaceId,
  ticket,
  config,
  agents,
  onPhaseChange,
  onTab,
}: {
  workspaceId: string
  ticket: SdTicketDTO
  config: SdConfigBootstrapDTO
  agents: SdAgentDTO[]
  onPhaseChange: (phaseId: string) => void
  /** Abre uma aba da coluna principal (atalhos do resumo). */
  onTab: (tab: string) => void
}) {
  const now = useSdNow(30_000)
  const update = useUpdateSdTicket(workspaceId, ticket.id)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [savingField, setSavingField] = useState<string | null>(null)

  function save(field: string, value: unknown) {
    setSavingField(field)
    update.mutate(sdFieldPatch(field, value), {
      onSuccess: () =>
        setErrors((current) => {
          const { [field]: _removed, ...rest } = current
          return rest
        }),
      onError: (error) =>
        setErrors((current) => ({ ...current, [field]: error.message })),
      onSettled: () => setSavingField(null),
    })
  }

  const field = (key: string, label: string) => (
    <SidebarField
      key={key}
      workspaceId={workspaceId}
      ticket={ticket}
      config={config}
      agents={agents}
      field={key}
      label={label}
      error={errors[key]}
      saving={savingField === key}
      onSave={save}
    />
  )

  const phases =
    config.phases
      .find((f) => f.ticketType === ticket.type)
      ?.phases.filter((p) => p.active || p.id === ticket.phaseId)
      .sort((a, b) => a.position - b.position) ?? []
  const customFields = sdApplicableCustomFields(config.customFields, 'TICKET', {
    ticketType: ticket.type,
    categoryIds: [
      ticket.category?.id,
      ticket.subcategory?.id,
      ticket.service?.id,
    ],
  })
  const first = sdLiveSla(ticket.sla.firstResponse, now)
  const resolution = sdLiveSla(ticket.sla.resolution, now)
  const risk = ticket.risk

  return (
    <div className='flex flex-col py-2' data-testid='sd-ticket-details'>
      <section
        aria-label='SLA'
        className='flex flex-col gap-1.5 px-4 pt-1 pb-3'
      >
        <div className='flex items-center justify-between gap-2'>
          <span className='text-muted-foreground text-xs'>1ª resposta</span>
          <SdSlaIndicator live={first} label='1ª resposta' showLabel={false} />
        </div>
        <div className='flex items-center justify-between gap-2'>
          <span className='text-muted-foreground text-xs'>Resolução</span>
          <SdSlaIndicator
            live={resolution}
            label='Resolução'
            showLabel={false}
          />
        </div>
      </section>

      <SdSidebarSection title='Geral'>
        <ReadRow label='Tipo'>{SD_TICKET_TYPE_LABEL[ticket.type]}</ReadRow>
        <div className={ROW}>
          <label htmlFor='sd-side-phase' className={LABEL}>
            Fase
          </label>
          <SdOptionSelect
            id='sd-side-phase'
            aria-label='Fase'
            allowClear={false}
            value={ticket.phaseId}
            onChange={(phaseId) => phaseId && onPhaseChange(phaseId)}
            options={phases.map((p) => ({
              value: p.id,
              label: p.name,
              color: p.color,
              hint: `${p.completionPercent}%`,
            }))}
          />
        </div>
        {field('priorityId', 'Prioridade')}
        {field('severityId', 'Severidade')}
        {field('impactId', 'Impacto')}
        {field('urgencyId', 'Urgência')}
        {field('classificationId', 'Classificação')}
        <ReadRow label='Canal'>{SD_CHANNEL_LABEL[ticket.channel]}</ReadRow>
        <SdTicketMonitorBlock
          workspaceId={workspaceId}
          ticket={ticket}
          className='mt-1 border-0 bg-muted/40 p-2.5'
        />
      </SdSidebarSection>

      <SdSidebarSection title='Atendimento'>
        {field('assigneeId', 'Responsável')}
        <div className={ROW}>
          <span className={LABEL}>Agente de IA</span>
          <SteelAgentAssignSelect
            workspaceId={workspaceId}
            entityType='SD_TICKET'
            entityRef={ticket.id}
            className='h-8 w-full'
          />
        </div>
        {field('departmentId', 'Departamento')}
        {field('requesterId', 'Solicitante')}
        <Participants
          workspaceId={workspaceId}
          ticket={ticket}
          agents={agents}
        />
        {field('tags', 'Tags')}
        <SdOnCallBadge
          workspaceId={workspaceId}
          departmentId={ticket.department?.id}
          quiet
        />
      </SdSidebarSection>

      <SdSidebarSection title='Trabalho'>
        <WorkSummary workspaceId={workspaceId} ticket={ticket} onTab={onTab} />
      </SdSidebarSection>

      <SdSidebarSection title='Catálogo'>
        {field('categoryId', 'Categoria')}
        {field('subcategoryId', 'Subcategoria')}
        {field('serviceId', 'Serviço')}
      </SdSidebarSection>

      <SdSidebarSection title='Cliente e CMDB'>
        {field('customerId', 'Cliente')}
        {field('companyId', 'Empresa')}
        {field('contactId', 'Contato')}
        {ticket.contact ? (
          <div className='pl-[7rem]'>
            <SdPortalAccessButton
              workspaceId={workspaceId}
              contactId={ticket.contact.id}
              contactEmail={ticket.contact.email}
              contactName={ticket.contact.name}
              size='xs'
            />
          </div>
        ) : null}
        {field('configItemId', 'Item de configuração')}
      </SdSidebarSection>

      {customFields.length > 0 ? (
        <SdSidebarSection title='Campos customizados'>
          {customFields.map((d) => field(`customFields.${d.key}`, d.label))}
        </SdSidebarSection>
      ) : null}

      <SdSidebarSection title='Solução' defaultOpen={Boolean(ticket.solution)}>
        {field('solutionClassificationId', 'Classificação')}
        {field('solution', 'Solução')}
      </SdSidebarSection>

      {ticket.type === 'CHANGE' ? (
        <SdSidebarSection title='Mudança'>
          {field('changeType', 'Tipo de mudança')}
          {field('changeRisk', 'Risco')}
          {field('plannedStartAt', 'Início planejado')}
          {field('plannedEndAt', 'Fim planejado')}
          {field('implementationPlan', 'Plano de implantação')}
          {field('rollbackPlan', 'Plano de retorno')}
          {field('testPlan', 'Plano de testes')}
        </SdSidebarSection>
      ) : null}

      {ticket.type === 'PROBLEM' ? (
        <SdSidebarSection title='Problema'>
          {field('knownError', 'Erro conhecido')}
          {field('rootCause', 'Causa raiz')}
          {field('workaround', 'Solução de contorno')}
        </SdSidebarSection>
      ) : null}

      {risk ? (
        <SdSidebarSection
          title='Risco preditivo'
          defaultOpen={risk.level !== 'LOW'}
          aside={`${SD_RISK_LEVEL_LABEL[risk.level]} · ${risk.score}`}
        >
          <section
            aria-label='Risco preditivo'
            data-risk-level={risk.level}
            className='flex flex-col gap-1.5 text-xs'
          >
            {risk.factors.length > 0 ? (
              <SdRiskFactorList factors={risk.factors} />
            ) : (
              <p className='text-muted-foreground'>
                Nenhum fator de risco neste chamado.
              </p>
            )}
            {risk.breachEtaAt ? (
              <p className='text-muted-foreground'>
                Previsão de estouro do prazo{' '}
                {sdRelativeTime(risk.breachEtaAt, now)}.
              </p>
            ) : null}
          </section>
        </SdSidebarSection>
      ) : null}

      <SdTicketIntegrationLinks
        workspaceId={workspaceId}
        ticket={ticket}
        mode='agent'
        className='mx-4 my-2 rounded-none border-0 bg-transparent p-0'
      />

      <SdSidebarSection title='Datas' defaultOpen={false}>
        <ReadRow label='Aberto em'>
          {sdFormatDateTime(ticket.createdAt)}
        </ReadRow>
        <ReadRow label='1ª resposta'>
          {sdFormatDateTime(ticket.firstRespondedAt)}
        </ReadRow>
        <ReadRow label='Resolvido em'>
          {sdFormatDateTime(ticket.resolvedAt)}
        </ReadRow>
        <ReadRow label='Fechado em'>
          {sdFormatDateTime(ticket.closedAt)}
        </ReadRow>
        <ReadRow label='Última atividade'>
          {sdFormatDateTime(ticket.lastActivityAt)}
        </ReadRow>
        {ticket.reopenCount > 0 ? (
          <ReadRow label='Reaberturas'>{ticket.reopenCount}</ReadRow>
        ) : null}
        {ticket.createdBy ? (
          <ReadRow label='Aberto por'>{ticket.createdBy.name}</ReadRow>
        ) : null}
      </SdSidebarSection>

      <SdSidebarSection
        title='Copiloto de IA'
        defaultOpen={false}
        icon={
          <SteelIcon
            icon={AiMagicIcon}
            strokeWidth={2}
            className={cn('size-3.5', SD_TONE_TEXT.violet)}
          />
        }
      >
        <SdAiCopilotPanel workspaceId={workspaceId} ticket={ticket} />
        {config.settings.aiEnabled ? null : (
          <p className='text-muted-foreground text-xs'>
            A IA está desligada nas configurações do ServiceDesk.
          </p>
        )}
      </SdSidebarSection>
    </div>
  )
}
