'use client'

import {
  ArrowRight01Icon,
  Delete02Icon,
  PencilEdit02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import {
  sitePlatformApi,
  sitePlatformKeys,
  useSiteRedirects,
} from '@/src/hooks/use-site-platform'
import type { SiteRedirectDTO } from '@/types/site-platform'

interface Draft {
  id: string | null
  fromPath: string
  toPath: string
  permanent: boolean
}

const EMPTY: Draft = { id: null, fromPath: '', toPath: '', permanent: true }

/**
 * "Redirecionamentos": old addresses of the site and where they lead. Live
 * as soon as saved (no publish), so renaming a page never breaks links
 * already shared or indexed.
 */
export function RedirectsDialog({
  open,
  onOpenChange,
  workspaceId,
  siteId,
  canEdit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  siteId: string
  canEdit: boolean
}) {
  const id = useId()
  const queryClient = useQueryClient()
  const redirects = useSiteRedirects(workspaceId, siteId, open)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [busy, setBusy] = useState(false)
  const api = sitePlatformApi(workspaceId)
  const key = sitePlatformKeys.redirects(workspaceId, siteId)

  const set = <K extends keyof Draft>(field: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [field]: value }))

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!draft.fromPath.trim() || !draft.toPath.trim()) {
      notify.error('Informe o endereço antigo e o novo.')
      return
    }
    setBusy(true)
    try {
      const body = {
        fromPath: draft.fromPath.trim(),
        toPath: draft.toPath.trim(),
        permanent: draft.permanent,
      }
      if (draft.id) await api.updateRedirect(siteId, draft.id, body)
      else await api.createRedirect(siteId, body)
      await queryClient.invalidateQueries({ queryKey: key })
      notify.success(
        draft.id ? 'Redirecionamento salvo.' : 'Redirecionamento criado.',
      )
      setDraft(EMPTY)
    } catch (error) {
      notify.error(error, 'Não foi possível salvar o redirecionamento')
    } finally {
      setBusy(false)
    }
  }

  async function remove(redirect: SiteRedirectDTO) {
    try {
      await api.removeRedirect(siteId, redirect.id)
      queryClient.setQueryData<SiteRedirectDTO[]>(key, (current) =>
        current?.filter((item) => item.id !== redirect.id),
      )
      if (draft.id === redirect.id) setDraft(EMPTY)
      notify.success('Redirecionamento excluído.')
    } catch (error) {
      notify.error(error, 'Não foi possível excluir o redirecionamento')
    }
  }

  const list = redirects.data ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-2xl' data-testid='site-redirects'>
        <DialogHeader>
          <DialogTitle>Redirecionamentos</DialogTitle>
          <DialogDescription>
            Leve quem acessa um endereço antigo para a página nova. Vale na
            hora, sem publicar.
          </DialogDescription>
        </DialogHeader>

        {canEdit ? (
          <form
            onSubmit={submit}
            className='grid gap-3 rounded-lg border p-3'
            aria-label={
              draft.id ? 'Editar redirecionamento' : 'Novo redirecionamento'
            }
          >
            <div className='grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end'>
              <div className='grid gap-1.5'>
                <Label htmlFor={`${id}-from`}>Endereço antigo</Label>
                <Input
                  id={`${id}-from`}
                  value={draft.fromPath}
                  placeholder='/servicos-antigos ou /blog/*'
                  maxLength={500}
                  onChange={(event) => set('fromPath', event.target.value)}
                />
              </div>
              <SteelIcon
                icon={ArrowRight01Icon}
                className='mb-2.5 hidden size-4 text-muted-foreground sm:block'
              />
              <div className='grid gap-1.5'>
                <Label htmlFor={`${id}-to`}>Novo endereço</Label>
                <Input
                  id={`${id}-to`}
                  value={draft.toPath}
                  placeholder='/servicos ou https://…'
                  maxLength={2000}
                  onChange={(event) => set('toPath', event.target.value)}
                />
              </div>
            </div>
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <Label
                htmlFor={`${id}-permanent`}
                className='flex items-center gap-2 font-normal text-sm'
              >
                <Switch
                  id={`${id}-permanent`}
                  checked={draft.permanent}
                  onCheckedChange={(checked) => set('permanent', checked)}
                />
                Permanente
                <span className='text-muted-foreground text-xs'>
                  (os buscadores passam a mostrar o novo endereço)
                </span>
              </Label>
              <div className='flex gap-2'>
                {draft.id ? (
                  <Button
                    type='button'
                    size='sm'
                    variant='ghost'
                    onClick={() => setDraft(EMPTY)}
                  >
                    Cancelar
                  </Button>
                ) : null}
                <Button type='submit' size='sm' disabled={busy}>
                  {draft.id ? 'Salvar' : 'Adicionar'}
                </Button>
              </div>
            </div>
            <p className='text-muted-foreground text-xs'>
              Termine com /* para levar um caminho inteiro: /blog/* →
              /novidades/* manda /blog/post para /novidades/post.
            </p>
          </form>
        ) : null}

        <div className='-mx-1 max-h-[45vh] overflow-y-auto px-1'>
          {redirects.isLoading ? (
            <div className='grid gap-2'>
              <Skeleton className='h-10' />
              <Skeleton className='h-10' />
            </div>
          ) : redirects.error ? (
            <p className='py-6 text-center text-muted-foreground text-sm'>
              Não foi possível carregar os redirecionamentos.
            </p>
          ) : list.length === 0 ? (
            <p className='py-6 text-center text-muted-foreground text-sm'>
              Nenhum redirecionamento ainda.
            </p>
          ) : (
            <ul aria-label='Redirecionamentos do site' className='divide-y'>
              {list.map((redirect) => (
                <li
                  key={redirect.id}
                  className='flex min-w-0 flex-wrap items-center gap-2 py-2 text-sm'
                >
                  <code className='min-w-0 max-w-full truncate rounded bg-muted px-1.5 py-0.5 text-xs'>
                    {redirect.fromPath}
                  </code>
                  <SteelIcon
                    icon={ArrowRight01Icon}
                    className='size-3.5 shrink-0 text-muted-foreground'
                  />
                  <span
                    className='min-w-0 flex-1 truncate'
                    title={redirect.toPath}
                  >
                    {redirect.toPath}
                  </span>
                  <Badge variant='outline' className='shrink-0'>
                    {redirect.permanent ? 'Permanente' : 'Temporário'}
                  </Badge>
                  {canEdit ? (
                    <span className='flex shrink-0 gap-0.5'>
                      <button
                        type='button'
                        aria-label={`Editar ${redirect.fromPath}`}
                        onClick={() =>
                          setDraft({
                            id: redirect.id,
                            fromPath: redirect.fromPath,
                            toPath: redirect.toPath,
                            permanent: redirect.permanent,
                          })
                        }
                        className='flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground'
                      >
                        <SteelIcon
                          icon={PencilEdit02Icon}
                          className='size-3.5'
                        />
                      </button>
                      <button
                        type='button'
                        aria-label={`Excluir ${redirect.fromPath}`}
                        onClick={() => void remove(redirect)}
                        className='flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
                      >
                        <SteelIcon icon={Delete02Icon} className='size-3.5' />
                      </button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
