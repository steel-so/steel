'use client'

import {
  Attachment01Icon,
  Cancel01Icon,
  File02Icon,
  FlashIcon,
  SentIcon,
  SmileIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import {
  type ClipboardEvent,
  type DragEvent,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useQuickSend } from '@/app/_components/shortcuts/use-quick-send'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
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
import { cn } from '@/lib/utils'
import { useSdAgents, useSdConfig } from '@/src/hooks/use-sd-config'
import {
  useDeleteSdTicketAttachment,
  useSendSdTicketMessage,
  useUploadSdTicketAttachment,
} from '@/src/hooks/use-sd-ticket-messages'
import { useSteelAgents } from '@/src/hooks/use-steel-agents'
import type { SdCannedResponseDTO } from '@/types/sd-config'
import type {
  SdMessageVisibilityDTO,
  SdTicketAttachmentDTO,
} from '@/types/sd-ticket-message'
import { SD_TONE_BORDER, SD_TONE_TEXT } from '../../sd-tone'
import { formatBytes } from '../shared/sd-tab-format'

/** `id` do campo de texto — o "Responder" do cabeçalho foca nele. */
export const SD_COMPOSER_INPUT_ID = 'sd-ticket-composer'

/** Limite por arquivo (o servidor confere de novo). */
export const SD_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024
const MAX_ATTACHMENTS = 10

interface PendingFile {
  key: string
  file: File
  status: 'uploading' | 'done' | 'error'
  attachment?: SdTicketAttachmentDTO
}

/** Respostas prontas que casam com `query` (atalho ou título). */
export function filterSdCannedResponses(
  responses: SdCannedResponseDTO[],
  query: string,
): SdCannedResponseDTO[] {
  const q = query.trim().toLowerCase()
  if (!q) return responses
  return responses.filter(
    (r) =>
      r.shortcut?.toLowerCase().includes(q) ||
      r.title.toLowerCase().includes(q),
  )
}

/** Token `@alguem` no fim do texto (menção em andamento). */
export function sdMentionQuery(text: string): string | null {
  const match = /(^|\s)@([\p{L}\p{N}._-]*)$/u.exec(text)
  return match ? (match[2] ?? '') : null
}

/**
 * Ids dos agentes escolhidos no `@` que **continuam** citados no texto: o
 * usuário pode apagar a menção depois de escolher, e aí ela não deve ir
 * para o servidor. Compara pelo nome inserido (`@Nome`).
 */
export function sdResolveMentions(
  text: string,
  picked: { id: string; name: string }[],
): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const agent of picked) {
    if (seen.has(agent.id)) continue
    if (!text.includes(`@${agent.name}`)) continue
    seen.add(agent.id)
    ids.push(agent.id)
  }
  return ids
}

let pendingSeq = 0

/** Quem foi citado com `@`: pessoa do atendimento ou Steel Agent (IA). */
interface PickedMention {
  id: string
  name: string
  kind: 'user' | 'agent'
}

export function SdMessageComposer({
  workspaceId,
  ticketRef,
  mode,
  disabled,
  disabledReason,
}: {
  workspaceId: string
  ticketRef: string
  mode: 'agent' | 'requester'
  disabled?: boolean
  disabledReason?: string
}) {
  const isAgent = mode === 'agent'
  const quickSend = useQuickSend()
  const [text, setText] = useState('')
  const [visibility, setVisibility] = useState<SdMessageVisibilityDTO>('PUBLIC')
  const [pending, setPending] = useState<PendingFile[]>([])
  const [picked, setPicked] = useState<PickedMention[]>([])
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [cannedOpen, setCannedOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const config = useSdConfig(isAgent ? workspaceId : '')
  const agents = useSdAgents(workspaceId, { enabled: isAgent })
  const steelAgents = useSteelAgents(workspaceId, isAgent)
  const send = useSendSdTicketMessage(workspaceId, ticketRef)
  const upload = useUploadSdTicketAttachment(workspaceId, ticketRef)
  const removeAttachment = useDeleteSdTicketAttachment(workspaceId, ticketRef)

  const canned = config.data?.cannedResponses ?? []
  const slashQuery = isAgent && text.startsWith('/') ? text.slice(1) : null
  const slashMatches = useMemo(
    () =>
      slashQuery === null ? [] : filterSdCannedResponses(canned, slashQuery),
    [canned, slashQuery],
  )
  const mention = isAgent ? sdMentionQuery(text) : null
  const mentionMatches = useMemo(() => {
    if (mention === null) return []
    const q = mention.toLowerCase()
    const people: PickedMention[] = (agents.data ?? [])
      .filter((a) => a.isAgent && a.name.toLowerCase().includes(q))
      .map((a) => ({ id: a.id, name: a.name, kind: 'user' }))
    const bots: PickedMention[] = (steelAgents.data ?? [])
      .filter((a) => a.enabled && a.name.toLowerCase().includes(q))
      .map((a) => ({ id: a.id, name: a.name, kind: 'agent' }))
    return [...people, ...bots].slice(0, 8)
  }, [agents.data, steelAgents.data, mention])

  const uploading = pending.some((p) => p.status === 'uploading')
  const readyIds = pending
    .filter((p) => p.status === 'done' && p.attachment)
    .map((p) => p.attachment?.id as string)
  const canSend =
    !disabled &&
    !uploading &&
    !send.isPending &&
    (text.trim().length > 0 || readyIds.length > 0)

  function addFiles(files: FileList | File[] | null) {
    if (!files || disabled) return
    const list = Array.from(files)
    const room = MAX_ATTACHMENTS - pending.length
    if (list.length > room) {
      notify.warning(`No máximo ${MAX_ATTACHMENTS} anexos por mensagem`)
    }
    for (const file of list.slice(0, Math.max(0, room))) {
      if (file.size > SD_ATTACHMENT_MAX_BYTES) {
        notify.error(`${file.name} passa de 25 MB`)
        continue
      }
      pendingSeq += 1
      const key = `f${pendingSeq}`
      setPending((prev) => [...prev, { key, file, status: 'uploading' }])
      upload.mutate(file, {
        onSuccess: (attachment) =>
          setPending((prev) =>
            prev.map((p) =>
              p.key === key ? { ...p, status: 'done', attachment } : p,
            ),
          ),
        onError: (error) => {
          notify.error(error, `Não foi possível enviar ${file.name}`)
          setPending((prev) =>
            prev.map((p) => (p.key === key ? { ...p, status: 'error' } : p)),
          )
        },
      })
    }
  }

  function discard(item: PendingFile) {
    setPending((prev) => prev.filter((p) => p.key !== item.key))
    if (item.attachment) removeAttachment.mutate(item.attachment.id)
  }

  async function submit() {
    if (!canSend) return
    try {
      await send.mutateAsync({
        body: text.trim(),
        visibility: isAgent ? visibility : 'PUBLIC',
        attachmentIds: readyIds,
        mentionedUserIds: sdResolveMentions(
          text,
          picked.filter((p) => p.kind === 'user'),
        ),
        mentionedAgentIds: sdResolveMentions(
          text,
          picked.filter((p) => p.kind === 'agent'),
        ),
      })
      setText('')
      setPending([])
      setPicked([])
    } catch (error) {
      notify.error(error, 'Erro ao enviar a mensagem')
    }
  }

  function applyCanned(response: SdCannedResponseDTO) {
    setText(response.body)
    setCannedOpen(false)
  }

  function applyMention(agent: PickedMention) {
    setText((current) =>
      current.replace(/@[\p{L}\p{N}._-]*$/u, `@${agent.name} `),
    )
    setPicked((current) =>
      current.some((a) => a.id === agent.id) ? current : [...current, agent],
    )
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData?.files ?? [])
    if (files.length > 0) {
      e.preventDefault()
      addFiles(files)
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    addFiles(e.dataTransfer?.files ?? null)
  }

  if (disabled && disabledReason) {
    return (
      <p className='shrink-0 px-4 py-3 text-center text-muted-foreground text-sm'>
        {disabledReason}
      </p>
    )
  }

  const internal = isAgent && visibility === 'INTERNAL'

  return (
    <div className='shrink-0 px-4 pt-2 pb-4 sm:px-6'>
      <div
        className={cn(
          'relative flex flex-col gap-1 rounded-lg border border-border bg-background px-2 pt-1.5 pb-1.5 transition-colors focus-within:border-ring/60',
          // Nota interna: borda tracejada no tom âmbar — sem fundo colorido.
          internal && cn('border-dashed', SD_TONE_BORDER.amber),
          dragging && 'ring-2 ring-primary ring-inset',
        )}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        data-testid='sd-composer'
      >
        {isAgent ? (
          <div
            className='flex gap-0.5 px-1'
            role='radiogroup'
            aria-label='Visibilidade'
          >
            <Button
              type='button'
              variant='ghost'
              size='xs'
              role='radio'
              aria-checked={visibility === 'PUBLIC'}
              data-sd-visibility='PUBLIC'
              onClick={() => setVisibility('PUBLIC')}
              className={cn(
                'h-6 px-1.5 font-normal text-xs hover:bg-transparent',
                visibility === 'PUBLIC'
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Público
            </Button>
            <Button
              type='button'
              variant='ghost'
              size='xs'
              role='radio'
              aria-checked={visibility === 'INTERNAL'}
              data-sd-visibility='INTERNAL'
              onClick={() => setVisibility('INTERNAL')}
              className={cn(
                'h-6 px-1.5 font-normal text-xs hover:bg-transparent',
                visibility === 'INTERNAL'
                  ? cn('font-medium', SD_TONE_TEXT.amber)
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Nota interna
            </Button>
          </div>
        ) : null}

        {pending.length > 0 ? (
          <ul className='flex flex-wrap gap-1.5' aria-label='Anexos a enviar'>
            {pending.map((p) => (
              <li
                key={p.key}
                className={cn(
                  'flex max-w-56 items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs',
                  p.status === 'error' && 'border-destructive text-destructive',
                )}
              >
                <SteelIcon icon={File02Icon} size={14} />
                <span className='truncate'>{p.file.name}</span>
                <span className='shrink-0 text-muted-foreground'>
                  {p.status === 'uploading'
                    ? 'enviando…'
                    : p.status === 'error'
                      ? 'falhou'
                      : formatBytes(p.file.size)}
                </span>
                <button
                  type='button'
                  aria-label={`Remover ${p.file.name}`}
                  onClick={() => discard(p)}
                  className='shrink-0 text-muted-foreground hover:text-foreground'
                >
                  <SteelIcon icon={Cancel01Icon} size={12} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className='relative'>
          {slashQuery !== null && slashMatches.length > 0 ? (
            <div
              role='listbox'
              aria-label='Respostas prontas'
              className='absolute bottom-full left-0 z-20 mb-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md'
            >
              {slashMatches.map((r) => (
                <div key={r.id}>
                  <button
                    type='button'
                    role='option'
                    aria-selected={false}
                    onClick={() => applyCanned(r)}
                    className='flex w-full flex-col items-start rounded px-2 py-1.5 text-left text-sm hover:bg-muted'
                  >
                    <span className='font-medium'>
                      {r.shortcut ? `/${r.shortcut} · ` : ''}
                      {r.title}
                    </span>
                    <span className='line-clamp-1 text-muted-foreground text-xs'>
                      {r.body}
                    </span>
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {mention !== null && mentionMatches.length > 0 ? (
            <div
              role='listbox'
              aria-label='Mencionar agente'
              className='absolute bottom-full left-0 z-20 mb-1 w-64 rounded-md border border-border bg-popover p-1 shadow-md'
            >
              {mentionMatches.map((a) => (
                <div key={`${a.kind}:${a.id}`}>
                  <button
                    type='button'
                    role='option'
                    aria-selected={false}
                    onClick={() => applyMention(a)}
                    className='flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted'
                  >
                    <span className='truncate'>{a.name}</span>
                    {a.kind === 'agent' ? (
                      <span className='shrink-0 text-muted-foreground text-xs'>
                        Agente de IA
                      </span>
                    ) : null}
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <Textarea
            id={SD_COMPOSER_INPUT_ID}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={onPaste}
            data-composer
            onKeyDown={(e) => {
              // Enter picks the highlighted canned reply in the `/` menu.
              if (
                e.key === 'Enter' &&
                !e.shiftKey &&
                slashQuery !== null &&
                slashMatches[0]
              ) {
                e.preventDefault()
                applyCanned(slashMatches[0])
                return
              }
              if (quickSend.isSend(e)) {
                e.preventDefault()
                void submit()
              }
            }}
            disabled={disabled}
            placeholder={
              internal
                ? 'Nota interna (o solicitante não vê)…'
                : isAgent
                  ? 'Escreva uma resposta… ( / para respostas prontas)'
                  : 'Escreva uma mensagem…'
            }
            aria-label='Mensagem'
            className='max-h-48 min-h-14 resize-none border-0 bg-transparent px-1.5 shadow-none focus-visible:ring-0 dark:bg-transparent'
          />
        </div>

        <div className='flex items-center gap-1'>
          <input
            ref={fileInput}
            type='file'
            multiple
            hidden
            data-testid='sd-composer-file'
            onChange={(e) => {
              addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <Button
            type='button'
            variant='ghost'
            size='icon-sm'
            className='text-muted-foreground'
            aria-label='Anexar arquivo'
            disabled={disabled}
            onClick={() => fileInput.current?.click()}
          >
            <SteelIcon icon={Attachment01Icon} size={16} />
          </Button>

          <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
            <PopoverTrigger
              render={
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-sm'
                  className='text-muted-foreground'
                  disabled={disabled}
                  aria-label='Emoji'
                >
                  <SteelIcon icon={SmileIcon} size={16} />
                </Button>
              }
            />
            <PopoverContent className='h-80 w-72 p-0'>
              <EmojiPicker
                className='h-full'
                onEmojiSelect={({ emoji }) => setText((c) => `${c}${emoji}`)}
              >
                <EmojiPickerSearch />
                <EmojiPickerContent />
                <EmojiPickerFooter />
              </EmojiPicker>
            </PopoverContent>
          </Popover>

          {isAgent ? (
            <Popover open={cannedOpen} onOpenChange={setCannedOpen}>
              <PopoverTrigger
                render={
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon-sm'
                    className='text-muted-foreground'
                    disabled={disabled}
                    aria-label='Respostas prontas'
                  >
                    <SteelIcon icon={FlashIcon} size={16} />
                  </Button>
                }
              />
              <PopoverContent className='max-h-72 w-80 overflow-y-auto p-1'>
                {canned.length === 0 ? (
                  <p className='p-3 text-muted-foreground text-sm'>
                    Nenhuma resposta pronta cadastrada.
                  </p>
                ) : (
                  canned.map((r) => (
                    <button
                      key={r.id}
                      type='button'
                      onClick={() => applyCanned(r)}
                      className='flex w-full flex-col items-start rounded px-2 py-1.5 text-left text-sm hover:bg-muted'
                    >
                      <span className='font-medium'>{r.title}</span>
                      <span className='line-clamp-2 text-muted-foreground text-xs'>
                        {r.body}
                      </span>
                    </button>
                  ))
                )}
              </PopoverContent>
            </Popover>
          ) : null}

          <span className='ml-auto hidden text-[11px] text-muted-foreground sm:inline'>
            {quickSend.hint}
          </span>
          <Button
            type='button'
            size='sm'
            variant={canSend ? 'default' : 'secondary'}
            onClick={() => void submit()}
            disabled={!canSend}
            aria-label='Enviar mensagem'
          >
            <SteelIcon icon={SentIcon} />
            {internal ? 'Salvar nota' : 'Enviar'}
          </Button>
        </div>
      </div>
    </div>
  )
}
