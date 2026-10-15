'use client'

import {
  Add01Icon,
  Delete02Icon,
  Tick02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { notify } from '@/lib/notify'
import {
  type SiteBlogApi,
  siteBlogKeys,
  useSiteBlogCategories,
  useSiteBlogTags,
} from '@/src/hooks/use-site-blog'

/** Categories and tags of the blog: create, rename and remove. */

type Kind = 'category' | 'tag'

interface Term {
  id: string
  name: string
  slug: string
  postCount: number
}

function TermRow({
  term,
  onRename,
  onRemove,
}: {
  term: Term
  onRename: (name: string) => Promise<void>
  onRemove: () => Promise<void>
}) {
  const [name, setName] = useState(term.name)
  const changed = name.trim() && name.trim() !== term.name
  return (
    <li className='flex items-center gap-2'>
      <Input
        aria-label={`Nome de ${term.name}`}
        value={name}
        maxLength={80}
        className='h-8'
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && changed) void onRename(name.trim())
        }}
      />
      <span className='w-16 shrink-0 text-right text-muted-foreground text-xs'>
        {term.postCount === 1 ? '1 post' : `${term.postCount} posts`}
      </span>
      {changed ? (
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label={`Salvar ${term.name}`}
          onClick={() => void onRename(name.trim())}
        >
          <SteelIcon icon={Tick02Icon} />
        </Button>
      ) : null}
      <Button
        variant='ghost'
        size='icon-sm'
        aria-label={`Remover ${term.name}`}
        onClick={() => void onRemove()}
      >
        <SteelIcon icon={Delete02Icon} />
      </Button>
    </li>
  )
}

function TermList({
  kind,
  terms,
  api,
  refresh,
}: {
  kind: Kind
  terms: Term[]
  api: SiteBlogApi
  refresh: () => Promise<unknown>
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const label = kind === 'category' ? 'categoria' : 'tag'

  async function create(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      if (kind === 'category') await api.createCategory({ name: name.trim() })
      else await api.createTag({ name: name.trim() })
      await refresh()
      setName('')
    } catch (error) {
      notify.error(error, `Não foi possível criar a ${label}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='grid gap-3'>
      <form onSubmit={create} className='flex gap-2'>
        <Input
          aria-label={`Nova ${label}`}
          placeholder={kind === 'category' ? 'Nova categoria' : 'Nova tag'}
          value={name}
          maxLength={kind === 'category' ? 80 : 60}
          onChange={(event) => setName(event.target.value)}
        />
        <Button type='submit' disabled={busy || !name.trim()}>
          <SteelIcon icon={Add01Icon} data-icon='inline-start' />
          Criar
        </Button>
      </form>
      {terms.length === 0 ? (
        <p className='text-muted-foreground text-sm'>
          {kind === 'category'
            ? 'Nenhuma categoria ainda.'
            : 'Nenhuma tag ainda.'}
        </p>
      ) : (
        <ul className='grid max-h-80 gap-2 overflow-y-auto'>
          {terms.map((term) => (
            <TermRow
              key={term.id}
              term={term}
              onRename={async (next) => {
                try {
                  if (kind === 'category') {
                    await api.updateCategory(term.id, { name: next })
                  } else {
                    await api.updateTag(term.id, { name: next })
                  }
                  await refresh()
                } catch (error) {
                  notify.error(error, 'Não foi possível renomear')
                }
              }}
              onRemove={async () => {
                try {
                  if (kind === 'category') await api.removeCategory(term.id)
                  else await api.removeTag(term.id)
                  await refresh()
                } catch (error) {
                  notify.error(error, 'Não foi possível remover')
                }
              }}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

export function BlogTermsDialog({
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
  const categories = useSiteBlogCategories(workspaceId, siteId)
  const tags = useSiteBlogTags(workspaceId, siteId)
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: siteBlogKeys.all(workspaceId, siteId),
    })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Categorias e tags</DialogTitle>
          <DialogDescription>
            Cada uma ganha a própria página no blog (/blog/categoria/… e
            /blog/tag/…). O endereço não muda ao renomear.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue='categories'>
          <TabsList>
            <TabsTrigger value='categories'>Categorias</TabsTrigger>
            <TabsTrigger value='tags'>Tags</TabsTrigger>
          </TabsList>
          <TabsContent value='categories' className='pt-3'>
            <TermList
              kind='category'
              terms={categories.data ?? []}
              api={api}
              refresh={refresh}
            />
          </TabsContent>
          <TabsContent value='tags' className='pt-3'>
            <TermList
              kind='tag'
              terms={tags.data ?? []}
              api={api}
              refresh={refresh}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
