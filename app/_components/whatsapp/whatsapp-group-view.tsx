'use client'

import {
  Add01Icon,
  Copy01Icon,
  Delete02Icon,
  FlashIcon,
  SentIcon,
  Settings02Icon,
  ShieldUserIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { type FormEvent, useRef, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { MessageScroller } from '@/components/ui/chat/message-scroller'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { useUser } from '@/src/hooks/use-user'
import { useWhatsAppContacts } from '@/src/hooks/use-whatsapp-contacts'
import {
  useSendWhatsAppGroupTextMessage,
  useWhatsAppGroupMessages,
} from '@/src/hooks/use-whatsapp-group-messages'
import {
  useAddWhatsAppGroupParticipants,
  useLeaveWhatsAppGroup,
  useRemoveWhatsAppGroupParticipants,
  useSetWhatsAppGroupAdmin,
  useUpdateWhatsAppGroup,
  useWhatsAppGroupInviteLink,
} from '@/src/hooks/use-whatsapp-groups'
import { useWhatsAppQuickReplies } from '@/src/hooks/use-whatsapp-quick-replies'
import { findExactQuickReply } from '@/src/lib/whatsapp/quick-reply-match'
import { renderQuickReplyBody } from '@/src/lib/whatsapp/template-variables'
import type {
  WhatsAppGroupDTO,
  WhatsAppGroupParticipantDTO,
} from '@/types/whatsapp-group'
import type { WhatsAppGroupMessageDTO } from '@/types/whatsapp-group-message'
import type { WhatsAppQuickReplyDTO } from '@/types/whatsapp-quick-reply'
import {
  QUICK_REPLY_LIST_ID,
  QuickReplyOption,
  QuickReplySlashMenu,
  useQuickReplySlash,
} from './quick-reply-slash-menu'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function mentionPattern(label: string, flags = 'u'): RegExp {
  return new RegExp(`@${escapeRegExp(label)}(?![\\w])`, flags)
}

function sortByLabelLengthDesc(
  participants: WhatsAppGroupParticipantDTO[],
): WhatsAppGroupParticipantDTO[] {
  return [...participants].sort(
    (a, b) => (b.name ?? b.waId).length - (a.name ?? a.waId).length,
  )
}

// Z-API only renders a WhatsApp @mention when the message text contains the
// participant's literal phone number (e.g. "@5511999999999"), not their
// display name — so the friendly "@Nome" typed in the composer has to be
// swapped for "@waId" right before sending. Deriving mentions from the text
// itself (rather than tracking picker selections separately) means a
// deleted "@Nome" naturally drops out and a manually typed one still counts.
function buildOutgoingGroupMessage(
  text: string,
  participants: WhatsAppGroupParticipantDTO[],
): { text: string; mentionedWaIds: string[] } {
  let outgoing = text
  const mentionedWaIds: string[] = []

  for (const participant of sortByLabelLengthDesc(participants)) {
    const label = participant.name ?? participant.waId
    if (mentionPattern(label).test(outgoing)) {
      mentionedWaIds.push(participant.waId)
      outgoing = outgoing.replace(
        mentionPattern(label, 'gu'),
        `@${participant.waId}`,
      )
    }
  }

  return { text: outgoing, mentionedWaIds }
}

// Reverse of the above, for display: turns the "@waId" wire format that was
// actually sent back into "@Nome" so already-sent messages don't show raw
// phone numbers in the thread.
function formatIncomingGroupText(
  text: string,
  participants: WhatsAppGroupParticipantDTO[],
): string {
  let display = text

  for (const participant of sortByLabelLengthDesc(participants)) {
    if (!participant.name) continue
    display = display.replace(
      mentionPattern(participant.waId, 'gu'),
      `@${participant.name}`,
    )
  }

  return display
}

function GroupMessageBubble({
  message,
  participants,
}: {
  message: WhatsAppGroupMessageDTO
  participants: WhatsAppGroupParticipantDTO[]
}) {
  const isOutbound = message.direction === 'OUT'

  return (
    <div
      className={cn(
        'flex w-full',
        isOutbound ? 'justify-end' : 'justify-start',
      )}
    >
      <div
        className={cn(
          'flex flex-col',
          isOutbound ? 'items-end' : 'items-start',
        )}
      >
        {!isOutbound && message.senderName && (
          <span className='mb-0.5 px-1 font-medium text-primary text-xs'>
            {message.senderName}
          </span>
        )}
        <div
          className={cn(
            'max-w-fit rounded-2xl px-3 py-2 text-sm',
            isOutbound
              ? 'rounded-br-sm bg-primary text-primary-foreground'
              : 'rounded-bl-sm bg-muted text-foreground',
          )}
        >
          <p className='whitespace-pre-wrap break-words'>
            {message.text
              ? formatIncomingGroupText(message.text, participants)
              : message.text}
          </p>
          <div
            className={cn(
              'mt-1 text-[10px]',
              isOutbound ? 'text-right opacity-80' : 'opacity-60',
            )}
          >
            {new Date(message.createdAt).toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function GroupSettingsDialog({
  workspaceId,
  group,
  open,
  onOpenChange,
  onLeft,
}: {
  workspaceId: string
  group: WhatsAppGroupDTO
  open: boolean
  onOpenChange: (open: boolean) => void
  onLeft: () => void
}) {
  const [name, setName] = useState(group.name)
  const [description, setDescription] = useState(group.description ?? '')
  const [newParticipant, setNewParticipant] = useState<string>()
  const [removeParticipantTarget, setRemoveParticipantTarget] = useState<{
    waId: string
    label: string
  } | null>(null)
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false)

  const contacts = useWhatsAppContacts(workspaceId)
  const updateGroup = useUpdateWhatsAppGroup(workspaceId, group.id)
  const addParticipants = useAddWhatsAppGroupParticipants(workspaceId, group.id)
  const removeParticipants = useRemoveWhatsAppGroupParticipants(
    workspaceId,
    group.id,
  )
  const setAdmin = useSetWhatsAppGroupAdmin(workspaceId, group.id)
  const inviteLink = useWhatsAppGroupInviteLink(workspaceId, group.id)
  const leaveGroup = useLeaveWhatsAppGroup(workspaceId)

  const availableContacts = (contacts.data ?? []).filter(
    (contact) => !group.participants.some((p) => p.waId === contact.waId),
  )

  function handleSaveInfo(event: FormEvent) {
    event.preventDefault()
    updateGroup.mutate(
      { name: name.trim(), description: description.trim() },
      {
        onSuccess: () => notify.success('Grupo atualizado'),
        onError: (error) => notify.error(error, 'Erro ao atualizar grupo'),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>Configurações do grupo</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSaveInfo} className='space-y-3'>
          <div className='space-y-1.5'>
            <Label htmlFor='groupSettingsName'>Nome</Label>
            <Input
              id='groupSettingsName'
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='groupSettingsDescription'>Descrição</Label>
            <Textarea
              id='groupSettingsDescription'
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <Button type='submit' size='sm' disabled={updateGroup.isPending}>
            Salvar
          </Button>
        </form>

        <div className='space-y-1.5 border-t pt-3'>
          <Label>Link de convite</Label>
          <div className='flex gap-2'>
            <Input readOnly value={group.inviteLink ?? ''} placeholder='—' />
            <Button
              type='button'
              variant='outline'
              size='icon-sm'
              disabled={inviteLink.isPending}
              onClick={() =>
                inviteLink.mutate(undefined, {
                  onSuccess: (result) => {
                    navigator.clipboard.writeText(result.inviteLink)
                    notify.success('Link copiado')
                  },
                  onError: (error) =>
                    notify.error(error, 'Erro ao obter link de convite'),
                })
              }
            >
              <SteelIcon icon={Copy01Icon} size={14} />
            </Button>
          </div>
        </div>

        <div className='space-y-1.5 border-t pt-3'>
          <Label>Participantes ({group.participants.length})</Label>
          <div className='max-h-40 space-y-0.5 overflow-y-auto'>
            {group.participants.map((participant) => (
              <div
                key={participant.waId}
                className='flex items-center justify-between gap-2 rounded-sm px-1 py-1 text-sm hover:bg-muted'
              >
                <span className='truncate'>
                  {participant.name ?? participant.waId}
                  {participant.role === 'ADMIN' && (
                    <span className='ml-1.5 text-[10px] text-muted-foreground'>
                      admin
                    </span>
                  )}
                </span>
                <div className='flex shrink-0 items-center gap-1'>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon-sm'
                    aria-label={
                      participant.role === 'ADMIN'
                        ? 'Remover admin'
                        : 'Tornar admin'
                    }
                    disabled={setAdmin.isPending}
                    onClick={() =>
                      setAdmin.mutate({
                        waId: participant.waId,
                        admin: participant.role !== 'ADMIN',
                      })
                    }
                  >
                    <SteelIcon icon={ShieldUserIcon} size={14} />
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon-sm'
                    aria-label='Remover participante'
                    disabled={removeParticipants.isPending}
                    onClick={() =>
                      setRemoveParticipantTarget({
                        waId: participant.waId,
                        label: participant.name ?? participant.waId,
                      })
                    }
                  >
                    <SteelIcon icon={Delete02Icon} size={14} />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {availableContacts.length > 0 && (
            <div className='flex gap-2 pt-1'>
              <select
                className='h-9 flex-1 rounded-md border bg-background px-2 text-sm'
                value={newParticipant ?? ''}
                onChange={(event) =>
                  setNewParticipant(event.target.value || undefined)
                }
              >
                <option value=''>Selecione um contato</option>
                {availableContacts.map((contact) => (
                  <option key={contact.id} value={contact.waId}>
                    {contact.name ?? contact.waId}
                  </option>
                ))}
              </select>
              <Button
                type='button'
                variant='outline'
                size='icon-sm'
                disabled={!newParticipant || addParticipants.isPending}
                onClick={() => {
                  if (!newParticipant) return
                  addParticipants.mutate([newParticipant], {
                    onSuccess: () => setNewParticipant(undefined),
                  })
                }}
              >
                <SteelIcon icon={Add01Icon} size={14} />
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type='button'
            variant='destructive'
            disabled={leaveGroup.isPending}
            onClick={() => setLeaveConfirmOpen(true)}
          >
            Sair do grupo
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog
        open={removeParticipantTarget !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setRemoveParticipantTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover participante</AlertDialogTitle>
            <AlertDialogDescription>
              {removeParticipantTarget?.label} será removido deste grupo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeParticipants.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              disabled={removeParticipants.isPending}
              onClick={() => {
                if (!removeParticipantTarget) return
                removeParticipants.mutate([removeParticipantTarget.waId], {
                  onSuccess: () => setRemoveParticipantTarget(null),
                  onError: (error) =>
                    notify.error(error, 'Erro ao remover participante'),
                })
              }}
            >
              {removeParticipants.isPending ? 'Removendo...' : 'Remover'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={leaveConfirmOpen} onOpenChange={setLeaveConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sair do grupo</AlertDialogTitle>
            <AlertDialogDescription>
              Você vai sair de "{group.name}" e não vai mais receber mensagens
              dele.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={leaveGroup.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              disabled={leaveGroup.isPending}
              onClick={() => {
                leaveGroup.mutate(group.id, {
                  onSuccess: () => {
                    setLeaveConfirmOpen(false)
                    onOpenChange(false)
                    onLeft()
                  },
                  onError: (error) =>
                    notify.error(error, 'Erro ao sair do grupo'),
                })
              }}
            >
              {leaveGroup.isPending ? 'Saindo...' : 'Sair do grupo'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}

export function WhatsappGroupView({
  workspaceId,
  group,
  onLeft,
}: {
  workspaceId: string
  group: WhatsAppGroupDTO
  onLeft?: () => void
}) {
  const [text, setText] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [quickReplyOpen, setQuickReplyOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const messages = useWhatsAppGroupMessages(workspaceId, group.id)
  const sendText = useSendWhatsAppGroupTextMessage(workspaceId, group.id)
  const quickReplies = useWhatsAppQuickReplies(workspaceId)
  const currentUser = useUser()

  // Groups send text only: a quick reply's media is not attached here.
  function renderQuickReply(quickReply: WhatsAppQuickReplyDTO): string {
    return renderQuickReplyBody(quickReply.body, {
      contactName: null,
      userName: currentUser.data?.name,
    })
  }

  const slash = useQuickReplySlash({
    text,
    quickReplies: quickReplies.data,
    onApply: (quickReply) => setText(renderQuickReply(quickReply)),
  })

  const mentionCandidates =
    mentionQuery === null
      ? []
      : group.participants.filter((p) =>
          (p.name ?? p.waId).toLowerCase().includes(mentionQuery.toLowerCase()),
        )

  function handleTextChange(value: string, cursor: number) {
    setText(value)
    const upToCursor = value.slice(0, cursor)
    const match = upToCursor.match(/(?:^|\s)@([^\s@]*)$/)
    setMentionQuery(match ? match[1] : null)
  }

  function insertMention(participant: WhatsAppGroupParticipantDTO) {
    const el = textareaRef.current
    const cursor = el?.selectionStart ?? text.length
    const upToCursor = text.slice(0, cursor)
    const match = upToCursor.match(/(?:^|\s)@([^\s@]*)$/)
    if (!match) return

    const mentionStart = cursor - match[1].length - 1
    const label = participant.name ?? participant.waId
    const before = text.slice(0, mentionStart)
    const after = text.slice(cursor)
    const insertion = `@${label} `

    setText(`${before}${insertion}${after}`)
    setMentionQuery(null)

    requestAnimationFrame(() => {
      const pos = before.length + insertion.length
      el?.focus()
      el?.setSelectionRange(pos, pos)
    })
  }

  async function handleSend() {
    const exact = findExactQuickReply(quickReplies.data ?? [], text)
    const trimmed = (exact ? renderQuickReply(exact) : text).trim()
    if (!trimmed) return
    try {
      const outgoing = buildOutgoingGroupMessage(trimmed, group.participants)
      await sendText.mutateAsync(outgoing)
      setText('')
      setMentionQuery(null)
    } catch (error) {
      notify.error(error, 'Erro ao enviar mensagem')
    }
  }

  return (
    <div className='flex h-full min-w-0 flex-1 flex-col'>
      <div className='flex items-center justify-between gap-3 border-b px-4 py-3'>
        <button
          type='button'
          className='flex items-center gap-2.5 text-left'
          onClick={() => setSettingsOpen(true)}
        >
          <Avatar>
            <AvatarImage src={group.imageUrl ?? undefined} />
            <AvatarFallback>
              {group.name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className='font-medium text-sm'>{group.name}</p>
            <p className='text-muted-foreground text-xs'>
              {group.participants.length} participantes
            </p>
          </div>
        </button>
        <Button
          type='button'
          variant='ghost'
          size='icon-sm'
          aria-label='Configurações do grupo'
          onClick={() => setSettingsOpen(true)}
        >
          <SteelIcon icon={Settings02Icon} size={18} />
        </Button>
      </div>

      <MessageScroller dependencyKey={messages.data?.length}>
        {(messages.data ?? []).map((message) => (
          <GroupMessageBubble
            key={message.id}
            message={message}
            participants={group.participants}
          />
        ))}
      </MessageScroller>

      <div className='relative border-t p-2'>
        <QuickReplySlashMenu
          matches={slash.matches}
          activeIndex={slash.activeIndex}
          onApply={slash.apply}
        />
        {mentionQuery !== null && mentionCandidates.length > 0 && (
          <div className='absolute bottom-full left-2 z-10 mb-1 max-h-40 w-64 overflow-y-auto rounded-md border bg-popover p-1 shadow-md'>
            {mentionCandidates.map((participant) => (
              <button
                key={participant.waId}
                type='button'
                className='flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted'
                onMouseDown={(event) => {
                  event.preventDefault()
                  insertMention(participant)
                }}
              >
                <span className='truncate'>
                  {participant.name ?? participant.waId}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className='flex items-end gap-1.5'>
          <Popover open={quickReplyOpen} onOpenChange={setQuickReplyOpen}>
            <PopoverTrigger
              render={
                <Button
                  variant='ghost'
                  size='icon-sm'
                  disabled={sendText.isPending}
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
                        setText(
                          (current) => `${current}${renderQuickReply(qr)}`,
                        )
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
          <Textarea
            ref={textareaRef}
            value={text}
            onChange={(event) =>
              handleTextChange(
                event.target.value,
                event.target.selectionStart ?? event.target.value.length,
              )
            }
            onKeyDown={(event) => {
              if (slash.onKeyDown(event)) return
              if (event.key === 'Escape' && mentionQuery !== null) {
                setMentionQuery(null)
                return
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                handleSend()
              }
            }}
            placeholder='Digite uma mensagem — use @ para mencionar'
            aria-controls={slash.open ? QUICK_REPLY_LIST_ID : undefined}
            disabled={sendText.isPending}
            className='max-h-32 min-h-9 flex-1 resize-none'
            rows={1}
          />
          <Button
            type='button'
            size='icon-sm'
            disabled={sendText.isPending || !text.trim()}
            aria-label='Enviar'
            onClick={handleSend}
          >
            <SteelIcon icon={SentIcon} size={16} />
          </Button>
        </div>
      </div>

      <GroupSettingsDialog
        workspaceId={workspaceId}
        group={group}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onLeft={() => onLeft?.()}
      />
    </div>
  )
}
