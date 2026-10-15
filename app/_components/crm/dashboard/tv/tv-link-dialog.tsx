'use client'

import {
  Copy01Icon,
  Delete02Icon,
  Link01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import * as React from 'react'
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
import { notify } from '@/lib/notify'
import { isApiErrorCode } from '@/src/hooks/_fetch'
import {
  createCrmDashboardTvLink,
  revokeCrmDashboardTvLink,
  useCrmDashboardTvLinks,
} from '@/src/hooks/use-crm-dashboard-tv'
import type { CrmDashboardTvLinkDTO } from '@/types/crm-dashboard'

const DATE = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
})

function absoluteUrl(path: string): string {
  if (typeof window === 'undefined') return path
  return `${window.location.origin}${path}`
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    notify.success('Link copiado')
  } catch {
    notify.error('Não foi possível copiar. Selecione o link e copie à mão.')
  }
}

function LinkRow({
  link,
  onRevoke,
}: {
  link: CrmDashboardTvLinkDTO
  onRevoke: (link: CrmDashboardTvLinkDTO) => void
}) {
  const url = absoluteUrl(link.path)
  return (
    <li
      data-testid='tv-link-row'
      className='space-y-1.5 rounded-lg border border-border/70 p-3'
    >
      <div className='flex items-center justify-between gap-2'>
        <span className='truncate font-medium text-sm'>{link.name}</span>
        <div className='flex shrink-0 items-center gap-1'>
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label={`Copiar link ${link.name}`}
            onClick={() => copy(url)}
          >
            <SteelIcon icon={Copy01Icon} strokeWidth={2} />
          </Button>
          <Button
            variant='ghost'
            size='icon-sm'
            className='text-muted-foreground hover:text-destructive'
            aria-label={`Revogar link ${link.name}`}
            onClick={() => onRevoke(link)}
          >
            <SteelIcon icon={Delete02Icon} strokeWidth={2} />
          </Button>
        </div>
      </div>
      <Input
        readOnly
        value={url}
        className='font-mono text-xs'
        onFocus={(e) => e.currentTarget.select()}
      />
      <p className='text-muted-foreground text-xs'>
        Criado em {DATE.format(new Date(link.createdAt))}
        {link.lastUsedAt
          ? ` · última exibição ${DATE.format(new Date(link.lastUsedAt))}`
          : ' · ainda não exibido'}
      </p>
    </li>
  )
}

/**
 * Links somente leitura do painel para TVs (`/tv/<token>`): abrem sem login,
 * não mostram e-mail nem telefone de cliente e param na hora em que são
 * revogados. Só donos e administradores do CRM criam ou revogam.
 */
export function TvLinkDialog({
  open,
  onOpenChange,
  workspaceId,
  dashboardId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  dashboardId: string
}) {
  const { links, setLinks, isLoading, error, forbidden } =
    useCrmDashboardTvLinks(workspaceId, dashboardId, open)
  const [name, setName] = React.useState('TV da sala de vendas')
  const [creating, setCreating] = React.useState(false)
  const nameId = React.useId()

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault()
    setCreating(true)
    try {
      const link = await createCrmDashboardTvLink(
        workspaceId,
        dashboardId,
        name.trim() || 'TV',
      )
      setLinks((prev) => [link, ...prev])
      await copy(absoluteUrl(link.path))
    } catch (e) {
      notify.error(
        isApiErrorCode(e, 'FORBIDDEN')
          ? 'Só donos e administradores do CRM criam links da TV.'
          : e,
      )
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke(link: CrmDashboardTvLinkDTO) {
    const previous = links
    setLinks((prev) => prev.filter((item) => item.id !== link.id))
    try {
      await revokeCrmDashboardTvLink(workspaceId, dashboardId, link.id)
      notify.success('Link revogado. A TV para na próxima atualização.')
    } catch (e) {
      setLinks(previous)
      notify.error(e)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Link da TV</DialogTitle>
          <DialogDescription>
            Abra o painel numa TV sem fazer login. A tela é só leitura, não
            mostra e-mail nem telefone de clientes e para assim que o link é
            revogado.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleCreate} className='flex items-end gap-2'>
          <div className='flex-1 space-y-1.5'>
            <Label htmlFor={nameId}>Nome do link</Label>
            <Input
              id={nameId}
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <Button type='submit' disabled={creating}>
            <SteelIcon icon={Link01Icon} strokeWidth={2} />
            {creating ? 'Criando…' : 'Criar link'}
          </Button>
        </form>

        <div className='max-h-80 space-y-2 overflow-y-auto'>
          {error ? (
            <p className='text-muted-foreground text-sm'>
              {forbidden
                ? 'Só donos e administradores do CRM gerenciam links da TV.'
                : error}
            </p>
          ) : null}
          {!error && !isLoading && links.length === 0 ? (
            <p className='text-muted-foreground text-sm'>
              Nenhum link ativo. Crie um e abra o endereço no navegador da TV.
            </p>
          ) : null}
          <ul className='space-y-2'>
            {links.map((link) => (
              <LinkRow key={link.id} link={link} onRevoke={handleRevoke} />
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  )
}
