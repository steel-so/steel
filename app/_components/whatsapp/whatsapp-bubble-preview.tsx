'use client'

import {
  ArrowTurnBackwardIcon,
  ArrowUpRight01Icon,
  Call02Icon,
  Copy01Icon,
  Image01Icon,
  Pdf01Icon,
  Video01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { cn } from '@/lib/utils'

export type PreviewHeader =
  | { format: 'TEXT'; text: string }
  | {
      format: 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION'
      /** Uploaded sample; without it a placeholder stands in. */
      url?: string | null
      fileName?: string
    }

export interface PreviewButton {
  type: 'REPLY' | 'URL' | 'PHONE_NUMBER' | 'COPY_CODE'
  label: string
}

const PLACEHOLDER_ICON = {
  IMAGE: Image01Icon,
  VIDEO: Video01Icon,
  DOCUMENT: Pdf01Icon,
  LOCATION: Image01Icon,
} as const

const PLACEHOLDER_LABEL = {
  IMAGE: 'Imagem',
  VIDEO: 'Vídeo',
  DOCUMENT: 'Documento',
  LOCATION: 'Localização',
} as const

function buttonIcon(type: PreviewButton['type']) {
  if (type === 'URL') return ArrowUpRight01Icon
  if (type === 'PHONE_NUMBER') return Call02Icon
  if (type === 'COPY_CODE') return Copy01Icon
  return ArrowTurnBackwardIcon
}

function HeaderMedia({
  header,
}: {
  header: Exclude<PreviewHeader, { format: 'TEXT' }>
}) {
  if (header.url && header.format === 'IMAGE') {
    return (
      <img
        src={header.url}
        alt='Cabeçalho do template'
        className='aspect-[1.91/1] w-full rounded-md object-cover'
      />
    )
  }
  if (header.url && header.format === 'VIDEO') {
    return (
      // biome-ignore lint/a11y/useMediaCaption: preview of a WhatsApp header, no caption track exists
      <video
        src={header.url}
        className='aspect-video w-full rounded-md bg-muted object-cover'
      />
    )
  }
  if (header.url && header.format === 'DOCUMENT') {
    return (
      <div className='flex items-center gap-2 rounded-md bg-muted px-2.5 py-2 text-xs'>
        <SteelIcon icon={Pdf01Icon} size={20} className='text-destructive' />
        <span className='min-w-0 truncate'>
          {header.fileName ?? 'documento.pdf'}
        </span>
      </div>
    )
  }
  return (
    <div className='flex aspect-[1.91/1] w-full flex-col items-center justify-center gap-1 rounded-md bg-muted text-muted-foreground text-xs'>
      <SteelIcon icon={PLACEHOLDER_ICON[header.format]} size={22} />
      {PLACEHOLDER_LABEL[header.format]}
    </div>
  )
}

/** A WhatsApp-style chat bubble: header (text or media), body, footer and
 * the buttons below it, the way the contact sees the message. */
export function WhatsappBubblePreview({
  header,
  body,
  footer,
  buttons = [],
  note,
  className,
}: {
  header?: PreviewHeader | null
  body: string
  footer?: string | null
  buttons?: PreviewButton[]
  /** Small caption under the phone frame (e.g. provider caveats). */
  note?: string
  className?: string
}) {
  return (
    <div className={cn('space-y-2', className)}>
      <div
        data-slot='whatsapp-preview'
        className='rounded-lg bg-[#e5ddd5] p-4 dark:bg-muted'
      >
        <div className='mx-auto max-w-xs'>
          <div className='rounded-lg rounded-tl-none bg-background p-1 shadow-sm'>
            {header && header.format !== 'TEXT' ? (
              <HeaderMedia header={header} />
            ) : null}
            <div className='space-y-1 px-2 pt-1.5 pb-1 text-sm'>
              {header?.format === 'TEXT' && header.text ? (
                <p className='font-semibold'>{header.text}</p>
              ) : null}
              <p
                className={cn(
                  'whitespace-pre-wrap break-words',
                  !body && 'text-muted-foreground italic',
                )}
              >
                {body || 'O texto da mensagem aparece aqui'}
              </p>
              {footer ? (
                <p className='text-muted-foreground text-xs'>{footer}</p>
              ) : null}
              <p className='text-right text-[10px] text-muted-foreground'>
                10:42
              </p>
            </div>
          </div>
          {buttons.length > 0 ? (
            <div className='mt-1 space-y-1'>
              {buttons.map((button, index) => (
                <div
                  key={`${button.label}-${index}`}
                  className='flex items-center justify-center gap-1.5 rounded-lg bg-background py-2 font-medium text-primary text-sm shadow-sm'
                >
                  <SteelIcon icon={buttonIcon(button.type)} size={14} />
                  <span className='truncate'>
                    {button.label || `Botão ${index + 1}`}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {note ? <p className='text-muted-foreground text-xs'>{note}</p> : null}
    </div>
  )
}
