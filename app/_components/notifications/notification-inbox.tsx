'use client'

import {
  AiMagicIcon,
  Alert02Icon,
  Archive02Icon,
  ArchiveRestoreIcon,
  Delete02Icon,
  KeyboardIcon,
  Mail01Icon,
  MailOpen01Icon,
  MoreHorizontalIcon,
  Search01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ShortcutKbd } from '@/app/_components/shortcuts/shortcut-kbd'
import {
  useShortcut,
  useShortcuts,
} from '@/app/_components/shortcuts/shortcuts-provider'
import { AiInsightFeed } from '@/app/_components/steel-ai-insights/ai-insight-feed'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
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
import { useAiInsights } from '@/src/hooks/use-ai-insights'
import {
  useArchiveReadNotifications,
  useInboxAiPending,
  useMarkNotificationsRead,
  useNotificationAction,
  useNotificationInbox,
  useNotificationStream,
  useSnoozeNotifications,
} from '@/src/hooks/use-notifications'
import {
  NOTIFICATION_MODULE_LABELS,
  type NotificationModule,
  type NotificationQuickFilter,
  notificationKindCatalog,
} from '@/src/lib/notification-kind'
import type { NotificationSnoozePreset } from '@/src/lib/notifications/snooze'
import type {
  NotificationAction,
  NotificationFolder,
} from '@/src/schemas/notification.schema'
import type { NotificationDTO } from '@/types/notification'
import { NotificationAiPendingPanel } from './notification-ai-pending-panel'
import { NotificationBrowserPrompt } from './notification-browser-toggle'
import { NotificationList } from './notification-list'
import { NotificationReadingPanel } from './notification-reading-panel'
import { NotificationSnoozeDialog } from './notification-snooze-dialog'
import { NotificationSnoozeMenu } from './notification-snooze-menu'

type Folder = NotificationFolder
/** `insights` = proactive AI insights (ADR 0040), `?view=insights`. */
type View = 'notifications' | 'ai' | 'insights'

function viewFromSearch(value: string | null | undefined): View {
  return value === 'ai' || value === 'insights' ? value : 'notifications'
}

const FOLDERS: { value: Folder; label: string }[] = [
  { value: 'all', label: 'Tudo' },
  { value: 'unread', label: 'Não lidas' },
  { value: 'snoozed', label: 'Adiadas' },
  { value: 'archived', label: 'Arquivadas' },
]

const QUICK_FILTERS: { value: NotificationQuickFilter; label: string }[] = [
  { value: 'mentions', label: 'Menções' },
  { value: 'assigned', label: 'Atribuídas a mim' },
]

/** Módulos oferecidos no filtro, na ordem do produto. */
const FILTER_MODULES: NotificationModule[] = [
  'SERVICE_DESK',
  'COMMUNICATION',
  'CRM',
  'OTHER',
]

const ALL = '__all__'

const UNDOABLE: Partial<Record<NotificationAction, NotificationAction>> = {
  archive: 'unarchive',
  unarchive: 'archive',
  delete: 'restore',
  read: 'unread',
  unread: 'read',
}

const ACTION_DONE: Record<NotificationAction, string> = {
  read: 'Marcada como lida',
  unread: 'Marcada como não lida',
  archive: 'Arquivada',
  unarchive: 'Desarquivada',
  delete: 'Excluída',
  restore: 'Restaurada',
  unsnooze: 'Adiamento desfeito',
}

const ACTION_DONE_MANY: Record<NotificationAction, string> = {
  read: 'Marcadas como lidas',
  unread: 'Marcadas como não lidas',
  archive: 'Arquivadas',
  unarchive: 'Desarquivadas',
  delete: 'Excluídas',
  restore: 'Restauradas',
  unsnooze: 'Adiamento desfeito',
}

/**
 * Caixa de entrada das notificações do workspace no formato de cliente de
 * e-mail: pastas, filtros rápidos, busca, lista à esquerda, leitura à
 * direita, seleção múltipla com ações em lote (ler, arquivar, adiar,
 * excluir), desfazer, atalhos de teclado e a visão "Pendências da IA". No
 * celular vira coluna única (lista → detalhe).
 */
export function NotificationInbox({
  workspaceId,
  slug,
  userId,
}: {
  workspaceId: string
  slug?: string
  userId?: string
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [view, setView] = useState<View>(
    viewFromSearch(searchParams?.get('view')),
  )
  const [folder, setFolder] = useState<Folder>('all')
  const [quick, setQuick] = useState<NotificationQuickFilter | null>(null)
  const [moduleFilter, setModuleFilter] = useState<string>(ALL)
  const [kindFilter, setKindFilter] = useState<string>(ALL)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const shortcuts = useShortcuts()
  const [snoozeIds, setSnoozeIds] = useState<string[] | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  useNotificationStream(workspaceId)

  // Busca com pequeno atraso: a tecla "/" foca o campo e cada letra não
  // dispara uma consulta.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 350)
    return () => clearTimeout(timer)
  }, [searchInput])

  const filters = useMemo(
    () => ({
      folder,
      module:
        moduleFilter === ALL ? undefined : (moduleFilter as NotificationModule),
      kind: kindFilter === ALL ? undefined : kindFilter,
      quick: quick ?? undefined,
      search: search || undefined,
    }),
    [folder, moduleFilter, kindFilter, quick, search],
  )

  /** Scope of "marcar todas"/"arquivar lidas": the module/kind on screen. */
  const bulkScope = useMemo(
    () => ({
      ...(filters.module ? { module: filters.module } : {}),
      ...(filters.kind ? { kind: filters.kind } : {}),
    }),
    [filters.module, filters.kind],
  )

  const inbox = useNotificationInbox(workspaceId, filters, {
    enabled: view === 'notifications',
  })
  const aiPending = useInboxAiPending(workspaceId)
  const insights = useAiInsights(workspaceId, { state: 'active', limit: 1 })
  const action = useNotificationAction(workspaceId)
  const markRead = useMarkNotificationsRead(workspaceId)
  const archiveRead = useArchiveReadNotifications(workspaceId)
  const snooze = useSnoozeNotifications(workspaceId)

  const items = useMemo(
    () => inbox.data?.pages.flatMap((page) => page.items) ?? [],
    [inbox.data],
  )
  const counts = inbox.data?.pages[0]?.counts ?? {
    all: 0,
    unread: 0,
    archived: 0,
    snoozed: 0,
  }
  const aiCount = aiPending.data?.count ?? 0
  const insightCount = insights.data?.enabled ? insights.data.counts.active : 0

  const active = items.find((item) => item.id === activeId) ?? null

  const kindOptions = useMemo(() => {
    const catalog = notificationKindCatalog()
    return moduleFilter === ALL
      ? catalog
      : catalog.filter((info) => info.module === moduleFilter)
  }, [moduleFilter])

  /** Põe o foco na linha (os atalhos `j`/`k` movem o foco de verdade). */
  const focusRow = useCallback((id: string) => {
    const node = document.querySelector<HTMLElement>(
      `[data-notification-row="${id}"]`,
    )
    node?.focus()
  }, [])

  const run = useCallback(
    (
      verb: NotificationAction,
      ids: string[],
      { undoable = true }: { undoable?: boolean } = {},
    ) => {
      if (ids.length === 0) return
      action.mutate(
        { action: verb, ids },
        {
          onSuccess: () => {
            setSelectedIds(new Set())
            if (
              ids.includes(activeId ?? '') &&
              verb !== 'read' &&
              verb !== 'unread'
            ) {
              setActiveId(null)
            }
            const label =
              ids.length === 1 ? ACTION_DONE[verb] : ACTION_DONE_MANY[verb]
            const message =
              ids.length === 1 ? label : `${ids.length} notificações · ${label}`
            const undo = undoable ? UNDOABLE[verb] : undefined
            if (undo) {
              toast.success(message, {
                action: {
                  label: 'Desfazer',
                  onClick: () => run(undo, ids, { undoable: false }),
                },
              })
            } else {
              notify.success(message)
            }
          },
          onError: (error) =>
            notify.error(error, 'Não foi possível atualizar as notificações'),
        },
      )
    },
    [action, activeId],
  )

  const snoozeMany = useCallback(
    (ids: string[], preset: NotificationSnoozePreset) => {
      if (ids.length === 0) return
      snooze.mutate(
        { ids, preset },
        {
          onSuccess: (result) => {
            setSelectedIds(new Set())
            if (ids.includes(activeId ?? '')) setActiveId(null)
            const until = new Date(result.snoozedUntil).toLocaleString(
              'pt-BR',
              {
                weekday: 'short',
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              },
            )
            toast.success(
              ids.length === 1
                ? `Adiada até ${until}`
                : `${ids.length} notificações adiadas até ${until}`,
              {
                action: {
                  label: 'Desfazer',
                  onClick: () => run('unsnooze', ids, { undoable: false }),
                },
              },
            )
          },
          onError: (error) =>
            notify.error(error, 'Não foi possível adiar as notificações'),
        },
      )
    },
    [snooze, activeId, run],
  )

  const open = useCallback(
    (notification: NotificationDTO) => {
      setActiveId(notification.id)
      if (!notification.read) {
        action.mutate({ action: 'read', ids: [notification.id] })
      }
    },
    [action],
  )

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const archiveOf = useCallback(
    (notification: NotificationDTO) =>
      run(notification.archived ? 'unarchive' : 'archive', [notification.id]),
    [run],
  )

  const switchView = useCallback((next: View) => {
    setView(next)
    setActiveId(null)
    setSelectedIds(new Set())
  }, [])

  // Atalhos de cliente de e-mail (registro `inbox.*`). `j`/`k` movem o foco
  // pela lista; as ações usam a seleção (quando houver), a linha em foco ou a
  // aberta no painel. A guarda de digitação, os diálogos abertos e o `Esc`
  // que sai do campo ficam com o provider.
  const target = () => {
    const focusedId =
      document.activeElement instanceof HTMLElement
        ? document.activeElement.dataset.notificationRow
        : undefined
    const currentId = focusedId ?? activeId
    const index = items.findIndex((item) => item.id === currentId)
    const current = index >= 0 ? items[index] : null
    const targets =
      selectedIds.size > 0
        ? Array.from(selectedIds)
        : current
          ? [current.id]
          : []
    return { focusedId, index, current, targets }
  }
  const inboxReady = view === 'notifications'

  useShortcut('inbox.next', () => {
    const { index } = target()
    const next = items[index + 1] ?? items[0]
    if (next) focusRow(next.id)
  })
  useShortcut('inbox.prev', () => {
    const { index } = target()
    const previous = index > 0 ? items[index - 1] : items[items.length - 1]
    if (previous) focusRow(previous.id)
  })
  useShortcut('inbox.open', () => {
    const { current, focusedId } = target()
    // A focused row is a button: its own Enter opens it.
    if (!current || focusedId) return false
    open(current)
  })
  useShortcut('inbox.back', () => {
    const { current } = target()
    setActiveId(null)
    if (current) focusRow(current.id)
  })
  useShortcut('inbox.archive', () => {
    const { current } = target()
    if (!current) return false
    archiveOf(current)
  })
  useShortcut('inbox.read', () => {
    const { current, targets } = target()
    if (targets.length === 0) return false
    if (selectedIds.size > 0) run('read', targets)
    else if (current) run(current.read ? 'unread' : 'read', targets)
  })
  useShortcut('inbox.snooze', () => {
    const { targets } = target()
    if (targets.length === 0) return false
    setSnoozeIds(targets)
  })
  useShortcut('inbox.delete', () => {
    const { current } = target()
    if (!current) return false
    run('delete', [current.id])
  })
  useShortcut('inbox.select', () => {
    const { current } = target()
    if (!current) return false
    toggleSelect(current.id)
  })
  useShortcut('inbox.ai', () =>
    switchView(view === 'ai' ? 'notifications' : 'ai'),
  )
  useShortcut('inbox.search', () => searchRef.current?.focus(), {
    enabled: inboxReady,
  })
  useShortcut('inbox.clear', () => {
    if (selectedIds.size === 0) return false
    setSelectedIds(new Set())
  })

  const selectedList = Array.from(selectedIds)
  const filtered =
    Boolean(search) ||
    moduleFilter !== ALL ||
    kindFilter !== ALL ||
    quick !== null
  const emptyLabel = filtered
    ? 'Nada encontrado com esses filtros.'
    : folder === 'archived'
      ? 'Nenhuma notificação arquivada.'
      : folder === 'snoozed'
        ? 'Nenhuma notificação adiada.'
        : folder === 'unread'
          ? 'Tudo em dia: nenhuma não lida.'
          : 'Nenhuma notificação por aqui.'

  const scopeSuffix = filters.module || filters.kind ? ' (deste filtro)' : ''

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <NotificationBrowserPrompt workspaceId={workspaceId} />

      <div className='flex flex-wrap items-center gap-2 border-b px-4 py-3'>
        <Tabs
          value={view === 'notifications' ? folder : ''}
          onValueChange={(value) => {
            setFolder(value as Folder)
            switchView('notifications')
          }}
        >
          <TabsList aria-label='Pastas'>
            {FOLDERS.map((item) => (
              <TabsTrigger key={item.value} value={item.value}>
                {item.label}
                {item.value === 'unread' && counts.unread > 0 ? (
                  <Badge variant='secondary'>{counts.unread}</Badge>
                ) : null}
                {item.value === 'snoozed' && counts.snoozed > 0 ? (
                  <Badge variant='ghost'>{counts.snoozed}</Badge>
                ) : null}
                {item.value === 'archived' && counts.archived > 0 ? (
                  <Badge variant='ghost'>{counts.archived}</Badge>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className='relative w-full sm:ml-auto sm:max-w-xs'>
          <SteelIcon
            icon={Search01Icon}
            size={16}
            strokeWidth={2}
            className='-translate-y-1/2 absolute top-1/2 left-2.5 text-muted-foreground'
          />
          <Input
            ref={searchRef}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder='Buscar nas notificações…'
            aria-label='Buscar nas notificações'
            className='pl-8'
          />
        </div>

        <Select
          items={[
            { value: ALL, label: 'Todos os módulos' },
            ...FILTER_MODULES.map((module) => ({
              value: module,
              label: NOTIFICATION_MODULE_LABELS[module],
            })),
          ]}
          value={moduleFilter}
          onValueChange={(value) => {
            setModuleFilter(value as string)
            setKindFilter(ALL)
          }}
        >
          <SelectTrigger className='w-40' aria-label='Filtrar por módulo'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL}>Todos os módulos</SelectItem>
              {FILTER_MODULES.map((module) => (
                <SelectItem key={module} value={module}>
                  {NOTIFICATION_MODULE_LABELS[module]}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select
          items={[
            { value: ALL, label: 'Todos os tipos' },
            ...kindOptions.map((info) => ({
              value: info.kind,
              label: info.label,
            })),
          ]}
          value={kindFilter}
          onValueChange={(value) => setKindFilter(value as string)}
        >
          <SelectTrigger className='w-44' aria-label='Filtrar por tipo'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL}>Todos os tipos</SelectItem>
              {kindOptions.map((info) => (
                <SelectItem key={info.kind} value={info.kind}>
                  {info.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size='icon-sm'
                variant='ghost'
                aria-label='Mais ações da caixa de entrada'
              >
                <SteelIcon
                  icon={MoreHorizontalIcon}
                  size={18}
                  strokeWidth={2}
                />
              </Button>
            }
          />
          <DropdownMenuContent align='end' className='w-64'>
            <DropdownMenuGroup>
              <DropdownMenuItem
                disabled={markRead.isPending}
                onClick={() =>
                  markRead.mutate(bulkScope, {
                    onSuccess: (result) =>
                      notify.success(
                        result.updated === 0
                          ? 'Nada para marcar como lido'
                          : `${result.updated} marcadas como lidas`,
                      ),
                    onError: (error) =>
                      notify.error(error, 'Não foi possível marcar como lidas'),
                  })
                }
              >
                <SteelIcon icon={MailOpen01Icon} strokeWidth={2} />
                Marcar todas como lidas{scopeSuffix}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={archiveRead.isPending}
                onClick={() =>
                  archiveRead.mutate(bulkScope, {
                    onSuccess: (result) =>
                      notify.success(
                        result.updated === 0
                          ? 'Nenhuma lida para arquivar'
                          : `${result.updated} lidas arquivadas`,
                      ),
                    onError: (error) =>
                      notify.error(error, 'Não foi possível arquivar as lidas'),
                  })
                }
              >
                <SteelIcon icon={Archive02Icon} strokeWidth={2} />
                Arquivar todas as lidas{scopeSuffix}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            {slug ? (
              <DropdownMenuItem
                onClick={() => router.push(`/${slug}/settings/notifications`)}
              >
                Preferências de notificação
              </DropdownMenuItem>
            ) : null}
            {shortcuts ? (
              <DropdownMenuItem
                onClick={() => shortcuts.setCheatSheetOpen(true)}
              >
                <SteelIcon icon={KeyboardIcon} strokeWidth={2} />
                <span className='flex-1'>Atalhos do teclado</span>
                <ShortcutKbd id='global.shortcuts' />
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div
        role='toolbar'
        aria-label='Filtros rápidos'
        className='flex items-center gap-2 overflow-x-auto border-b px-4 py-2'
      >
        <Button
          size='xs'
          variant={view === 'ai' ? 'default' : 'outline'}
          aria-pressed={view === 'ai'}
          onClick={() => switchView(view === 'ai' ? 'notifications' : 'ai')}
          className='shrink-0'
        >
          <SteelIcon icon={AiMagicIcon} size={14} strokeWidth={2} />
          Pendências da IA
          {aiCount > 0 ? (
            <Badge
              variant={view === 'ai' ? 'secondary' : 'destructive'}
              aria-label={`${aiCount} pendências`}
            >
              {aiCount}
            </Badge>
          ) : null}
        </Button>
        <Button
          size='xs'
          variant={view === 'insights' ? 'default' : 'outline'}
          aria-pressed={view === 'insights'}
          onClick={() =>
            switchView(view === 'insights' ? 'notifications' : 'insights')
          }
          className='shrink-0'
        >
          <SteelIcon icon={Alert02Icon} size={14} strokeWidth={2} />
          Alertas da IA
          {insightCount > 0 ? (
            <Badge
              variant='secondary'
              aria-label={`${insightCount} alertas ativos`}
            >
              {insightCount}
            </Badge>
          ) : null}
        </Button>
        <Button
          size='xs'
          variant={
            view === 'notifications' && folder === 'unread'
              ? 'default'
              : 'outline'
          }
          aria-pressed={view === 'notifications' && folder === 'unread'}
          onClick={() => {
            setFolder(
              folder === 'unread' && view === 'notifications'
                ? 'all'
                : 'unread',
            )
            switchView('notifications')
          }}
          className='shrink-0'
        >
          <SteelIcon icon={Mail01Icon} size={14} strokeWidth={2} />
          Não lidas
        </Button>
        {QUICK_FILTERS.map((item) => {
          const pressed = view === 'notifications' && quick === item.value
          return (
            <Button
              key={item.value}
              size='xs'
              variant={pressed ? 'default' : 'outline'}
              aria-pressed={pressed}
              onClick={() => {
                setQuick(pressed ? null : item.value)
                switchView('notifications')
              }}
              className='shrink-0'
            >
              {item.label}
            </Button>
          )
        })}
      </div>

      {view === 'notifications' && selectedList.length > 0 ? (
        <div
          role='toolbar'
          aria-label='Ações da seleção'
          className='flex flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2'
        >
          <span className='text-sm'>
            {selectedList.length === 1
              ? '1 selecionada'
              : `${selectedList.length} selecionadas`}
          </span>
          <Button
            size='xs'
            variant='outline'
            onClick={() => run('read', selectedList)}
          >
            <SteelIcon icon={MailOpen01Icon} size={16} strokeWidth={2} />
            Marcar como lida
          </Button>
          <Button
            size='xs'
            variant='outline'
            onClick={() => run('unread', selectedList)}
          >
            <SteelIcon icon={Mail01Icon} size={16} strokeWidth={2} />
            Não lida
          </Button>
          <Button
            size='xs'
            variant='outline'
            onClick={() =>
              run(folder === 'archived' ? 'unarchive' : 'archive', selectedList)
            }
          >
            <SteelIcon
              icon={folder === 'archived' ? ArchiveRestoreIcon : Archive02Icon}
              size={16}
              strokeWidth={2}
            />
            {folder === 'archived' ? 'Desarquivar' : 'Arquivar'}
          </Button>
          {folder === 'snoozed' ? (
            <Button
              size='xs'
              variant='outline'
              onClick={() => run('unsnooze', selectedList)}
            >
              Desfazer adiamento
            </Button>
          ) : (
            <NotificationSnoozeMenu
              onSnooze={(preset) => snoozeMany(selectedList, preset)}
            />
          )}
          <Button
            size='xs'
            variant='outline'
            onClick={() => run('delete', selectedList)}
          >
            <SteelIcon icon={Delete02Icon} size={16} strokeWidth={2} />
            Excluir
          </Button>
          <Button
            size='xs'
            variant='ghost'
            className='ml-auto'
            onClick={() => setSelectedIds(new Set())}
          >
            Limpar seleção
          </Button>
        </div>
      ) : null}

      {view === 'ai' ? (
        <div className='min-h-0 flex-1 overflow-y-auto'>
          <NotificationAiPendingPanel
            workspaceId={workspaceId}
            slug={slug ?? ''}
          />
        </div>
      ) : view === 'insights' ? (
        <div className='min-h-0 flex-1 overflow-y-auto'>
          <AiInsightFeed workspaceId={workspaceId} slug={slug ?? ''} />
        </div>
      ) : (
        <div className='grid min-h-0 flex-1 lg:grid-cols-[minmax(20rem,26rem)_1fr]'>
          <div
            className={cn(
              'min-h-0 overflow-y-auto lg:border-r',
              // Coluna única no celular: com uma notificação aberta, a lista
              // sai de cena e o painel ocupa a tela.
              active ? 'hidden lg:block' : 'block',
            )}
          >
            <NotificationList
              items={items}
              activeId={activeId}
              selectedIds={selectedIds}
              loading={inbox.isLoading}
              hasNextPage={Boolean(inbox.hasNextPage)}
              loadingMore={inbox.isFetchingNextPage}
              onOpen={open}
              onToggleSelect={toggleSelect}
              onLoadMore={() => {
                if (inbox.hasNextPage && !inbox.isFetchingNextPage) {
                  inbox.fetchNextPage()
                }
              }}
              emptyLabel={emptyLabel}
            />
          </div>

          <div className={cn('min-h-0', active ? 'block' : 'hidden lg:block')}>
            <NotificationReadingPanel
              workspaceId={workspaceId}
              slug={slug}
              userId={userId}
              notification={active}
              onBack={() => setActiveId(null)}
              onToggleRead={(notification) =>
                run(notification.read ? 'unread' : 'read', [notification.id])
              }
              onArchive={archiveOf}
              onDelete={(notification) => run('delete', [notification.id])}
              onSnooze={(notification, preset) =>
                snoozeMany([notification.id], preset)
              }
              onUnsnooze={(notification) => run('unsnooze', [notification.id])}
              onOpenHref={(notification) => {
                if (notification.href) router.push(notification.href)
              }}
              onNavigate={(href) => router.push(href)}
            />
          </div>
        </div>
      )}

      <NotificationSnoozeDialog
        open={snoozeIds !== null}
        onOpenChange={(next) => {
          if (!next) setSnoozeIds(null)
        }}
        count={snoozeIds?.length ?? 0}
        onSnooze={(preset) => snoozeMany(snoozeIds ?? [], preset)}
      />
    </div>
  )
}
