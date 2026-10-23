'use client'

import {
  Add01Icon,
  ArchiveIcon,
  Delete02Icon,
  MoreVerticalIcon,
  PinIcon,
  Search01Icon,
  UserSwitchIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { type FormEvent, useEffect, useState } from 'react'
import { useShortcut } from '@/app/_components/shortcuts/shortcuts-provider'
import {
  contactRecordTitle,
  contactTitle,
} from '@/app/_components/whatsapp/whatsapp-contact-label'
import { useCan } from '@/app/_components/workspace/workspace-permissions'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { useUser } from '@/src/hooks/use-user'
import { useWhatsAppConnections } from '@/src/hooks/use-whatsapp-connections'
import { useWhatsAppContacts } from '@/src/hooks/use-whatsapp-contacts'
import {
  useArchiveWhatsAppConversation,
  useClearWhatsAppChat,
  useDeleteWhatsAppConversation,
  usePinWhatsAppConversation,
  useStartWhatsAppConversation,
  useWhatsAppConversations,
} from '@/src/hooks/use-whatsapp-conversations'
import {
  useWhatsAppConversationScope,
  useWhatsAppTeams,
} from '@/src/hooks/use-whatsapp-teams'
import {
  matchesSlaFilter,
  type WhatsAppSlaListFilter,
} from '@/src/lib/whatsapp/sla-format'
import type { WhatsAppConnectionDTO } from '@/types/whatsapp-connection'
import type { WhatsAppConversationDTO } from '@/types/whatsapp-conversation'
import {
  useSlaClock,
  useWhatsAppSlaByConversation,
  WhatsappSlaFilterSelect,
} from './whatsapp-sla-chip'
import {
  matchesInboxFilter,
  type WhatsAppInboxFilter,
} from './whatsapp-team-access'
import { WhatsappTeamBadge } from './whatsapp-team-badge'

/** "Todas / Minhas / Fila / Equipe X" — the teams listed are the viewer's. */
function InboxFilterSelect({
  workspaceId,
  value,
  onChange,
}: {
  workspaceId: string
  value: WhatsAppInboxFilter
  onChange: (value: WhatsAppInboxFilter) => void
}) {
  const teams = useWhatsAppTeams(workspaceId)
  const scope = useWhatsAppConversationScope(workspaceId)
  const visibleTeams = (teams.data ?? []).filter(
    (team) =>
      scope.data?.mode === 'ALL' || scope.data?.memberTeamIds.includes(team.id),
  )
  const labels: Record<string, string> = {
    all: 'Todas as conversas',
    mine: 'Minhas conversas',
    queue: 'Fila (sem responsável)',
    ...Object.fromEntries(
      visibleTeams.map((team) => [`team:${team.id}`, `Equipe ${team.name}`]),
    ),
  }

  return (
    <Select
      value={value}
      onValueChange={(next) => onChange((next ?? 'all') as WhatsAppInboxFilter)}
    >
      <SelectTrigger
        size='sm'
        className='w-full'
        aria-label='Filtrar conversas por responsável ou equipe'
      >
        <SelectValue>{labels[value] ?? labels.all}</SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        <SelectGroup>
          <SelectItem value='all'>Todas</SelectItem>
          <SelectItem value='mine'>Minhas</SelectItem>
          <SelectItem value='queue'>Fila</SelectItem>
          {visibleTeams.map((team) => (
            <SelectItem key={team.id} value={`team:${team.id}`}>
              Equipe {team.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function NewConversationDialog({
  workspaceId,
  onCreated,
}: {
  workspaceId: string
  onCreated: (conversation: WhatsAppConversationDTO) => void
}) {
  const [open, setOpen] = useState(false)
  // C → M (or `?new=1` from another screen) opens it.
  useShortcut('create.conversation', () => setOpen(true))
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('new') === '1') {
      setOpen(true)
    }
  }, [])
  const [contactId, setContactId] = useState<string>()
  const [connectionId, setConnectionId] = useState<string>()

  const contacts = useWhatsAppContacts(workspaceId)
  const connections = useWhatsAppConnections(workspaceId)
  const startConversation = useStartWhatsAppConversation(workspaceId)

  useEffect(() => {
    if (!connectionId && connections.data?.length) {
      setConnectionId(connections.data[0].id)
    }
  }, [connections.data, connectionId])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!contactId || !connectionId) return

    startConversation.mutate(
      { contactId, connectionId },
      {
        onSuccess: (conversation) => {
          onCreated(conversation)
          setOpen(false)
          setContactId(undefined)
        },
        onError: (error) => notify.error(error, 'Erro ao iniciar conversa'),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size='icon-sm' variant='ghost' aria-label='Nova conversa'>
            <SteelIcon icon={Add01Icon} size={18} />
          </Button>
        }
      />
      <DialogContent className='max-w-sm'>
        <DialogHeader>
          <DialogTitle>Nova conversa</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className='space-y-3'>
          <div className='space-y-1.5'>
            <Label htmlFor='newConvContact'>Contato</Label>
            <Select
              value={contactId}
              onValueChange={(value) => setContactId(value ?? undefined)}
            >
              <SelectTrigger id='newConvContact' className='w-full'>
                <SelectValue placeholder='Selecione um contato' />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {(contacts.data ?? []).map((contact) => (
                    <SelectItem key={contact.id} value={contact.id}>
                      {contactRecordTitle(contact)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {contacts.data?.length === 0 && (
              <p className='text-muted-foreground text-xs'>
                Cadastre um contato em Configurações primeiro.
              </p>
            )}
          </div>

          {connections.data && connections.data.length > 1 && (
            <div className='space-y-1.5'>
              <Label htmlFor='newConvConnection'>Enviar por</Label>
              <Select
                value={connectionId}
                onValueChange={(value) => setConnectionId(value ?? undefined)}
              >
                <SelectTrigger id='newConvConnection' className='w-full'>
                  <SelectValue placeholder='Selecione a conexão' />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {connections.data.map((connection) => (
                      <SelectItem key={connection.id} value={connection.id}>
                        {connection.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          )}

          <DialogFooter>
            <Button
              type='submit'
              disabled={
                !contactId || !connectionId || startConversation.isPending
              }
            >
              {startConversation.isPending
                ? 'Iniciando...'
                : 'Iniciar conversa'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) {
    return date.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    })
  }
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

export function WhatsappConversationSidebar({
  workspaceId,
  connections,
  connectionId,
  onConnectionChange,
  selectedConversationId,
  onSelect,
}: {
  workspaceId: string
  connections: WhatsAppConnectionDTO[]
  connectionId: string | undefined
  onConnectionChange: (connectionId: string | undefined) => void
  selectedConversationId: string | null
  onSelect: (conversation: WhatsAppConversationDTO) => void
}) {
  const [search, setSearch] = useState('')
  // Ativas = abertas (NEW/IN_PROGRESS); fechadas saem da caixa de entrada.
  const [tab, setTab] = useState<'active' | 'closed' | 'archived'>('active')
  const [inboxFilter, setInboxFilter] = useState<WhatsAppInboxFilter>('all')
  const [slaFilter, setSlaFilter] = useState<WhatsAppSlaListFilter>('all')
  const slaByConversation = useWhatsAppSlaByConversation(workspaceId)
  const slaNow = useSlaClock()
  const currentUser = useUser()
  const [clearTargetId, setClearTargetId] = useState<string | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const conversations = useWhatsAppConversations(
    workspaceId,
    tab === 'active' ? 'OPEN' : tab === 'closed' ? 'CLOSED' : undefined,
    tab === 'archived',
    connectionId,
  )
  const pinConversation = usePinWhatsAppConversation(workspaceId)
  const archiveConversation = useArchiveWhatsAppConversation(workspaceId)
  const deleteConversation = useDeleteWhatsAppConversation(workspaceId)
  const clearChat = useClearWhatsAppChat(workspaceId)
  // Limpar/excluir conversa é ação de admin (a API negaria ao Membro).
  const canDeleteConversation = useCan('conversations', 'DELETE')

  const filtered = (conversations.data ?? []).filter((conversation) => {
    if (!matchesInboxFilter(conversation, inboxFilter, currentUser.data?.id)) {
      return false
    }
    if (
      !matchesSlaFilter(
        slaByConversation.get(conversation.id),
        slaFilter,
        slaNow,
      )
    ) {
      return false
    }
    if (!search) return true
    const term = search.toLowerCase()
    return (
      conversation.contactName?.toLowerCase().includes(term) ||
      conversation.contactWaId.toLowerCase().includes(term) ||
      conversation.contactUsername?.toLowerCase().includes(term)
    )
  })

  // Alt+↑/↓ walk the list (also while typing), Alt+Shift+↓ the next unread;
  // E and P archive/pin the open conversation.
  const selectedIndex = filtered.findIndex(
    (conversation) => conversation.id === selectedConversationId,
  )
  const selected = selectedIndex >= 0 ? filtered[selectedIndex] : null
  function walk(delta: 1 | -1, unreadOnly = false) {
    for (let step = 1; step <= filtered.length; step++) {
      const index =
        selectedIndex < 0 && delta < 0
          ? filtered.length - step
          : selectedIndex + delta * step
      const next = filtered[index]
      if (!next) return false
      if (!unreadOnly || next.unreadCount > 0) {
        onSelect(next)
        return
      }
    }
    return false
  }
  useShortcut('zap.next', () => walk(1))
  useShortcut('zap.prev', () => walk(-1))
  useShortcut('zap.next-unread', () => walk(1, true))
  useShortcut(
    'zap.archive',
    () => {
      if (!selected) return false
      archiveConversation.mutate({
        conversationId: selected.id,
        archived: !selected.archived,
      })
      notify.success(
        selected.archived ? 'Conversa desarquivada' : 'Conversa arquivada',
      )
    },
    { enabled: Boolean(selected) },
  )
  useShortcut(
    'zap.pin',
    () => {
      if (!selected) return false
      pinConversation.mutate({
        conversationId: selected.id,
        pinned: !selected.pinned,
      })
      notify.success(
        selected.pinned ? 'Conversa desafixada' : 'Conversa fixada',
      )
    },
    { enabled: Boolean(selected) },
  )

  return (
    <div className='flex h-full w-80 shrink-0 flex-col border-r'>
      {connections.length > 1 && (
        <div className='px-3 pt-3'>
          <Select
            value={connectionId ?? 'all'}
            onValueChange={(value) =>
              onConnectionChange(
                value === 'all' ? undefined : (value ?? undefined),
              )
            }
          >
            <SelectTrigger className='w-full' aria-label='Filtrar por conexão'>
              <SelectValue placeholder='Todas as conexões' />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                <SelectItem value='all'>Todas as conexões</SelectItem>
                {connections.map((connection) => (
                  <SelectItem key={connection.id} value={connection.id}>
                    {connection.label} · {connection.phoneNumber}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      )}
      <div className='flex items-center gap-2 p-3'>
        <div className='relative flex-1'>
          <SteelIcon
            icon={Search01Icon}
            size={16}
            className='-translate-y-1/2 absolute top-1/2 left-2.5 text-muted-foreground'
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder='Buscar conversa'
            className='pl-8'
          />
        </div>
        <NewConversationDialog workspaceId={workspaceId} onCreated={onSelect} />
      </div>
      <Tabs
        value={tab}
        onValueChange={(value) =>
          setTab(value as 'active' | 'closed' | 'archived')
        }
        className='px-3'
      >
        <TabsList className='w-full'>
          <TabsTrigger value='active' className='flex-1'>
            Ativas
          </TabsTrigger>
          <TabsTrigger value='closed' className='flex-1'>
            Fechadas
          </TabsTrigger>
          <TabsTrigger value='archived' className='flex-1'>
            Arquivadas
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <div className='px-3 pt-2 pb-1'>
        <InboxFilterSelect
          workspaceId={workspaceId}
          value={inboxFilter}
          onChange={setInboxFilter}
        />
        <WhatsappSlaFilterSelect
          workspaceId={workspaceId}
          value={slaFilter}
          onChange={setSlaFilter}
        />
      </div>
      <div className='flex-1 overflow-y-auto'>
        {filtered.length === 0 ? (
          <p className='px-3 py-6 text-center text-muted-foreground text-sm'>
            Nenhuma conversa
          </p>
        ) : (
          filtered.map((conversation) => (
            <div
              key={conversation.id}
              className={cn(
                'group flex w-full items-center gap-2.5 border-b px-3 py-2.5 hover:bg-muted',
                selectedConversationId === conversation.id && 'bg-muted',
              )}
            >
              <button
                type='button'
                onClick={() => onSelect(conversation)}
                className='flex min-w-0 flex-1 items-center gap-2.5 text-left'
              >
                <Avatar>
                  <AvatarImage
                    src={conversation.contactAvatarUrl ?? undefined}
                  />
                  <AvatarFallback>
                    {contactTitle(conversation).slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className='min-w-0 flex-1'>
                  <div className='flex items-center gap-1.5'>
                    {conversation.pinned && (
                      <SteelIcon
                        icon={PinIcon}
                        size={11}
                        className='shrink-0 text-muted-foreground'
                      />
                    )}
                    {!conversation.aiActive && conversation.aiHandoff && (
                      <SteelIcon
                        icon={UserSwitchIcon}
                        size={11}
                        className='shrink-0 text-amber-600 dark:text-amber-400'
                      />
                    )}
                    <span className='truncate font-medium text-sm'>
                      {contactTitle(conversation)}
                    </span>
                    <span className='ml-auto shrink-0 text-[10px] text-muted-foreground'>
                      {formatRelativeTime(conversation.lastMessageAt)}
                    </span>
                  </div>
                  <div className='flex items-center justify-between gap-2'>
                    <span className='truncate text-muted-foreground text-xs'>
                      {conversation.lastMessagePreview ?? 'Sem mensagens'}
                    </span>
                    <WhatsappTeamBadge
                      team={conversation.team}
                      className='ml-auto'
                    />
                    {conversation.unreadCount > 0 && (
                      <Badge className='shrink-0'>
                        {conversation.unreadCount}
                      </Badge>
                    )}
                  </div>
                </div>
              </button>

              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant='ghost'
                      size='icon-sm'
                      className='shrink-0 opacity-0 group-hover:opacity-100'
                      aria-label='Ações da conversa'
                    >
                      <SteelIcon icon={MoreVerticalIcon} size={16} />
                    </Button>
                  }
                />
                <DropdownMenuContent align='end'>
                  <DropdownMenuItem
                    onClick={() =>
                      pinConversation.mutate({
                        conversationId: conversation.id,
                        pinned: !conversation.pinned,
                      })
                    }
                  >
                    <SteelIcon icon={PinIcon} size={14} />
                    {conversation.pinned ? 'Desafixar' : 'Fixar'}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      archiveConversation.mutate({
                        conversationId: conversation.id,
                        archived: !conversation.archived,
                      })
                    }
                  >
                    <SteelIcon icon={ArchiveIcon} size={14} />
                    {conversation.archived ? 'Desarquivar' : 'Arquivar'}
                  </DropdownMenuItem>
                  {canDeleteConversation ? (
                    <>
                      <DropdownMenuItem
                        onClick={() => setClearTargetId(conversation.id)}
                      >
                        <SteelIcon icon={Delete02Icon} size={14} />
                        Limpar conversa
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant='destructive'
                        onClick={() => setDeleteTargetId(conversation.id)}
                      >
                        <SteelIcon icon={Delete02Icon} size={14} />
                        Excluir conversa
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))
        )}
      </div>

      <AlertDialog
        open={clearTargetId !== null}
        onOpenChange={(open) => {
          if (!open) setClearTargetId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Limpar conversa</AlertDialogTitle>
            <AlertDialogDescription>
              Todas as mensagens desta conversa serão ocultadas. Essa ação não
              pode ser desfeita pela interface.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearChat.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={clearChat.isPending}
              onClick={() => {
                if (!clearTargetId) return
                clearChat.mutate(clearTargetId, {
                  onSuccess: () => setClearTargetId(null),
                  onError: (error) =>
                    notify.error(error, 'Erro ao limpar conversa'),
                })
              }}
            >
              {clearChat.isPending ? 'Limpando...' : 'Limpar conversa'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteTargetId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTargetId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir conversa</AlertDialogTitle>
            <AlertDialogDescription>
              A conversa será removida da lista. Essa ação não pode ser desfeita
              pela interface.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteConversation.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              disabled={deleteConversation.isPending}
              onClick={() => {
                if (!deleteTargetId) return
                deleteConversation.mutate(deleteTargetId, {
                  onSuccess: () => setDeleteTargetId(null),
                  onError: (error) =>
                    notify.error(error, 'Erro ao excluir conversa'),
                })
              }}
            >
              {deleteConversation.isPending
                ? 'Excluindo...'
                : 'Excluir conversa'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
