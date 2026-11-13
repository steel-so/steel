'use client'

import {
  ArrowLeft01Icon,
  Call02Icon,
  CheckmarkCircle02Icon,
  ComputerVideoCallIcon,
  Download01Icon,
  Invoice01Icon,
  MoneyReceive01Icon,
  MoreVerticalIcon,
  RefreshIcon,
  StarIcon,
  UserBlock01Icon,
  UserGroup03Icon,
  UserSwitchIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { PhoneCallCard } from '@/app/_components/phone-calls/phone-call-card'
import { useShortcut } from '@/app/_components/shortcuts/shortcuts-provider'
import { AskSteelAiButton } from '@/app/_components/steel-ai-ask/ask-steel-ai-button'
import { AiFeedbackButtons } from '@/app/_components/steel-ai-quality/ai-feedback-buttons'
import { useWebPhone } from '@/app/_components/webphone/webphone-context'
import {
  contactSubtitle,
  contactTitle,
} from '@/app/_components/whatsapp/whatsapp-contact-label'
import {
  useCan,
  useIsPrivileged,
} from '@/app/_components/workspace/workspace-permissions'
import { SteelIcon } from '@/components/icon/icon'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { MessageBubble } from '@/components/ui/chat/message-bubble'
import { MessageScroller } from '@/components/ui/chat/message-scroller'
import { ConfirmAction } from '@/components/ui/confirm-action'
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
import {
  useWhatsAppBoletoCharges,
  useWhatsAppBoletoSettings,
} from '@/src/hooks/use-whatsapp-boleto'
import { useWhatsAppBusinessHours } from '@/src/hooks/use-whatsapp-business-hours'
import {
  useUnblockWhatsAppContact,
  useWhatsAppConversationBlock,
} from '@/src/hooks/use-whatsapp-contact-blocks'
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
  useWhatsAppPixCharges,
  useWhatsAppPixSettings,
} from '@/src/hooks/use-whatsapp-pix'
import {
  useSetWhatsAppConversationTeam,
  useWhatsAppConversationScope,
  useWhatsAppTeams,
} from '@/src/hooks/use-whatsapp-teams'
import { canSeeConversation } from '@/src/lib/whatsapp/conversation-scope'
import { serviceWindowState } from '@/src/lib/whatsapp/service-window'
import type { WhatsAppBoletoChargeDTO } from '@/types/whatsapp-boleto'
import type { WhatsAppConnectionDTO } from '@/types/whatsapp-connection'
import type {
  WhatsAppConversationDTO,
  WhatsAppConversationEventDTO,
} from '@/types/whatsapp-conversation'
import type { WhatsAppMessageDTO } from '@/types/whatsapp-message'
import type { PhoneCallRecordDTO } from '@/types/whatsapp-phone-call'
import type { WhatsAppPixChargeDTO } from '@/types/whatsapp-pix'
import { WhatsappBoletoChargeCard } from './boleto/whatsapp-boleto-charge-card'
import { WhatsappBoletoChargeDialog } from './boleto/whatsapp-boleto-charge-dialog'
import { WhatsappBlockContactDialog } from './contact-block/whatsapp-block-contact-dialog'
import { WhatsappContactBlockedBanner } from './contact-block/whatsapp-contact-blocked-banner'
import { WhatsappPixChargeCard } from './pix/whatsapp-pix-charge-card'
import { WhatsappPixChargeDialog } from './pix/whatsapp-pix-charge-dialog'
import { SendSurveyDialog } from './surveys/send-survey-dialog'
import { WhatsappAdReferralBanner } from './whatsapp-ad-referral-banner'
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
import { WhatsappSlaChip } from './whatsapp-sla-chip'
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
  | { kind: 'pix'; at: string; charge: WhatsAppPixChargeDTO }
  | { kind: 'boleto'; at: string; charge: WhatsAppBoletoChargeDTO }

/** Live call states stay in the header banner, not in the timeline. */
const LIVE_CALL_STATUSES = new Set(['QUEUED', 'DIALING', 'IN_PROGRESS'])

/** Mensagens + eventos (fechada/reaberta) + ligações encerradas em ordem
 * cronológica. Eventos e ligações anteriores à mensagem mais antiga
 * carregada ficam de fora (paginação). */
function buildTimeline(
  messages: WhatsAppMessageDTO[],
  events: WhatsAppConversationEventDTO[],
  calls: PhoneCallRecordDTO[] = [],
  pixCharges: WhatsAppPixChargeDTO[] = [],
  boletoCharges: WhatsAppBoletoChargeDTO[] = [],
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
    ...pixCharges
      .filter((charge) => !oldest || charge.createdAt >= oldest)
      .map((charge) => ({
        kind: 'pix' as const,
        at: charge.createdAt,
        charge,
      })),
    ...boletoCharges
      .filter((charge) => !oldest || charge.createdAt >= oldest)
      .map((charge) => ({
        kind: 'boleto' as const,
        at: charge.createdAt,
        charge,
      })),
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
  connection = null,
  onSelectConversation,
  onBack,
}: {
  workspaceId: string
  conversation: WhatsAppConversationDTO
  /** The number this conversation runs on (provider drives the 24h rule). */
  connection?: WhatsAppConnectionDTO | null
  onSelectConversation?: (conversation: WhatsAppConversationDTO) => void
  /** `U`: close the conversation and go back to the list. */
  onBack?: () => void
}) {
  const [callOpen, setCallOpen] = useState(false)
  const [closeOpen, setCloseOpen] = useState(false)
  const [pixOpen, setPixOpen] = useState(false)
  const [boletoOpen, setBoletoOpen] = useState(false)
  const [surveyOpen, setSurveyOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [blockOpen, setBlockOpen] = useState(false)
  const [replyTarget, setReplyTarget] = useState<WhatsAppMessageDTO | null>(
    null,
  )
  const roomName = `steel-${conversation.id}`
  const params = useParams<{ 'workspace-slug'?: string }>()
  const slug = params?.['workspace-slug'] ?? ''
  // Message pending a delete confirmation, and a nudge to open the
  // composer's template picker from a failed message.
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [templatePickerRequest, setTemplatePickerRequest] = useState(0)
  // The 24h window closes while the chat is open: re-evaluate every minute.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const currentUser = useUser()
  const messages = useWhatsAppMessages(workspaceId, conversation.id)
  const events = useWhatsAppConversationEvents(workspaceId, conversation.id)
  const closeConversation = useCloseWhatsAppConversation(workspaceId)
  const reopenConversation = useReopenWhatsAppConversation(workspaceId)
  const canEdit = useCan('conversations', 'EDIT')
  const canCreate = useCan('conversations', 'CREATE')
  const isAdmin = useIsPrivileged()
  const pixSettings = useWhatsAppPixSettings(workspaceId)
  const pixEnabled = pixSettings.data?.enabled === true
  const pixCharges = useWhatsAppPixCharges(
    workspaceId,
    conversation.id,
    pixEnabled,
  )
  const boletoSettings = useWhatsAppBoletoSettings(workspaceId)
  const boletoEnabled = boletoSettings.data?.enabled === true
  const boletoCharges = useWhatsAppBoletoCharges(
    workspaceId,
    conversation.id,
    boletoEnabled,
  )
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
  // zap-block-contacts: a blocked contact gets nothing and sends nothing.
  const blockState = useWhatsAppConversationBlock(workspaceId, conversation.id)
  const unblockContact = useUnblockWhatsAppContact(workspaceId)
  const contactBlock = blockState.data?.block ?? null
  const isBlocked = contactBlock !== null
  const canBlock = Boolean(blockState.data?.canBlock) && !isBlocked
  const canUnblock = Boolean(blockState.data?.canUnblock) && isBlocked
  const businessHours = useWhatsAppBusinessHours(workspaceId)
  const outsideHours = businessHours.data?.open === false
  // Meta only accepts free text within 24h of the contact's last message.
  const windowClosed =
    connection?.provider === 'META' &&
    !serviceWindowState(conversation.lastInboundAt, now).open
  const connectionDown =
    connection?.status === 'DISCONNECTED' || connection?.status === 'ERROR'

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
  const assignee = conversation.assignedUserId
    ? (assignableMembers.data ?? []).find(
        (member) => member.id === conversation.assignedUserId,
      )
    : null
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
        // A scoped agent loses sight of what goes to someone outside their
        // reach: say so, or the conversation seems to vanish.
        const stillVisible = viewerScope
          ? canSeeConversation(viewerScope, updated)
          : true
        const target = assignedUserId
          ? (assignableMembers.data ?? []).find((m) => m.id === assignedUserId)
          : null
        notify.success(
          assignedUserId
            ? `Conversa transferida${target ? ` para ${target.name}` : ''}.${
                stillVisible
                  ? ''
                  : ' Você deixará de ver esta conversa na sua lista.'
              }`
            : `Conversa devolvida à fila.${
                stillVisible
                  ? ''
                  : ' Você deixará de ver esta conversa na sua lista.'
              }`,
        )
        onSelectConversation?.(updated)
      },
      onError: (error) =>
        notify.error(error, 'Não foi possível transferir a conversa'),
    })
  }

  function handleUnblock() {
    if (!contactBlock) return
    unblockContact.mutate(contactBlock.id, {
      onSuccess: (result) => {
        if (result.providerWarning) notify.warning(result.providerWarning)
        else notify.success('Contato desbloqueado')
      },
      onError: (error) =>
        notify.error(error, 'Não foi possível desbloquear o contato'),
    })
  }

  function handleSetTeam(teamId: string | null) {
    setTeam.mutate(teamId, {
      onSuccess: (updated) => {
        const stillVisible = viewerScope
          ? canSeeConversation(viewerScope, updated)
          : true
        notify.success(
          `${teamId ? 'Conversa movida de equipe.' : 'Conversa sem equipe.'}${
            stillVisible
              ? ''
              : ' Você deixará de ver esta conversa na sua lista.'
          }`,
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
    } catch (error) {
      notify.error(error, 'Erro ao iniciar conversa com o contato')
    }
  }

  const timeline = useMemo(
    () =>
      buildTimeline(
        messages.data ?? [],
        events.data ?? [],
        Array.isArray(calls.data) ? calls.data : [],
        pixCharges.data ?? [],
        boletoCharges.data ?? [],
      ),
    [
      messages.data,
      events.data,
      calls.data,
      pixCharges.data,
      boletoCharges.data,
    ],
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
  function handleDownload(format: 'txt' | 'csv' | 'pdf') {
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

  function handleResend(failed: WhatsAppMessageDTO) {
    if (!failed.text?.trim()) return
    sendText.mutate(
      { text: failed.text },
      {
        onSuccess: () => notify.success('Mensagem reenviada'),
        onError: (error) =>
          notify.error(error, 'Não foi possível reenviar a mensagem'),
      },
    )
  }

  async function handleStartCall() {
    try {
      await sendText.mutateAsync({
        text: `Vamos iniciar uma videochamada. Entre pelo link: https://meet.jit.si/${roomName}`,
      })
      setCallOpen(true)
    } catch (error) {
      notify.error(error, 'Erro ao iniciar chamada')
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
                    {contactTitle(conversation).slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className='min-w-0'>
                  <p className='flex items-center gap-1.5 font-medium text-sm'>
                    <span className='truncate'>
                      {contactTitle(conversation)}
                    </span>
                    <WhatsappTeamBadge team={conversation.team} />
                    <WhatsappSlaChip
                      workspaceId={workspaceId}
                      conversationId={conversation.id}
                    />
                  </p>
                  <p className='text-muted-foreground text-xs'>
                    {contactSubtitle(conversation)}
                    <span data-testid='conversation-assignee'>
                      {' · '}
                      {conversation.assignedUserId
                        ? assignee
                          ? `Com ${
                              assignee.id === currentUser.data?.id
                                ? 'você'
                                : assignee.name
                            }`
                          : 'Com outro atendente'
                        : 'Sem responsável (na fila)'}
                    </span>
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
                  {contactTitle(conversation).slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className='font-medium text-sm'>
                  {conversation.contactName ?? 'Sem nome'}
                </p>
                <p className='text-muted-foreground text-xs'>
                  {contactSubtitle(conversation)}
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
              {isBlocked ? (
                <div className='flex justify-between'>
                  <span className='text-muted-foreground'>Bloqueio</span>
                  <span className='text-destructive'>Bloqueado</span>
                </div>
              ) : null}
            </div>
            {canBlock || canUnblock ? (
              <div className='mt-3 border-t pt-3'>
                {canBlock ? (
                  <Button
                    variant='destructive'
                    size='sm'
                    className='w-full'
                    onClick={() => setBlockOpen(true)}
                  >
                    <SteelIcon icon={UserBlock01Icon} size={14} />
                    Bloquear contato
                  </Button>
                ) : (
                  <Button
                    variant='outline'
                    size='sm'
                    className='w-full'
                    disabled={unblockContact.isPending}
                    onClick={handleUnblock}
                  >
                    Desbloquear contato
                  </Button>
                )}
              </div>
            ) : null}
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
              label: contactTitle(conversation),
            }}
          />
          {pixEnabled && canCreate && (
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label='Cobrar via Pix'
              title={
                conversation.aiActive
                  ? 'Remova a conversa do atendimento da IA para cobrar'
                  : isClosed
                    ? 'Reabra a conversa para cobrar'
                    : outsideHours
                      ? 'Fora do horário de atendimento: a cobrança só pode ser enviada dentro do horário'
                      : 'Cobrar via Pix'
              }
              disabled={conversation.aiActive || isClosed || outsideHours}
              onClick={() => setPixOpen(true)}
            >
              <SteelIcon icon={MoneyReceive01Icon} size={18} />
            </Button>
          )}
          {boletoEnabled && canCreate && (
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label='Enviar boleto'
              title={
                conversation.aiActive
                  ? 'Remova a conversa do atendimento da IA para cobrar'
                  : isClosed
                    ? 'Reabra a conversa para cobrar'
                    : outsideHours
                      ? 'Fora do horário de atendimento: o boleto só pode ser enviado dentro do horário'
                      : 'Enviar boleto'
              }
              disabled={conversation.aiActive || isClosed || outsideHours}
              onClick={() => setBoletoOpen(true)}
            >
              <SteelIcon icon={Invoice01Icon} size={18} />
            </Button>
          )}
          {canEdit && (
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label='Ligar para o contato'
              title={
                !conversation.contactHasPhone
                  ? 'Este contato não tem telefone para ligar'
                  : webPhone.enabled
                    ? `Ligar pelo telefone web (ramal ${currentUser.data?.pabxExtension})`
                    : hasPabx
                      ? `Ligar pelo ramal ${currentUser.data?.pabxExtension}`
                      : 'Configure seu ramal e device no perfil para ligar'
              }
              disabled={
                startPhoneCall.isPending || !conversation.contactHasPhone
              }
              onClick={handlePhoneCall}
            >
              <SteelIcon icon={Call02Icon} size={18} />
            </Button>
          )}
          {canEdit && (
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label='Enviar pesquisa de satisfação'
              title='Enviar pesquisa de satisfação'
              onClick={() => setSurveyOpen(true)}
            >
              <SteelIcon icon={StarIcon} size={18} />
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
                <DropdownMenuItem onClick={() => handleDownload('pdf')}>
                  PDF só com o texto (.pdf)
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
          {canBlock || canUnblock ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    aria-label='Mais ações da conversa'
                    title='Mais ações'
                  >
                    <SteelIcon icon={MoreVerticalIcon} size={18} />
                  </Button>
                }
              />
              <DropdownMenuContent align='end'>
                {canBlock ? (
                  <DropdownMenuItem
                    variant='destructive'
                    onClick={() => setBlockOpen(true)}
                  >
                    <SteelIcon icon={UserBlock01Icon} size={16} />
                    Bloquear contato
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    disabled={unblockContact.isPending}
                    onClick={handleUnblock}
                  >
                    Desbloquear contato
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
      {contactBlock ? (
        <WhatsappContactBlockedBanner
          block={contactBlock}
          canUnblock={canUnblock}
          isUnblocking={unblockContact.isPending}
          onUnblock={handleUnblock}
        />
      ) : null}
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
          {isAdmin && slug ? (
            <>
              {' '}
              <Link
                href={`/${slug}/zap/configuracoes/hours-sla`}
                className='font-medium text-foreground underline underline-offset-2'
              >
                Alterar horário
              </Link>
            </>
          ) : null}
        </div>
      )}

      {connectionDown && connection ? (
        <div
          role='alert'
          className='border-b bg-muted px-4 py-2 text-destructive text-sm'
        >
          O número {connection.label} ({connection.phoneNumber}) está
          desconectado: as mensagens não são enviadas nem recebidas. Avise o
          administrador do WhatsApp.
          {isAdmin && slug ? (
            <>
              {' '}
              <Link
                href={`/${slug}/settings/whatsapp`}
                className='font-medium underline underline-offset-2'
              >
                Reconectar
              </Link>
            </>
          ) : null}
        </div>
      ) : null}

      <WhatsappPhoneCallBanner call={phoneCall.data} />

      <WhatsappAdReferralBanner
        workspaceId={workspaceId}
        conversationId={conversation.id}
      />

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
          ) : item.kind === 'pix' ? (
            <WhatsappPixChargeCard
              key={`pix-${item.charge.id}`}
              workspaceId={workspaceId}
              charge={item.charge}
              canManage={canEdit}
              canSimulate={isAdmin && Boolean(pixSettings.data?.isTestProvider)}
              className='mx-auto max-w-xl'
            />
          ) : item.kind === 'boleto' ? (
            <WhatsappBoletoChargeCard
              key={`boleto-${item.charge.id}`}
              workspaceId={workspaceId}
              charge={item.charge}
              canManage={canEdit}
              className='mx-auto max-w-xl'
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
        key={conversation.id}
        workspaceId={workspaceId}
        conversationId={conversation.id}
        contactName={contactTitle(conversation)}
        disabled={
          conversation.aiActive ||
          isClosed ||
          outsideHours ||
          isBlocked ||
          connectionDown
        }
        disabledReason={
          isClosed
            ? 'Conversa fechada. Reabra para responder.'
            : isBlocked
              ? 'Contato bloqueado. Desbloqueie para responder.'
              : conversation.aiActive
                ? 'A IA está atendendo esta conversa. Remova-a do atendimento para responder.'
                : outsideHours
                  ? 'Fora do horário de atendimento: os envios voltam quando o expediente abrir.'
                  : connectionDown
                    ? 'O número está desconectado. Avise o administrador.'
                    : undefined
        }
        windowClosed={windowClosed}
        connection={connection}
        templatePickerRequest={templatePickerRequest}
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
      {surveyOpen ? (
        <SendSurveyDialog
          workspaceId={workspaceId}
          open
          onOpenChange={setSurveyOpen}
          recipient={{
            whatsappContactId: conversation.contactId,
            name: conversation.contactName,
          }}
        />
      ) : null}
      {pixSettings.data?.enabled ? (
        <WhatsappPixChargeDialog
          workspaceId={workspaceId}
          conversationId={conversation.id}
          settings={pixSettings.data}
          open={pixOpen}
          onOpenChange={setPixOpen}
        />
      ) : null}
      {boletoEnabled ? (
        <WhatsappBoletoChargeDialog
          workspaceId={workspaceId}
          conversationId={conversation.id}
          defaultPayerName={conversation.contactName ?? undefined}
          open={boletoOpen}
          onOpenChange={setBoletoOpen}
        />
      ) : null}
      {blockOpen && blockState.data ? (
        <WhatsappBlockContactDialog
          workspaceId={workspaceId}
          open
          onOpenChange={setBlockOpen}
          target={{ conversationId: conversation.id }}
          contactName={contactTitle(conversation)}
          provider={blockState.data.provider}
        />
      ) : null}
      <WhatsappVideoCallDialog
        open={callOpen}
        onOpenChange={setCallOpen}
        roomName={roomName}
        displayName={currentUser.data?.name ?? 'Atendente'}
      />
      <ConfirmAction
        open={deleteTargetId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTargetId(null)
        }}
        title='Apagar esta mensagem?'
        description='Ela é removida só do Steel. O cliente continua vendo a mensagem no WhatsApp dele.'
        confirmLabel='Apagar'
        pending={deleteMessage.isPending}
        onConfirm={async () => {
          if (!deleteTargetId) return
          try {
            await deleteMessage.mutateAsync(deleteTargetId)
            notify.success('Mensagem apagada do Steel')
          } catch (error) {
            notify.error(error, 'Não foi possível apagar a mensagem')
          }
        }}
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
          reactToMessage.mutate(
            { messageId, emoji },
            {
              onError: (error) =>
                notify.error(error, 'Não foi possível reagir à mensagem'),
            },
          )
        }
        onDelete={setDeleteTargetId}
        onResend={handleResend}
        onUseTemplate={() => setTemplatePickerRequest((n) => n + 1)}
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
