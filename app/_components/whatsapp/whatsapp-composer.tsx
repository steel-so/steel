'use client'

import {
  Attachment01Icon,
  Camera01Icon,
  Cancel01Icon,
  Contact01Icon,
  File02Icon,
  FlashIcon,
  Folder01Icon,
  Mic01Icon,
  SentIcon,
  SmileIcon,
  Task01Icon,
  Video01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { type ChangeEvent, useRef, useState } from 'react'
import { useQuickSend } from '@/app/_components/shortcuts/use-quick-send'
import {
  contactRecordPhone,
  contactRecordTitle,
} from '@/app/_components/whatsapp/whatsapp-contact-label'
import { SteelIcon } from '@/components/icon/icon'
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from '@/components/ui/attachment'
import { Button } from '@/components/ui/button'
import {
  QuotedMessageThumbnail,
  quotedMessageLabel,
} from '@/components/ui/chat/quoted-message-preview'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  EmojiPicker,
  EmojiPickerContent,
  EmojiPickerFooter,
  EmojiPickerSearch,
} from '@/components/ui/emoji-picker'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { isApiErrorCode } from '@/src/hooks/_fetch'
import { useUser } from '@/src/hooks/use-user'
import { useWhatsAppContacts } from '@/src/hooks/use-whatsapp-contacts'
import { useUploadWhatsAppMedia } from '@/src/hooks/use-whatsapp-media-upload'
import {
  useSendWhatsAppContactMessage,
  useSendWhatsAppMediaMessage,
  useSendWhatsAppTemplateMessage,
  useSendWhatsAppTextMessage,
} from '@/src/hooks/use-whatsapp-messages'
import {
  useSendWhatsAppQuickReply,
  useWhatsAppQuickReplies,
} from '@/src/hooks/use-whatsapp-quick-replies'
import { useWhatsAppTemplates } from '@/src/hooks/use-whatsapp-templates'
import { TEMPLATE_STATUS_LABEL } from '@/src/lib/whatsapp/button-editor'
import {
  fileNameFromUrl,
  findExactQuickReply,
  mediaTypeFromUrl,
} from '@/src/lib/whatsapp/quick-reply-match'
import {
  extractTemplateFillableFields,
  hasFillableFields,
  parseMetaTemplateComponents,
  renderQuickReplyBody,
} from '@/src/lib/whatsapp/template-variables'
import type {
  WhatsAppMessageDTO,
  WhatsAppMessageTypeDTO,
} from '@/types/whatsapp-message'
import type { WhatsAppQuickReplyDTO } from '@/types/whatsapp-quick-reply'
import type { WhatsAppTemplateDTO } from '@/types/whatsapp-template'
import { WhatsappButtonsSummary } from './buttons/whatsapp-buttons-editor'
import { FlowSendDialog } from './flows/flow-send-dialog'
import {
  QUICK_REPLY_LIST_ID,
  QuickReplyOption,
  QuickReplySlashMenu,
  useQuickReplySlash,
} from './quick-reply-slash-menu'
import { TemplateQualityBadge } from './template-quality-badge'
import { TemplateVariablesDialog } from './template-variables-dialog'
import { WhatsappCopilotMenu } from './whatsapp-copilot-menu'

function mediaTypeFromMime(mime: string): WhatsAppMessageTypeDTO {
  if (mime.startsWith('image/')) return 'IMAGE'
  if (mime.startsWith('video/')) return 'VIDEO'
  if (mime.startsWith('audio/')) return 'AUDIO'
  return 'DOCUMENT'
}

interface StagedAttachment {
  id: string
  name: string
  /** Bytes of a local file; null for a quick reply's stored media. */
  size: number | null
  type: WhatsAppMessageTypeDTO
  previewUrl?: string
  status: 'uploading' | 'done' | 'error'
  uploadedUrl?: string
}

/** WhatsApp caps a media caption; longer text goes as its own message. */
const MAX_CAPTION_LENGTH = 1024

/** A quick reply's media, already stored: staged as a finished upload. */
function stagedFromQuickReplyMedia(mediaUrl: string): StagedAttachment {
  const type = mediaTypeFromUrl(mediaUrl)
  return {
    id: `qr:${mediaUrl}`,
    name: fileNameFromUrl(mediaUrl),
    size: null,
    type,
    previewUrl: type === 'IMAGE' ? mediaUrl : undefined,
    status: 'done',
    uploadedUrl: mediaUrl,
  }
}

function revokePreview(attachment: StagedAttachment) {
  if (attachment.previewUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(attachment.previewUrl)
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function useAudioRecorder(onRecorded: (blob: Blob) => void) {
  const [isRecording, setIsRecording] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        })
        for (const track of stream.getTracks()) track.stop()
        onRecorded(blob)
      }

      recorder.start()
      recorderRef.current = recorder
      setIsRecording(true)
    } catch {
      notify.error('Não foi possível acessar o microfone')
    }
  }

  function stop() {
    recorderRef.current?.stop()
    setIsRecording(false)
  }

  return { isRecording, start, stop }
}

/** Id of the message textarea (the `R` shortcut focuses it). */
export const WHATSAPP_COMPOSER_INPUT_ID = 'whatsapp-composer-input'

export { quickReplyQueryOf } from '@/src/lib/whatsapp/quick-reply-match'

export function WhatsappComposer({
  workspaceId,
  conversationId,
  contactName,
  disabled,
  replyTarget,
  onClearReply,
}: {
  workspaceId: string
  conversationId: string
  contactName?: string | null
  disabled?: boolean
  replyTarget?: WhatsAppMessageDTO | null
  onClearReply?: () => void
}) {
  const [text, setText] = useState('')
  const quickSend = useQuickSend()
  const [attachments, setAttachments] = useState<StagedAttachment[]>([])
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [quickReplyOpen, setQuickReplyOpen] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [pendingTemplate, setPendingTemplate] =
    useState<WhatsAppTemplateDTO | null>(null)
  const [variablesDialogOpen, setVariablesDialogOpen] = useState(false)
  const [shareContactOpen, setShareContactOpen] = useState(false)
  const [flowOpen, setFlowOpen] = useState(false)
  // A quick reply with buttons goes as-is through its own endpoint (a text
  // send would drop the buttons), so it is staged instead of filling the box.
  const [stagedQuickReply, setStagedQuickReply] =
    useState<WhatsAppQuickReplyDTO | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const currentUser = useUser()
  const quickReplies = useWhatsAppQuickReplies(workspaceId)
  const templates = useWhatsAppTemplates(workspaceId)
  const contacts = useWhatsAppContacts(workspaceId)
  const sendText = useSendWhatsAppTextMessage(workspaceId, conversationId)
  const sendMedia = useSendWhatsAppMediaMessage(workspaceId, conversationId)
  const sendTemplate = useSendWhatsAppTemplateMessage(
    workspaceId,
    conversationId,
  )
  const sendContact = useSendWhatsAppContactMessage(workspaceId, conversationId)
  const sendQuickReply = useSendWhatsAppQuickReply(workspaceId, conversationId)
  const uploadMedia = useUploadWhatsAppMedia(workspaceId)

  const audioRecorder = useAudioRecorder(async (blob) => {
    try {
      const file = new File(
        [blob],
        `audio.${blob.type.includes('ogg') ? 'ogg' : 'webm'}`,
        {
          type: blob.type,
        },
      )
      const uploaded = await uploadMedia.mutateAsync(file)
      await sendMedia.mutateAsync({ mediaUrl: uploaded.url, type: 'AUDIO' })
    } catch {
      notify.error('Erro ao enviar áudio')
    }
  })

  function renderQuickReply(quickReply: WhatsAppQuickReplyDTO): string {
    return renderQuickReplyBody(quickReply.body, {
      contactName,
      userName: currentUser.data?.name,
    })
  }

  function stageQuickReplyMedia(quickReply: WhatsAppQuickReplyDTO) {
    const { mediaUrl } = quickReply
    if (!mediaUrl) return
    const staged = stagedFromQuickReplyMedia(mediaUrl)
    setAttachments((current) =>
      current.some((a) => a.id === staged.id) ? current : [...current, staged],
    )
  }

  /** Picks a quick reply: one with buttons is staged to go as-is; any
   * other fills the draft (`replace`, or appended) and stages its media. */
  function pickQuickReply(quickReply: WhatsAppQuickReplyDTO, replace: boolean) {
    if (quickReply.buttons.length > 0) {
      setStagedQuickReply(quickReply)
      if (replace) setText('')
      return
    }
    setText((current) =>
      replace
        ? renderQuickReply(quickReply)
        : `${current}${renderQuickReply(quickReply)}`,
    )
    stageQuickReplyMedia(quickReply)
  }

  async function sendStagedQuickReply(quickReply: WhatsAppQuickReplyDTO) {
    try {
      await sendQuickReply.mutateAsync({
        quickReplyId: quickReply.id,
        variables: {
          nome_cliente: contactName?.trim() || 'cliente',
          nome_usuario: currentUser.data?.name?.trim() || 'atendente',
        },
      })
      setStagedQuickReply(null)
      setText('')
    } catch (error) {
      if (isApiErrorCode(error, 'WHATSAPP_BUTTONS_UNSUPPORTED')) {
        notify.error(
          'A Meta não aceita botões em mensagens com mais de 1024 caracteres. Encurte o texto da mensagem rápida para enviar com botões.',
        )
        return
      }
      notify.error(error, 'Erro ao enviar mensagem rápida')
    }
  }

  // `/saudacao` + Enter (or a click in the picker): the draft becomes the
  // reply, its media is staged, and the agent sends when ready.
  const slash = useQuickReplySlash({
    text,
    quickReplies: quickReplies.data,
    onApply: (quickReply) => pickQuickReply(quickReply, true),
  })

  const isUploading = attachments.some((a) => a.status === 'uploading')
  const isBusy =
    sendText.isPending ||
    sendMedia.isPending ||
    uploadMedia.isPending ||
    sendQuickReply.isPending
  const isDisabled = Boolean(disabled) || isBusy || isUploading
  const hasAttachments = attachments.length > 0

  function removeAttachment(id: string) {
    setAttachments((current) => {
      const target = current.find((a) => a.id === id)
      if (target) revokePreview(target)
      return current.filter((a) => a.id !== id)
    })
  }

  async function handleSend() {
    if (isDisabled) return
    if (stagedQuickReply) {
      await sendStagedQuickReply(stagedQuickReply)
      return
    }

    // The send button (or the quick-send key with the picker closed) on an
    // exact `/shortcut`: send the reply itself, never the literal command.
    const exact = hasAttachments
      ? null
      : findExactQuickReply(quickReplies.data ?? [], text)
    if (exact?.buttons.length) {
      await sendStagedQuickReply(exact)
      return
    }
    if (exact) {
      await send(
        renderQuickReply(exact).trim(),
        exact.mediaUrl ? [stagedFromQuickReplyMedia(exact.mediaUrl)] : [],
      )
      return
    }
    await send(text.trim(), attachments)
  }

  async function send(trimmed: string, staged: StagedAttachment[]) {
    if (staged.length > 0) {
      const ready = staged.filter((a) => a.status === 'done' && a.uploadedUrl)
      if (ready.length === 0) return
      const captionFits = trimmed.length <= MAX_CAPTION_LENGTH
      try {
        for (const [index, attachment] of ready.entries()) {
          await sendMedia.mutateAsync({
            mediaUrl: attachment.uploadedUrl as string,
            type: attachment.type,
            fileName: attachment.name,
            caption:
              index === 0 && captionFits ? trimmed || undefined : undefined,
            replyToMessageId: index === 0 ? replyTarget?.id : undefined,
          })
        }
        if (trimmed && !captionFits) {
          await sendText.mutateAsync({ text: trimmed })
        }
        for (const attachment of ready) revokePreview(attachment)
        const sentIds = new Set(ready.map((a) => a.id))
        setAttachments((current) => current.filter((a) => !sentIds.has(a.id)))
        setText('')
        onClearReply?.()
      } catch {
        notify.error('Erro ao enviar arquivo')
      }
      return
    }

    if (!trimmed) return
    try {
      await sendText.mutateAsync({
        text: trimmed,
        replyToMessageId: replyTarget?.id,
      })
      setText('')
      onClearReply?.()
    } catch {
      notify.error('Erro ao enviar mensagem')
    }
  }

  function handleFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const id = crypto.randomUUID()
    const type = mediaTypeFromMime(file.type)
    const previewUrl =
      type === 'IMAGE' || type === 'VIDEO'
        ? URL.createObjectURL(file)
        : undefined

    setAttachments((current) => [
      ...current,
      {
        id,
        name: file.name,
        size: file.size,
        type,
        previewUrl,
        status: 'uploading',
      },
    ])

    uploadMedia.mutate(file, {
      onSuccess: (uploaded) => {
        setAttachments((current) =>
          current.map((a) =>
            a.id === id
              ? { ...a, status: 'done', uploadedUrl: uploaded.url }
              : a,
          ),
        )
      },
      onError: () => {
        notify.error('Erro ao enviar arquivo')
        setAttachments((current) =>
          current.map((a) => (a.id === id ? { ...a, status: 'error' } : a)),
        )
      },
    })
  }

  return (
    <div className='border-t p-2'>
      {replyTarget && (
        <div className='mb-2 flex items-center justify-between gap-2 rounded-md border-primary border-l-2 bg-muted/50 px-2.5 py-1.5'>
          <div className='flex min-w-0 items-center gap-2'>
            <QuotedMessageThumbnail message={replyTarget} />
            <div className='min-w-0'>
              <p className='font-medium text-primary text-xs'>Respondendo</p>
              <p className='truncate text-muted-foreground text-xs'>
                {quotedMessageLabel(replyTarget)}
              </p>
            </div>
          </div>
          <Button
            type='button'
            variant='ghost'
            size='icon-sm'
            aria-label='Cancelar resposta'
            onClick={onClearReply}
          >
            <SteelIcon icon={Cancel01Icon} size={14} />
          </Button>
        </div>
      )}
      {stagedQuickReply && (
        <div className='mb-2 rounded-md border bg-muted/50 px-2.5 py-2'>
          <div className='flex items-start justify-between gap-2'>
            <div className='min-w-0 space-y-1'>
              <p className='font-medium text-xs'>
                Mensagem rápida com botões · /
                {stagedQuickReply.shortcut.replace(/^\/+/, '')}
              </p>
              <p className='line-clamp-2 whitespace-pre-wrap text-muted-foreground text-xs'>
                {renderQuickReply(stagedQuickReply)}
              </p>
              <WhatsappButtonsSummary buttons={stagedQuickReply.buttons} />
              <p className='text-[11px] text-muted-foreground'>
                Vai como está{stagedQuickReply.mediaUrl ? ', com o anexo' : ''}{' '}
                e os botões. Para mudar o texto, edite a mensagem rápida.
              </p>
            </div>
            <Button
              type='button'
              variant='ghost'
              size='icon-sm'
              aria-label='Cancelar mensagem rápida'
              onClick={() => setStagedQuickReply(null)}
            >
              <SteelIcon icon={Cancel01Icon} size={14} />
            </Button>
          </div>
        </div>
      )}
      {hasAttachments && (
        <AttachmentGroup className='mb-2 px-0.5'>
          {attachments.map((attachment) => (
            <Attachment key={attachment.id} size='sm' state={attachment.status}>
              <AttachmentMedia
                variant={attachment.previewUrl ? 'image' : 'icon'}
              >
                {attachment.previewUrl && attachment.type === 'IMAGE' ? (
                  <img src={attachment.previewUrl} alt={attachment.name} />
                ) : (
                  <SteelIcon icon={File02Icon} size={16} />
                )}
              </AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>{attachment.name}</AttachmentTitle>
                <AttachmentDescription>
                  {attachment.status === 'uploading'
                    ? 'Enviando…'
                    : attachment.status === 'error'
                      ? 'Falha no envio'
                      : attachment.size === null
                        ? 'Anexo da mensagem rápida'
                        : formatFileSize(attachment.size)}
                </AttachmentDescription>
              </AttachmentContent>
              <AttachmentActions>
                <AttachmentAction
                  aria-label='Remover anexo'
                  onClick={() => removeAttachment(attachment.id)}
                >
                  <SteelIcon icon={Cancel01Icon} size={14} />
                </AttachmentAction>
              </AttachmentActions>
            </Attachment>
          ))}
        </AttachmentGroup>
      )}
      {/* Wraps when the pane is narrow (tablet with the conversation list
          open): the message box then takes its own line instead of shrinking
          to a sliver beside the tool buttons. */}
      <div className='flex flex-wrap items-end gap-1.5'>
        <input
          ref={photoInputRef}
          type='file'
          accept='image/*'
          className='hidden'
          onChange={handleFileSelected}
        />
        <input
          ref={videoInputRef}
          type='file'
          accept='video/*'
          className='hidden'
          onChange={handleFileSelected}
        />
        <input
          ref={fileInputRef}
          type='file'
          className='hidden'
          onChange={handleFileSelected}
        />

        <Popover open={quickReplyOpen} onOpenChange={setQuickReplyOpen}>
          <PopoverTrigger
            render={
              <Button
                variant='ghost'
                size='icon-sm'
                disabled={isDisabled}
                aria-label='Mensagem rápida'
              >
                <SteelIcon icon={FlashIcon} size={18} />
              </Button>
            }
          />
          <PopoverContent align='start' className='w-72 p-1'>
            <div className='max-h-64 overflow-y-auto'>
              {quickReplies.data?.length ? (
                quickReplies.data.map((qr) => (
                  <QuickReplyOption
                    key={qr.id}
                    quickReply={qr}
                    onClick={() => {
                      pickQuickReply(qr, false)
                      setQuickReplyOpen(false)
                    }}
                  />
                ))
              ) : (
                <p className='p-2 text-muted-foreground text-xs'>
                  Nenhuma mensagem rápida cadastrada
                </p>
              )}
            </div>
          </PopoverContent>
        </Popover>

        <Popover open={templateOpen} onOpenChange={setTemplateOpen}>
          <PopoverTrigger
            render={
              <Button
                variant='ghost'
                size='icon-sm'
                disabled={isDisabled}
                aria-label='Template'
              >
                <SteelIcon icon={File02Icon} size={18} />
              </Button>
            }
          />
          <PopoverContent align='start' className='w-72 p-1'>
            <div className='max-h-64 overflow-y-auto'>
              {templates.data?.length ? (
                templates.data.map((template) => (
                  <button
                    key={template.id}
                    type='button'
                    className='flex w-full flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50'
                    disabled={
                      template.status !== 'APPROVED' || sendTemplate.isPending
                    }
                    onClick={async () => {
                      setTemplateOpen(false)
                      const fields = extractTemplateFillableFields(
                        parseMetaTemplateComponents(template.components),
                      )
                      if (hasFillableFields(fields)) {
                        setPendingTemplate(template)
                        setVariablesDialogOpen(true)
                        return
                      }
                      try {
                        await sendTemplate.mutateAsync({
                          templateName: template.name,
                          language: template.language,
                        })
                      } catch {
                        notify.error('Erro ao enviar template')
                      }
                    }}
                  >
                    <span className='flex w-full min-w-0 items-center gap-1.5 font-medium'>
                      <TemplateQualityBadge quality={template.quality} />
                      <span className='truncate'>{template.name}</span>
                    </span>
                    <span className='text-muted-foreground text-xs'>
                      {template.language} ·{' '}
                      {TEMPLATE_STATUS_LABEL[template.status]}
                    </span>
                  </button>
                ))
              ) : (
                <p className='p-2 text-muted-foreground text-xs'>
                  Nenhum template sincronizado
                </p>
              )}
            </div>
          </PopoverContent>
        </Popover>

        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
          <PopoverTrigger
            render={
              <Button
                variant='ghost'
                size='icon-sm'
                disabled={isDisabled}
                aria-label='Emoji'
              >
                <SteelIcon icon={SmileIcon} size={18} />
              </Button>
            }
          />
          <PopoverContent className='h-80 w-72 p-0'>
            <EmojiPicker
              className='h-full'
              onEmojiSelect={({ emoji }) => {
                setText((current) => `${current}${emoji}`)
              }}
            >
              <EmojiPickerSearch />
              <EmojiPickerContent />
              <EmojiPickerFooter />
            </EmojiPicker>
          </PopoverContent>
        </Popover>

        <WhatsappCopilotMenu
          workspaceId={workspaceId}
          conversationId={conversationId}
          text={text}
          onTextChange={setText}
          disabled={isDisabled}
        />

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant='ghost'
                size='icon-sm'
                disabled={isDisabled}
                aria-label='Anexo'
              >
                <SteelIcon icon={Attachment01Icon} size={18} />
              </Button>
            }
          />
          <DropdownMenuContent align='start'>
            <DropdownMenuItem onClick={() => photoInputRef.current?.click()}>
              <SteelIcon icon={Camera01Icon} size={16} />
              Foto
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => videoInputRef.current?.click()}>
              <SteelIcon icon={Video01Icon} size={16} />
              Vídeo
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
              <SteelIcon icon={Folder01Icon} size={16} />
              Arquivo
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setShareContactOpen(true)}>
              <SteelIcon icon={Contact01Icon} size={16} />
              Contato
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setFlowOpen(true)}>
              <SteelIcon icon={Task01Icon} size={16} />
              Formulário (Flow)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          type='button'
          variant={audioRecorder.isRecording ? 'destructive' : 'ghost'}
          size='icon-sm'
          disabled={isDisabled}
          aria-label={
            audioRecorder.isRecording ? 'Parar gravação' : 'Gravar áudio'
          }
          onClick={() =>
            audioRecorder.isRecording
              ? audioRecorder.stop()
              : audioRecorder.start()
          }
        >
          <SteelIcon icon={Mic01Icon} size={18} />
        </Button>

        <div className='relative min-w-48 flex-1'>
          <QuickReplySlashMenu
            matches={slash.matches}
            activeIndex={slash.activeIndex}
            onApply={slash.apply}
          />
          <Textarea
            id={WHATSAPP_COMPOSER_INPUT_ID}
            data-composer
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (slash.onKeyDown(event)) return
              if (quickSend.isSend(event)) {
                event.preventDefault()
                handleSend()
              }
            }}
            placeholder='Digite uma mensagem'
            aria-label='Mensagem'
            aria-controls={slash.open ? QUICK_REPLY_LIST_ID : undefined}
            title={quickSend.hint}
            disabled={isDisabled}
            className='max-h-32 min-h-9 w-full resize-none'
            rows={1}
          />
        </div>

        <Button
          type='button'
          size='icon-sm'
          disabled={
            isDisabled ||
            (stagedQuickReply
              ? false
              : hasAttachments
                ? !attachments.some((a) => a.status === 'done')
                : !text.trim())
          }
          aria-label='Enviar'
          onClick={handleSend}
        >
          <SteelIcon icon={SentIcon} size={16} />
        </Button>
      </div>

      <TemplateVariablesDialog
        template={pendingTemplate}
        open={variablesDialogOpen}
        onOpenChange={setVariablesDialogOpen}
        isSubmitting={sendTemplate.isPending}
        onConfirm={async (components) => {
          if (!pendingTemplate) return
          try {
            await sendTemplate.mutateAsync({
              templateName: pendingTemplate.name,
              language: pendingTemplate.language,
              components,
            })
            setVariablesDialogOpen(false)
            setPendingTemplate(null)
          } catch {
            notify.error('Erro ao enviar template')
          }
        }}
      />

      <FlowSendDialog
        workspaceId={workspaceId}
        conversationId={conversationId}
        open={flowOpen}
        onOpenChange={setFlowOpen}
      />

      <Dialog open={shareContactOpen} onOpenChange={setShareContactOpen}>
        <DialogContent className='max-w-sm'>
          <DialogHeader>
            <DialogTitle>Enviar contato</DialogTitle>
          </DialogHeader>
          <div className='max-h-72 overflow-y-auto'>
            {contacts.data?.length ? (
              contacts.data.map((contact) => (
                <button
                  key={contact.id}
                  type='button'
                  disabled={sendContact.isPending}
                  className='flex w-full flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50'
                  onClick={async () => {
                    try {
                      await sendContact.mutateAsync({ contactId: contact.id })
                      setShareContactOpen(false)
                    } catch {
                      notify.error('Erro ao enviar contato')
                    }
                  }}
                >
                  <span className='font-medium'>
                    {contactRecordTitle(contact)}
                  </span>
                  <span className='text-muted-foreground text-xs'>
                    {contactRecordPhone(contact)}
                  </span>
                </button>
              ))
            ) : (
              <p className='p-2 text-muted-foreground text-xs'>
                Nenhum contato cadastrado
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
