'use client'

import {
  Attachment01Icon,
  Link01Icon,
  SentIcon,
  Settings02Icon,
  Timer02Icon,
  WhatsappIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { type ChangeEvent, useRef, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MessageBubble } from '@/components/ui/chat/message-bubble'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { useSdTicketRealtime } from '@/src/hooks/use-sd-tickets'
import {
  useLinkSdWhatsapp,
  useSdTicketWhatsapp,
  useSdWhatsappConversations,
  useSdWhatsappMessages,
  useSdWhatsappTemplates,
  useSendSdWhatsappMedia,
  useSendSdWhatsappTemplate,
  useSendSdWhatsappText,
  useStartSdWhatsapp,
  useUnlinkSdWhatsapp,
} from '@/src/hooks/use-sd-whatsapp'
import type {
  SdTicketWhatsappDTO,
  SdWhatsappConversationDTO,
  SdWhatsappTemplateDTO,
} from '@/types/sd-whatsapp'
import { ConfirmDeleteButton, EmptyState } from '../../settings/sd-settings-kit'
import { SD_TONE, SD_TONE_SOFT, SD_TONE_TEXT } from '../sd-ticket-meta'
import { SdAgentOnlyNotice } from '../shared/sd-tab-bits'
import { formatDateTime } from '../shared/sd-tab-format'
import type { SdTicketTabProps } from './types'

/** Até onde o arquivo enviado pela aba pode ir (igual ao limite da API). */
const MAX_MEDIA_BYTES = 16 * 1024 * 1024

const STATUS_LABEL: Record<string, string> = {
  CONNECTED: 'Conectado',
  CONNECTING: 'Conectando',
  DISCONNECTED: 'Desconectado',
  ERROR: 'Com erro',
}

/** Tom do selo de status da conexão (mapa fechado). */
const STATUS_TONE: Record<string, string> = {
  CONNECTED: SD_TONE.emerald,
  CONNECTING: SD_TONE.amber,
  DISCONNECTED: SD_TONE.amber,
  ERROR: SD_TONE.red,
}

const CONVERSATION_STATUS_LABEL: Record<string, string> = {
  NEW: 'Nova',
  IN_PROGRESS: 'Em atendimento',
  CLOSED: 'Encerrada',
}

/** Número em dígitos → `+55 (11) 99999-9999` (ou o próprio, se não casar). */
export function formatSdWaId(waId: string): string {
  if (waId && !/^\d+$/.test(waId)) return 'Sem telefone'
  const match = /^(\d{2})(\d{2})(\d{4,5})(\d{4})$/.exec(waId)
  if (!match) return waId
  return `+${match[1]} (${match[2]}) ${match[3]}-${match[4]}`
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant='outline'
      className={cn('gap-1', STATUS_TONE[status] ?? SD_TONE.amber)}
    >
      {STATUS_LABEL[status] ?? status}
    </Badge>
  )
}

/** Faixa da janela de 24 h da Meta (a Z-API não tem janela). */
function WindowNotice({ window }: { window: SdTicketWhatsappDTO['window'] }) {
  if (window.open) {
    if (!window.expiresAt) return null
    return (
      <p className='flex items-center gap-1.5 text-muted-foreground text-xs'>
        <SteelIcon icon={Timer02Icon} size={12} strokeWidth={2} />
        Janela de 24 h aberta até {formatDateTime(window.expiresAt)}.
      </p>
    )
  }
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2 text-xs',
        SD_TONE_SOFT.amber,
      )}
    >
      <SteelIcon
        icon={Timer02Icon}
        size={14}
        strokeWidth={2}
        className='mt-px shrink-0'
      />
      <p>
        Fora da janela de 24 h do WhatsApp: só é possível enviar um modelo
        aprovado. O contato precisa responder para liberar o texto livre.
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Sem conversa vinculada                                               */
/* ------------------------------------------------------------------ */

function ConversationPicker({
  workspaceId,
  ticketRef,
}: {
  workspaceId: string
  ticketRef: string
}) {
  const [search, setSearch] = useState('')
  const conversations = useSdWhatsappConversations(workspaceId, search)
  const link = useLinkSdWhatsapp(workspaceId, ticketRef)
  const items = conversations.data ?? []

  return (
    <div className='flex flex-col gap-2'>
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder='Buscar por nome ou número'
        aria-label='Buscar conversa do WhatsApp'
      />
      {conversations.isLoading ? (
        <Skeleton className='h-20 w-full' />
      ) : items.length === 0 ? (
        <EmptyState>Nenhuma conversa do WhatsApp por aqui ainda.</EmptyState>
      ) : (
        <ul className='flex max-h-64 flex-col gap-1.5 overflow-y-auto'>
          {items.map((conversation: SdWhatsappConversationDTO) => (
            <li key={conversation.id}>
              <div className='flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2'>
                <div className='flex min-w-0 flex-1 flex-col'>
                  <span className='truncate font-medium text-sm'>
                    {conversation.contact.name ??
                      formatSdWaId(conversation.contact.waId)}
                  </span>
                  <span className='truncate text-muted-foreground text-xs'>
                    {conversation.lastMessagePreview ??
                      formatSdWaId(conversation.contact.waId)}
                  </span>
                  {conversation.openTicket ? (
                    <span className={cn('text-xs', SD_TONE_TEXT.amber)}>
                      Já vinculada ao chamado {conversation.openTicket.code}
                    </span>
                  ) : null}
                </div>
                <Badge variant='secondary'>
                  {CONVERSATION_STATUS_LABEL[conversation.status] ??
                    conversation.status}
                </Badge>
                <Button
                  size='xs'
                  variant='outline'
                  disabled={link.isPending}
                  onClick={() =>
                    link.mutate(conversation.id, {
                      onSuccess: () => notify.success('Conversa vinculada'),
                      onError: (error) => notify.error(error),
                    })
                  }
                >
                  <SteelIcon icon={Link01Icon} size={14} strokeWidth={2} />
                  Vincular
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function NoConversation({
  workspaceId,
  ticketRef,
  state,
}: {
  workspaceId: string
  ticketRef: string
  state: SdTicketWhatsappDTO
}) {
  const [waId, setWaId] = useState(state.suggestedWaId ?? '')
  const start = useStartSdWhatsapp(workspaceId, ticketRef)

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-col gap-2 rounded-lg border border-border bg-card p-4'>
        <h3 className='font-medium text-sm'>Iniciar uma conversa</h3>
        <p className='text-muted-foreground text-xs'>
          Enviamos pela conexão {state.connection?.label} (
          {formatSdWaId(state.connection?.phoneNumber ?? '')}). Informe o número
          com DDI e DDD.
        </p>
        <form
          className='flex gap-2'
          onSubmit={(event) => {
            event.preventDefault()
            start.mutate(waId.trim() || undefined, {
              onSuccess: () => notify.success('Conversa iniciada'),
              onError: (error) => notify.error(error),
            })
          }}
        >
          <Input
            value={waId}
            onChange={(event) => setWaId(event.target.value)}
            placeholder='5511999999999'
            aria-label='Número do WhatsApp'
          />
          <Button type='submit' size='sm' disabled={start.isPending}>
            {start.isPending ? 'Iniciando...' : 'Iniciar'}
          </Button>
        </form>
      </div>

      <div className='flex flex-col gap-2 rounded-lg border border-border bg-card p-4'>
        <h3 className='font-medium text-sm'>Vincular uma conversa existente</h3>
        <p className='text-muted-foreground text-xs'>
          Conversas que já chegaram no WhatsApp do ServiceDesk.
        </p>
        <ConversationPicker workspaceId={workspaceId} ticketRef={ticketRef} />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Envio                                                                */
/* ------------------------------------------------------------------ */

function TemplateComposer({
  workspaceId,
  ticketRef,
}: {
  workspaceId: string
  ticketRef: string
}) {
  const templates = useSdWhatsappTemplates(workspaceId, ticketRef)
  const send = useSendSdWhatsappTemplate(workspaceId, ticketRef)
  const [selected, setSelected] = useState('')
  const [variables, setVariables] = useState<string[]>([])
  const items = templates.data ?? []
  const template: SdWhatsappTemplateDTO | undefined = items.find(
    (item) => item.id === selected,
  )

  function choose(id: string) {
    setSelected(id)
    const next = items.find((item) => item.id === id)
    setVariables(Array.from({ length: next?.variableCount ?? 0 }, () => ''))
  }

  function submit() {
    if (!template) return
    const components = variables.length
      ? [
          {
            type: 'body',
            parameters: variables.map((text) => ({ type: 'text', text })),
          },
        ]
      : undefined
    send.mutate(
      {
        templateName: template.name,
        language: template.language,
        components,
      },
      {
        onSuccess: () => notify.success('Modelo enviado'),
        onError: (error) => notify.error(error),
      },
    )
  }

  if (templates.isLoading) return <Skeleton className='h-24 w-full' />
  if (items.length === 0) {
    return (
      <EmptyState>
        Nenhum modelo aprovado nesta conexão. Cadastre um modelo na Meta para
        falar fora da janela de 24 h.
      </EmptyState>
    )
  }

  return (
    <div className='flex flex-col gap-2'>
      <select
        className='h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30'
        value={selected}
        aria-label='Modelo aprovado'
        onChange={(event: ChangeEvent<HTMLSelectElement>) =>
          choose(event.target.value)
        }
      >
        <option value=''>Selecione um modelo</option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name} ({item.language})
          </option>
        ))}
      </select>
      {template ? (
        <>
          {template.body ? (
            <p className='whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-muted-foreground text-xs'>
              {template.body}
            </p>
          ) : null}
          {variables.map((value, index) => (
            <Input
              key={`${template.id}-var-${index + 1}`}
              value={value}
              aria-label={`Variável ${index + 1}`}
              placeholder={`Valor de {{${index + 1}}}`}
              onChange={(event) =>
                setVariables((current) =>
                  current.map((item, position) =>
                    position === index ? event.target.value : item,
                  ),
                )
              }
            />
          ))}
          <Button
            size='sm'
            className='self-end'
            disabled={send.isPending || variables.some((v) => !v.trim())}
            onClick={submit}
          >
            {send.isPending ? 'Enviando...' : 'Enviar modelo'}
          </Button>
        </>
      ) : null}
    </div>
  )
}

function FreeComposer({
  workspaceId,
  ticketRef,
  disabled,
}: {
  workspaceId: string
  ticketRef: string
  disabled: boolean
}) {
  const [text, setText] = useState('')
  const sendText = useSendSdWhatsappText(workspaceId, ticketRef)
  const sendMedia = useSendSdWhatsappMedia(workspaceId, ticketRef)
  const fileInput = useRef<HTMLInputElement>(null)

  function submit() {
    const body = text.trim()
    if (!body) return
    sendText.mutate(body, {
      onSuccess: () => setText(''),
      onError: (error) => notify.error(error),
    })
  }

  function pickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > MAX_MEDIA_BYTES) {
      notify.error('Arquivo muito grande (máx. 16 MB)')
      return
    }
    sendMedia.mutate(
      { file, caption: text.trim() || undefined },
      {
        onSuccess: () => setText(''),
        onError: (error) => notify.error(error),
      },
    )
  }

  const pending = sendText.isPending || sendMedia.isPending

  return (
    <div className='flex items-end gap-2'>
      <input
        ref={fileInput}
        type='file'
        className='hidden'
        aria-label='Arquivo para enviar'
        onChange={pickFile}
      />
      <Button
        type='button'
        size='icon'
        variant='outline'
        aria-label='Anexar arquivo'
        disabled={disabled || pending}
        onClick={() => fileInput.current?.click()}
      >
        <SteelIcon icon={Attachment01Icon} strokeWidth={2} />
      </Button>
      <Textarea
        value={text}
        rows={2}
        maxLength={4096}
        disabled={disabled}
        aria-label='Mensagem do WhatsApp'
        placeholder='Escreva para o contato...'
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            submit()
          }
        }}
      />
      <Button
        type='button'
        size='icon'
        aria-label='Enviar mensagem'
        disabled={disabled || pending || !text.trim()}
        onClick={submit}
      >
        <SteelIcon icon={SentIcon} strokeWidth={2} />
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Aba                                                                  */
/* ------------------------------------------------------------------ */

/** Conversa de WhatsApp do chamado: histórico, envio e vínculo. */
export function SdTicketWhatsappTab({
  workspaceId,
  slug,
  ticket,
  mode,
}: SdTicketTabProps) {
  const isAgent = mode === 'agent'
  const ticketRef = ticket.id
  useSdTicketRealtime(isAgent ? workspaceId : undefined)
  const state = useSdTicketWhatsapp(isAgent ? workspaceId : '', ticketRef)
  const conversation = state.data?.conversation ?? null
  const messages = useSdWhatsappMessages(workspaceId, ticketRef, {
    enabled: isAgent && Boolean(conversation),
  })
  const unlink = useUnlinkSdWhatsapp(workspaceId, ticketRef)

  if (!isAgent) return <SdAgentOnlyNotice />
  if (state.isLoading) {
    return (
      <div className='flex flex-col gap-3 p-4'>
        <Skeleton className='h-12 w-full' />
        <Skeleton className='h-48 w-full' />
      </div>
    )
  }
  if (state.error) {
    return (
      <div className='p-4'>
        <EmptyState>{state.error.message}</EmptyState>
      </div>
    )
  }
  const data = state.data
  if (!data) return null

  if (!data.configured) {
    return (
      <div className='flex flex-col items-start gap-3 p-4'>
        <div className='flex items-start gap-3 rounded-lg border border-border bg-muted px-4 py-3'>
          <SteelIcon
            icon={WhatsappIcon}
            strokeWidth={2}
            className='mt-0.5 shrink-0 text-muted-foreground'
          />
          <div className='flex flex-col gap-1'>
            <p className='font-medium text-sm'>
              Nenhuma conexão de WhatsApp configurada
            </p>
            <p className='text-muted-foreground text-xs'>
              Um administrador do ServiceDesk precisa cadastrar a conexão (Z-API
              ou Meta) nas configurações do módulo para atender por WhatsApp.
            </p>
          </div>
        </div>
        <Button
          size='sm'
          variant='outline'
          render={
            <Link href={`/${slug}/servicedesk/settings?tab=whatsapp`}>
              <SteelIcon icon={Settings02Icon} strokeWidth={2} />
              Abrir as configurações
            </Link>
          }
        />
      </div>
    )
  }

  if (!conversation) {
    return (
      <div className='p-4'>
        <NoConversation
          workspaceId={workspaceId}
          ticketRef={ticketRef}
          state={data}
        />
      </div>
    )
  }

  const items = messages.data ?? []

  return (
    <div className='flex min-h-0 flex-col gap-3 p-4'>
      <header className='flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2'>
        <SteelIcon
          icon={WhatsappIcon}
          strokeWidth={2}
          className={SD_TONE_TEXT.emerald}
        />
        <div className='flex min-w-0 flex-col'>
          <span className='truncate font-medium text-sm'>
            {conversation.contact.name ??
              formatSdWaId(conversation.contact.waId)}
          </span>
          <span className='truncate text-muted-foreground text-xs'>
            {formatSdWaId(conversation.contact.waId)} ·{' '}
            {data.connection?.label ?? 'Conexão do ServiceDesk'}
          </span>
        </div>
        <div className='ml-auto flex items-center gap-2'>
          {conversation.aiActive ? (
            <Badge variant='outline' className={SD_TONE.violet}>
              IA atendendo
            </Badge>
          ) : null}
          {data.connection ? (
            <StatusBadge status={data.connection.status} />
          ) : null}
          <ConfirmDeleteButton
            iconOnly={false}
            label='Desvincular'
            title='Desvincular a conversa?'
            description='O chamado deixa de receber as mensagens deste WhatsApp. O histórico já espelhado continua no chamado.'
            pending={unlink.isPending}
            onConfirm={() =>
              unlink.mutate(undefined, {
                onSuccess: () => notify.success('Conversa desvinculada'),
                onError: (error) => notify.error(error),
              })
            }
          />
        </div>
      </header>

      {data.connection && data.connection.status !== 'CONNECTED' ? (
        <p className={cn('rounded-lg px-3 py-2 text-xs', SD_TONE.red)}>
          A conexão {data.connection.label} está{' '}
          {(
            STATUS_LABEL[data.connection.status] ?? data.connection.status
          ).toLowerCase()}
          . As mensagens podem não ser entregues.
        </p>
      ) : null}

      <WindowNotice window={data.window} />

      <div
        className='flex max-h-[28rem] min-h-40 flex-col gap-2 overflow-y-auto rounded-lg border border-border bg-muted/40 p-3'
        data-testid='sd-whatsapp-messages'
      >
        {messages.isLoading ? (
          <Skeleton className='h-24 w-full' />
        ) : items.length === 0 ? (
          <p className='py-6 text-center text-muted-foreground text-sm'>
            Nenhuma mensagem nesta conversa ainda.
          </p>
        ) : (
          items.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))
        )}
      </div>

      {data.window.requiresTemplate ? (
        <TemplateComposer workspaceId={workspaceId} ticketRef={ticketRef} />
      ) : (
        <FreeComposer
          workspaceId={workspaceId}
          ticketRef={ticketRef}
          disabled={false}
        />
      )}
    </div>
  )
}
