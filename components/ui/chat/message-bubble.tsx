'use client'

import {
  ArrowTurnBackwardIcon,
  ArrowUpRight01Icon,
  Contact01Icon,
  Delete02Icon,
  Download01Icon,
  Robot01Icon,
  SmileIcon,
  Tick01Icon,
  TouchInteraction01Icon,
  Tick02Icon,
  UserAdd01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { MediaLightbox } from '@/components/ui/chat/media-lightbox'
import {
  quotedMessageLabel,
  QuotedMessageThumbnail,
} from '@/components/ui/chat/quoted-message-preview'
import { cn } from '@/lib/utils'
import type { WhatsAppMessageDTO } from '@/types/whatsapp-message'

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏']

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function MessageStatusTicks({
  status,
}: {
  status: WhatsAppMessageDTO['status']
}) {
  if (status === 'FAILED') {
    return <span className='text-[10px] text-destructive'>Falhou</span>
  }
  if (status === 'READ') {
    return <SteelIcon icon={Tick02Icon} size={14} className='text-primary' />
  }
  if (status === 'DELIVERED') {
    return (
      <SteelIcon
        icon={Tick02Icon}
        size={14}
        className='text-muted-foreground'
      />
    )
  }
  return (
    <SteelIcon icon={Tick01Icon} size={14} className='text-muted-foreground' />
  )
}

function MessageBubbleMedia({
  message,
  onOpenLightbox,
}: {
  message: WhatsAppMessageDTO
  onOpenLightbox: (media: { url: string; type: 'IMAGE' | 'VIDEO' }) => void
}) {
  if (!message.mediaUrl) return null
  const mediaUrl = message.mediaUrl

  switch (message.type) {
    case 'IMAGE':
    case 'STICKER':
      return (
        <button
          type='button'
          className='mb-1 block cursor-zoom-in'
          onClick={() => onOpenLightbox({ url: mediaUrl, type: 'IMAGE' })}
        >
          {/* biome-ignore lint/performance/noImgElement: media served from workspace's own MinIO bucket, not a next/image remote pattern */}
          <img
            src={mediaUrl}
            alt={message.text ?? 'Imagem'}
            className='max-w-64 rounded-md'
          />
        </button>
      )
    case 'VIDEO':
      return (
        <button
          type='button'
          className='mb-1 block cursor-zoom-in'
          onClick={() => onOpenLightbox({ url: mediaUrl, type: 'VIDEO' })}
        >
          {/* biome-ignore lint/a11y/useMediaCaption: WhatsApp media has no caption tracks */}
          <video src={mediaUrl} className='max-w-64 rounded-md' />
        </button>
      )
    case 'AUDIO':
      return (
        // biome-ignore lint/a11y/useMediaCaption: WhatsApp media has no caption tracks
        <audio src={mediaUrl} controls className='mb-1 max-w-64' />
      )
    case 'DOCUMENT':
      return (
        <a
          href={mediaUrl}
          download={message.text ?? undefined}
          target='_blank'
          rel='noreferrer'
          className='mb-1 flex items-center gap-2 rounded-md border border-current/10 px-2.5 py-2 text-sm underline-offset-2 hover:underline'
        >
          <SteelIcon icon={Download01Icon} size={16} className='shrink-0' />
          <span className='truncate'>{message.text ?? 'Documento'}</span>
        </a>
      )
    default:
      return null
  }
}

/** Buttons sent with an OUT message, the way the contact got them: reply
 * buttons are inert here (the contact clicks on their phone), links open. */
function MessageButtons({ message }: { message: WhatsAppMessageDTO }) {
  if (!message.buttons?.length) return null
  return (
    <div
      aria-label='Botões enviados'
      className='mt-1 flex w-full min-w-48 max-w-xs flex-col gap-1'
    >
      {message.buttons.map((button) =>
        button.type === 'URL' ? (
          <a
            key={button.id}
            href={button.url}
            target='_blank'
            rel='noreferrer'
            className='flex items-center justify-center gap-1.5 rounded-xl border bg-background px-3 py-1.5 font-medium text-primary text-xs shadow-xs hover:bg-muted'
          >
            <SteelIcon icon={ArrowUpRight01Icon} size={14} />
            <span className='truncate'>{button.label}</span>
          </a>
        ) : (
          <span
            key={button.id}
            aria-disabled='true'
            title='O contato responde tocando no botão'
            className='flex cursor-default items-center justify-center gap-1.5 rounded-xl border bg-background px-3 py-1.5 font-medium text-muted-foreground text-xs'
          >
            <SteelIcon icon={ArrowTurnBackwardIcon} size={14} />
            <span className='truncate'>{button.label}</span>
          </span>
        ),
      )}
    </div>
  )
}

export function MessageBubble({
  message,
  replyToMessage,
  onReply,
  onReact,
  onDelete,
  onStartConversationWithContact,
}: {
  message: WhatsAppMessageDTO
  replyToMessage?: WhatsAppMessageDTO
  onReply?: (message: WhatsAppMessageDTO) => void
  onReact?: (messageId: string, emoji: string) => void
  onDelete?: (messageId: string) => void
  onStartConversationWithContact?: (contact: {
    name: string
    waId: string
  }) => void
}) {
  const [lightboxMedia, setLightboxMedia] = useState<{
    url: string
    type: 'IMAGE' | 'VIDEO'
  } | null>(null)
  const isOutbound = message.direction === 'OUT'
  const isButtonClick = !isOutbound && message.type === 'BUTTON'
  const showTextBelowMedia =
    message.text && message.type !== 'DOCUMENT' && !isButtonClick

  return (
    <div
      className={cn('flex w-full', isOutbound ? 'justify-end' : 'justify-start')}
    >
      <ContextMenu>
        <ContextMenuTrigger>
          <div className={cn('flex flex-col', isOutbound ? 'items-end' : 'items-start')}>
            <div
              className={cn(
                'max-w-fit rounded-2xl px-3 py-2 text-sm',
                isOutbound
                  ? 'rounded-br-sm bg-primary text-primary-foreground'
                  : 'rounded-bl-sm bg-muted text-foreground',
              )}
            >
              {message.sentByAi && (
                <div className='mb-1 flex items-center gap-1 text-[10px] opacity-70'>
                  <SteelIcon icon={Robot01Icon} size={12} />
                  <span>IA</span>
                </div>
              )}
              {replyToMessage && (
                <div className='mb-1.5 flex items-center gap-2 rounded-md border-current/20 border-l-2 bg-current/5 px-2 py-1 text-xs opacity-80'>
                  <QuotedMessageThumbnail message={replyToMessage} />
                  <p className='truncate'>{quotedMessageLabel(replyToMessage)}</p>
                </div>
              )}
              {message.type === 'CONTACT' && message.contactPayload && (
                <div className='mb-1 flex min-w-48 flex-col gap-2 rounded-md border border-current/10 px-2.5 py-2'>
                  <div className='flex items-center gap-2'>
                    <SteelIcon icon={Contact01Icon} size={20} />
                    <div className='min-w-0'>
                      <p className='truncate font-medium text-sm'>
                        {message.contactPayload.name}
                      </p>
                      <p className='truncate text-xs opacity-70'>
                        {message.contactPayload.waId}
                      </p>
                    </div>
                  </div>
                  {!isOutbound && onStartConversationWithContact && (
                    <Button
                      type='button'
                      size='xs'
                      variant='secondary'
                      onClick={() =>
                        message.contactPayload &&
                        onStartConversationWithContact(message.contactPayload)
                      }
                    >
                      <SteelIcon icon={UserAdd01Icon} size={14} />
                      Iniciar conversa
                    </Button>
                  )}
                </div>
              )}
              <MessageBubbleMedia
                message={message}
                onOpenLightbox={setLightboxMedia}
              />
              {isButtonClick && (
                <p className='flex items-center gap-1.5'>
                  <SteelIcon
                    icon={TouchInteraction01Icon}
                    size={14}
                    className='shrink-0 opacity-70'
                  />
                  <span className='opacity-70'>Clicou em:</span>
                  <span className='font-medium'>{message.text ?? 'botão'}</span>
                </p>
              )}
              {showTextBelowMedia && (
                <p className='whitespace-pre-wrap break-words'>{message.text}</p>
              )}
              <div
                className={cn(
                  'mt-1 flex items-center gap-1 text-[10px]',
                  isOutbound ? 'justify-end opacity-80' : 'opacity-60',
                )}
              >
                <span>{formatTime(message.createdAt)}</span>
                {isOutbound && <MessageStatusTicks status={message.status} />}
              </div>
            </div>
            {isOutbound && <MessageButtons message={message} />}
            {message.reactionEmoji && (
              <span className='-mt-1.5 rounded-full border bg-background px-1.5 py-0.5 text-xs shadow-sm'>
                {message.reactionEmoji}
              </span>
            )}
          </div>
        </ContextMenuTrigger>
        {(onReply || onReact || onDelete) && (
          <ContextMenuContent>
            {onReply && (
              <ContextMenuItem onClick={() => onReply(message)}>
                Responder
              </ContextMenuItem>
            )}
            {onDelete && (
              <ContextMenuItem
                variant='destructive'
                onClick={() => onDelete(message.id)}
              >
                <SteelIcon icon={Delete02Icon} size={16} />
                Apagar mensagem
              </ContextMenuItem>
            )}
            {onReact && (
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <SteelIcon icon={SmileIcon} size={16} />
                  Reagir
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  {QUICK_REACTIONS.map((emoji) => (
                    <ContextMenuItem
                      key={emoji}
                      onClick={() => onReact(message.id, emoji)}
                    >
                      {emoji}
                    </ContextMenuItem>
                  ))}
                  {message.reactionEmoji && (
                    <>
                      <ContextMenuSeparator />
                      <ContextMenuItem onClick={() => onReact(message.id, '')}>
                        Remover reação
                      </ContextMenuItem>
                    </>
                  )}
                </ContextMenuSubContent>
              </ContextMenuSub>
            )}
          </ContextMenuContent>
        )}
      </ContextMenu>
      <MediaLightbox
        media={lightboxMedia}
        onOpenChange={() => setLightboxMedia(null)}
      />
    </div>
  )
}
