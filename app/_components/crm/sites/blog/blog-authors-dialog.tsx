'use client'

import {
  Add01Icon,
  Delete02Icon,
  PencilEdit02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { apiFetch } from '@/src/hooks/_fetch'
import {
  type SiteBlogApi,
  siteBlogKeys,
  useSiteAuthors,
} from '@/src/hooks/use-site-blog'
import {
  AUTHOR_NETWORKS,
  type SiteAuthorLinkDTO,
} from '@/src/schemas/site-blog.schema'
import type { WorkspaceMemberDTO } from '@/types/membership'
import type { SiteAuthorDTO } from '@/types/site-blog'
import { MediaPickButton } from '../media-pick-button'

/**
 * Author profiles of the blog: a public name, photo, bio and social links,
 * usually tied to a workspace member (guest authors have none). Shown in
 * posts and on `/blog/autor/<slug>`.
 */

const NO_MEMBER = '__none'

const NETWORK_LABELS: Record<(typeof AUTHOR_NETWORKS)[number], string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  x: 'X (Twitter)',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  github: 'GitHub',
  pinterest: 'Pinterest',
  threads: 'Threads',
  site: 'Site pessoal',
}

interface AuthorForm {
  userId: string | null
  name: string
  bio: string
  avatarUrl: string | null
  links: SiteAuthorLinkDTO[]
}

function formOf(author?: SiteAuthorDTO): AuthorForm {
  return {
    userId: author?.userId ?? null,
    name: author?.name ?? '',
    bio: author?.bio ?? '',
    avatarUrl: author?.avatarUrl ?? null,
    links: author?.links ?? [],
  }
}

function AuthorEditor({
  workspaceId,
  author,
  onSave,
  onCancel,
}: {
  workspaceId: string
  author?: SiteAuthorDTO
  onSave: (form: AuthorForm) => Promise<void>
  onCancel: () => void
}) {
  const id = useId()
  const [form, setForm] = useState(() => formOf(author))
  const [busy, setBusy] = useState(false)
  const members = useQuery({
    queryKey: ['site-blog-members', workspaceId],
    queryFn: () =>
      apiFetch<WorkspaceMemberDTO[]>(
        `/api/workspaces/${workspaceId}/members`,
        undefined,
        'Erro ao carregar os membros',
      ),
    staleTime: 5 * 60_000,
  })

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!form.name.trim()) return
    setBusy(true)
    try {
      await onSave({
        ...form,
        links: form.links.filter((link) => link.url.trim()),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className='grid gap-3 rounded-lg border p-3'>
      <div className='grid gap-1.5'>
        <Label htmlFor={`${id}-member`}>Membro do workspace</Label>
        <Select
          value={form.userId ?? NO_MEMBER}
          onValueChange={(next) => {
            if (typeof next !== 'string') return
            const member = members.data?.find((item) => item.userId === next)
            setForm((current) => ({
              ...current,
              userId: next === NO_MEMBER ? null : next,
              name: current.name || member?.name || '',
              avatarUrl: current.avatarUrl ?? member?.image ?? null,
            }))
          }}
        >
          <SelectTrigger id={`${id}-member`} className='w-full'>
            <SelectValue>
              {(value: string | null) =>
                !value || value === NO_MEMBER
                  ? 'Autor convidado (sem conta)'
                  : (members.data?.find((item) => item.userId === value)
                      ?.name ?? 'Membro')
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_MEMBER}>
              Autor convidado (sem conta)
            </SelectItem>
            {(members.data ?? []).map((member) => (
              <SelectItem key={member.userId} value={member.userId}>
                {member.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className='grid gap-1.5'>
        <Label htmlFor={`${id}-name`}>Nome público</Label>
        <Input
          id={`${id}-name`}
          value={form.name}
          maxLength={120}
          required
          onChange={(event) =>
            setForm((current) => ({ ...current, name: event.target.value }))
          }
        />
      </div>
      <div className='grid gap-1.5'>
        <Label htmlFor={`${id}-bio`}>Biografia</Label>
        <Textarea
          id={`${id}-bio`}
          value={form.bio}
          rows={3}
          maxLength={1000}
          onChange={(event) =>
            setForm((current) => ({ ...current, bio: event.target.value }))
          }
        />
      </div>
      <div className='flex flex-wrap items-center gap-3'>
        {form.avatarUrl ? (
          <img
            src={form.avatarUrl}
            alt=''
            className='size-12 rounded-full border object-cover'
          />
        ) : null}
        <MediaPickButton
          workspaceId={workspaceId}
          label={form.avatarUrl ? 'Trocar foto' : 'Escolher foto'}
          onPick={(url) =>
            setForm((current) => ({ ...current, avatarUrl: url }))
          }
        />
        {form.avatarUrl ? (
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() =>
              setForm((current) => ({ ...current, avatarUrl: null }))
            }
          >
            Remover foto
          </Button>
        ) : null}
      </div>
      <div className='grid gap-2'>
        <p className='font-medium text-sm'>Redes sociais</p>
        {form.links.map((link, index) => (
          <div
            key={index}
            className='grid grid-cols-[8rem_minmax(0,1fr)_auto] items-center gap-1.5'
          >
            <Select
              value={link.network}
              onValueChange={(next) =>
                typeof next === 'string' &&
                setForm((current) => ({
                  ...current,
                  links: current.links.map((entry, i) =>
                    i === index
                      ? {
                          ...entry,
                          network: next as SiteAuthorLinkDTO['network'],
                        }
                      : entry,
                  ),
                }))
              }
            >
              <SelectTrigger aria-label='Rede' className='h-8 w-full text-xs'>
                <SelectValue>
                  {(value: string | null) =>
                    NETWORK_LABELS[value as SiteAuthorLinkDTO['network']] ??
                    value
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {AUTHOR_NETWORKS.map((network) => (
                  <SelectItem key={network} value={network}>
                    {NETWORK_LABELS[network]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              aria-label='Endereço do perfil'
              type='url'
              placeholder='https://'
              value={link.url}
              maxLength={500}
              className='h-8'
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  links: current.links.map((entry, i) =>
                    i === index ? { ...entry, url: event.target.value } : entry,
                  ),
                }))
              }
            />
            <Button
              type='button'
              variant='ghost'
              size='icon-sm'
              aria-label='Remover rede'
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  links: current.links.filter((_, i) => i !== index),
                }))
              }
            >
              <SteelIcon icon={Delete02Icon} />
            </Button>
          </div>
        ))}
        <Button
          type='button'
          variant='outline'
          size='sm'
          className='justify-self-start'
          disabled={form.links.length >= 10}
          onClick={() =>
            setForm((current) => ({
              ...current,
              links: [...current.links, { network: 'linkedin', url: '' }],
            }))
          }
        >
          <SteelIcon icon={Add01Icon} data-icon='inline-start' />
          Adicionar rede
        </Button>
      </div>
      <div className='flex justify-end gap-2'>
        <Button type='button' variant='ghost' onClick={onCancel}>
          Cancelar
        </Button>
        <Button type='submit' disabled={busy || !form.name.trim()}>
          {author ? 'Salvar autor' : 'Criar autor'}
        </Button>
      </div>
    </form>
  )
}

export function BlogAuthorsDialog({
  open,
  onOpenChange,
  workspaceId,
  siteId,
  api,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  siteId: string
  api: SiteBlogApi
}) {
  const queryClient = useQueryClient()
  const authors = useSiteAuthors(workspaceId, siteId)
  const [editing, setEditing] = useState<SiteAuthorDTO | 'new' | null>(null)

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: siteBlogKeys.authors(workspaceId, siteId),
    })

  async function save(form: AuthorForm) {
    const dto = {
      userId: form.userId,
      name: form.name.trim(),
      bio: form.bio.trim() || null,
      avatarUrl: form.avatarUrl,
      links: form.links,
    }
    try {
      if (editing === 'new') await api.createAuthor(dto)
      else if (editing) await api.updateAuthor(editing.id, dto)
      await refresh()
      setEditing(null)
      notify.success('Autor salvo.')
    } catch (error) {
      notify.error(error, 'Não foi possível salvar o autor')
    }
  }

  async function remove(author: SiteAuthorDTO) {
    if (
      !window.confirm(`Remover ${author.name}? Os posts dele ficam sem autor.`)
    ) {
      return
    }
    try {
      await api.removeAuthor(author.id)
      await refresh()
      notify.success('Autor removido.')
    } catch (error) {
      notify.error(error, 'Não foi possível remover o autor')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Autores do blog</DialogTitle>
          <DialogDescription>
            O perfil público de quem escreve: nome, foto, biografia e redes.
          </DialogDescription>
        </DialogHeader>
        {editing ? (
          <AuthorEditor
            key={editing === 'new' ? 'new' : editing.id}
            workspaceId={workspaceId}
            author={editing === 'new' ? undefined : editing}
            onSave={save}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <div className='grid gap-3'>
            {(authors.data ?? []).length === 0 ? (
              <p className='text-muted-foreground text-sm'>
                Nenhum autor ainda.
              </p>
            ) : (
              <ul className='grid gap-2'>
                {(authors.data ?? []).map((author) => (
                  <li
                    key={author.id}
                    className='flex items-center gap-3 rounded-lg border p-2'
                  >
                    {author.avatarUrl ? (
                      <img
                        src={author.avatarUrl}
                        alt=''
                        className='size-9 rounded-full object-cover'
                      />
                    ) : (
                      <span className='flex size-9 items-center justify-center rounded-full bg-muted font-semibold text-sm'>
                        {author.name.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <div className='min-w-0 flex-1'>
                      <p className='truncate font-medium text-sm'>
                        {author.name}
                      </p>
                      <p className='text-muted-foreground text-xs'>
                        {author.postCount === 1
                          ? '1 post'
                          : `${author.postCount} posts`}
                      </p>
                    </div>
                    <Button
                      variant='ghost'
                      size='icon-sm'
                      aria-label={`Editar ${author.name}`}
                      onClick={() => setEditing(author)}
                    >
                      <SteelIcon icon={PencilEdit02Icon} />
                    </Button>
                    <Button
                      variant='ghost'
                      size='icon-sm'
                      aria-label={`Remover ${author.name}`}
                      onClick={() => void remove(author)}
                    >
                      <SteelIcon icon={Delete02Icon} />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <Button
              variant='outline'
              className='justify-self-start'
              onClick={() => setEditing('new')}
            >
              <SteelIcon icon={Add01Icon} data-icon='inline-start' />
              Novo autor
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
