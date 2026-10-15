'use client'

import {
  Add01Icon,
  LinkSquare02Icon,
  Search01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useNearViewport } from '@/app/_components/canvas-site/site-snapshot'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/src/hooks/_fetch'
import { emailTemplateKey } from '@/src/hooks/use-crm-email-builder'
import {
  applyVariables,
  contactToVariables,
  SAMPLE_CONTACT,
} from '@/src/lib/crm-email-builder/variables'
import type { CrmCampaignOptionsDTO } from '@/types/crm-campaign'
import type { CrmEmailTemplateDTO } from '@/types/crm-email-marketing'

type TemplateOption = CrmCampaignOptionsDTO['emailTemplates'][number]

export const EDITOR_LABEL: Record<TemplateOption['editor'], string> = {
  v2: 'Novo editor',
  v1: 'Editor antigo',
  html: 'HTML',
}

/** The rendered e-mail (600 px + margins) scaled into the card. */
const THUMB_WIDTH = 680
const THUMB_HEIGHT = 820

/** The template's last saved render, drawn small (sample contact). */
export function EmailTemplateThumbnail({
  workspaceId,
  templateId,
  name,
}: {
  workspaceId: string
  templateId: string
  name: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const near = useNearViewport(box)
  const [scale, setScale] = useState(0.35)
  // Same cache as the editor (`emailTemplateKey`), fetched near the viewport.
  const template = useQuery({
    queryKey: emailTemplateKey(workspaceId, templateId),
    enabled: near,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: () =>
      apiFetch<CrmEmailTemplateDTO>(
        `/api/workspaces/${workspaceId}/crm/email-templates/${templateId}`,
      ),
  })

  useEffect(() => {
    const node = box.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) {
        setScale(entry.contentRect.width / THUMB_WIDTH)
      }
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const html = template.data?.contentHtml
    ? applyVariables(
        template.data.contentHtml,
        contactToVariables(SAMPLE_CONTACT, { campaignLink: '#' }),
        'html',
      )
    : ''

  return (
    <div
      ref={box}
      className='relative aspect-[4/5] w-full overflow-hidden bg-muted/60'
    >
      {html ? (
        <iframe
          title={`Miniatura: ${name}`}
          srcDoc={html}
          sandbox=''
          tabIndex={-1}
          aria-hidden='true'
          className='pointer-events-none absolute top-0 left-0 origin-top-left border-0 bg-white'
          style={{
            width: THUMB_WIDTH,
            height: THUMB_HEIGHT,
            transform: `scale(${scale})`,
          }}
        />
      ) : template.isError ? null : (
        <Skeleton className='size-full rounded-none' />
      )}
      <div className='pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card to-transparent' />
    </div>
  )
}

/**
 * "Visual do e-mail": the workspace's templates as cards (thumbnail, editor
 * version), with search, plus "Criar novo template" — the full-screen
 * editor, which comes back here with the new template selected.
 */
export function EmailTemplatePicker({
  workspaceId,
  templates,
  value,
  onChange,
  onCreate,
  onOpen,
}: {
  workspaceId: string
  templates: TemplateOption[]
  value: string | null
  onChange: (templateId: string) => void
  /** Opens the template gallery (saves the draft first). */
  onCreate: () => void
  /** Opens the chosen template in the editor (saves the draft first). */
  onOpen: (templateId: string) => void
}) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const shown = templates.filter(
    (template) =>
      !needle ||
      template.name.toLowerCase().includes(needle) ||
      template.subject.toLowerCase().includes(needle),
  )
  const selected = templates.find((template) => template.id === value)

  return (
    <div className='flex min-w-0 flex-col gap-3'>
      <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
        <div className='relative min-w-0 sm:flex-1'>
          <SteelIcon
            icon={Search01Icon}
            size={16}
            className='-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 text-muted-foreground'
          />
          <Input
            aria-label='Buscar template'
            placeholder='Buscar template…'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className='pl-8'
          />
        </div>
        {selected && selected.editor !== 'html' ? (
          <Button
            type='button'
            variant='outline'
            onClick={() => onOpen(selected.id)}
          >
            <SteelIcon icon={LinkSquare02Icon} /> Abrir no editor
          </Button>
        ) : null}
      </div>
      <ul className='grid grid-cols-2 gap-3 sm:grid-cols-3'>
        <li>
          <button
            type='button'
            onClick={onCreate}
            className='flex aspect-[4/5] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-muted-foreground text-sm transition-colors hover:bg-muted/40 hover:text-foreground'
          >
            <SteelIcon icon={Add01Icon} size={22} />
            Criar novo template
          </button>
        </li>
        {shown.map((template) => {
          const active = template.id === value
          return (
            <li
              key={template.id}
              data-testid={`campaign-template-${template.id}`}
            >
              <button
                type='button'
                aria-pressed={active}
                onClick={() => onChange(template.id)}
                className={cn(
                  'flex w-full min-w-0 flex-col overflow-hidden rounded-xl border bg-card text-left transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                  active && 'border-primary ring-1 ring-primary',
                )}
              >
                <EmailTemplateThumbnail
                  workspaceId={workspaceId}
                  templateId={template.id}
                  name={template.name}
                />
                <span className='flex min-w-0 flex-col gap-1 p-2.5'>
                  <span className='truncate font-medium text-sm'>
                    {template.name}
                  </span>
                  <Badge
                    variant={template.editor === 'v2' ? 'default' : 'outline'}
                    className='self-start'
                  >
                    {EDITOR_LABEL[template.editor]}
                  </Badge>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {templates.length > 0 && shown.length === 0 ? (
        <p className='text-muted-foreground text-sm'>
          Nenhum template encontrado.
        </p>
      ) : null}
    </div>
  )
}
