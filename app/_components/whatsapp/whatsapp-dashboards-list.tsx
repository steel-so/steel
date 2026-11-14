'use client'

import { Add01Icon, Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { ConfirmAction } from '@/components/ui/confirm-action'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { notify } from '@/lib/notify'
import { useResourceList } from '@/src/hooks/use-crm-resource-list'
import type { CrmDashboardDTO } from '@/types/crm-dashboard'

export function WhatsappDashboardsList({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const router = useRouter()
  const { items, isLoading, error, refetch } = useResourceList<CrmDashboardDTO>(
    workspaceId,
    'whatsapp/dashboards',
  )
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/whatsapp/dashboards`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        },
      )
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) {
        notify.error(json?.message ?? 'Não foi possível criar o painel.')
        return
      }
      setOpen(false)
      setTitle('')
      router.push(`/${slug}/zap/dashboards/${json.data.id}`)
    } catch {
      notify.error('Não foi possível criar o painel. Verifique sua conexão.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/whatsapp/dashboards/${id}`,
        { method: 'DELETE' },
      )
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        notify.error(json?.message ?? 'Não foi possível remover o painel.')
        return
      }
      refetch()
    } catch {
      notify.error('Não foi possível remover o painel. Verifique sua conexão.')
    }
  }

  return (
    <div className='space-y-4 p-6'>
      <div className='flex items-center justify-between'>
        <div data-tour='zap-dashboards-intro'>
          <h3 className='font-medium text-sm'>Painéis</h3>
          <p className='text-muted-foreground text-xs'>
            Dashboards customizados sobre conversas, sentimento e transmissões
            do WhatsApp
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger
            render={
              <Button size='sm' data-tour='zap-dashboards-new'>
                <SteelIcon icon={Add01Icon} strokeWidth={2} />
                Novo painel
              </Button>
            }
          />
          <DialogContent className='max-w-sm'>
            <DialogHeader>
              <DialogTitle>Novo painel</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className='space-y-3'>
              <div className='space-y-1.5'>
                <Label htmlFor='dashboardTitle'>Título</Label>
                <Input
                  id='dashboardTitle'
                  required
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
              <DialogFooter>
                <Button type='submit' disabled={saving}>
                  {saving ? 'Criando...' : 'Criar painel'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div
        className='divide-y rounded-md border'
        data-tour='zap-dashboards-list'
      >
        {items.map((dashboard) => (
          <div
            key={dashboard.id}
            className='flex items-center justify-between gap-2 px-4 py-3'
          >
            <button
              type='button'
              className='min-w-0 flex-1 truncate text-left text-sm hover:underline'
              onClick={() =>
                router.push(`/${slug}/zap/dashboards/${dashboard.id}`)
              }
            >
              {dashboard.title}
            </button>
            <ConfirmAction
              trigger={
                <Button
                  size='icon-xs'
                  variant='ghost'
                  aria-label='Remover painel'
                >
                  <SteelIcon icon={Delete02Icon} strokeWidth={2} />
                </Button>
              }
              title={`Remover o painel "${dashboard.title}"?`}
              description='O painel e os gráficos dele são apagados. Não dá para desfazer.'
              confirmLabel='Remover'
              onConfirm={() => handleDelete(dashboard.id)}
            />
          </div>
        ))}
        {!isLoading && error && (
          <div className='flex flex-col items-center gap-2 px-4 py-6 text-center'>
            <p role='alert' className='text-destructive text-sm'>
              Não foi possível carregar os painéis. {error}
            </p>
            <Button size='sm' variant='outline' onClick={() => refetch()}>
              Tentar novamente
            </Button>
          </div>
        )}
        {!isLoading && !error && items.length === 0 && (
          <p className='px-4 py-6 text-center text-muted-foreground text-sm'>
            Nenhum painel criado ainda.
          </p>
        )}
      </div>
    </div>
  )
}
