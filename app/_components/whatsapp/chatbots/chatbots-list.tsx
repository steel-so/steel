'use client'

import {
  Delete02Icon,
  Edit02Icon,
  PauseIcon,
  PlayIcon,
  PlusSignIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { useIsPrivileged } from '@/app/_components/workspace/workspace-permissions'
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
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  useCreateWhatsAppChatbot,
  useDeleteWhatsAppChatbot,
  useSetWhatsAppChatbotStatus,
  useWhatsAppChatbots,
} from '@/src/hooks/use-whatsapp-chatbots'
import { TRIGGER_LABEL } from '@/src/lib/whatsapp/chatbot/editor-model'
import type { WhatsAppChatbotListItemDTO } from '@/types/whatsapp-chatbot'
import {
  ChatbotSettingsFields,
  type ChatbotSettingsValue,
} from './chatbot-settings-fields'
import { ChatbotStatusBadge } from './chatbot-ui'

type Template = 'blank' | 'menu' | 'lead-capture'

const TEMPLATES: Array<{ value: Template; label: string; hint: string }> = [
  { value: 'blank', label: 'Em branco', hint: 'Boas-vindas e atendente' },
  {
    value: 'menu',
    label: 'Menu de atendimento',
    hint: 'Comercial, suporte e IA',
  },
  {
    value: 'lead-capture',
    label: 'Captação de contato',
    hint: 'Pergunta nome e e-mail',
  },
]

const DEFAULT_SETTINGS: ChatbotSettingsValue = {
  triggerKind: 'NEW_CONVERSATION',
  keywords: [],
  connectionId: '',
  sessionTtlMinutes: 720,
}

function CreateChatbotDialog({
  workspaceId,
  open,
  onOpenChange,
  onCreated,
}: {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (id: string) => void
}) {
  const create = useCreateWhatsAppChatbot(workspaceId)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [template, setTemplate] = useState<Template>('menu')
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [error, setError] = useState<string | null>(null)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) {
      setError('Dê um nome ao chatbot')
      return
    }
    if (settings.triggerKind === 'KEYWORD' && settings.keywords.length === 0) {
      setError('Informe ao menos uma palavra-chave')
      return
    }
    setError(null)
    create.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        template,
        triggerKind: settings.triggerKind,
        keywords: settings.keywords,
        connectionId: settings.connectionId || null,
        sessionTtlMinutes: settings.sessionTtlMinutes,
      },
      {
        onSuccess: (bot) => {
          notify.success('Chatbot criado')
          setName('')
          setDescription('')
          setSettings(DEFAULT_SETTINGS)
          onOpenChange(false)
          onCreated(bot.id)
        },
        onError: (e) => notify.error(e.message),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-lg'>
        <form onSubmit={submit} className='space-y-4'>
          <DialogHeader>
            <DialogTitle>Novo chatbot</DialogTitle>
            <DialogDescription>
              Monte o fluxo no editor visual. Ele só atende depois de publicado.
            </DialogDescription>
          </DialogHeader>

          <div className='space-y-1.5'>
            <Label htmlFor='chatbot-name'>Nome</Label>
            <Input
              id='chatbot-name'
              value={name}
              maxLength={80}
              placeholder='Ex.: Atendimento inicial'
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='chatbot-description'>Descrição (opcional)</Label>
            <Textarea
              id='chatbot-description'
              value={description}
              maxLength={300}
              rows={2}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className='space-y-1.5'>
            <Label>Começar de um modelo</Label>
            <Select
              value={template}
              onValueChange={(next) => next && setTemplate(next as Template)}
            >
              <SelectTrigger className='w-full' aria-label='Modelo'>
                <SelectValue>
                  {TEMPLATES.find((item) => item.value === template)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {TEMPLATES.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label} — {item.hint}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <ChatbotSettingsFields
            workspaceId={workspaceId}
            value={settings}
            onChange={setSettings}
          />

          {error ? (
            <p role='alert' className='text-destructive text-sm'>
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type='submit' disabled={create.isPending}>
              Criar chatbot
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className='min-w-0'>
      <p className='font-semibold text-base tabular-nums'>{value}</p>
      <p className='truncate text-muted-foreground text-xs'>{label}</p>
    </div>
  )
}

function ChatbotCard({
  bot,
  slug,
  canManage,
  onToggle,
  onDelete,
  busy,
}: {
  bot: WhatsAppChatbotListItemDTO
  slug: string
  canManage: boolean
  onToggle: (bot: WhatsAppChatbotListItemDTO) => void
  onDelete: (bot: WhatsAppChatbotListItemDTO) => void
  busy: boolean
}) {
  const running = bot.status === 'ACTIVE'
  const canToggle = canManage && (running || bot.publishedVersion > 0)
  return (
    <li className='flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4'>
      <div className='flex items-start justify-between gap-2'>
        <div className='min-w-0'>
          <Link
            href={`/${slug}/zap/chatbots/${bot.id}`}
            className='block truncate font-medium hover:underline'
          >
            {bot.name}
          </Link>
          <p className='truncate text-muted-foreground text-xs'>
            {TRIGGER_LABEL[bot.triggerKind]} · {bot.nodeCount} blocos
          </p>
        </div>
        <ChatbotStatusBadge status={bot.status} />
      </div>

      {bot.description ? (
        <p className='line-clamp-2 text-muted-foreground text-sm'>
          {bot.description}
        </p>
      ) : null}

      {bot.hasUnpublishedChanges ? (
        <p className='text-muted-foreground text-xs'>
          Alterações não publicadas
        </p>
      ) : null}

      <div className='grid grid-cols-4 gap-2'>
        <Stat label='Conversas' value={bot.stats.sessions} />
        <Stat label='Concluídas' value={bot.stats.completed} />
        <Stat label='p/ atendente' value={bot.stats.handedOffHuman} />
        <Stat label='p/ IA' value={bot.stats.handedOffAi} />
      </div>

      <div className='mt-auto flex flex-wrap gap-2'>
        <Button
          variant='outline'
          size='sm'
          nativeButton={false}
          render={<Link href={`/${slug}/zap/chatbots/${bot.id}`} />}
        >
          <SteelIcon icon={Edit02Icon} strokeWidth={2} />
          {canManage ? 'Editar' : 'Ver fluxo'}
        </Button>
        {canToggle ? (
          <Button
            variant='outline'
            size='sm'
            disabled={busy}
            onClick={() => onToggle(bot)}
          >
            <SteelIcon icon={running ? PauseIcon : PlayIcon} strokeWidth={2} />
            {running ? 'Pausar' : 'Ativar'}
          </Button>
        ) : null}
        {canManage ? (
          <Button
            variant='ghost'
            size='sm'
            aria-label={`Excluir ${bot.name}`}
            onClick={() => onDelete(bot)}
          >
            <SteelIcon icon={Delete02Icon} strokeWidth={2} />
          </Button>
        ) : null}
      </div>
    </li>
  )
}

export function ChatbotsList({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const router = useRouter()
  const canManage = useIsPrivileged()
  const bots = useWhatsAppChatbots(workspaceId)
  const setStatus = useSetWhatsAppChatbotStatus(workspaceId)
  const remove = useDeleteWhatsAppChatbot(workspaceId)
  const [creating, setCreating] = useState(false)
  const [toDelete, setToDelete] = useState<WhatsAppChatbotListItemDTO | null>(
    null,
  )

  const toggle = (bot: WhatsAppChatbotListItemDTO) => {
    const next = bot.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'
    setStatus.mutate(
      { id: bot.id, status: next },
      {
        onSuccess: () =>
          notify.success(
            next === 'ACTIVE' ? 'Chatbot ativado' : 'Chatbot pausado',
          ),
        onError: (e) => notify.error(e.message),
      },
    )
  }

  const confirmDelete = () => {
    if (!toDelete) return
    remove.mutate(toDelete.id, {
      onSuccess: () => {
        notify.success('Chatbot excluído')
        setToDelete(null)
      },
      onError: (e) => notify.error(e.message),
    })
  }

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0'>
          <h1 className='font-semibold text-xl'>Chatbots</h1>
          <p className='text-muted-foreground text-sm'>
            Fluxos sem código que atendem o contato antes de um atendente ou da
            IA. Os números abaixo são dos últimos 30 dias.
          </p>
        </div>
        {canManage ? (
          <Button onClick={() => setCreating(true)}>
            <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
            Novo chatbot
          </Button>
        ) : null}
      </div>

      {bots.isLoading ? (
        <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
          <Skeleton className='h-44 rounded-xl' />
          <Skeleton className='h-44 rounded-xl' />
        </div>
      ) : bots.isError ? (
        <p role='alert' className='text-destructive text-sm'>
          Não foi possível carregar os chatbots.
        </p>
      ) : (bots.data ?? []).length === 0 ? (
        <div className='rounded-xl border border-dashed p-8 text-center text-muted-foreground text-sm'>
          Nenhum chatbot criado ainda.
          {canManage ? ' Comece por um modelo pronto.' : ''}
        </div>
      ) : (
        <ul className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
          {(bots.data ?? []).map((bot) => (
            <ChatbotCard
              key={bot.id}
              bot={bot}
              slug={slug}
              canManage={canManage}
              busy={setStatus.isPending}
              onToggle={toggle}
              onDelete={setToDelete}
            />
          ))}
        </ul>
      )}

      <CreateChatbotDialog
        workspaceId={workspaceId}
        open={creating}
        onOpenChange={setCreating}
        onCreated={(id) => router.push(`/${slug}/zap/chatbots/${id}`)}
      />

      <AlertDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir chatbot?</AlertDialogTitle>
            <AlertDialogDescription>
              “{toDelete?.name}” e o histórico das conversas que ele atendeu
              serão removidos. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
