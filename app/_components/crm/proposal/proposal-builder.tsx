'use client'

import {
  Analytics01Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  BookmarkAdd02Icon,
  Cancel01Icon,
  SentIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Checkbox } from '@/components/ui/checkbox'
import { GhostAiProvider, GhostAiSection } from '@/components/ui/ghost-ai'
import { Input } from '@/components/ui/input'
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
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/src/hooks/_fetch'
import {
  createCrmProposal,
  saveCrmProposal,
  saveCrmProposalAsTemplate,
  sendCrmProposal,
  useCrmProposal,
} from '@/src/hooks/use-crm-proposal'
import { useCrmTextAi } from '@/src/hooks/use-crm-text-ai'
import { useCrmWorkspaceLookups } from '@/src/hooks/use-crm-workspace-lookups'
import {
  type CrmProposalSectionContent,
  CrmProposalSectionContentSchema,
  type CrmProposalSectionType,
} from '@/src/schemas/crm-proposal.schema'
import type {
  CrmProposalSectionDTO,
  CrmProposalStatusDTO,
} from '@/types/crm-proposal'
import type { CrmProposalTemplateDTO } from '@/types/crm-proposal-template'
import { ProposalExpiredHint } from './proposal-expired-hint'
import { ProposalMetricsDrawer } from './proposal-metrics-drawer'
import { ProposalPreviewPanel } from './proposal-preview-panel'
import { SECTION_ORDER, SECTION_REGISTRY } from './sections/registry'

const NONE = '__none__'

const STATUS_LABEL: Record<CrmProposalStatusDTO, string> = {
  DRAFT: 'Rascunho',
  SENT: 'Enviada',
  VIEWED: 'Visualizada',
  ACCEPTED: 'Aceita',
  REJECTED: 'Recusada',
  EXPIRED: 'Expirada',
}

const STATUS_STYLES: Record<CrmProposalStatusDTO, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  SENT: 'bg-blue-500/15 text-blue-600',
  VIEWED: 'bg-violet-500/15 text-violet-600',
  ACCEPTED: 'bg-emerald-500/15 text-emerald-600',
  REJECTED: 'bg-red-500/15 text-red-600',
  EXPIRED: 'bg-amber-500/15 text-amber-600',
}

const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' })

type SectionState = {
  type: CrmProposalSectionType
  order: number
  enabled: boolean
  content: CrmProposalSectionContent
}

function toSectionState(
  existing: CrmProposalSectionDTO[],
  ctx: { proposalName?: string; responsibleName?: string },
): SectionState[] {
  return SECTION_ORDER.map((type, index) => {
    const found = existing.find((s) => s.type === type)
    if (found) {
      return {
        type,
        order: found.order,
        enabled: found.enabled,
        content: found.content,
      }
    }
    return {
      type,
      order: index,
      enabled: false,
      content: SECTION_REGISTRY[type].createDefaultContent(ctx),
    }
  }).sort((a, b) => a.order - b.order)
}

/**
 * Valida o rascunho com o mesmo schema da API antes do autosave, para não
 * disparar requisições que seriam rejeitadas. Retorna a 1ª mensagem (pt-BR)
 * prefixada pela seção, ou null quando está tudo válido.
 */
function validateDraft(sections: SectionState[]): string | null {
  for (const section of sections) {
    const parsed = CrmProposalSectionContentSchema.safeParse(section.content)
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'Conteúdo inválido'
      return `${SECTION_REGISTRY[section.type].label}: ${message}`
    }
  }
  return null
}

/** Chave estável do que é persistido — base para detectar mudanças reais. */
function draftKey(meta: Meta, sections: SectionState[]): string {
  return JSON.stringify([meta, sections])
}

type Meta = {
  name: string
  companyId: string | null
  contactId: string | null
  opportunityId: string | null
  responsibleId: string
  validUntil: string | null
}

export function ProposalBuilder({
  workspaceId,
  slug,
  proposalId,
  currentUserId,
  initialTemplateId,
}: {
  workspaceId: string
  slug: string
  proposalId: string
  currentUserId: string
  initialTemplateId?: string
}) {
  const isNew = proposalId === 'new'
  const router = useRouter()
  const { proposal, isLoading } = useCrmProposal(
    workspaceId,
    isNew ? '' : proposalId,
  )
  const { lookups } = useCrmWorkspaceLookups(workspaceId, [
    'companies',
    'people',
    'opportunities',
    'users',
  ])

  const [realId, setRealId] = useState<string | null>(isNew ? null : proposalId)
  const [meta, setMeta] = useState<Meta>({
    name: '',
    companyId: null,
    contactId: null,
    opportunityId: null,
    responsibleId: currentUserId,
    validUntil: null,
  })
  const [sections, setSections] = useState<SectionState[]>(() =>
    toSectionState([], {}),
  )
  const [status, setStatus] = useState<CrmProposalStatusDTO>('DRAFT')
  const [shareToken, setShareToken] = useState<string | null>(null)
  const [selectedType, setSelectedType] =
    useState<CrmProposalSectionType>('COVER')
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [datePopoverOpen, setDatePopoverOpen] = useState(false)
  const [metricsOpen, setMetricsOpen] = useState(false)

  const hydrated = useRef(false)
  // Snapshot do último estado carregado/salvo: o autosave só dispara quando o
  // rascunho difere dele (nunca ao abrir a proposta ou aplicar o template).
  const baseline = useRef<string | null>(null)
  const captureBaseline = useRef(false)
  const [draftError, setDraftError] = useState<string | null>(null)

  // Nova proposta a partir de um template: pré-carrega as seções padrão.
  useEffect(() => {
    if (!isNew || !initialTemplateId) return
    apiFetch<CrmProposalTemplateDTO>(
      `/api/workspaces/${workspaceId}/crm/proposal-templates/${initialTemplateId}`,
      undefined,
      'Não foi possível carregar o template.',
    )
      .then((template) => {
        setMeta((m) => ({ ...m, name: template.name }))
        setSections(
          toSectionState(
            template.sections.map((s) => ({
              id: s.id,
              type: s.type,
              order: s.order,
              enabled: s.enabled,
              content:
                s.defaultContent ??
                SECTION_REGISTRY[s.type].createDefaultContent({}),
            })),
            { proposalName: template.name },
          ),
        )
        hydrated.current = true
        captureBaseline.current = true
      })
      .catch(() => notify.error('Não foi possível carregar o template.'))
  }, [isNew, initialTemplateId, workspaceId])

  useEffect(() => {
    if (isNew || !proposal) return
    setRealId(proposal.id)
    setMeta({
      name: proposal.name,
      companyId: proposal.companyId,
      contactId: proposal.contactId,
      opportunityId: proposal.opportunityId,
      responsibleId: proposal.responsibleId,
      validUntil: proposal.validUntil,
    })
    setSections(
      toSectionState(proposal.sections, { proposalName: proposal.name }),
    )
    setStatus(proposal.status)
    setShareToken(proposal.shareToken)
    hydrated.current = true
    captureBaseline.current = true
  }, [isNew, proposal])

  const responsibleName = lookups.maps.users[meta.responsibleId]

  // Persiste (cria na 1ª mudança, depois só faz PATCH) com debounce.
  useEffect(() => {
    if (!hydrated.current && !isNew) return
    const key = draftKey(meta, sections)
    if (captureBaseline.current) {
      // Estado recém-hidratado (proposta ou template): não é mudança do usuário.
      captureBaseline.current = false
      baseline.current = key
      return
    }
    if (key === baseline.current) {
      setDraftError(null)
      return
    }
    if (isNew && !meta.name && sections.every((s) => !s.enabled)) return

    const invalid = validateDraft(sections)
    setDraftError(invalid)
    if (invalid) return

    const timer = setTimeout(async () => {
      setSaving(true)
      const payload = {
        name: meta.name || 'Proposta sem título',
        companyId: meta.companyId,
        contactId: meta.contactId,
        opportunityId: meta.opportunityId,
        responsibleId: meta.responsibleId,
        validUntil: meta.validUntil,
        sections: sections.map((s, index) => ({
          type: s.type,
          order: index,
          enabled: s.enabled,
          content: s.content,
        })),
      }

      if (!realId) {
        const res = await createCrmProposal(workspaceId, {
          ...payload,
          companyId: payload.companyId ?? undefined,
          contactId: payload.contactId ?? undefined,
          opportunityId: payload.opportunityId ?? undefined,
          validUntil: payload.validUntil ?? undefined,
          templateId: initialTemplateId,
        })
        setSaving(false)
        if (res.ok && res.data) {
          baseline.current = key
          const created = res.data
          setRealId(created.id)
          setShareToken(created.shareToken)
          // Sem data escolhida, o servidor aplica a validade padrão da
          // workspace — traz para o estado para o próximo PATCH não limpá-la.
          if (created.validUntil) {
            setMeta((m) =>
              m.validUntil ? m : { ...m, validUntil: created.validUntil },
            )
          }
          hydrated.current = true
          router.replace(`/${slug}/crm/proposals/${res.data.id}`)
        } else {
          notify.error(res.message ?? 'Não foi possível criar a proposta.')
        }
        return
      }

      const res = await saveCrmProposal(workspaceId, realId, payload)
      setSaving(false)
      if (res.ok) {
        baseline.current = key
        // Nova validade de uma expirada (admin) a reativa no servidor.
        if (res.data?.status) setStatus(res.data.status)
      } else notify.error(res.message ?? 'Não foi possível salvar.')
    }, 800)

    return () => clearTimeout(timer)
  }, [meta, sections, realId, workspaceId])

  async function handleSend() {
    if (!realId) return
    setSending(true)
    const res = await sendCrmProposal(workspaceId, realId)
    setSending(false)
    if (res.ok && res.data) {
      setStatus(res.data.status)
      notify.success('Proposta enviada. O link público já está ativo.')
    } else {
      notify.error(res.message ?? 'Não foi possível enviar a proposta.')
    }
  }

  async function handleSaveAsTemplate() {
    if (!realId) {
      notify.error('Salve a proposta antes de gerar um template.')
      return
    }
    const res = await saveCrmProposalAsTemplate(workspaceId, realId)
    if (res.ok) {
      notify.success('Template salvo. Disponível ao criar novas propostas.')
    } else {
      notify.error(res.message ?? 'Não foi possível salvar o template.')
    }
  }

  function updateSection(
    type: CrmProposalSectionType,
    patch: Partial<SectionState>,
  ) {
    setSections((prev) =>
      prev.map((s) => (s.type === type ? { ...s, ...patch } : s)),
    )
  }

  function move(type: CrmProposalSectionType, direction: -1 | 1) {
    setSections((prev) => {
      const index = prev.findIndex((s) => s.type === type)
      const target = index + direction
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const selectedSection = sections.find((s) => s.type === selectedType)
  const shareUrl = useMemo(
    () => (shareToken ? `${window.location.origin}/p/${shareToken}` : ''),
    [shareToken],
  )
  const previewSections: CrmProposalSectionDTO[] = sections.map((s, index) => ({
    id: s.type,
    type: s.type,
    order: index,
    enabled: s.enabled,
    content: s.content,
  }))

  const assistText = useCrmTextAi(workspaceId, 'DOCUMENT', () => ({
    title: meta.name,
  }))

  if (!isNew && isLoading) {
    return (
      <div className='flex h-full flex-col gap-3 p-4'>
        <Skeleton className='h-10 w-full' />
        <Skeleton className='h-full w-full' />
      </div>
    )
  }

  return (
    <div className='flex h-full min-h-0 flex-col'>
      {/* Barra superior */}
      <div className='flex flex-col gap-3 border-b p-3'>
        <div className='flex items-center gap-2'>
          <Input
            value={meta.name}
            onChange={(e) => setMeta((m) => ({ ...m, name: e.target.value }))}
            placeholder='Nome da proposta'
            className='max-w-sm font-medium'
          />
          <Badge className={cn(STATUS_STYLES[status])}>
            {STATUS_LABEL[status]}
          </Badge>
          {draftError ? (
            <span role='alert' className='text-destructive text-xs'>
              Não salvo — {draftError}
            </span>
          ) : (
            <span className='text-muted-foreground text-xs'>
              {saving ? 'Salvando…' : ''}
            </span>
          )}
          <div className='ml-auto flex items-center gap-2'>
            {realId ? (
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() => setMetricsOpen(true)}
              >
                <SteelIcon icon={Analytics01Icon} strokeWidth={2} />
                Métricas
              </Button>
            ) : null}
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={handleSaveAsTemplate}
            >
              <SteelIcon icon={BookmarkAdd02Icon} strokeWidth={2} />
              Salvar como template
            </Button>
            {status === 'DRAFT' ? (
              <Button
                type='button'
                size='sm'
                disabled={sending || !realId}
                onClick={handleSend}
              >
                <SteelIcon icon={SentIcon} strokeWidth={2} />
                {sending ? 'Enviando…' : 'Enviar'}
              </Button>
            ) : null}
          </div>
        </div>

        {status === 'EXPIRED' ? <ProposalExpiredHint /> : null}

        <div className='flex flex-wrap items-center gap-2'>
          <Select
            value={meta.companyId ?? NONE}
            onValueChange={(v) =>
              setMeta((m) => ({ ...m, companyId: v === NONE ? null : v }))
            }
          >
            <SelectTrigger size='sm' className='w-44'>
              <SelectValue placeholder='Cliente' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>— nenhum —</SelectItem>
              {lookups.options.companies.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={meta.contactId ?? NONE}
            onValueChange={(v) =>
              setMeta((m) => ({ ...m, contactId: v === NONE ? null : v }))
            }
          >
            <SelectTrigger size='sm' className='w-44'>
              <SelectValue placeholder='Contato' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>— nenhum —</SelectItem>
              {lookups.options.people.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={meta.opportunityId ?? NONE}
            onValueChange={(v) =>
              setMeta((m) => ({ ...m, opportunityId: v === NONE ? null : v }))
            }
          >
            <SelectTrigger size='sm' className='w-44'>
              <SelectValue placeholder='Oportunidade' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>— nenhuma —</SelectItem>
              {lookups.options.opportunities.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
            <PopoverTrigger
              render={
                <button
                  type='button'
                  className='flex h-8 items-center rounded-md border px-3 text-sm hover:bg-muted/50'
                />
              }
            >
              {meta.validUntil ? (
                dateFmt.format(new Date(meta.validUntil))
              ) : (
                <span className='text-muted-foreground'>Validade</span>
              )}
            </PopoverTrigger>
            <PopoverContent align='start' className='w-auto gap-2 p-2'>
              <Calendar
                mode='single'
                selected={
                  meta.validUntil ? new Date(meta.validUntil) : undefined
                }
                onSelect={(next) => {
                  if (next) {
                    const d = new Date(next)
                    d.setHours(12, 0, 0, 0)
                    setMeta((m) => ({ ...m, validUntil: d.toISOString() }))
                  }
                  setDatePopoverOpen(false)
                }}
              />
              {meta.validUntil ? (
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={() => {
                    setMeta((m) => ({ ...m, validUntil: null }))
                    setDatePopoverOpen(false)
                  }}
                >
                  <SteelIcon icon={Cancel01Icon} strokeWidth={2} />
                  Limpar data
                </Button>
              ) : null}
            </PopoverContent>
          </Popover>

          <Select
            value={meta.responsibleId}
            onValueChange={(v) =>
              setMeta((m) => ({ ...m, responsibleId: v ?? m.responsibleId }))
            }
          >
            <SelectTrigger size='sm' className='w-44'>
              <SelectValue placeholder='Responsável'>
                {responsibleName}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {lookups.options.users.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Corpo: Seções | Conteúdo | Preview */}
      <div className='grid min-h-0 flex-1 grid-cols-[240px_1fr_1fr]'>
        {/* Seções */}
        <aside className='flex min-h-0 flex-col gap-1 overflow-y-auto border-r p-2'>
          {sections.map((section) => {
            const def = SECTION_REGISTRY[section.type]
            return (
              <div
                key={section.type}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                  selectedType === section.type
                    ? 'bg-primary/10 text-primary'
                    : 'hover:bg-muted/50',
                )}
              >
                <Checkbox
                  checked={section.enabled}
                  onCheckedChange={(checked) =>
                    updateSection(section.type, { enabled: Boolean(checked) })
                  }
                />
                <button
                  type='button'
                  className='flex flex-1 items-center gap-2 truncate text-left'
                  onClick={() => setSelectedType(section.type)}
                >
                  <SteelIcon
                    icon={def.icon}
                    strokeWidth={2}
                    className='size-4 shrink-0'
                  />
                  <span className='truncate'>{def.label}</span>
                </button>
                <div className='flex shrink-0 flex-col'>
                  <button
                    type='button'
                    aria-label='Mover para cima'
                    className='text-muted-foreground hover:text-foreground disabled:opacity-30'
                    disabled={section === sections[0]}
                    onClick={() => move(section.type, -1)}
                  >
                    <SteelIcon
                      icon={ArrowUp01Icon}
                      strokeWidth={2}
                      className='size-3'
                    />
                  </button>
                  <button
                    type='button'
                    aria-label='Mover para baixo'
                    className='text-muted-foreground hover:text-foreground disabled:opacity-30'
                    disabled={section === sections[sections.length - 1]}
                    onClick={() => move(section.type, 1)}
                  >
                    <SteelIcon
                      icon={ArrowDown01Icon}
                      strokeWidth={2}
                      className='size-3'
                    />
                  </button>
                </div>
              </div>
            )
          })}
        </aside>

        {/* Conteúdo */}
        <section className='min-h-0 overflow-y-auto border-r p-4'>
          {selectedSection ? (
            <>
              <h2 className='mb-4 font-medium text-sm text-muted-foreground'>
                {SECTION_REGISTRY[selectedSection.type].label}
                {!selectedSection.enabled ? (
                  <span className='ml-2 text-xs'>
                    (seção desabilitada — não aparece na proposta)
                  </span>
                ) : null}
              </h2>
              {(() => {
                const { Editor } = SECTION_REGISTRY[selectedSection.type]
                return (
                  <GhostAiProvider assist={assistText}>
                    <GhostAiSection
                      value={SECTION_REGISTRY[selectedSection.type].label}
                    >
                      <Editor
                        content={selectedSection.content}
                        onChange={(content: CrmProposalSectionContent) =>
                          updateSection(selectedSection.type, { content })
                        }
                        workspaceId={workspaceId}
                      />
                    </GhostAiSection>
                  </GhostAiProvider>
                )
              })()}
            </>
          ) : null}
        </section>

        {/* Preview */}
        <section className='min-h-0 overflow-hidden p-4'>
          <ProposalPreviewPanel
            name={meta.name || 'Proposta sem título'}
            sections={previewSections}
            shareUrl={shareUrl}
            canShare={status !== 'DRAFT' && Boolean(shareToken)}
          />
        </section>
      </div>

      {realId ? (
        <ProposalMetricsDrawer
          workspaceId={workspaceId}
          proposalId={realId}
          open={metricsOpen}
          onOpenChange={setMetricsOpen}
        />
      ) : null}
    </div>
  )
}
