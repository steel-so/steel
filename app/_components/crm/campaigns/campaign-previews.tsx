'use client'

import {
  ComputerIcon,
  LinkSquare02Icon,
  SmartPhone01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { cn } from '@/lib/utils'
import type {
  CrmCampaignEmailPreviewDTO,
  CrmCampaignTemplateButtonDTO,
  CrmCampaignVariableSourceDTO,
} from '@/types/crm-campaign'

/** Sample contact of the previews (same as the e-mail preview's). */
export const SAMPLE_NAME = 'Maria Silva'

/** The rendered campaign e-mail in a desktop (600 px) or mobile frame. */
export function EmailPreview({
  preview,
  loading,
  className,
}: {
  preview: CrmCampaignEmailPreviewDTO | undefined
  loading: boolean
  className?: string
}) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  if (loading) {
    return <div className='h-80 animate-pulse rounded-xl bg-muted' />
  }
  if (!preview) {
    return (
      <p className='rounded-xl border border-dashed p-6 text-center text-muted-foreground text-sm'>
        Salve para ver a prévia.
      </p>
    )
  }
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <div className='flex min-w-0 items-center justify-between gap-2'>
        <p className='min-w-0 truncate text-sm'>
          <span className='text-muted-foreground'>Assunto: </span>
          {preview.subject}
        </p>
        <fieldset className='flex shrink-0 rounded-md border p-0.5'>
          <legend className='sr-only'>Dispositivo da prévia</legend>
          {(
            [
              { id: 'desktop', label: 'Computador', icon: ComputerIcon },
              { id: 'mobile', label: 'Celular', icon: SmartPhone01Icon },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type='button'
              aria-label={item.label}
              aria-pressed={device === item.id}
              onClick={() => setDevice(item.id)}
              className={cn(
                'rounded px-2 py-1 text-muted-foreground transition-colors hover:text-foreground',
                device === item.id && 'bg-muted text-foreground',
              )}
            >
              <SteelIcon icon={item.icon} size={16} />
            </button>
          ))}
        </fieldset>
      </div>
      <div className='flex min-w-0 justify-center overflow-hidden rounded-xl border bg-muted/40 p-2'>
        <iframe
          title={
            device === 'mobile'
              ? 'Prévia do e-mail no celular'
              : 'Prévia do e-mail'
          }
          sandbox=''
          srcDoc={preview.html}
          className={cn(
            'h-[28rem] rounded-lg border-0 bg-white',
            device === 'mobile' ? 'w-[375px] max-w-full' : 'w-full',
          )}
        />
      </div>
    </div>
  )
}

/** A template text with `{{n}}` filled from the campaign mapping. */
export function fillTemplateText(
  text: string,
  mapping: Record<string, CrmCampaignVariableSourceDTO> | undefined,
  sample: { name: string; link: string },
): string {
  return text.replace(/\{\{\s*(\d+)\s*\}\}/g, (token, index: string) => {
    const source = mapping?.[index]
    switch (source?.source) {
      case 'name':
        return sample.name
      case 'first_name':
        return sample.name.split(/\s+/)[0] ?? sample.name
      case 'link':
        return sample.link
      case 'link_code':
        return 'abc123'
      case 'static':
        return source.value || token
      default:
        return token
    }
  })
}

/** Z-API text with `{nome}`, `{primeiro_nome}` and `{link}` filled. */
export function fillZapiText(
  text: string,
  sample: { name: string; link: string },
): string {
  return text
    .replaceAll('{primeiro_nome}', sample.name.split(/\s+/)[0] ?? sample.name)
    .replaceAll('{nome}', sample.name)
    .replaceAll('{link}', sample.link)
}

/**
 * A WhatsApp message as the contact sees it: optional media/text header,
 * the body and the buttons under the bubble.
 */
export function WhatsAppBubble({
  header,
  mediaUrl,
  body,
  buttons,
}: {
  header?: string | null
  /** Image to show, or a label for video/document headers. */
  mediaUrl?: string | null
  body: string
  buttons: CrmCampaignTemplateButtonDTO[]
}) {
  const image = mediaUrl && /\.(png|jpe?g|gif|webp)(\?|$)/i.test(mediaUrl)
  return (
    <figure
      aria-label='Prévia da mensagem de WhatsApp'
      className='flex w-full max-w-xs flex-col gap-1 rounded-xl bg-muted/40 p-3'
    >
      <div className='flex flex-col gap-2 rounded-lg rounded-tl-none border bg-card p-2 text-sm shadow-xs'>
        {mediaUrl ? (
          image ? (
            <img
              src={mediaUrl}
              alt='Mídia do cabeçalho'
              className='max-h-40 w-full rounded-md object-cover'
            />
          ) : (
            <span className='rounded-md bg-muted px-2 py-6 text-center text-muted-foreground text-xs'>
              Mídia anexada
            </span>
          )
        ) : null}
        {header ? <p className='font-semibold'>{header}</p> : null}
        <p className='whitespace-pre-wrap break-words'>{body}</p>
      </div>
      {buttons.length > 0 ? (
        <ul className='flex flex-col gap-1'>
          {buttons.map((button) => (
            <li
              key={`${button.type}-${button.label}`}
              className='flex items-center justify-center gap-1.5 rounded-lg border bg-card px-2 py-1.5 text-primary text-sm'
            >
              {button.type === 'URL' ? (
                <SteelIcon icon={LinkSquare02Icon} size={14} />
              ) : null}
              {button.label}
            </li>
          ))}
        </ul>
      ) : null}
    </figure>
  )
}
