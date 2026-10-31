'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  useReplyWhatsAppSocialComment,
  useWhatsAppSocialComments,
} from '@/src/hooks/use-whatsapp-meta-channels'
import type { WhatsAppMessageDTO } from '@/types/whatsapp-message'
import type { WhatsAppSocialCommentDTO } from '@/types/whatsapp-meta-channel'

type ReplyMode = 'PUBLIC' | 'PRIVATE'

function CommentRow({
  comment,
  text,
  onReply,
  isPending,
  blocked,
}: {
  comment: WhatsAppSocialCommentDTO
  text: string
  onReply: (mode: ReplyMode, text: string) => Promise<boolean>
  isPending: boolean
  blocked: boolean
}) {
  const [mode, setMode] = useState<ReplyMode | null>(null)
  const [draft, setDraft] = useState('')

  async function submit() {
    if (!mode || !draft.trim()) return
    if (await onReply(mode, draft.trim())) {
      setMode(null)
      setDraft('')
    }
  }

  return (
    <div className='space-y-2 rounded-md border bg-background p-3'>
      <p className='whitespace-pre-wrap text-sm'>{text}</p>
      <div className='flex flex-wrap items-center gap-2 text-xs'>
        {comment.repliedAt ? (
          <span className='text-muted-foreground'>Respondido</span>
        ) : (
          <span className='font-medium'>Sem resposta</span>
        )}
        {comment.permalink && /^https?:\/\//i.test(comment.permalink) ? (
          <a
            href={comment.permalink}
            target='_blank'
            rel='noopener noreferrer'
            className='underline underline-offset-2'
          >
            Ver publicação
          </a>
        ) : null}
        <Button size='xs' variant='outline' onClick={() => setMode('PUBLIC')}>
          Responder em público
        </Button>
        <Button size='xs' variant='outline' onClick={() => setMode('PRIVATE')}>
          Responder por mensagem
        </Button>
      </div>
      {mode ? (
        <div className='space-y-2'>
          <Textarea
            value={draft}
            maxLength={2000}
            rows={3}
            placeholder={
              mode === 'PUBLIC'
                ? 'Resposta pública sob o comentário'
                : 'Mensagem direta ao autor (uma por comentário, em até 7 dias)'
            }
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className='flex justify-end gap-2'>
            <Button size='xs' variant='ghost' onClick={() => setMode(null)}>
              Cancelar
            </Button>
            <Button
              size='xs'
              disabled={isPending || blocked || !draft.trim()}
              onClick={submit}
            >
              {isPending ? 'Enviando...' : 'Enviar'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Comments of a conversation that came from an Instagram post or a Page post,
 * with the public and private reply actions. Renders nothing for a
 * conversation without comments (every WhatsApp conversation).
 */
export function WhatsappSocialCommentsBanner({
  workspaceId,
  conversationId,
  contactWaId,
  messages,
  disabled,
}: {
  workspaceId: string
  conversationId: string
  contactWaId: string
  messages: WhatsAppMessageDTO[]
  disabled: boolean
}) {
  const isSocial =
    contactWaId.startsWith('ig:') || contactWaId.startsWith('fb:')
  const comments = useWhatsAppSocialComments(
    workspaceId,
    conversationId,
    isSocial,
  )
  const reply = useReplyWhatsAppSocialComment(workspaceId, conversationId)
  const list = comments.data ?? []
  if (!isSocial || list.length === 0) return null

  const textOf = (messageId: string) =>
    messages.find((message) => message.id === messageId)?.text ?? ''

  function handleReply(messageId: string) {
    return (mode: ReplyMode, text: string) =>
      new Promise<boolean>((resolve) => {
        reply.mutate(
          { messageId, mode, text },
          {
            onSuccess: () => {
              notify.success(
                mode === 'PUBLIC'
                  ? 'Resposta publicada'
                  : 'Mensagem enviada ao autor',
              )
              resolve(true)
            },
            onError: (error) => {
              notify.error(error, 'Não foi possível responder')
              resolve(false)
            },
          },
        )
      })
  }

  return (
    <div className='max-h-64 space-y-2 overflow-y-auto border-b bg-muted px-4 py-3'>
      <p className='font-medium text-sm'>
        Comentários em publicações ({list.length})
      </p>
      {list.map((comment) => (
        <CommentRow
          key={comment.messageId}
          comment={comment}
          text={textOf(comment.messageId)}
          onReply={handleReply(comment.messageId)}
          isPending={reply.isPending}
          blocked={disabled}
        />
      ))}
    </div>
  )
}
