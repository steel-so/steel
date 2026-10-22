'use client'

import {
  ArrowLeft01Icon,
  Call02Icon,
  CheckmarkCircle02Icon,
  ComputerVideoCallIcon,
  Download01Icon,
  RefreshIcon,
  UserGroup03Icon,
  UserSwitchIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { PhoneCallCard } from '@/app/_components/phone-calls/phone-call-card'
import { useShortcut } from '@/app/_components/shortcuts/shortcuts-provider'
import { AskSteelAiButton } from '@/app/_components/steel-ai-ask/ask-steel-ai-button'
import { AiFeedbackButtons } from '@/app/_components/steel-ai-quality/ai-feedback-buttons'
import { useWebPhone } from '@/app/_components/webphone/webphone-context'
import { useCan } from '@/app/_components/workspace/workspace-permissions'
import { SteelIcon } from '@/components/icon/icon'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { MessageBubble } from '@/components/ui/chat/message-bubble'
import { MessageScroller } from '@/components/ui/chat/message-scroller'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { notify } from '@/lib/notify'
import { feedbackKey, useMyAiFeedback } from '@/src/hooks/use-ai-feedback'
import {
  type PhoneCallTaskTarget,
  usePhoneCalls,
} from '@/src/hooks/use-phone-calls'
import { useUser } from '@/src/hooks/use-user'
import { useWhatsAppBusinessHours } from '@/src/hooks/use-whatsapp-business-hours'
import { useFindOrCreateWhatsAppContact } from '@/src/hooks/use-whatsapp-contacts'
import {
  useAssignWhatsAppConversation,
  useCloseWhatsAppConversation,
  useMarkWhatsAppConversationRead,
  useRemoveWhatsAppConversationFromAi,
  useReopenWhatsAppConversation,
  useResumeWhatsAppConversationAi,
  useStartWhatsAppConversation,
  useStartWhatsAppPhoneCall,
  useWhatsAppAssignableMembers,
  useWhatsAppConversationEvents,
  useWhatsAppPhoneCall,
} from '@/src/hooks/use-whatsapp-conversations'
import {
  useDeleteWhatsAppMessage,
  useReactToWhatsAppMessage,
  useSendWhatsAppTextMessage,
  useWhatsAppMessages,
} from '@/src/hooks/use-whatsapp-messages'
import {
  useSetWhatsAppConversationTeam,
  useWhatsAppConversationScope,
  useWhatsAppTeams,
} from '@/src/hooks/use-whatsapp-teams'
import type {
  WhatsAppConversationDTO,
  WhatsAppConversationEventDTO,
} from '@/types/whatsapp-conversation'
import type { WhatsAppMessageDTO } from '@/types/whatsapp-message'
import type { PhoneCallRecordDTO } from '@/types/whatsapp-phone-call'
import { WhatsappAiBanner } from './whatsapp-ai-banner'
import { WhatsappCloseConversationDialog } from './whatsapp-close-conversation-dialog'
import { CLOSE_OUTCOME_LABEL } from './whatsapp-close-outcome-badge'
import {
  WHATSAPP_COMPOSER_INPUT_ID,
  WhatsappComposer,
} from './whatsapp-composer'
import { WhatsappConversationEventChip } from './whatsapp-conversation-event-chip'
import { WhatsappHandoffBanner } from './whatsapp-handoff-banner'
import { WhatsappPhoneCallBanner } from './whatsapp-phone-call-banner'
import {
  canAssignTo,
  canMoveToTeam,
  clientConversationScope,
} from './whatsapp-team-access'
import { WhatsappTeamBadge } from './whatsapp-team-badge'
import { WhatsappVideoCallDialog } from './whatsapp-video-call-dialog'

const STATUS_LABEL: Record<WhatsAppConversationDTO['status'], string> = {
  NEW: 'Nova',
  IN_PROGRESS: 'Em atendimento',
  CLOSED: 'Fechada',
}

type TimelineItem =
  | { kind: 'message'; at: string; message: WhatsAppMessageDTO }
  | { kind: 'event'; at: string; event: WhatsAppConversationEventDTO }
  | { kind: 'call'; at: string; call: PhoneCallRecordDTO }

/** Live call states stay in the header banner, not in the timeline. */
const LIVE_CALL_STATUSES = new Set(['QUEUED', 'DIALING', 'IN_PROGRESS'])

/** Mensagens + eventos (fechada/reaberta) + ligações encerradas em ordem
 * cronológica. Eventos e ligações anteriores à mensagem mais antiga
 * carregada ficam de fora (paginação). */
function buildTimeline(
  messages: WhatsAppMessageDTO[],
  events: WhatsAppConversationEventDTO[],
  calls: PhoneCallRecordDTO[] = [],
): TimelineItem[] {
  const oldest = messages[0]?.createdAt
  const items: TimelineItem[] = [
    ...messages.map((message) => ({
      kind: 'message' as const,
      at: message.createdAt,
      message,
    })),
    ...events
      .filter((event) => !oldest || event.createdAt >= oldest)
      .map((event) => ({ kind: 'event' as const, at: event.createdAt, event })),
    ...calls
      .filter(
        (call) =>
          !LIVE_CALL_STATUSES.has(call.status) &&
          (!oldest || call.createdAt >= oldest),
      )
      .map((call) => ({ kind: 'call' as const, at: call.createdAt, call })),
  ]
  return items.sort((a, b) => a.at.localeCompare(b.at))
}

/** "Criar tarefa" from a call: CRM task on the person, else ticket task. */
function callTaskTarget(call: PhoneCallRecordDTO): PhoneCallTaskTarget | null {
  if (call.crmPersonId || call.crmOpportunityId)
    return {
      kind: 'crm',
      personId: call.crmPersonId,
      opportunityId: call.crmOpportunityId,
    }
  if (call.sdTicketId) return { kind: 'ticket', ticketRef: call.sdTicketId }
  return null
}

export function WhatsappConversationView({
  workspaceId,
  conversation,
  onSelectConversation,
  onBack,
}: {
  workspaceId: string
  conversation: WhatsAppConversationDTO
  onSelectConversation?: (conversation: WhatsAppConversationDTO) => void
  /** `U`: close the conversation and go back to the list. */
  onBack?: () => void
}) {
  const [callOpen, setCallOpen] = useState(false)
  const [closeOpen, setCloseOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [replyTarget, setReplyTarget] = useState<WhatsAppMessageDTO | null>(
    null,
  )
  const roomName = `steel-${conversation.id}`

  const currentUser = useUser()
  const messages = useWhatsAppMessages(workspaceId, conversation.id)
  const events = useWhatsAppConversationEvents(workspaceId, conversation.id)
  const closeConversation = useCloseWhatsAppConversation(workspaceId)
  const reopenConversation = useReopenWhatsAppConversation(workspaceId)
  const canEdit = useCan('conversations', 'EDIT')
  const startPhoneCall = useStartWhatsAppPhoneCall(workspaceId)
  const phoneCall = useWhatsAppPhoneCall(workspaceId, conversation.id)
  const webPhone = useWebPhone()
  const calls = usePhoneCalls(workspaceId, {
    kind: 'conversation',
    id: conversation.id,
  })
  const hasPabx = Boolean(
    currentUser.data?.pabxExtension && currentUser.data?.pabxDeviceId,
  )
  const isClosed = conversation.status === 'CLOSED'
  const businessHours = useWhatsAppBusinessHours(workspaceId)
  const outsideHours = businessHours.data?.open === false

  // Conversation shortcuts (registry `zap.*`).
  useShortcut('zap.reply', () => {
    const input = document.getElementById(WHATSAPP_COMPOSER_INPUT_ID)
    if (!(input instanceof HTMLTextAreaElement) || input.disabled) return false
    input.focus()
  })
  useShortcut('zap.transfer', () => setTransferOpen(true))
  useShortcut('zap.close', () => setCloseOpen(true), {
    enabled: canEdit && !isClosed,
  })
  useShortcut('zap.back', () => (onBack ? onBack() : false), {
    enabled: Boolean(onBack),
  })
  const markRead = useMarkWhatsAppConversationRead(workspaceId)
  const removeFromAi = useRemoveWhatsAppConversationFromAi(workspaceId)
  const resumeAi = useResumeWhatsAppConversationAi(workspaceId)
  const assignableMembers = useWhatsAppAssignableMembers(workspaceId)
  const assignConversation = useAssignWhatsAppConversation(
    workspaceId,
    conversation.id,
  )
  // Equipes: offer only the assignments and team moves the API accepts.
  const teams = useWhatsAppTeams(workspaceId)
  const conversationScope = useWhatsAppConversationScope(workspaceId)
  const setTeam = useSetWhatsAppConversationTeam(workspaceId, conversation.id)
  const viewerScope = clientConversationScope(
    conversationScope.data,
    teams.data,
    currentUser.data?.id,
  )
  const assignTargets = (assignableMembers.data ?? []).filter(
    (member) =>
      member.id === conversation.assignedUserId ||
      canAssignTo(viewerScope, conversation, member.id),
  )
  const canReturnToQueue =
    conversation.assignedUserId !== null &&
    canAssignTo(viewerScope, conversation, null)
  const teamTargets = (teams.data ?? []).filter((team) =>
    canMoveToTeam(viewerScope, conversation, team.id),
  )
  const canClearTeam =
    conversation.teamId !== null &&
    canMoveToTeam(viewerScope, conversation, null)

  function handleAssign(assignedUserId: string | null) {
    assignConversation.mutate(assignedUserId, {
      onSuccess: (updated) => {
        notify.success(
          assignedUserId ? 'Conversa transferida' : 'Conversa devolvida à fila',
        )
        onSelectConversation?.(updated)
      },
      onError: (error) =>
        notify.error(error, 'Não foi possível transferir a conversa'),
    })
  }

  function handleSetTeam(teamId: string | null) {
    setTeam.mutate(teamId, {
      onSuccess: (updated) => {
        notify.success(
          teamId ? 'Conversa movida de equipe' : 'Conversa sem equipe',
        )
        onSelectConversation?.(updated)
      },
      onError: (error) =>
        notify.error(error, 'Não foi possível mover a conversa de equipe'),
    })
  }
  const sendText = useSendWhatsAppTextMessage(workspaceId, conversation.id)
  const reactToMessage = useReactToWhatsAppMessage(workspaceId, conversation.id)
  const deleteMessage = useDeleteWhatsAppMessage(workspaceId, conversation.id)
  const findOrCreateContact = useFindOrCreateWhatsAppContact(workspaceId)
  const startConversation = useStartWhatsAppConversation(workspaceId)

  async function handleStartConversationWithContact(contact: {
    name: string
    waId: string
  }) {
    try {
      const found = await findOrCreateContact.mutateAsync(contact)
      const started = await startConversation.mutateAsync({
        contactId: found.id,
        connectionId: conversation.connectionId,
      })
      onSelectConversation?.(started)
    } catch {
      notify.error('Erro ao iniciar conversa com o contato')
    }
  }

  const timeline = useMemo(
    () =>
      buildTimeline(
        messages.data ?? [],
        events.data ?? [],
        Array.isArray(calls.data) ? calls.data : [],
      ),
    [messages.data, events.data, calls.data],
  )

  function handleClose(reason: string | undefined, statusIds: string[]) {
    closeConversation.mutate(
      { conversationId: conversation.id, reason, statusIds },
      {
        onSuccess: (updated) => {
          setCloseOpen(false)
          notify.success('Conversa fechada')
          onSelectConversation?.(updated)
        },
        onError: (error) =>
          notify.error(error, 'Não foi possível fechar a conversa'),
      },
    )
  }

  // Plain navigation to the attachment route: the browser keeps the page and
  // saves the file (Content-Disposition), with the session cookie attached.
  function handleDownload(format: 'txt' | 'csv') {
    const link = document.createElement('a')
    link.href = `/api/workspaces/${workspaceId}/whatsapp/conversations/${conversation.id}/export?format=${format}`
    link.download = ''
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  function handleReopen() {
    reopenConversation.mutate(conversation.id, {
      onSuccess: (updated) => {
        notify.success('Conversa reaberta')
        onSelectConversation?.(updated)
      },
      onError: (error) =>
        notify.error(error, 'Não foi possível reabrir a conversa'),
    })
  }

  const messagesById = useMemo(() => {
    const map = new Map<string, WhatsAppMessageDTO>()
    for (const message of messages.data ?? []) map.set(message.id, message)
    return map
  }, [messages.data])

  const aiReplyIds = useMemo(
    () =>
      (messages.data ?? [])
        .filter((m) => m.sentByAi && m.direction === 'OUT')
        .map((m) => m.id),
    [messages.data],
  )
  const aiFeedback = useMyAiFeedback(
    workspaceId,
    'WHATSAPP_AUTO_REPLY',
    aiReplyIds,
  )

  useEffect(() => {
    if (conversation.unreadCount > 0) {
      markRead.mutate(conversation.id)
    }
  }, [conversation.id])

  async function handlePhoneCall() {
    // Browser phone first: the call leaves from this tab's microphone.
    if (webPhone.enabled) {
      if (webPhone.call && webPhone.call.state !== 'ended') {
        notify.error('Já existe uma ligação em andamento.')
        return
      }
      if (webPhone.status !== 'online') {
        notify.error(
          webPhone.status === 'other-tab'
            ? 'O telefone web está aberto em outra aba.'
            : webPhone.status === 'connecting'
              ? 'O telefone web ainda está conectando. Tente em instantes.'
              : (webPhone.error ?? 'O telefone web está sem conexão.'),
        )
        return
      }
      try {
        await webPhone.dial(
          conversation.contactWaId,
          conversation.contactName ?? null,
          { conversationId: conversation.id },
        )
      } catch (error) {
        notify.error(
          error instanceof Error ? error.message : 'Erro ao iniciar a ligação',
        )
      }
      return
    }
    if (!hasPabx) {
      notify.error('Configure seu ramal e device no perfil para ligar.')
      return
    }
    try {
      const call = await startPhoneCall.mutateAsync(conversation.id)
      notify.success(
        `Atenda o ramal ${call.extension} para falar com o contato.`,
      )
    } catch (error) {
      notify.error(
        error instanceof Error ? error.message : 'Erro ao iniciar a ligação',
      )
    }
  }

  async function handleStartCall() {
    try {
      await sendText.mutateAsync({
        text: `Vamos iniciar uma videochamada. Entre pelo link: https://meet.jit.si/${roomName}`,
      })
      setCallOpen(true)
    } catch {
      notify.error('Erro ao iniciar chamada')
    }
  }

  return (
    <div className='flex h-full min-w-0 flex-1 flex-col'>
      <div className='flex items-center justify-between gap-3 border-b px-4 py-3 max-lg:pl-2'>
        {onBack ? (
          // Below `lg` the list and the chat take turns: this goes back.
          <Button
            variant='ghost'
            size='icon-sm'
            className='-mr-1.5 shrink-0 lg:hidden'
            aria-label='Voltar para as conversas'
            onClick={onBack}
          >
            <SteelIcon icon={ArrowLeft01Icon} size={18} />
          </Button>
        ) : null}
        <Popover>
          <PopoverTrigger
            render={
              <button
                type='button'
                className='flex items-center gap-2.5 rounded-md text-left'
              >
                <Avatar>
                  <AvatarImage
                    src={conversation.contactAvatarUrl ?? undefined}
                  />
                  <AvatarFallback>
                    {(conversation.contactName ?? conversation.contactWaId)
                      .slice(0, 2)
                      .toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className='min-w-0'>
                  <p className='flex items-center gap-1.5 font-medium text-sm'>
                    <span className='truncate'>
                      {conversation.contactName ?? conversation.contactWaId}
                    </span>
                    <WhatsappTeamBadge team={conversation.team} />
                  </p>
                  <p className='text-muted-foreground text-xs'>
                    {conversation.contactWaId}
                  </p>
                </div>
              </button>
            }
          />
          <PopoverContent align='start' className='w-72 p-4'>
            <div className='flex flex-col items-center gap-2 text-center'>
              <Avatar className='size-16'>
                <AvatarImage src={conversation.contactAvatarUrl ?? undefined} />
                <AvatarFallback className='text-lg'>
                  {(conversation.contactName ?? conversation.contactWaId)
                    .slice(0, 2)
                    .toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className='font-medium text-sm'>
                  {conversation.contactName ?? 'Sem nome'}
                </p>
                <p className='text-muted-foreground text-xs'>
                  {conversation.contactWaId}
                </p>
              </div>
            </div>
            <div className='mt-3 space-y-1.5 border-t pt-3 text-xs'>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>Cliente desde</span>
                <span>
                  {format(new Date(conversation.contactSince), 'dd/MM/yyyy', {
                    locale: ptBR,
                  })}
                </span>
              </div>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>Status</span>
                <span>{STATUS_LABEL[conversation.status]}</span>
              </div>
            </div>
          </PopoverContent>
        </Popover>
        <div className='flex items-center gap-1'>
          {canEdit &&
            (isClosed ? (
              <Button
                variant='outline'
                size='xs'
                disabled={reopenConversation.isPending}
                onClick={handleReopen}
              >
                <SteelIcon icon={RefreshIcon} size={14} />
                Reabrir
              </Button>
            ) : (
              <Button
                variant='outline'
                size='xs'
                onClick={() => setCloseOpen(true)}
              >
                <SteelIcon icon={CheckmarkCircle02Icon} size={14} />
                Fechar
              </Button>
            ))}
          <AskSteelAiButton
            workspaceId={workspaceId}
            reference={{
              kind: 'conversation',
              label: conversation.contactName ?? conversation.contactWaId,
            }}
          />
          {canEdit && (
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label='Ligar para o contato'
              title={
                webPhone.enabled
                  ? `Ligar pelo telefone web (ramal ${currentUser.data?.pabxExtension})`
                  : hasPabx
                    ? `Ligar pelo ramal ${currentUser.data?.pabxExtension}`
                    : 'Configure seu ramal e device no perfil para ligar'
              }
              disabled={startPhoneCall.isPending}
              onClick={handlePhoneCall}
            >
              <SteelIcon icon={Call02Icon} size={18} />
            </Button>
          )}
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label='Iniciar chamada de vídeo'
            onClick={handleStartCall}
          >
            <SteelIcon icon={ComputerVideoCallIcon} size={18} />
          </Button>
          {teamTargets.length > 0 || canClearTeam ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    aria-label='Mover para outra equipe'
                    title='Equipe da conversa'
                  >
                    <SteelIcon icon={UserGroup03Icon} size={18} />
                  </Button>
                }
              />
              <DropdownMenuContent align='end'>
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Mover para a equipe</DropdownMenuLabel>
                  {teamTargets.map((team) => (
                    <DropdownMenuItem
                      key={team.id}
                      disabled={
                        setTeam.isPending || team.id === conversation.teamId
                      }
                      onClick={() => handleSetTeam(team.id)}
                    >
                      {team.name}
                      {team.id === conversation.teamId ? ' (atual)' : ''}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
                {canClearTeam ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={setTeam.isPending}
                      onClick={() => handleSetTeam(null)}
                    >
                      Tirar da equipe
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant='ghost'
                  size='icon-sm'
                  aria-label='Baixar conversa'
                  title='Baixar conversa'
                >
                  <SteelIcon icon={Download01Icon} size={18} />
                </Button>
              }
            />
            <DropdownMenuContent align='end'>
              <DropdownMenuGroup>
                <DropdownMenuLabel>Baixar conversa</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => handleDownload('txt')}>
                  Texto (.txt)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleDownload('csv')}>
                  Planilha (.csv)
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu open={transferOpen} onOpenChange={setTransferOpen}>
            <DropdownMenuTrigger
              render={
                <Button
                  variant='ghost'
                  size='icon-sm'
                  aria-label='Transferir conversa'
                >
                  <SteelIcon icon={UserSwitchIcon} size={18} />
                </Button>
              }
            />
            <DropdownMenuContent align='end'>
              <DropdownMenuGroup>
                <DropdownMenuLabel>Transferir para</DropdownMenuLabel>
                {assignTargets.length ? (
                  assignTargets.map((member) => (
                    <DropdownMenuItem
                      key={member.id}
                      disabled={
                        assignConversation.isPending ||
                        member.id === conversation.assignedUserId
                      }
                      onClick={() => handleAssign(member.id)}
                    >
                      {member.name}
                      {member.id === currentUser.data?.id ? ' (você)' : ''}
                    </DropdownMenuItem>
                  ))
                ) : (
                  <DropdownMenuItem disabled>
                    Nenhum membro disponível
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
              {canReturnToQueue ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={assignConversation.isPending}
                    onClick={() => handleAssign(null)}
                  >
                    Devolver para a fila
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {isClosed && (
        <div className='border-b bg-muted px-4 py-2 text-muted-foreground text-sm'>
          Conversa fechada
          {conversation.closeOutcome
            ? ` (${CLOSE_OUTCOME_LABEL[conversation.closeOutcome].toLowerCase()}${
                conversation.closeStatusLabels.length
                  ? `: ${conversation.closeStatusLabels.join(', ')}`
                  : ''
              })`
            : ''}
          {conversation.closeReason ? ` — ${conversation.closeReason}` : ''}. A
          IA não responde até a conversa ser reaberta.
        </div>
      )}

      {outsideHours && !isClosed && (
        <div className='border-b bg-muted px-4 py-2 text-muted-foreground text-sm'>
          Fora do horário de atendimento ({businessHours.data?.start}–
          {businessHours.data?.end}): os envios estão travados
          {businessHours.data?.nextOpeningAt
            ? ` até ${format(
                new Date(businessHours.data.nextOpeningAt),
                "EEEE, dd/MM 'às' HH:mm",
                { locale: ptBR },
              )}`
            : ''}
          .
        </div>
      )}

      <WhatsappPhoneCallBanner call={phoneCall.data} />

      {!isClosed && conversation.aiActive && (
        <WhatsappAiBanner
          isRemoving={removeFromAi.isPending}
          onRemoveFromAi={() => removeFromAi.mutate(conversation.id)}
        />
      )}

      {!isClosed && !conversation.aiActive && conversation.aiHandoff && (
        <WhatsappHandoffBanner
          isResuming={resumeAi.isPending}
          onResumeAi={() => resumeAi.mutate(conversation.id)}
        />
      )}

      <MessageScroller dependencyKey={timeline.length}>
        {timeline.map((item) =>
          item.kind === 'event' ? (
            <WhatsappConversationEventChip
              key={`event-${item.event.id}`}
              event={item.event}
            />
          ) : item.kind === 'call' ? (
            <PhoneCallCard
              key={`call-${item.call.id}`}
              workspaceId={workspaceId}
              call={item.call}
              taskTarget={callTaskTarget(item.call)}
              className='mx-auto max-w-xl'
            />
          ) : (
            <Fragment key={item.message.id}>
              {renderMessage(item.message)}
            </Fragment>
          ),
        )}
      </MessageScroller>
      <WhatsappComposer
        workspaceId={workspaceId}
        conversationId={conversation.id}
        contactName={conversation.contactName ?? conversation.contactWaId}
        disabled={conversation.aiActive || isClosed || outsideHours}
        replyTarget={replyTarget}
        onClearReply={() => setReplyTarget(null)}
      />
      <WhatsappCloseConversationDialog
        workspaceId={workspaceId}
        open={closeOpen}
        onOpenChange={setCloseOpen}
        onConfirm={handleClose}
        isPending={closeConversation.isPending}
      />
      <WhatsappVideoCallDialog
        open={callOpen}
        onOpenChange={setCallOpen}
        roomName={roomName}
        displayName={currentUser.data?.name ?? 'Atendente'}
      />
    </div>
  )

  function renderMessage(message: WhatsAppMessageDTO) {
    const bubble = (
      <MessageBubble
        key={message.id}
        message={message}
        replyToMessage={
          message.replyToMessageId
            ? messagesById.get(message.replyToMessageId)
            : undefined
        }
        onReply={setReplyTarget}
        onReact={(messageId, emoji) =>
          reactToMessage.mutate({ messageId, emoji })
        }
        onDelete={(messageId) => deleteMessage.mutate(messageId)}
        onStartConversationWithContact={handleStartConversationWithContact}
      />
    )
    if (!message.sentByAi || message.direction !== 'OUT') return bubble
    return (
      <div className='flex flex-col items-end gap-0.5'>
        {bubble}
        <AiFeedbackButtons
          workspaceId={workspaceId}
          surface='WHATSAPP_AUTO_REPLY'
          targetId={message.id}
          feedback={
            aiFeedback.data
              ? (aiFeedback.data.get(feedbackKey(message.id)) ?? null)
              : aiFeedback.isError
                ? null
                : undefined
          }
        />
      </div>
    )
  }
}
