'use client'

import {
  ArrowDown01Icon,
  ArrowUp01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useEffect, useRef, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Checkbox } from '@/components/ui/checkbox'
import { GhostAiProvider, GhostAiSection } from '@/components/ui/ghost-ai'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/src/hooks/_fetch'
import {
  createCrmProposalTemplate,
  updateCrmProposalTemplate,
} from '@/src/hooks/use-crm-proposal-template'
import { useCrmTextAi } from '@/src/hooks/use-crm-text-ai'
import type {
  CrmProposalSectionContent,
  CrmProposalSectionType,
} from '@/src/schemas/crm-proposal.schema'
import type { CrmProposalTemplateDTO } from '@/types/crm-proposal-template'
import { SECTION_ORDER, SECTION_REGISTRY } from './sections/registry'

type SectionState = {
  type: CrmProposalSectionType
  order: number
  enabled: boolean
  defaultContent?: CrmProposalSectionContent
}

function toSectionState(
  existing: CrmProposalTemplateDTO['sections'],
): SectionState[] {
  return SECTION_ORDER.map((type, index) => {
    const found = existing.find((s) => s.type === type)
    if (found) {
      return {
        type,
        order: found.order,
        enabled: found.enabled,
        defaultContent: found.defaultContent ?? undefined,
      }
    }
    return { type, order: index, enabled: false }
  }).sort((a, b) => a.order - b.order)
}

export function ProposalTemplateEditor({
  workspaceId,
  templateId,
}: {
  workspaceId: string
  templateId: string
}) {
  const isNew = templateId === 'new'
  const [realId, setRealId] = useState<string | null>(isNew ? null : templateId)
  const [isLoading, setIsLoading] = useState(!isNew)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [sections, setSections] = useState<SectionState[]>(() =>
    toSectionState([]),
  )
  const [selectedType, setSelectedType] =
    useState<CrmProposalSectionType>('COVER')
  const [saving, setSaving] = useState(false)
  const hydrated = useRef(false)

  useEffect(() => {
    if (isNew) return
    apiFetch<CrmProposalTemplateDTO>(
      `/api/workspaces/${workspaceId}/crm/proposal-templates/${templateId}`,
      undefined,
      'Não foi possível carregar o template.',
    )
      .then((template) => {
        setName(template.name)
        setDescription(template.description ?? '')
        setSections(toSectionState(template.sections))
        hydrated.current = true
      })
      .catch(() => notify.error('Não foi possível carregar o template.'))
      .finally(() => setIsLoading(false))
  }, [isNew, workspaceId, templateId])

  useEffect(() => {
    if (!hydrated.current && !isNew) return
    if (isNew && !name && sections.every((s) => !s.enabled)) return

    const timer = setTimeout(async () => {
      setSaving(true)
      const payload = {
        name: name || 'Template sem nome',
        description: description || undefined,
        sections: sections.map((s, index) => ({
          type: s.type,
          order: index,
          enabled: s.enabled,
          defaultContent: s.defaultContent,
        })),
      }

      if (!realId) {
        const res = await createCrmProposalTemplate(workspaceId, payload)
        setSaving(false)
        if (res.ok && res.data) {
          setRealId(res.data.id)
          hydrated.current = true
        } else {
          notify.error(res.message ?? 'Não foi possível criar o template.')
        }
        return
      }

      const res = await updateCrmProposalTemplate(workspaceId, realId, payload)
      setSaving(false)
      if (!res.ok) notify.error(res.message ?? 'Não foi possível salvar.')
    }, 800)

    return () => clearTimeout(timer)
  }, [name, description, sections, realId, workspaceId])

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

  const assistText = useCrmTextAi(workspaceId, 'DOCUMENT', () => ({
    title: name,
  }))

  if (isLoading) {
    return (
      <div className='flex h-full flex-col gap-3 p-4'>
        <Skeleton className='h-10 w-full' />
        <Skeleton className='h-full w-full' />
      </div>
    )
  }

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='flex flex-col gap-2 border-b p-3'>
        <div className='flex items-center gap-2'>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='Nome do template'
            className='max-w-sm font-medium'
          />
          <span className='text-muted-foreground text-xs'>
            {saving ? 'Salvando…' : ''}
          </span>
        </div>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder='Descrição (opcional)'
          className='max-w-md'
        />
      </div>

      <div className='grid min-h-0 flex-1 grid-cols-[240px_1fr]'>
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

        <section className='min-h-0 overflow-y-auto p-4'>
          {selectedSection ? (
            <>
              <h2 className='mb-4 font-medium text-sm text-muted-foreground'>
                {SECTION_REGISTRY[selectedSection.type].label}
                <span className='ml-2 text-xs'>
                  (conteúdo padrão — opcional, pode ficar em branco)
                </span>
              </h2>
              {selectedSection.defaultContent ? (
                (() => {
                  const { Editor } = SECTION_REGISTRY[selectedSection.type]
                  const content = selectedSection.defaultContent
                  return (
                    <GhostAiProvider assist={assistText}>
                      <GhostAiSection
                        value={SECTION_REGISTRY[selectedSection.type].label}
                      >
                        <Editor
                          content={content}
                          onChange={(next: CrmProposalSectionContent) =>
                            updateSection(selectedSection.type, {
                              defaultContent: next,
                            })
                          }
                          workspaceId={workspaceId}
                        />
                      </GhostAiSection>
                    </GhostAiProvider>
                  )
                })()
              ) : (
                <button
                  type='button'
                  className='text-primary text-sm underline'
                  onClick={() =>
                    updateSection(selectedSection.type, {
                      defaultContent: SECTION_REGISTRY[
                        selectedSection.type
                      ].createDefaultContent({ proposalName: name }),
                    })
                  }
                >
                  Definir conteúdo padrão para esta seção
                </button>
              )}
            </>
          ) : null}
        </section>
      </div>
    </div>
  )
}
