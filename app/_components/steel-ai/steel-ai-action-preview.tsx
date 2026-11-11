import {
  ArrowRight02Icon,
  LinkSquare02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { SteelIcon } from '@/components/icon/icon'
import type { AiToolPreviewDTO } from '@/types/steel-ai'

/** pt-BR names of the record types the AI tools point at. */
const TARGET_LABEL: Record<string, string> = {
  crm_company: 'Empresa',
  crm_dashboard: 'Painel',
  crm_document: 'Documento',
  crm_form: 'Formulário',
  crm_lead: 'Lead',
  crm_note: 'Nota',
  crm_opportunity: 'Oportunidade',
  crm_person: 'Contato',
  crm_task: 'Tarefa',
  sd_config_item: 'Item de configuração',
  sd_kb_article: 'Artigo',
  sd_ticket: 'Chamado',
  whatsapp_broadcast: 'Disparo',
  whatsapp_contact: 'Contato',
  whatsapp_conversation: 'Conversa',
  whatsapp_quick_reply: 'Resposta rápida',
}

/**
 * Label of a preview target type. A type that is already readable text is
 * kept; an unknown internal key (`crm_something`) falls back to "Registro".
 */
export function steelAiTargetLabel(type: string): string {
  const known = TARGET_LABEL[type]
  if (known) return known
  return /^[a-z0-9_]*$/.test(type) ? 'Registro' : type
}

/**
 * Body shared by the assistant's pending-action card and the agent approval
 * card: summary, the before → after fields and the record it touches.
 */
export function SteelAiActionPreview({
  preview,
}: {
  preview: AiToolPreviewDTO
}) {
  return (
    <>
      {preview.summary ? (
        <p className='text-muted-foreground text-sm leading-relaxed'>
          {preview.summary}
        </p>
      ) : null}

      {preview.fields && preview.fields.length > 0 ? (
        <dl className='divide-y divide-border/60 rounded-lg bg-muted/50 text-xs'>
          {preview.fields.map((field) => (
            <div
              key={field.label}
              className='grid gap-0.5 px-3 py-2 sm:grid-cols-[minmax(0,9rem)_1fr] sm:gap-3'
            >
              <dt className='text-muted-foreground'>{field.label}</dt>
              <dd className='flex min-w-0 flex-wrap items-center gap-1.5'>
                {field.before != null && field.before !== '' ? (
                  <>
                    <span className='break-words text-muted-foreground line-through'>
                      {field.before}
                    </span>
                    <SteelIcon
                      icon={ArrowRight02Icon}
                      strokeWidth={2}
                      aria-label='passa a ser'
                      className='size-3 shrink-0 text-muted-foreground'
                    />
                  </>
                ) : null}
                <span className='break-words font-medium'>
                  {field.after != null && field.after !== ''
                    ? field.after
                    : '—'}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {preview.target ? (
        <p className='flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs'>
          <span className='text-muted-foreground'>
            {steelAiTargetLabel(preview.target.type)}
          </span>
          {preview.target.href ? (
            <Link
              href={preview.target.href}
              className='inline-flex min-w-0 items-center gap-1 break-words font-medium text-primary underline-offset-2 hover:underline'
            >
              {preview.target.label}
              <SteelIcon
                icon={LinkSquare02Icon}
                strokeWidth={2}
                className='size-3 shrink-0'
              />
            </Link>
          ) : (
            <span className='break-words font-medium'>
              {preview.target.label}
            </span>
          )}
        </p>
      ) : null}
    </>
  )
}
