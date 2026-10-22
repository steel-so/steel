'use client'

import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  ArrowUpDownIcon,
  Cancel01Icon,
  Download01Icon,
  FilterIcon,
  PlusSignIcon,
  Search01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApolloImportDialog } from '@/app/_components/crm/apollo/apollo-import-dialog'
import {
  LEAD_STAGES,
  STAGE_LABELS,
  STAGE_STYLES,
} from '@/app/_components/crm/crm-lead-stage'
import { useShortcut } from '@/app/_components/shortcuts/shortcuts-provider'
import { useListShortcuts } from '@/app/_components/shortcuts/use-list-shortcuts'
import { AskSteelAiButton } from '@/app/_components/steel-ai-ask/ask-steel-ai-button'
import { useCan } from '@/app/_components/workspace/workspace-permissions'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/src/hooks/_fetch'
import {
  useCloseCrmLeadLost,
  useCloseCrmLeadWon,
  useCreateCrmLeadProposal,
  useCrmLeadReopenings,
  useRegisterCrmLeadContactAttempt,
  useRegisterCrmLeadMeeting,
  useRegisterCrmLeadProposalPresentation,
  useReopenCrmLead,
  useSetCrmLeadInterestProducts,
  useUpsertCrmLeadQualification,
} from '@/src/hooks/use-crm-lead-pipeline'
import {
  createCrmResource,
  useCrmResourceList,
} from '@/src/hooks/use-crm-resource-list'
import { useCrmSettings } from '@/src/hooks/use-crm-settings'
import { useRecordParam } from '@/src/hooks/use-record-param'
import type {
  CrmLeadContactAttemptDTO,
  CrmLeadDTO,
  CrmLeadInterestLevelDTO,
  CrmLeadMeetingDTO,
  CrmLeadProposalPresentationDTO,
  CrmLeadStageDTO,
} from '@/types/crm-lead'
import type { CrmProductDTO } from '@/types/crm-product'

const NEXT_STEP_HINT: Record<CrmLeadStageDTO, string> = {
  RECEIVED: 'Para avançar: registre a primeira tentativa de contato.',
  IN_CONTACT:
    'Para avançar: registre um contato efetivo (uma conversa realizada).',
  QUALIFIED:
    'Para avançar: informe a previsão de fechamento e o decisor (nome e cargo).',
  OPPORTUNITY: 'Para avançar: registre a reunião e crie a proposta comercial.',
  PROPOSAL:
    'Para avançar: registre o resultado da proposta (ganho ou perdido).',
  CLOSED: 'Negócio encerrado.',
}

const INTEREST_LEVELS: { value: CrmLeadInterestLevelDTO; label: string }[] = [
  { value: 'VERY_LOW', label: 'Muito baixo' },
  { value: 'LOW', label: 'Baixo' },
  { value: 'MEDIUM', label: 'Médio' },
  { value: 'HIGH', label: 'Alto' },
  { value: 'VERY_HIGH', label: 'Muito alto' },
]

const THERMOMETER_COLORS = [
  'bg-blue-400',
  'bg-emerald-400',
  'bg-amber-400',
  'bg-orange-400',
  'bg-rose-400',
]

type LeadFieldKey =
  | 'name'
  | 'company'
  | 'email'
  | 'phone'
  | 'jobTitle'
  | 'city'
  | 'source'
  | 'channel'
  | 'score'
  | 'createdAt'
  | 'updatedAt'

const LEAD_FIELDS: { key: LeadFieldKey; label: string; sortable: boolean }[] = [
  { key: 'name', label: 'Nome', sortable: true },
  { key: 'company', label: 'Empresa', sortable: true },
  { key: 'email', label: 'E-mail', sortable: true },
  { key: 'phone', label: 'Telefone', sortable: true },
  { key: 'jobTitle', label: 'Cargo', sortable: true },
  { key: 'city', label: 'Cidade', sortable: true },
  { key: 'source', label: 'Origem', sortable: true },
  { key: 'channel', label: 'Canal', sortable: true },
  { key: 'score', label: 'Pontuação', sortable: true },
  { key: 'createdAt', label: 'Criado em', sortable: true },
  { key: 'updatedAt', label: 'Última atualização', sortable: true },
]

const FILTERABLE_FIELDS = LEAD_FIELDS.filter(
  (f) => f.key !== 'score' && f.key !== 'createdAt' && f.key !== 'updatedAt',
)

type LeadSort = { key: LeadFieldKey; desc: boolean }

function leadFieldValue(lead: CrmLeadDTO, key: LeadFieldKey): string | number {
  switch (key) {
    case 'email':
      return lead.emails.join(' ')
    case 'phone':
      return lead.phones.join(' ')
    case 'score':
      return lead.score
    case 'name':
    case 'company':
    case 'jobTitle':
    case 'city':
    case 'source':
    case 'channel':
    case 'createdAt':
    case 'updatedAt':
      return lead[key] ?? ''
  }
}

function fieldLabel(key: LeadFieldKey) {
  return LEAD_FIELDS.find((f) => f.key === key)?.label ?? key
}

function FilterChip({
  children,
  onRemove,
}: {
  children: React.ReactNode
  onRemove: () => void
}) {
  return (
    <span className='inline-flex items-center gap-1 rounded-full border bg-card py-0.5 pr-1 pl-2 text-xs'>
      {children}
      <button
        type='button'
        onClick={onRemove}
        className='rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground'
        aria-label='Remover'
      >
        <SteelIcon icon={Cancel01Icon} strokeWidth={2} className='size-3' />
      </button>
    </span>
  )
}

function InterestThermometer({
  value,
  onChange,
}: {
  value: CrmLeadInterestLevelDTO | null
  onChange?: (value: CrmLeadInterestLevelDTO) => void
}) {
  const activeIndex = value
    ? INTEREST_LEVELS.findIndex((l) => l.value === value)
    : -1

  return (
    <div className='flex flex-col gap-1.5'>
      <div className='flex items-center gap-1'>
        {INTEREST_LEVELS.map((level, i) => (
          <button
            key={level.value}
            type='button'
            disabled={!onChange}
            onClick={() => onChange?.(level.value)}
            title={level.label}
            className={cn(
              'h-2 flex-1 rounded-full transition-colors',
              i <= activeIndex ? THERMOMETER_COLORS[i] : 'bg-muted',
              onChange && 'cursor-pointer',
            )}
          />
        ))}
      </div>
      <div className='flex items-center justify-between text-[10px] text-muted-foreground'>
        {INTEREST_LEVELS.map((level) => (
          <span
            key={level.value}
            className={cn(
              level.value === value && 'font-medium text-foreground',
            )}
          >
            {level.label}
          </span>
        ))}
      </div>
    </div>
  )
}

export function CrmLeadsBoard({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const {
    items: leads,
    isLoading,
    refetch,
  } = useCrmResourceList<CrmLeadDTO>(workspaceId, 'leads')
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
  // Deep link (`?record=<id>`, e.g. from Steel AI): opens that lead once loaded.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('record')
    if (id) setSelectedLeadId(id)
  }, [])
  const [createOpen, setCreateOpen] = useState(false)
  const [apolloOpen, setApolloOpen] = useState(false)
  // `?apollo=1` (old import page redirect) opens the Apollo import modal.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('apollo') === '1') {
      setApolloOpen(true)
    }
  }, [])
  // Quick action from the global search (`?new=1`): opens the create form.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('new') === '1') {
      setCreateOpen(true)
    }
  }, [])

  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Partial<Record<LeadFieldKey, string>>>(
    {},
  )
  const [sorting, setSorting] = useState<LeadSort[]>([])
  const activeFilters = FILTERABLE_FIELDS.filter(
    (f) => (filters[f.key] ?? '').trim() !== '',
  )

  const visibleLeads = useMemo(() => {
    const term = search.trim().toLowerCase()
    const filtered = leads.filter((lead) => {
      if (term) {
        const haystack = FILTERABLE_FIELDS.map((f) =>
          String(leadFieldValue(lead, f.key)),
        )
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(term)) return false
      }
      return activeFilters.every((f) =>
        String(leadFieldValue(lead, f.key))
          .toLowerCase()
          .includes((filters[f.key] ?? '').trim().toLowerCase()),
      )
    })
    if (sorting.length === 0) return filtered
    return [...filtered].sort((a, b) => {
      for (const { key, desc } of sorting) {
        const va = leadFieldValue(a, key)
        const vb = leadFieldValue(b, key)
        const cmp =
          typeof va === 'number' && typeof vb === 'number'
            ? va - vb
            : String(va).localeCompare(String(vb), 'pt-BR', {
                sensitivity: 'base',
                numeric: true,
              })
        if (cmp !== 0) return desc ? -cmp : cmp
      }
      return 0
    })
  }, [leads, search, filters, sorting, activeFilters])

  const toggleSort = (key: LeadFieldKey, desc: boolean) =>
    setSorting((cur) => {
      const current = cur.find((s) => s.key === key)
      if (current?.desc === desc) return cur.filter((s) => s.key !== key)
      return [...cur.filter((s) => s.key !== key), { key, desc }]
    })

  const byStage = useMemo(() => {
    const map = new Map<CrmLeadStageDTO, CrmLeadDTO[]>()
    for (const stage of LEAD_STAGES) map.set(stage, [])
    for (const lead of visibleLeads) map.get(lead.stage)?.push(lead)
    return map
  }, [visibleLeads])

  const selectedLead = leads.find((l) => l.id === selectedLeadId) ?? null
  const boardRef = useRef<HTMLDivElement | null>(null)
  useListShortcuts({
    containerRef: boardRef,
    onNew: () => setCreateOpen(true),
  })
  useShortcut('create.lead', () => setCreateOpen(true))
  // Deep link from the notification inbox: `?record=<id>` opens the lead.
  const isLeadLoaded = useCallback(
    (id: string) => leads.some((lead) => lead.id === id),
    [leads],
  )
  useRecordParam(setSelectedLeadId, isLeadLoaded)

  return (
    <div className='flex h-full min-h-0 w-full flex-col gap-4 p-4'>
      <ApolloImportDialog
        open={apolloOpen}
        onOpenChange={setApolloOpen}
        workspaceId={workspaceId}
        slug={slug}
      />
      <div className='flex items-center justify-between'>
        <p className='text-muted-foreground text-sm'>
          {visibleLeads.length === leads.length
            ? `${leads.length} lead${leads.length === 1 ? '' : 's'} no funil`
            : `${visibleLeads.length} de ${leads.length} leads`}
        </p>
        <div className='flex items-center gap-2'>
          <div className='relative'>
            <SteelIcon
              icon={Search01Icon}
              strokeWidth={2}
              className='-translate-y-1/2 absolute top-1/2 left-2.5 size-4 text-muted-foreground'
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder='Buscar leads…'
              aria-label='Buscar leads'
              className='h-8 w-56 pl-8'
            />
          </div>
          <Popover>
            <PopoverTrigger
              render={
                <Button variant='outline' size='sm' data-shortcut-filters>
                  <SteelIcon icon={FilterIcon} strokeWidth={2} />
                  Filtrar
                  {activeFilters.length > 0 ? (
                    <span className='ml-1 rounded bg-primary px-1 text-primary-foreground text-xs'>
                      {activeFilters.length}
                    </span>
                  ) : null}
                </Button>
              }
            />
            <PopoverContent align='end' className='w-72'>
              <div className='grid gap-3'>
                <p className='font-medium text-sm'>Filtrar por campo</p>
                {FILTERABLE_FIELDS.map((field) => (
                  <div key={field.key} className='grid gap-1'>
                    <span className='text-muted-foreground text-xs'>
                      {field.label}
                    </span>
                    <Input
                      value={filters[field.key] ?? ''}
                      onChange={(e) =>
                        setFilters((cur) => ({
                          ...cur,
                          [field.key]: e.target.value,
                        }))
                      }
                      placeholder={`Filtrar ${field.label}…`}
                      className='h-8'
                    />
                  </div>
                ))}
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={() => setFilters({})}
                  disabled={activeFilters.length === 0}
                >
                  <SteelIcon icon={Cancel01Icon} strokeWidth={2} />
                  Limpar filtros
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger
              render={
                <Button variant='outline' size='sm'>
                  <SteelIcon icon={ArrowUpDownIcon} strokeWidth={2} />
                  Ordenar
                  {sorting.length > 0 ? (
                    <span className='ml-1 rounded bg-primary px-1 text-primary-foreground text-xs'>
                      {sorting.length}
                    </span>
                  ) : null}
                </Button>
              }
            />
            <PopoverContent align='end' className='w-72'>
              <div className='grid gap-2'>
                <p className='font-medium text-sm'>Ordenar por</p>
                {LEAD_FIELDS.filter((f) => f.sortable).map((field) => {
                  const current = sorting.find((s) => s.key === field.key)
                  return (
                    <div
                      key={field.key}
                      className='flex items-center justify-between gap-2'
                    >
                      <span className='truncate text-sm'>{field.label}</span>
                      <div className='flex gap-1'>
                        <Button
                          variant={
                            current && !current.desc ? 'default' : 'outline'
                          }
                          size='xs'
                          onClick={() => toggleSort(field.key, false)}
                        >
                          Asc
                        </Button>
                        <Button
                          variant={current?.desc ? 'default' : 'outline'}
                          size='xs'
                          onClick={() => toggleSort(field.key, true)}
                        >
                          Desc
                        </Button>
                      </div>
                    </div>
                  )
                })}
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={() => setSorting([])}
                  disabled={sorting.length === 0}
                >
                  <SteelIcon icon={Cancel01Icon} strokeWidth={2} />
                  Limpar ordenação
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <Button
            size='sm'
            variant='outline'
            onClick={() => setApolloOpen(true)}
          >
            <SteelIcon icon={Download01Icon} strokeWidth={2} />
            Importar da Apollo
          </Button>
          <Button size='sm' onClick={() => setCreateOpen(true)}>
            <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
            Novo lead
          </Button>
        </div>
      </div>

      {activeFilters.length > 0 || sorting.length > 0 ? (
        <div className='flex shrink-0 flex-wrap items-center gap-1.5'>
          {activeFilters.map((f) => (
            <FilterChip
              key={`filter-${f.key}`}
              onRemove={() => setFilters((cur) => ({ ...cur, [f.key]: '' }))}
            >
              <SteelIcon
                icon={FilterIcon}
                strokeWidth={2}
                className='size-3 text-muted-foreground'
              />
              <span className='font-medium'>{f.label}</span>
              <span className='max-w-32 truncate text-muted-foreground'>
                {filters[f.key]}
              </span>
            </FilterChip>
          ))}
          {sorting.map((s) => (
            <FilterChip
              key={`sort-${s.key}`}
              onRemove={() =>
                setSorting((cur) => cur.filter((x) => x.key !== s.key))
              }
            >
              <SteelIcon
                icon={s.desc ? ArrowDown01Icon : ArrowUp01Icon}
                strokeWidth={2}
                className='size-3 text-muted-foreground'
              />
              <span className='font-medium'>{fieldLabel(s.key)}</span>
            </FilterChip>
          ))}
          <Button
            variant='ghost'
            size='xs'
            className='text-muted-foreground'
            onClick={() => {
              setFilters({})
              setSorting([])
            }}
          >
            Limpar tudo
          </Button>
        </div>
      ) : null}

      <div
        ref={boardRef}
        className='flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2'
      >
        {LEAD_STAGES.map((stage) => (
          <div
            key={stage}
            data-shortcut-column-id={stage}
            className='flex w-72 shrink-0 flex-col rounded-lg border bg-muted/30'
          >
            <div className='flex items-center justify-between border-b p-3'>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 font-medium text-xs',
                  STAGE_STYLES[stage],
                )}
              >
                {STAGE_LABELS[stage]}
              </span>
              <span className='text-muted-foreground text-xs'>
                {byStage.get(stage)?.length ?? 0}
              </span>
            </div>
            <div className='flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2'>
              {isLoading ? (
                <p className='p-2 text-muted-foreground text-xs'>Carregando…</p>
              ) : null}
              {byStage.get(stage)?.map((lead) => (
                <button
                  key={lead.id}
                  type='button'
                  data-shortcut-row={lead.id}
                  data-shortcut-column={stage}
                  onClick={() => setSelectedLeadId(lead.id)}
                  className='flex flex-col gap-1 rounded-md border bg-background p-3 text-left shadow-sm outline-none transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/50'
                >
                  <span className='truncate font-medium text-sm'>
                    {lead.name}
                  </span>
                  {lead.company ? (
                    <span className='truncate text-muted-foreground text-xs'>
                      {lead.company}
                    </span>
                  ) : null}
                  {lead.emails[0] ? (
                    <span className='truncate text-muted-foreground text-xs'>
                      {lead.emails[0]}
                    </span>
                  ) : null}
                </button>
              ))}
              {!isLoading && byStage.get(stage)?.length === 0 ? (
                <p className='p-2 text-muted-foreground text-xs'>Vazio</p>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <div className='rounded-lg border bg-muted/20 p-3'>
        <p className='mb-1.5 font-medium text-xs'>Termômetro de Interesse</p>
        <InterestThermometer value={null} />
      </div>

      <CreateLeadDialog
        workspaceId={workspaceId}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false)
          refetch()
        }}
      />

      <Sheet
        open={!!selectedLead}
        onOpenChange={(next) => {
          if (!next) setSelectedLeadId(null)
        }}
      >
        <SheetContent className='overflow-y-auto'>
          {selectedLead ? (
            <LeadPanelShortcuts onClose={() => setSelectedLeadId(null)} />
          ) : null}
          {selectedLead ? (
            <LeadStagePanel
              workspaceId={workspaceId}
              lead={selectedLead}
              onChanged={refetch}
              onClose={() => setSelectedLeadId(null)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}

/** `U` inside the lead sheet closes it (the sheet traps other keys). */
function LeadContacts({ lead }: { lead: CrmLeadDTO }) {
  return (
    <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm'>
      <dt className='text-muted-foreground'>E-mail</dt>
      <dd className='min-w-0 break-words'>
        {lead.emails.length === 0
          ? '—'
          : lead.emails.map((email) => (
              <a
                key={email}
                href={`mailto:${email}`}
                className='block hover:underline'
              >
                {email}
              </a>
            ))}
      </dd>
      <dt className='text-muted-foreground'>Telefone</dt>
      <dd className='min-w-0'>
        {lead.phones.length === 0
          ? '—'
          : lead.phones.map((phone) => (
              <a
                key={phone}
                href={`tel:${phone}`}
                className='block hover:underline'
              >
                {phone}
              </a>
            ))}
      </dd>
    </dl>
  )
}

function LeadPanelShortcuts({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLSpanElement | null>(null)
  useShortcut('crm.record.back', onClose, { ref })
  return <span ref={ref} hidden />
}

function LeadStagePanel({
  workspaceId,
  lead,
  onChanged,
  onClose,
}: {
  workspaceId: string
  lead: CrmLeadDTO
  onChanged: () => void
  onClose: () => void
}) {
  return (
    <>
      <SheetHeader>
        <div className='flex items-center gap-2'>
          <SheetTitle>{lead.name}</SheetTitle>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 font-medium text-xs',
              STAGE_STYLES[lead.stage],
            )}
          >
            {STAGE_LABELS[lead.stage]}
          </span>
          <AskSteelAiButton
            workspaceId={workspaceId}
            reference={{ kind: 'lead', label: lead.name }}
          />
        </div>
        <p className='text-muted-foreground text-sm'>
          {NEXT_STEP_HINT[lead.stage]}
        </p>
      </SheetHeader>

      <div className='flex flex-col gap-6 px-4'>
        <LeadContacts lead={lead} />

        {lead.stage === 'RECEIVED' || lead.stage === 'IN_CONTACT' ? (
          <ContactAttemptForm
            workspaceId={workspaceId}
            lead={lead}
            onChanged={onChanged}
          />
        ) : null}

        {lead.stage === 'QUALIFIED' ? (
          <QualificationForm
            workspaceId={workspaceId}
            lead={lead}
            onChanged={onChanged}
          />
        ) : null}

        {lead.stage === 'OPPORTUNITY' ? (
          <OpportunityForms
            workspaceId={workspaceId}
            lead={lead}
            onChanged={onChanged}
          />
        ) : null}

        {lead.stage === 'PROPOSAL' ? (
          <ProposalStageForms
            workspaceId={workspaceId}
            lead={lead}
            onChanged={onChanged}
          />
        ) : null}

        {lead.stage === 'CLOSED' ? (
          <ClosedSummary
            workspaceId={workspaceId}
            lead={lead}
            onChanged={onChanged}
          />
        ) : null}

        <ReopeningHistory workspaceId={workspaceId} leadId={lead.id} />
      </div>

      {lead.stage !== 'CLOSED' ? (
        <SheetFooter>
          <CloseLostAction
            workspaceId={workspaceId}
            lead={lead}
            onChanged={() => {
              onChanged()
              onClose()
            }}
          />
        </SheetFooter>
      ) : null}
    </>
  )
}

const CONTACT_CHANNELS = [
  { value: 'PHONE', label: 'Telefone' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'EMAIL', label: 'E-mail' },
  { value: 'MEETING', label: 'Reunião' },
  { value: 'OTHER', label: 'Outro' },
] as const

function ContactAttemptForm({
  workspaceId,
  lead,
  onChanged,
}: {
  workspaceId: string
  lead: CrmLeadDTO
  onChanged: () => void
}) {
  const [contactedWith, setContactedWith] = useState('')
  const [channel, setChannel] =
    useState<(typeof CONTACT_CHANNELS)[number]['value']>('WHATSAPP')
  const [outcome, setOutcome] = useState<'ATTEMPTED' | 'REACHED'>('ATTEMPTED')
  const [note, setNote] = useState('')
  const [history, setHistory] = useState<CrmLeadContactAttemptDTO[]>([])
  const registerAttempt = useRegisterCrmLeadContactAttempt(workspaceId)

  useEffect(() => {
    apiFetch<CrmLeadContactAttemptDTO[]>(
      `/api/workspaces/${workspaceId}/crm/leads/${lead.id}/contact-attempts`,
    )
      .then(setHistory)
      .catch(() => setHistory([]))
  }, [workspaceId, lead.id])

  async function handleSubmit() {
    if (!contactedWith.trim()) {
      notify.error('Informe com quem falou ou tentou falar')
      return
    }
    try {
      await registerAttempt.mutateAsync({
        leadId: lead.id,
        contactedWith: contactedWith.trim(),
        channel,
        outcome,
        note: note.trim() || undefined,
      })
      notify.success('Contato registrado')
      setContactedWith('')
      setNote('')
      onChanged()
    } catch (err) {
      notify.error(err)
    }
  }

  return (
    <div className='flex flex-col gap-3'>
      <p className='font-medium text-sm'>Registrar contato</p>
      <div className='grid gap-1.5'>
        <Label className='text-muted-foreground text-xs'>
          Com quem falou/tentou falar
        </Label>
        <Input
          value={contactedWith}
          onChange={(e) => setContactedWith(e.target.value)}
        />
      </div>
      <div className='grid grid-cols-2 gap-3'>
        <div className='grid gap-1.5'>
          <Label className='text-muted-foreground text-xs'>
            Forma de contato
          </Label>
          <Select
            value={channel}
            onValueChange={(v) => setChannel(v as typeof channel)}
          >
            <SelectTrigger className='w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONTACT_CHANNELS.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='grid gap-1.5'>
          <Label className='text-muted-foreground text-xs'>Resultado</Label>
          <Select
            value={outcome}
            onValueChange={(v) => setOutcome(v as typeof outcome)}
          >
            <SelectTrigger className='w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='ATTEMPTED'>
                Tentativa (sem resposta)
              </SelectItem>
              <SelectItem value='REACHED'>
                Contato efetivo (conversou)
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className='grid gap-1.5'>
        <Label className='text-muted-foreground text-xs'>Observação</Label>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
        />
      </div>
      <Button
        size='sm'
        onClick={handleSubmit}
        disabled={registerAttempt.isPending}
      >
        {registerAttempt.isPending ? 'Registrando…' : 'Registrar contato'}
      </Button>

      {history.length > 0 ? (
        <div className='flex flex-col gap-1.5 border-t pt-3'>
          <p className='text-muted-foreground text-xs'>Histórico</p>
          {history.map((h) => (
            <div key={h.id} className='text-xs'>
              <span className='font-medium'>{h.contactedWith}</span> ·{' '}
              {h.channel} ·{' '}
              {h.outcome === 'REACHED' ? 'contato efetivo' : 'tentativa'} ·{' '}
              {new Date(h.occurredAt).toLocaleString('pt-BR')}
            </div>
          ))}
        </div>
      ) : null}

      {lead.stage === 'IN_CONTACT' ? (
        <InterestProductsPicker workspaceId={workspaceId} lead={lead} />
      ) : null}
    </div>
  )
}

function InterestProductsPicker({
  workspaceId,
  lead,
}: {
  workspaceId: string
  lead: CrmLeadDTO
}) {
  const { items: products } = useCrmResourceList<CrmProductDTO>(
    workspaceId,
    'products',
  )
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const setInterestProducts = useSetCrmLeadInterestProducts(workspaceId)

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleSave() {
    try {
      await setInterestProducts.mutateAsync({
        leadId: lead.id,
        productIds: Array.from(selected),
      })
      notify.success('Produtos de interesse salvos')
    } catch (err) {
      notify.error(err)
    }
  }

  if (products.length === 0) return null

  return (
    <div className='flex flex-col gap-2 border-t pt-3'>
      <p className='font-medium text-sm'>Serviço(s)/produto(s) de interesse</p>
      <div className='flex flex-wrap gap-1.5'>
        {products.map((p) => (
          <button
            key={p.id}
            type='button'
            onClick={() => toggle(p.id)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-xs',
              selected.has(p.id)
                ? 'border-primary bg-primary/10 text-primary'
                : 'text-muted-foreground',
            )}
          >
            {p.name}
          </button>
        ))}
      </div>
      <Button
        size='sm'
        variant='secondary'
        className='w-fit'
        onClick={handleSave}
        disabled={setInterestProducts.isPending || selected.size === 0}
      >
        Salvar interesse
      </Button>
    </div>
  )
}

function QualificationForm({
  workspaceId,
  lead,
  onChanged,
}: {
  workspaceId: string
  lead: CrmLeadDTO
  onChanged: () => void
}) {
  const [expectedCloseAt, setExpectedCloseAt] = useState('')
  const [decisionMakerName, setDecisionMakerName] = useState('')
  const [decisionMakerRole, setDecisionMakerRole] = useState('')
  const upsertQualification = useUpsertCrmLeadQualification(workspaceId)

  async function handleSubmit() {
    if (!decisionMakerName.trim() || !decisionMakerRole.trim()) {
      notify.error('Informe o nome e o cargo do decisor')
      return
    }
    try {
      await upsertQualification.mutateAsync({
        leadId: lead.id,
        expectedCloseAt: expectedCloseAt || undefined,
        decisionMakerName: decisionMakerName.trim(),
        decisionMakerRole: decisionMakerRole.trim(),
      })
      notify.success('Lead qualificado')
      onChanged()
    } catch (err) {
      notify.error(err)
    }
  }

  return (
    <div className='flex flex-col gap-3'>
      <p className='font-medium text-sm'>Qualificar lead</p>
      <div className='grid gap-1.5'>
        <Label className='text-muted-foreground text-xs'>
          Previsão de fechamento
        </Label>
        <Input
          type='date'
          value={expectedCloseAt}
          onChange={(e) => setExpectedCloseAt(e.target.value)}
        />
      </div>
      <div className='grid gap-1.5'>
        <Label className='text-muted-foreground text-xs'>Nome do decisor</Label>
        <Input
          value={decisionMakerName}
          onChange={(e) => setDecisionMakerName(e.target.value)}
        />
      </div>
      <div className='grid gap-1.5'>
        <Label className='text-muted-foreground text-xs'>
          Cargo do decisor
        </Label>
        <Input
          value={decisionMakerRole}
          onChange={(e) => setDecisionMakerRole(e.target.value)}
        />
      </div>
      <Button
        size='sm'
        onClick={handleSubmit}
        disabled={upsertQualification.isPending}
      >
        {upsertQualification.isPending ? 'Salvando…' : 'Confirmar qualificação'}
      </Button>
    </div>
  )
}

function OpportunityForms({
  workspaceId,
  lead,
  onChanged,
}: {
  workspaceId: string
  lead: CrmLeadDTO
  onChanged: () => void
}) {
  const [scheduledAt, setScheduledAt] = useState('')
  const [format, setFormat] = useState<'IN_PERSON' | 'ONLINE'>('ONLINE')
  const [contactPersonName, setContactPersonName] = useState('')
  const [interestDetails, setInterestDetails] = useState('')
  const [identifiedNeed, setIdentifiedNeed] = useState('')
  const [proposalName, setProposalName] = useState(`Proposta ${lead.name}`)
  const [meetings, setMeetings] = useState<CrmLeadMeetingDTO[]>([])
  const registerMeeting = useRegisterCrmLeadMeeting(workspaceId)
  const createProposal = useCreateCrmLeadProposal(workspaceId)

  useEffect(() => {
    apiFetch<CrmLeadMeetingDTO[]>(
      `/api/workspaces/${workspaceId}/crm/leads/${lead.id}/meetings`,
    )
      .then(setMeetings)
      .catch(() => setMeetings([]))
  }, [workspaceId, lead.id])

  async function handleRegisterMeeting() {
    if (!interestDetails.trim() || !identifiedNeed.trim() || !scheduledAt) {
      notify.error('Preencha data, interesse e necessidade identificada')
      return
    }
    try {
      await registerMeeting.mutateAsync({
        leadId: lead.id,
        scheduledAt: new Date(scheduledAt).toISOString(),
        format,
        contactPersonName: contactPersonName.trim() || undefined,
        interestDetails: interestDetails.trim(),
        identifiedNeed: identifiedNeed.trim(),
      })
      notify.success('Reunião registrada')
      setMeetings((prev) => [...prev])
      onChanged()
      apiFetch<CrmLeadMeetingDTO[]>(
        `/api/workspaces/${workspaceId}/crm/leads/${lead.id}/meetings`,
      ).then(setMeetings)
    } catch (err) {
      notify.error(err)
    }
  }

  async function handleCreateProposal() {
    if (!proposalName.trim()) {
      notify.error('Informe o nome da proposta')
      return
    }
    try {
      await createProposal.mutateAsync({
        leadId: lead.id,
        name: proposalName.trim(),
      })
      notify.success('Proposta criada')
      onChanged()
    } catch (err) {
      notify.error(err)
    }
  }

  return (
    <div className='flex flex-col gap-6'>
      <div className='flex flex-col gap-3'>
        <p className='font-medium text-sm'>Registrar reunião</p>
        <div className='grid gap-1.5'>
          <Label className='text-muted-foreground text-xs'>
            Data e horário
          </Label>
          <Input
            type='datetime-local'
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
          />
        </div>
        <div className='grid gap-1.5'>
          <Label className='text-muted-foreground text-xs'>Formato</Label>
          <Select
            value={format}
            onValueChange={(v) => setFormat(v as typeof format)}
          >
            <SelectTrigger className='w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='IN_PERSON'>Presencial</SelectItem>
              <SelectItem value='ONLINE'>Online</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className='grid gap-1.5'>
          <Label className='text-muted-foreground text-xs'>
            Pessoa de contato
          </Label>
          <Input
            value={contactPersonName}
            onChange={(e) => setContactPersonName(e.target.value)}
          />
        </div>
        <div className='grid gap-1.5'>
          <Label className='text-muted-foreground text-xs'>
            Detalhes do interesse
          </Label>
          <Textarea
            value={interestDetails}
            onChange={(e) => setInterestDetails(e.target.value)}
            rows={2}
          />
        </div>
        <div className='grid gap-1.5'>
          <Label className='text-muted-foreground text-xs'>
            Necessidade/demanda identificada
          </Label>
          <Textarea
            value={identifiedNeed}
            onChange={(e) => setIdentifiedNeed(e.target.value)}
            rows={2}
          />
        </div>
        <Button
          size='sm'
          onClick={handleRegisterMeeting}
          disabled={registerMeeting.isPending}
        >
          {registerMeeting.isPending ? 'Registrando…' : 'Registrar reunião'}
        </Button>

        {meetings.length > 0 ? (
          <p className='text-muted-foreground text-xs'>
            {meetings.length} reunião(ões) registrada(s).
          </p>
        ) : null}
      </div>

      <div className='flex flex-col gap-3 border-t pt-4'>
        <p className='font-medium text-sm'>Criar proposta comercial</p>
        <p className='text-muted-foreground text-xs'>
          Registre ao menos uma reunião antes de criar a proposta.
        </p>
        <div className='grid gap-1.5'>
          <Label className='text-muted-foreground text-xs'>
            Nome da proposta
          </Label>
          <Input
            value={proposalName}
            onChange={(e) => setProposalName(e.target.value)}
          />
        </div>
        <Button
          size='sm'
          variant='secondary'
          onClick={handleCreateProposal}
          disabled={createProposal.isPending || meetings.length === 0}
        >
          {createProposal.isPending
            ? 'Criando…'
            : 'Criar e avançar para Proposta'}
        </Button>
      </div>
    </div>
  )
}

function ProposalStageForms({
  workspaceId,
  lead,
  onChanged,
}: {
  workspaceId: string
  lead: CrmLeadDTO
  onChanged: () => void
}) {
  const [proposalId, setProposalId] = useState<string | null>(null)
  const [presentedAt, setPresentedAt] = useState('')
  const [format, setFormat] = useState<
    'IN_PERSON' | 'ONLINE' | 'EMAIL' | 'OTHER'
  >('ONLINE')
  const [amount, setAmount] = useState('')
  const [interestLevel, setInterestLevel] =
    useState<CrmLeadInterestLevelDTO>('MEDIUM')
  const [interactionsCount, setInteractionsCount] = useState('0')
  const [notes, setNotes] = useState('')
  const [presentations, setPresentations] = useState<
    CrmLeadProposalPresentationDTO[]
  >([])
  const registerPresentation =
    useRegisterCrmLeadProposalPresentation(workspaceId)
  const closeWon = useCloseCrmLeadWon(workspaceId)
  const [contractSignedAt, setContractSignedAt] = useState('')
  const [billingType, setBillingType] = useState<
    'ONE_TIME' | 'MONTHLY' | 'YEARLY'
  >('MONTHLY')
  const [closedAmount, setClosedAmount] = useState('')

  useEffect(() => {
    apiFetch<{ id: string } | null>(
      `/api/workspaces/${workspaceId}/crm/leads/${lead.id}/proposal`,
    )
      .then((proposal) => setProposalId(proposal?.id ?? null))
      .catch(() => setProposalId(null))
  }, [workspaceId, lead.id])

  useEffect(() => {
    if (!proposalId) return
    apiFetch<CrmLeadProposalPresentationDTO[]>(
      `/api/workspaces/${workspaceId}/crm/leads/${lead.id}/proposal/${proposalId}/presentations`,
    )
      .then(setPresentations)
      .catch(() => setPresentations([]))
  }, [workspaceId, lead.id, proposalId])

  async function handleRegisterPresentation() {
    if (!proposalId) {
      notify.error('Nenhuma proposta encontrada para este lead')
      return
    }
    if (!presentedAt || !amount) {
      notify.error('Preencha data e valor da proposta')
      return
    }
    try {
      await registerPresentation.mutateAsync({
        leadId: lead.id,
        proposalId,
        presentedAt: new Date(presentedAt).toISOString(),
        format,
        amount: Number(amount),
        interestLevel,
        interactionsCount: Number(interactionsCount) || 0,
        notes: notes.trim() || undefined,
      })
      notify.success('Apresentação registrada')
      onChanged()
      apiFetch<CrmLeadProposalPresentationDTO[]>(
        `/api/workspaces/${workspaceId}/crm/leads/${lead.id}/proposal/${proposalId}/presentations`,
      ).then(setPresentations)
    } catch (err) {
      notify.error(err)
    }
  }

  async function handleCloseWon() {
    if (!contractSignedAt || !closedAmount) {
      notify.error('Preencha a data de assinatura e o valor fechado')
      return
    }
    try {
      await closeWon.mutateAsync({
        leadId: lead.id,
        contractSignedAt: new Date(contractSignedAt).toISOString(),
        billingType,
        closedAmount: Number(closedAmount),
        contractSignedConfirmed: true,
      })
      notify.success('Negócio fechado como ganho — lead convertido em pessoa')
      onChanged()
    } catch (err) {
      notify.error(err)
    }
  }

  return (
    <div className='flex flex-col gap-6'>
      <div className='flex flex-col gap-3'>
        <p className='font-medium text-sm'>Registrar apresentação</p>
        <div className='grid gap-1.5'>
          <Label className='text-muted-foreground text-xs'>
            Data da apresentação
          </Label>
          <Input
            type='datetime-local'
            value={presentedAt}
            onChange={(e) => setPresentedAt(e.target.value)}
          />
        </div>
        <div className='grid grid-cols-2 gap-3'>
          <div className='grid gap-1.5'>
            <Label className='text-muted-foreground text-xs'>Forma</Label>
            <Select
              value={format}
              onValueChange={(v) => setFormat(v as typeof format)}
            >
              <SelectTrigger className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='IN_PERSON'>Presencial</SelectItem>
                <SelectItem value='ONLINE'>Online</SelectItem>
                <SelectItem value='EMAIL'>E-mail</SelectItem>
                <SelectItem value='OTHER'>Outro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className='grid gap-1.5'>
            <Label className='text-muted-foreground text-xs'>Valor (R$)</Label>
            <Input
              type='number'
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </div>
        <div className='grid gap-1.5'>
          <Label className='text-muted-foreground text-xs'>
            Termômetro de Interesse
          </Label>
          <InterestThermometer
            value={interestLevel}
            onChange={setInterestLevel}
          />
        </div>
        <div className='grid gap-1.5'>
          <Label className='text-muted-foreground text-xs'>
            Quantidade de perguntas/interações
          </Label>
          <Input
            type='number'
            value={interactionsCount}
            onChange={(e) => setInteractionsCount(e.target.value)}
          />
        </div>
        <div className='grid gap-1.5'>
          <Label className='text-muted-foreground text-xs'>
            Observações e negociações
          </Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
        </div>
        <Button
          size='sm'
          onClick={handleRegisterPresentation}
          disabled={registerPresentation.isPending}
        >
          {registerPresentation.isPending
            ? 'Registrando…'
            : 'Registrar apresentação'}
        </Button>
        {presentations.length > 0 ? (
          <p className='text-muted-foreground text-xs'>
            {presentations.length} apresentação(ões) registrada(s).
          </p>
        ) : null}
      </div>

      <div className='flex flex-col gap-3 border-t pt-4'>
        <p className='font-medium text-sm'>Fechar como ganho</p>
        <p className='text-muted-foreground text-xs'>
          Registre ao menos uma apresentação antes de fechar.
        </p>
        <div className='grid gap-1.5'>
          <Label className='text-muted-foreground text-xs'>
            Data da assinatura do contrato
          </Label>
          <Input
            type='date'
            value={contractSignedAt}
            onChange={(e) => setContractSignedAt(e.target.value)}
          />
        </div>
        <div className='grid grid-cols-2 gap-3'>
          <div className='grid gap-1.5'>
            <Label className='text-muted-foreground text-xs'>
              Forma de cobrança
            </Label>
            <Select
              value={billingType}
              onValueChange={(v) => setBillingType(v as typeof billingType)}
            >
              <SelectTrigger className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='ONE_TIME'>Pagamento único</SelectItem>
                <SelectItem value='MONTHLY'>Mensal</SelectItem>
                <SelectItem value='YEARLY'>Anual</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className='grid gap-1.5'>
            <Label className='text-muted-foreground text-xs'>
              Valor fechado (R$)
            </Label>
            <Input
              type='number'
              value={closedAmount}
              onChange={(e) => setClosedAmount(e.target.value)}
            />
          </div>
        </div>
        <Button
          size='sm'
          onClick={handleCloseWon}
          disabled={closeWon.isPending || presentations.length === 0}
        >
          {closeWon.isPending
            ? 'Fechando…'
            : 'Confirmar contrato assinado — Ganho'}
        </Button>
      </div>
    </div>
  )
}

function ClosedSummary({
  workspaceId,
  lead,
  onChanged,
}: {
  workspaceId: string
  lead: CrmLeadDTO
  onChanged: () => void
}) {
  if (lead.closeResult === 'WON') {
    return (
      <div className='flex flex-col gap-2'>
        <Badge className='w-fit bg-emerald-500/15 text-emerald-600'>
          Ganho
        </Badge>
        <p className='text-sm'>
          Contrato assinado em{' '}
          {lead.contractSignedAt
            ? new Date(lead.contractSignedAt).toLocaleDateString('pt-BR')
            : '—'}
        </p>
        <p className='text-muted-foreground text-sm'>
          Valor: {lead.closedAmount ?? '—'} · Cobrança:{' '}
          {lead.billingType ?? '—'}
        </p>
      </div>
    )
  }
  if (lead.closeResult === 'LOST') {
    return (
      <div className='flex flex-col gap-2'>
        <Badge className='w-fit bg-rose-500/15 text-rose-600'>Perdido</Badge>
        <p className='text-sm'>Motivo: {lead.lostReason ?? '—'}</p>
        {lead.lostNote ? (
          <p className='text-muted-foreground text-sm'>{lead.lostNote}</p>
        ) : null}
        {lead.retryAt ? (
          <p className='text-muted-foreground text-xs'>
            Nova tentativa prevista para{' '}
            {new Date(lead.retryAt).toLocaleDateString('pt-BR')}
          </p>
        ) : null}
        <ReopenLeadAction
          workspaceId={workspaceId}
          lead={lead}
          onChanged={onChanged}
        />
      </div>
    )
  }
  return (
    <p className='text-muted-foreground text-sm'>Sem resultado registrado.</p>
  )
}

/**
 * Reabre um lead perdido (motivo obrigatório). O destino é a etapa das
 * configurações do CRM, limitada pelo que os registros do lead permitem —
 * o servidor decide e a mensagem de sucesso mostra onde o lead caiu.
 */
function ReopenLeadAction({
  workspaceId,
  lead,
  onChanged,
}: {
  workspaceId: string
  lead: CrmLeadDTO
  onChanged: () => void
}) {
  const canEdit = useCan('leads', 'EDIT')
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const reopen = useReopenCrmLead(workspaceId)
  const { data: settings } = useCrmSettings(open ? workspaceId : '')

  if (!canEdit) return null

  async function handleSubmit() {
    if (!reason.trim()) {
      notify.error('Informe o motivo da reabertura')
      return
    }
    try {
      const updated = await reopen.mutateAsync({
        leadId: lead.id,
        reason: reason.trim(),
      })
      notify.success(`Lead reaberto em "${STAGE_LABELS[updated.stage]}"`)
      setOpen(false)
      setReason('')
      onChanged()
    } catch (err) {
      notify.error(err)
    }
  }

  if (!open) {
    return (
      <Button
        size='sm'
        variant='outline'
        className='w-fit'
        onClick={() => setOpen(true)}
      >
        Reabrir lead
      </Button>
    )
  }

  return (
    <div className='flex flex-col gap-2 rounded-md border p-3'>
      <Label>Motivo da reabertura</Label>
      <Textarea
        placeholder='Ex.: cliente voltou a responder e pediu nova proposta'
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
      />
      <p className='text-muted-foreground text-xs'>
        {settings
          ? `O lead volta para "${STAGE_LABELS[settings.leadReopenStage]}" — ou para a etapa mais avançada que os registros dele permitem.`
          : 'O lead volta para a etapa definida nas configurações do CRM.'}{' '}
        O motivo e a perda anterior ficam no histórico.
      </p>
      <div className='flex gap-2'>
        <Button size='sm' variant='ghost' onClick={() => setOpen(false)}>
          Cancelar
        </Button>
        <Button size='sm' onClick={handleSubmit} disabled={reopen.isPending}>
          {reopen.isPending ? 'Reabrindo…' : 'Confirmar reabertura'}
        </Button>
      </div>
    </div>
  )
}

/** Reaberturas anteriores do lead (motivo + a perda que foi desfeita). */
function ReopeningHistory({
  workspaceId,
  leadId,
}: {
  workspaceId: string
  leadId: string
}) {
  const { data: reopenings } = useCrmLeadReopenings(workspaceId, leadId)
  if (!reopenings?.length) return null

  return (
    <div className='flex flex-col gap-2'>
      <p className='font-medium text-sm'>Histórico de reaberturas</p>
      <ul className='flex flex-col gap-2'>
        {reopenings.map((r) => (
          <li key={r.id} className='rounded-md border p-2 text-xs'>
            <p>
              <span className='font-medium'>
                {new Date(r.createdAt).toLocaleDateString('pt-BR')}
              </span>{' '}
              · reaberto em "{STAGE_LABELS[r.toStage]}"
            </p>
            <p className='text-muted-foreground'>Motivo: {r.reason}</p>
            {r.previousLostReason ? (
              <p className='text-muted-foreground'>
                Perda anterior: {r.previousLostReason}
                {r.previousClosedAt
                  ? ` (${new Date(r.previousClosedAt).toLocaleDateString('pt-BR')})`
                  : ''}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

function CloseLostAction({
  workspaceId,
  lead,
  onChanged,
}: {
  workspaceId: string
  lead: CrmLeadDTO
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [lostReason, setLostReason] = useState('')
  const [lostNote, setLostNote] = useState('')
  const closeLost = useCloseCrmLeadLost(workspaceId)

  async function handleSubmit() {
    if (!lostReason.trim()) {
      notify.error('Informe o motivo da perda')
      return
    }
    try {
      await closeLost.mutateAsync({
        leadId: lead.id,
        lostReason: lostReason.trim(),
        lostNote: lostNote.trim() || undefined,
      })
      notify.success('Lead marcado como perdido')
      onChanged()
    } catch (err) {
      notify.error(err)
    }
  }

  if (!open) {
    return (
      <Button size='sm' variant='ghost' onClick={() => setOpen(true)}>
        Marcar como perdido
      </Button>
    )
  }

  return (
    <div className='flex flex-col gap-2'>
      <Input
        placeholder='Motivo da perda'
        value={lostReason}
        onChange={(e) => setLostReason(e.target.value)}
      />
      <Textarea
        placeholder='Observação (opcional)'
        value={lostNote}
        onChange={(e) => setLostNote(e.target.value)}
        rows={2}
      />
      <div className='flex gap-2'>
        <Button size='sm' variant='ghost' onClick={() => setOpen(false)}>
          Cancelar
        </Button>
        <Button
          size='sm'
          variant='destructive'
          onClick={handleSubmit}
          disabled={closeLost.isPending}
        >
          {closeLost.isPending ? 'Fechando…' : 'Confirmar perda'}
        </Button>
      </div>
    </div>
  )
}

function CreateLeadDialog({
  workspaceId,
  open,
  onClose,
  onCreated,
}: {
  workspaceId: string
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [source, setSource] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function reset() {
    setName('')
    setEmail('')
    setPhone('')
    setSource('')
  }

  async function handleSubmit() {
    if (!name.trim()) {
      notify.error('Informe o nome')
      return
    }
    if (!email.trim() && !phone.trim()) {
      notify.error('Informe ao menos um email ou telefone')
      return
    }
    if (!source.trim()) {
      notify.error('Informe a origem')
      return
    }

    setSubmitting(true)
    try {
      const result = await createCrmResource<CrmLeadDTO>(workspaceId, 'leads', {
        name: name.trim(),
        emails: email.trim() ? [email.trim()] : [],
        phones: phone.trim() ? [phone.trim()] : [],
        source: source.trim(),
      })
      if (!result.ok) {
        notify.error(result.message ?? 'Não foi possível criar o lead.')
        return
      }
      notify.success('Lead criado')
      reset()
      onCreated()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset()
          onClose()
        }
      }}
    >
      <DialogContent className='w-full sm:max-w-md'>
        <DialogTitle>Novo lead</DialogTitle>
        <div className='flex flex-col gap-4'>
          <div className='grid gap-1.5'>
            <Label className='text-muted-foreground text-xs'>Nome *</Label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div className='grid gap-1.5'>
              <Label className='text-muted-foreground text-xs'>Email</Label>
              <Input
                type='email'
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className='grid gap-1.5'>
              <Label className='text-muted-foreground text-xs'>Telefone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div className='grid gap-1.5'>
            <Label className='text-muted-foreground text-xs'>Origem *</Label>
            <Input value={source} onChange={(e) => setSource(e.target.value)} />
          </div>
        </div>
        <div className='flex justify-end gap-2'>
          <Button variant='ghost' onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Criando…' : 'Criar lead'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
