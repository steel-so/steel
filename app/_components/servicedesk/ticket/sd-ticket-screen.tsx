'use client'

import {
  Alert02Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowUpDoubleIcon,
  Copy01Icon,
  Delete02Icon,
  Edit02Icon,
  HierarchyIcon,
  Link01Icon,
  MoreHorizontalIcon,
  SidebarRightIcon,
  StarIcon,
  Unlink01Icon,
  UserIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import {
  sdNeighbourTicket,
  sdReadTicketNav,
} from '@/app/_components/servicedesk/board/sd-ticket-nav'
import { ShortcutKbd } from '@/app/_components/shortcuts/shortcut-kbd'
import { useShortcut } from '@/app/_components/shortcuts/shortcuts-provider'
import { AskSteelAiMenuItem } from '@/app/_components/steel-ai-ask/ask-steel-ai-button'
import { AskSteelAiDialog } from '@/app/_components/steel-ai-ask/ask-steel-ai-dialog'
import { SendSurveyDialog } from '@/app/_components/whatsapp/surveys/send-survey-dialog'
import { SteelIcon } from '@/components/icon/icon'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { useSdAgents, useSdConfig, useSdMe } from '@/src/hooks/use-sd-config'
import { useSdTicketKbLinks } from '@/src/hooks/use-sd-knowledge'
import {
  useDeleteSdTicket,
  useSdTicket,
  useSdTicketRealtime,
  useSetSdTicketParent,
  useUpdateSdTicket,
} from '@/src/hooks/use-sd-tickets'
import type {
  SdAgentDTO,
  SdConfigBootstrapDTO,
  SdMeDTO,
} from '@/types/sd-config'
import type { SdTicketDTO } from '@/types/sd-ticket'
import { SdRiskBadge } from '../risk/sd-risk-badge'
import { SD_COMPOSER_INPUT_ID } from './history/sd-message-composer'
import { SdCreateTicketSheet } from './sd-create-ticket-sheet'
import { SdFollowButton } from './sd-follow-button'
import { SdOptionSelect } from './sd-option-select'
import { useSdPhaseMover } from './sd-phase-mover'
import { SdRichTextEditor, SdRichTextView } from './sd-rich-text-editor'
import { SdSlaIndicator, useSdNow } from './sd-ticket-badges'
import {
  SD_PHASE_CATEGORY_COLOR,
  SD_TICKET_TYPE_LABEL,
  SD_TICKET_TYPE_PLURAL,
  SD_TYPE_ROUTE,
  sdPrimarySla,
  sdTicketHref,
} from './sd-ticket-meta'
import { sdTypePhases } from './sd-ticket-options'
import { SdTicketPicker } from './sd-ticket-picker'
import { SdTicketSidebar } from './sd-ticket-sidebar'
import { SdTicketTabs, sdResolveTab, sdTicketTabsFor } from './ticket-tabs'
import { useSdIsDesktop } from './use-sd-is-desktop'

function EditableTitle({
  workspaceId,
  ticket,
}: {
  workspaceId: string
  ticket: SdTicketDTO
}) {
  const update = useUpdateSdTicket(workspaceId, ticket.id)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(ticket.title)

  function save() {
    const title = value.trim()
    setEditing(false)
    if (!title || title === ticket.title) {
      setValue(ticket.title)
      return
    }
    update.mutate(
      { title },
      {
        onError: (e) => {
          notify.error(e)
          setValue(ticket.title)
        },
      },
    )
  }

  if (editing) {
    return (
      <Input
        autoFocus
        aria-label='Título do chamado'
        value={value}
        maxLength={200}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') {
            setValue(ticket.title)
            setEditing(false)
          }
        }}
        className='h-9 font-medium text-lg'
      />
    )
  }
  return (
    <button
      type='button'
      onClick={() => {
        setValue(ticket.title)
        setEditing(true)
      }}
      className='group flex min-w-0 items-start gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
      title='Editar título'
    >
      <h1 className='line-clamp-2 font-medium text-lg leading-snug'>
        {ticket.title}
      </h1>
      <SteelIcon
        icon={Edit02Icon}
        strokeWidth={2}
        className='mt-1.5 size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
      />
    </button>
  )
}

function Description({
  workspaceId,
  ticket,
}: {
  workspaceId: string
  ticket: SdTicketDTO
}) {
  const update = useUpdateSdTicket(workspaceId, ticket.id)
  const [editing, setEditing] = useState(false)
  const [html, setHtml] = useState(ticket.description ?? '')

  if (editing) {
    return (
      <section aria-label='Descrição' className='px-4 pt-4 sm:px-6'>
        <SdRichTextEditor value={html} onChange={setHtml} minHeight={120} />
        <div className='mt-2 flex justify-end gap-1'>
          <Button variant='ghost' size='xs' onClick={() => setEditing(false)}>
            Cancelar
          </Button>
          <Button
            size='xs'
            disabled={update.isPending}
            data-shortcut-save
            onClick={() =>
              update.mutate(
                { description: html || null },
                {
                  onSuccess: () => setEditing(false),
                  onError: notify.error,
                },
              )
            }
          >
            Salvar
          </Button>
        </div>
      </section>
    )
  }
  return (
    <section
      aria-label='Descrição'
      className='group relative px-4 pt-4 sm:px-6'
    >
      {ticket.description ? (
        <SdRichTextView
          html={ticket.description}
          className='max-h-64 overflow-y-auto pr-8 text-sm'
        />
      ) : (
        <p className='text-muted-foreground text-sm'>Sem descrição.</p>
      )}
      <Button
        variant='ghost'
        size='icon-xs'
        aria-label='Editar descrição'
        className='absolute top-3 right-3 text-muted-foreground opacity-60 hover:opacity-100 focus-visible:opacity-100 sm:right-5'
        onClick={() => {
          setHtml(ticket.description ?? '')
          setEditing(true)
        }}
      >
        <SteelIcon icon={Edit02Icon} strokeWidth={2} />
      </Button>
    </section>
  )
}

/** "Atribuir": eu, outro agente ou ninguém — salva na hora. */
function AssignMenu({
  workspaceId,
  ticket,
  agents,
  me,
  open,
  onOpenChange,
}: {
  workspaceId: string
  ticket: SdTicketDTO
  agents: SdAgentDTO[]
  me: SdMeDTO
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const update = useUpdateSdTicket(workspaceId, ticket.id)
  const options = agents.filter((a) => a.isAgent)
  const assign = (assigneeId: string | null) =>
    update.mutate(
      { assigneeId },
      {
        onSuccess: () =>
          notify.success(
            assigneeId ? 'Responsável atualizado.' : 'Responsável removido.',
          ),
        onError: notify.error,
      },
    )
  const mine = ticket.assignee?.id === me.userId
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button
            variant='ghost'
            size='sm'
            disabled={update.isPending}
            aria-label={`Atribuir — responsável: ${ticket.assignee?.name ?? 'ninguém'}`}
            className='max-w-48'
          >
            <SteelIcon icon={UserIcon} strokeWidth={2} />
            <span className='truncate'>
              {ticket.assignee?.name ?? 'Atribuir'}
            </span>
            <SteelIcon
              icon={ArrowDown01Icon}
              strokeWidth={2}
              className='size-3.5 text-muted-foreground'
            />
          </Button>
        }
      />
      <DropdownMenuContent align='end' className='max-h-80 w-56'>
        {mine ? null : (
          <DropdownMenuItem onClick={() => assign(me.userId)}>
            <span className='flex-1'>Atribuir a mim</span>
            <ShortcutKbd id='sd.ticket.assign-me' />
          </DropdownMenuItem>
        )}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Agentes</DropdownMenuLabel>
          {options.map((agent) => (
            <DropdownMenuItem
              key={agent.id}
              disabled={agent.id === ticket.assignee?.id}
              onClick={() => assign(agent.id)}
            >
              <span className='truncate'>{agent.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        {ticket.assignee ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => assign(null)}>
              Remover responsável
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Header({
  workspaceId,
  slug,
  ticket,
  config,
  me,
  agents,
  isDesktop,
  onPhaseChange,
  onTab,
  onReply,
  onDetails,
}: {
  workspaceId: string
  slug: string
  ticket: SdTicketDTO
  config: SdConfigBootstrapDTO
  me: SdMeDTO
  agents: SdAgentDTO[]
  isDesktop: boolean
  onPhaseChange: (phaseId: string) => void
  onTab: (tab: string) => void
  onReply: () => void
  onDetails: () => void
}) {
  const router = useRouter()
  const now = useSdNow(30_000)
  const remove = useDeleteSdTicket(workspaceId)
  const setParent = useSetSdTicketParent(workspaceId, ticket.id)
  const [creatingChild, setCreatingChild] = useState(false)
  const [linkingParent, setLinkingParent] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [asking, setAsking] = useState(false)
  const [surveying, setSurveying] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const headerRef = useRef<HTMLElement | null>(null)
  const update = useUpdateSdTicket(workspaceId, ticket.id)
  const phases = sdTypePhases(config, ticket.type)

  // Header shortcuts: they reuse the visible controls, so the keyboard and
  // the mouse always do the same thing.
  const clickIn = (selector: string) => {
    const target = headerRef.current?.querySelector<HTMLElement>(selector)
    if (!target) return false
    target.click()
  }
  useShortcut('sd.ticket.assign', () => setAssignOpen(true))
  useShortcut('sd.ticket.assign-me', () => {
    if (ticket.assignee?.id === me.userId) {
      notify.success('O chamado já está com você.')
      return
    }
    update.mutate(
      { assigneeId: me.userId },
      {
        onSuccess: () => notify.success('Chamado atribuído a você.'),
        onError: notify.error,
      },
    )
  })
  useShortcut('sd.ticket.phase', () => clickIn('[aria-label="Mudar fase"]'))
  useShortcut('sd.ticket.follow', () =>
    clickIn('[data-shortcut-follow] button'),
  )
  useShortcut('sd.ticket.edit-title', () =>
    clickIn('button[title="Editar título"]'),
  )
  useShortcut('global.ask-ai', () => setAsking(true))
  const boardHref = `/${slug}/servicedesk/${SD_TYPE_ROUTE[ticket.type]}`
  const sla = sdPrimarySla(ticket.sla, now)
  const priorityColor = ticket.priority?.color ?? null

  function copyLink() {
    const url = `${window.location.origin}${sdTicketHref(slug, ticket)}`
    void navigator.clipboard
      ?.writeText(url)
      .then(() => notify.success('Link copiado.'))
      .catch(() => notify.error('Não foi possível copiar o link.'))
  }

  return (
    <header
      ref={headerRef}
      className='flex shrink-0 flex-col gap-2 border-b px-4 pt-3 pb-3 sm:px-6'
    >
      <div className='flex min-w-0 items-center gap-2 text-muted-foreground text-xs'>
        <Link
          href={boardHref}
          className='inline-flex shrink-0 items-center gap-1 hover:text-foreground'
        >
          <SteelIcon
            icon={ArrowLeft01Icon}
            strokeWidth={2}
            className='size-3.5'
          />
          {SD_TICKET_TYPE_PLURAL[ticket.type]}
        </Link>
        <span aria-hidden>/</span>
        <button
          type='button'
          onClick={copyLink}
          className='inline-flex shrink-0 items-center gap-1 font-mono text-foreground hover:underline'
          title='Copiar link'
        >
          {ticket.code}
          <SteelIcon icon={Copy01Icon} strokeWidth={2} className='size-3' />
        </button>
        <span className='hidden truncate sm:inline'>
          · {SD_TICKET_TYPE_LABEL[ticket.type]}
        </span>

        <div className='ml-auto flex shrink-0 items-center gap-0.5'>
          <span data-shortcut-follow className='contents'>
            <SdFollowButton
              workspaceId={workspaceId}
              ticketRef={ticket.id}
              compact
            />
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant='ghost'
                  size='icon-sm'
                  aria-label='Mais ações do chamado'
                >
                  <SteelIcon icon={MoreHorizontalIcon} strokeWidth={2} />
                </Button>
              }
            />
            <DropdownMenuContent align='end' className='w-52'>
              <DropdownMenuItem onClick={() => onTab('escalation')}>
                <SteelIcon icon={ArrowUpDoubleIcon} strokeWidth={2} />
                Escalonar
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setCreatingChild(true)}>
                <SteelIcon icon={HierarchyIcon} strokeWidth={2} />
                Adicionar item filho
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLinkingParent(true)}>
                <SteelIcon icon={Link01Icon} strokeWidth={2} />
                {ticket.parent ? 'Trocar item pai' : 'Vincular item pai'}
              </DropdownMenuItem>
              {ticket.parent ? (
                <DropdownMenuItem
                  onClick={() =>
                    setParent.mutate(null, {
                      onSuccess: () => notify.success('Item pai removido.'),
                      onError: notify.error,
                    })
                  }
                >
                  <SteelIcon icon={Unlink01Icon} strokeWidth={2} />
                  Remover item pai
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={copyLink}>
                <SteelIcon icon={Copy01Icon} strokeWidth={2} />
                <span className='flex-1'>Copiar link</span>
                <ShortcutKbd id='global.copy-link' />
              </DropdownMenuItem>
              <AskSteelAiMenuItem onSelect={() => setAsking(true)} />
              {ticket.contact?.email || ticket.requester?.email ? (
                <DropdownMenuItem onClick={() => setSurveying(true)}>
                  <SteelIcon icon={StarIcon} strokeWidth={2} />
                  Enviar pesquisa de satisfação
                </DropdownMenuItem>
              ) : null}
              {me.isAdmin ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant='destructive'
                    onClick={() => setDeleting(true)}
                  >
                    <SteelIcon icon={Delete02Icon} strokeWidth={2} />
                    Excluir chamado
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {surveying ? (
        <SendSurveyDialog
          workspaceId={workspaceId}
          open
          onOpenChange={setSurveying}
          recipient={{
            email: ticket.contact?.email ?? ticket.requester?.email,
            name: ticket.contact?.name ?? ticket.requester?.name,
          }}
        />
      ) : null}

      {asking ? (
        <AskSteelAiDialog
          open
          onOpenChange={setAsking}
          workspaceId={workspaceId}
          slug={slug}
          reference={{ kind: 'ticket', code: ticket.code, label: ticket.title }}
        />
      ) : null}

      <EditableTitle
        key={ticket.title}
        workspaceId={workspaceId}
        ticket={ticket}
      />

      <div className='flex flex-wrap items-center gap-x-4 gap-y-2'>
        <dl className='flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground text-xs'>
          {ticket.priority ? (
            <div className='flex items-center gap-1.5'>
              <dt className='sr-only'>Prioridade</dt>
              <span
                aria-hidden
                className='size-1.5 shrink-0 rounded-full bg-muted-foreground'
                style={
                  priorityColor ? { backgroundColor: priorityColor } : undefined
                }
              />
              <dd className='text-foreground' title='Prioridade'>
                {ticket.priority.name}
              </dd>
            </div>
          ) : null}
          <div className='flex items-center'>
            <dt className='sr-only'>SLA</dt>
            <dd>
              <SdSlaIndicator
                live={sla.live}
                label={
                  sla.kind === 'firstResponse' ? '1ª resposta' : 'Resolução'
                }
              />
            </dd>
          </div>
          {ticket.escalationLevel > 0 ? (
            <div>
              <dt className='sr-only'>Escalonamento</dt>
              <dd>Escalonado N{ticket.escalationLevel}</dd>
            </div>
          ) : null}
          {ticket.parent ? (
            <div>
              <dt className='sr-only'>Item pai</dt>
              <dd>
                <Link
                  href={`/${slug}/servicedesk/tickets/${ticket.parent.number}`}
                  className='hover:text-foreground hover:underline'
                >
                  Filho de {ticket.parent.code}
                </Link>
              </dd>
            </div>
          ) : null}
          {ticket.risk ? (
            <div>
              <dt className='sr-only'>Risco preditivo</dt>
              <dd>
                <SdRiskBadge risk={ticket.risk} />
              </dd>
            </div>
          ) : null}
        </dl>

        <div className='flex flex-wrap items-center gap-1 sm:ml-auto'>
          <div className='flex items-center gap-1.5'>
            <SdOptionSelect
              aria-label='Mudar fase'
              allowClear={false}
              value={ticket.phaseId}
              onChange={(phaseId) => phaseId && onPhaseChange(phaseId)}
              className='h-8 w-auto min-w-24 max-w-44 border-transparent bg-transparent shadow-none hover:bg-muted dark:bg-transparent'
              options={phases.map((p) => ({
                value: p.id,
                label: p.name,
                color: p.color ?? SD_PHASE_CATEGORY_COLOR[p.category],
                hint: `${p.completionPercent}%`,
              }))}
            />
            <span className='shrink-0 text-muted-foreground text-xs tabular-nums'>
              {ticket.completionPercent}%
            </span>
          </div>
          <AssignMenu
            workspaceId={workspaceId}
            ticket={ticket}
            agents={agents}
            me={me}
            open={assignOpen}
            onOpenChange={setAssignOpen}
          />
          <div className='flex items-center gap-1'>
            {isDesktop ? null : (
              <Button variant='outline' size='sm' onClick={onDetails}>
                <SteelIcon icon={SidebarRightIcon} strokeWidth={2} />
                Detalhes
              </Button>
            )}
            <Button size='sm' onClick={onReply}>
              Responder
              <ShortcutKbd
                id='sd.ticket.reply'
                className='hidden sm:inline-flex [&_kbd]:bg-primary-foreground/20 [&_kbd]:text-primary-foreground'
              />
            </Button>
          </div>
        </div>
      </div>

      <SdCreateTicketSheet
        workspaceId={workspaceId}
        slug={slug}
        open={creatingChild}
        onOpenChange={setCreatingChild}
        defaultType={ticket.type}
        preset={{
          type: ticket.type,
          parent: { id: ticket.id, label: `${ticket.code} · ${ticket.title}` },
        }}
        onCreated={() => onTab('children')}
      />

      <Dialog open={linkingParent} onOpenChange={setLinkingParent}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>Vincular item pai</DialogTitle>
            <DialogDescription>
              {ticket.code} passa a ser item filho do chamado escolhido.
            </DialogDescription>
          </DialogHeader>
          <SdTicketPicker
            workspaceId={workspaceId}
            value={null}
            excludeIds={[ticket.id]}
            onChange={(option) =>
              option &&
              setParent.mutate(option.id, {
                onSuccess: () => {
                  notify.success('Item pai definido.')
                  setLinkingParent(false)
                },
                onError: notify.error,
              })
            }
          />
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {ticket.code}?</AlertDialogTitle>
            <AlertDialogDescription>
              O chamado sai dos quadros e relatórios. A rastreabilidade é
              preservada para auditoria.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button
              variant='destructive'
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(ticket.id, {
                  onSuccess: () => {
                    notify.success(`${ticket.code} excluído.`)
                    router.push(boardHref)
                  },
                  onError: notify.error,
                })
              }
            >
              Excluir
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  )
}

/**
 * Tela do chamado (agente), minimalista: cabeçalho compacto (código,
 * título editável, prioridade e SLA em texto discreto, ações principais
 * Responder / Atribuir / Fase e o resto no menu "Mais"), a conversa como
 * protagonista e os detalhes numa coluna lateral recolhível — abaixo de
 * `lg` eles abrem num Sheet ("Detalhes"). Aba ativa lembrada em `?tab=`;
 * atualiza em tempo real a cada evento deste chamado.
 */
export function SdTicketScreen({
  workspaceId,
  slug,
  ticketRef,
}: {
  workspaceId: string
  slug: string
  ticketRef: string
}) {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const isDesktop = useSdIsDesktop()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [detailsHidden, setDetailsHidden] = useState(false)
  const ticket = useSdTicket(workspaceId, ticketRef)
  const config = useSdConfig(workspaceId)
  const me = useSdMe(workspaceId)
  const agents = useSdAgents(workspaceId, { includeRequesters: true })
  const kbLinks = useSdTicketKbLinks(workspaceId, ticket.data?.id ?? '')
  useSdTicketRealtime(workspaceId)

  const mover = useSdPhaseMover({
    workspaceId,
    slug,
    config: config.data,
    agents: agents.data ?? [],
  })
  const tab = sdResolveTab(params.get('tab'), 'agent', ticket.data?.type)

  function setTab(next: string) {
    const search = new URLSearchParams(params.toString())
    search.set('tab', next)
    router.replace(`${pathname}?${search.toString()}`, { scroll: false })
  }

  function reply(visibility?: 'PUBLIC' | 'INTERNAL') {
    if (tab !== 'history') setTab('history')
    // A aba pode estar montando: tenta de novo no próximo quadro.
    const focus = (tries: number) => {
      const input = document.getElementById(SD_COMPOSER_INPUT_ID)
      if (input) {
        if (visibility) {
          document
            .querySelector<HTMLElement>(`[data-sd-visibility="${visibility}"]`)
            ?.click()
        }
        input.scrollIntoView?.({ block: 'center' })
        input.focus()
      } else if (tries > 0) {
        requestAnimationFrame(() => focus(tries - 1))
      }
    }
    focus(20)
  }

  // Ticket shortcuts (registry `sd.ticket.*`).
  const loaded = Boolean(ticket.data && config.data && me.data)
  const shortcutOptions = { enabled: loaded }
  useShortcut('sd.ticket.reply', () => reply('PUBLIC'), shortcutOptions)
  useShortcut('sd.ticket.note', () => reply('INTERNAL'), shortcutOptions)
  useShortcut(
    'sd.ticket.edit-description',
    () => {
      const edit = document.querySelector<HTMLElement>(
        '[aria-label="Editar descrição"]',
      )
      if (!edit) return false
      edit.click()
    },
    shortcutOptions,
  )
  useShortcut(
    'sd.ticket.tab',
    (_event, keys) => {
      if (!ticket.data) return false
      const tabs = sdTicketTabsFor('agent', ticket.data.type)
      const target = tabs[Number(keys) - 1]
      if (!target) return false
      setTab(target.id)
    },
    shortcutOptions,
  )
  useShortcut(
    'sd.ticket.toggle-details',
    () => {
      if (isDesktop) setDetailsHidden((hidden) => !hidden)
      else setDetailsOpen((open) => !open)
    },
    shortcutOptions,
  )
  const walk = (delta: 1 | -1) => {
    if (!ticket.data) return false
    const next = sdNeighbourTicket(
      sdReadTicketNav(),
      sdTicketHref(slug, ticket.data),
      delta,
    )
    if (!next) return false
    router.push(next)
  }
  useShortcut('sd.ticket.next', () => walk(1), shortcutOptions)
  useShortcut('sd.ticket.prev', () => walk(-1), shortcutOptions)
  useShortcut(
    'sd.ticket.back',
    () => {
      if (!ticket.data) return false
      router.push(
        sdReadTicketNav()?.from ??
          `/${slug}/servicedesk/${SD_TYPE_ROUTE[ticket.data.type]}`,
      )
    },
    shortcutOptions,
  )

  // `?reply=1` (e.g. "Responder" in the inbox): once the ticket is on
  // screen, focus the history composer and drop the flag from the URL.
  const replyRequested = params.get('reply') === '1'
  const ready = Boolean(ticket.data && config.data && me.data)
  const replyHandled = useRef(false)
  useEffect(() => {
    if (!replyRequested || !ready || replyHandled.current) return
    replyHandled.current = true
    const search = new URLSearchParams(window.location.search)
    search.delete('reply')
    search.set('tab', 'history')
    router.replace(`${pathname}?${search.toString()}`, { scroll: false })
    const focus = (tries: number) => {
      const input = document.getElementById(SD_COMPOSER_INPUT_ID)
      if (input) {
        input.scrollIntoView?.({ block: 'center' })
        input.focus()
      } else if (tries > 0) {
        requestAnimationFrame(() => focus(tries - 1))
      }
    }
    focus(30)
  }, [replyRequested, ready, router, pathname])

  if (ticket.isLoading || config.isLoading || me.isLoading) {
    return (
      <div className='flex flex-col gap-3 p-4 sm:px-6'>
        <Skeleton className='h-4 w-40' />
        <Skeleton className='h-7 w-2/3' />
        <Skeleton className='h-4 w-1/2' />
        <Skeleton className='h-64 w-full' />
      </div>
    )
  }

  if (ticket.error || !ticket.data || !config.data || !me.data) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3 p-8 text-center'>
        <SteelIcon
          icon={Alert02Icon}
          strokeWidth={1.8}
          className='size-6 text-muted-foreground'
        />
        <p className='font-medium text-sm'>Chamado não encontrado</p>
        <p className='max-w-sm text-muted-foreground text-xs'>
          {ticket.error?.message ??
            'Ele pode ter sido excluído ou você não tem acesso.'}
        </p>
        <Link
          href={`/${slug}/servicedesk/tickets`}
          className='text-primary text-sm hover:underline'
        >
          Voltar aos chamados
        </Link>
      </div>
    )
  }

  const data = ticket.data
  const sidebar = (
    <SdTicketSidebar
      workspaceId={workspaceId}
      ticket={data}
      config={config.data}
      agents={agents.data ?? []}
      onPhaseChange={(phaseId) => mover.move(data, phaseId)}
      onTab={(next) => {
        setDetailsOpen(false)
        setTab(next)
      }}
    />
  )
  return (
    <div className='flex h-full min-h-0 flex-col'>
      <Header
        workspaceId={workspaceId}
        slug={slug}
        ticket={data}
        config={config.data}
        me={me.data}
        agents={agents.data ?? []}
        isDesktop={isDesktop}
        onPhaseChange={(phaseId) => mover.move(data, phaseId)}
        onTab={setTab}
        onReply={() => reply()}
        onDetails={() => setDetailsOpen(true)}
      />
      <div
        className={cn(
          'grid min-h-0 flex-1 grid-cols-1',
          !detailsHidden &&
            'lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]',
        )}
      >
        <main className='flex min-h-0 flex-col overflow-y-auto'>
          <Description
            key={data.description ?? ''}
            workspaceId={workspaceId}
            ticket={data}
          />
          <SdTicketTabs
            active={tab}
            onChange={setTab}
            counts={{
              children: data.childrenCount,
              escalation: data.escalationLevel,
              knowledge: kbLinks.data?.length,
            }}
            props={{
              workspaceId,
              slug,
              ticket: data,
              me: me.data,
              mode: 'agent',
            }}
          />
        </main>
        {isDesktop && !detailsHidden ? (
          <aside
            aria-label='Detalhes do chamado'
            className='min-h-0 overflow-y-auto border-l'
          >
            {sidebar}
          </aside>
        ) : null}
      </div>
      {isDesktop ? null : (
        <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
          <SheetContent
            side='right'
            className={cn('w-full gap-0 p-0 sm:max-w-md')}
          >
            <SheetHeader className='border-b'>
              <SheetTitle>Detalhes</SheetTitle>
              <SheetDescription>
                {data.code} · {data.title}
              </SheetDescription>
            </SheetHeader>
            <div className='min-h-0 flex-1 overflow-y-auto'>{sidebar}</div>
          </SheetContent>
        </Sheet>
      )}
      {mover.dialog}
    </div>
  )
}
