'use client'

import {
  Agreement01Icon,
  Copy01Icon,
  Delete02Icon,
  PlusSignIcon,
  RefreshIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useEffect, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  useDealRoom,
  useDealRoomMessages,
  usePostDealRoomMessage,
  useUpsertDealRoom,
} from '@/src/hooks/use-crm-deals'
import type { CrmDealRoomDTO } from '@/types/crm-deals'
import { formatDealDateTime } from './deals-tone'

const OWNER_LABEL = { SELLER: 'Vendedor', CUSTOMER: 'Cliente' } as const

interface MaterialDraft {
  id?: string
  title: string
  url: string
}

interface ActionDraft {
  id?: string
  title: string
  owner: 'SELLER' | 'CUSTOMER'
  done: boolean
}

function toDrafts(room: CrmDealRoomDTO) {
  return {
    welcomeMessage: room.welcomeMessage ?? '',
    materials: room.materials.map(
      (m): MaterialDraft => ({ id: m.id, title: m.title, url: m.url }),
    ),
    actions: room.actions.map(
      (a): ActionDraft => ({
        id: a.id,
        title: a.title,
        owner: a.owner,
        done: a.done,
      }),
    ),
  }
}

function RoomChat({
  workspaceId,
  opportunityId,
}: {
  workspaceId: string
  opportunityId: string
}) {
  const messages = useDealRoomMessages(workspaceId, opportunityId, true)
  const post = usePostDealRoomMessage(workspaceId, opportunityId)
  const [text, setText] = useState('')

  async function send() {
    if (!text.trim()) return
    try {
      await post.mutateAsync(text.trim())
      setText('')
    } catch (error) {
      notify.error(error)
    }
  }

  return (
    <div className='flex flex-col gap-2'>
      <h4 className='font-medium text-muted-foreground text-xs uppercase tracking-wide'>
        Conversa com o cliente
      </h4>
      <ul className='flex max-h-64 flex-col gap-1.5 overflow-auto'>
        {(messages.data ?? []).length === 0 ? (
          <li className='py-2 text-center text-muted-foreground text-sm'>
            Nenhuma mensagem ainda.
          </li>
        ) : (
          (messages.data ?? []).map((message) => (
            <li
              key={message.id}
              className={
                message.authorKind === 'SELLER'
                  ? 'ml-6 rounded-md bg-primary/10 px-3 py-1.5 text-sm'
                  : 'mr-6 rounded-md bg-muted px-3 py-1.5 text-sm'
              }
            >
              <span className='font-medium'>{message.authorName}</span>
              <span className='ml-2 text-muted-foreground text-xs'>
                {formatDealDateTime(message.createdAt)}
              </span>
              <p className='whitespace-pre-wrap'>{message.body}</p>
            </li>
          ))
        )}
      </ul>
      <div className='flex gap-2'>
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send()
          }}
          placeholder='Escreva para o cliente'
          maxLength={2000}
        />
        <Button
          type='button'
          size='sm'
          disabled={post.isPending || !text.trim()}
          onClick={send}
        >
          Enviar
        </Button>
      </div>
    </div>
  )
}

/**
 * Sala de negociação da oportunidade: o vendedor liga o link público, escolhe
 * a proposta, junta materiais e monta o plano de ação com o cliente, vê quem
 * abriu o quê e responde a conversa.
 */
export function DealRoomPanel({
  workspaceId,
  opportunityId,
  canEdit,
}: {
  workspaceId: string
  opportunityId: string
  canEdit: boolean
}) {
  const roomQuery = useDealRoom(workspaceId, opportunityId)
  const upsert = useUpsertDealRoom(workspaceId, opportunityId)
  const room = roomQuery.data ?? null

  const [welcome, setWelcome] = useState('')
  const [materials, setMaterials] = useState<MaterialDraft[]>([])
  const [actions, setActions] = useState<ActionDraft[]>([])
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!room || dirty) return
    const drafts = toDrafts(room)
    setWelcome(drafts.welcomeMessage)
    setMaterials(drafts.materials)
    setActions(drafts.actions)
  }, [room, dirty])

  async function save(input: Parameters<typeof upsert.mutateAsync>[0], ok: string) {
    try {
      await upsert.mutateAsync(input)
      setDirty(false)
      notify.success(ok)
    } catch (error) {
      notify.error(error)
    }
  }

  if (roomQuery.isLoading) return <Skeleton className='h-20 w-full' />

  const header = (
    <div className='flex items-center gap-2'>
      <SteelIcon icon={Agreement01Icon} strokeWidth={2} className='size-4' />
      <h3 className='font-semibold text-sm'>Sala de negociação</h3>
    </div>
  )

  if (!room) {
    return (
      <div className='flex flex-col gap-2 rounded-lg border p-3'>
        {header}
        <p className='text-muted-foreground text-sm'>
          Uma página só deste negócio, com a proposta, materiais, plano de ação
          em conjunto e conversa com o cliente. Você vê quem abriu o quê.
        </p>
        {canEdit ? (
          <Button
            type='button'
            size='sm'
            className='self-start'
            disabled={upsert.isPending}
            onClick={() => save({ enabled: true }, 'Sala criada')}
          >
            Criar a sala
          </Button>
        ) : null}
      </div>
    )
  }

  const link =
    typeof window === 'undefined'
      ? room.publicPath
      : `${window.location.origin}${room.publicPath}`

  function payload() {
    return {
      welcomeMessage: welcome.trim() || null,
      materials: materials
        .filter((m) => m.title.trim() && m.url.trim())
        .map((m) => ({ id: m.id, title: m.title.trim(), url: m.url.trim() })),
      actions: actions
        .filter((a) => a.title.trim())
        .map((a) => ({
          id: a.id,
          title: a.title.trim(),
          owner: a.owner,
          done: a.done,
        })),
    }
  }

  return (
    <div className='flex flex-col gap-4 rounded-lg border p-3'>
      <div className='flex flex-wrap items-center gap-2'>
        {header}
        <div className='ml-auto flex items-center gap-2'>
          <Switch
            id='deal-room-enabled'
            checked={room.enabled}
            disabled={!canEdit || upsert.isPending}
            onCheckedChange={(checked) =>
              save(
                { enabled: checked === true },
                checked === true ? 'Link ligado' : 'Link desligado',
              )
            }
          />
          <Label htmlFor='deal-room-enabled'>
            {room.enabled ? 'Link ligado' : 'Link desligado'}
          </Label>
        </div>
      </div>

      <div className='flex flex-wrap items-center gap-2'>
        <Input readOnly value={link} className='min-w-0 flex-1 text-xs' />
        <Button
          type='button'
          size='sm'
          variant='outline'
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link)
              notify.success('Link copiado')
            } catch {
              notify.error('Não foi possível copiar o link')
            }
          }}
        >
          <SteelIcon icon={Copy01Icon} strokeWidth={2} />
          Copiar
        </Button>
        {canEdit ? (
          <Button
            type='button'
            size='sm'
            variant='ghost'
            disabled={upsert.isPending}
            onClick={() => save({ rotateToken: true }, 'Link trocado')}
          >
            <SteelIcon icon={RefreshIcon} strokeWidth={2} />
            Trocar link
          </Button>
        ) : null}
      </div>

      <div className='flex flex-col gap-1.5'>
        <Label htmlFor='deal-room-welcome'>Mensagem de boas-vindas</Label>
        <Textarea
          id='deal-room-welcome'
          rows={2}
          value={welcome}
          disabled={!canEdit}
          maxLength={2000}
          onChange={(e) => {
            setWelcome(e.target.value)
            setDirty(true)
          }}
        />
      </div>

      <div className='flex flex-col gap-2'>
        <h4 className='font-medium text-muted-foreground text-xs uppercase tracking-wide'>
          Materiais (links)
        </h4>
        {materials.map((material, index) => (
          <div key={material.id ?? `new-${index}`} className='flex gap-2'>
            <Input
              value={material.title}
              placeholder='Título'
              disabled={!canEdit}
              onChange={(e) => {
                setMaterials((list) =>
                  list.map((m, i) =>
                    i === index ? { ...m, title: e.target.value } : m,
                  ),
                )
                setDirty(true)
              }}
            />
            <Input
              value={material.url}
              placeholder='https://…'
              disabled={!canEdit}
              onChange={(e) => {
                setMaterials((list) =>
                  list.map((m, i) =>
                    i === index ? { ...m, url: e.target.value } : m,
                  ),
                )
                setDirty(true)
              }}
            />
            {canEdit ? (
              <Button
                type='button'
                size='icon-sm'
                variant='ghost'
                aria-label='Remover material'
                onClick={() => {
                  setMaterials((list) => list.filter((_, i) => i !== index))
                  setDirty(true)
                }}
              >
                <SteelIcon icon={Delete02Icon} strokeWidth={2} />
              </Button>
            ) : null}
          </div>
        ))}
        {canEdit ? (
          <Button
            type='button'
            size='sm'
            variant='outline'
            className='self-start'
            onClick={() => {
              setMaterials((list) => [...list, { title: '', url: '' }])
              setDirty(true)
            }}
          >
            <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
            Adicionar material
          </Button>
        ) : null}
      </div>

      <div className='flex flex-col gap-2'>
        <h4 className='font-medium text-muted-foreground text-xs uppercase tracking-wide'>
          Plano de ação em conjunto
        </h4>
        {actions.map((action, index) => (
          <div key={action.id ?? `new-${index}`} className='flex items-center gap-2'>
            <Checkbox
              checked={action.done}
              disabled={!canEdit}
              aria-label='Concluída'
              onCheckedChange={(checked) => {
                setActions((list) =>
                  list.map((a, i) =>
                    i === index ? { ...a, done: checked === true } : a,
                  ),
                )
                setDirty(true)
              }}
            />
            <Input
              value={action.title}
              placeholder='O que precisa acontecer'
              disabled={!canEdit}
              onChange={(e) => {
                setActions((list) =>
                  list.map((a, i) =>
                    i === index ? { ...a, title: e.target.value } : a,
                  ),
                )
                setDirty(true)
              }}
            />
            <Select
              value={action.owner}
              disabled={!canEdit}
              onValueChange={(value) => {
                setActions((list) =>
                  list.map((a, i) =>
                    i === index
                      ? { ...a, owner: (value as 'SELLER' | 'CUSTOMER') ?? a.owner }
                      : a,
                  ),
                )
                setDirty(true)
              }}
            >
              <SelectTrigger size='sm' className='w-28'>
                <SelectValue>{OWNER_LABEL[action.owner]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='SELLER'>Vendedor</SelectItem>
                <SelectItem value='CUSTOMER'>Cliente</SelectItem>
              </SelectContent>
            </Select>
            {canEdit ? (
              <Button
                type='button'
                size='icon-sm'
                variant='ghost'
                aria-label='Remover ação'
                onClick={() => {
                  setActions((list) => list.filter((_, i) => i !== index))
                  setDirty(true)
                }}
              >
                <SteelIcon icon={Delete02Icon} strokeWidth={2} />
              </Button>
            ) : null}
          </div>
        ))}
        {canEdit ? (
          <Button
            type='button'
            size='sm'
            variant='outline'
            className='self-start'
            onClick={() => {
              setActions((list) => [
                ...list,
                { title: '', owner: 'CUSTOMER', done: false },
              ])
              setDirty(true)
            }}
          >
            <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
            Adicionar ação
          </Button>
        ) : null}
      </div>

      {canEdit ? (
        <Button
          type='button'
          size='sm'
          className='self-end'
          disabled={!dirty || upsert.isPending}
          onClick={() => save(payload(), 'Sala salva')}
        >
          {upsert.isPending ? 'Salvando…' : 'Salvar a sala'}
        </Button>
      ) : null}

      <div className='flex flex-col gap-2'>
        <h4 className='font-medium text-muted-foreground text-xs uppercase tracking-wide'>
          Quem abriu o quê
        </h4>
        {room.events.length === 0 ? (
          <p className='text-muted-foreground text-sm'>
            Ninguém abriu a sala ainda.
          </p>
        ) : (
          <ul className='flex max-h-48 flex-col gap-1 overflow-auto text-sm'>
            {room.events.map((event) => (
              <li key={event.id} className='flex flex-wrap gap-x-2'>
                <span className='font-medium'>
                  {event.visitorName ?? 'Visitante'}
                </span>
                <span>
                  {event.label}
                  {event.targetLabel ? `: ${event.targetLabel}` : ''}
                </span>
                <span className='ml-auto text-muted-foreground text-xs'>
                  {formatDealDateTime(event.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <RoomChat workspaceId={workspaceId} opportunityId={opportunityId} />
    </div>
  )
}
