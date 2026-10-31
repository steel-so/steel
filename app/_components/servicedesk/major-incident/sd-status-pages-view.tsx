'use client'

import {
  Link01Icon,
  Megaphone01Icon,
  PlusSignIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { useSdConfigList, useSdMe } from '@/src/hooks/use-sd-config'
import { useSdCustomerOptions } from '@/src/hooks/use-sd-customers'
import {
  useAddSdStatusSubscriber,
  useCreateSdStatusPage,
  useDeleteSdStatusPage,
  useRemoveSdStatusSubscriber,
  useSdStatusPages,
  useSdStatusSubscribers,
  useUpdateSdStatusPage,
} from '@/src/hooks/use-sd-status-pages'
import type { SdCategoryDTO } from '@/types/sd-config'
import type { SdStatusPageDTO } from '@/types/sd-status-page'
import {
  ConfirmDeleteButton,
  EmptyState,
  FieldBlock,
  SimpleSelect,
  ToggleRow,
} from '../settings/sd-settings-kit'
import { formatIncidentDateTime } from './sd-major-incident-meta'
import {
  SdComponentsDialog,
  SdMaintenanceSection,
} from './sd-status-maintenance-panels'

interface PageForm {
  name: string
  slug: string
  description: string
  customerId: string | null
  serviceIds: string[]
  published: boolean
  allowSubscriptions: boolean
}

const EMPTY_FORM: PageForm = {
  name: '',
  slug: '',
  description: '',
  customerId: null,
  serviceIds: [],
  published: true,
  allowSubscriptions: true,
}

function PageFormDialog({
  workspaceId,
  page,
  open,
  onOpenChange,
}: {
  workspaceId: string
  /** `null` = create. */
  page: SdStatusPageDTO | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const create = useCreateSdStatusPage(workspaceId)
  const update = useUpdateSdStatusPage(workspaceId, page?.id ?? '')
  const customers = useSdCustomerOptions(workspaceId, { enabled: open })
  const categories = useSdConfigList<SdCategoryDTO>(
    workspaceId,
    'categories',
    {},
    { enabled: open },
  )
  const [form, setForm] = useState<PageForm>(EMPTY_FORM)

  useEffect(() => {
    if (!open) return
    setForm(
      page
        ? {
            name: page.name,
            slug: page.slug,
            description: page.description ?? '',
            customerId: page.customer?.id ?? null,
            serviceIds: page.serviceIds,
            published: page.published,
            allowSubscriptions: page.allowSubscriptions,
          }
        : EMPTY_FORM,
    )
  }, [open, page])

  const set = <K extends keyof PageForm>(key: K, value: PageForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }))
  const services = (categories.data ?? []).filter((c) => c.active)
  const pending = create.isPending || update.isPending

  async function submit() {
    try {
      if (page) {
        await update.mutateAsync({
          name: form.name.trim(),
          description: form.description.trim() || null,
          customerId: form.customerId,
          serviceIds: form.serviceIds,
          published: form.published,
          allowSubscriptions: form.allowSubscriptions,
        })
      } else {
        await create.mutateAsync({
          name: form.name.trim(),
          slug: form.slug.trim() || undefined,
          description: form.description.trim() || undefined,
          customerId: form.customerId ?? undefined,
          serviceIds: form.serviceIds,
          published: form.published,
          allowSubscriptions: form.allowSubscriptions,
        })
      }
      onOpenChange(false)
      notify.success(page ? 'Página atualizada' : 'Página criada')
    } catch (error) {
      notify.error(error)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>
            {page ? 'Editar página de status' : 'Nova página de status'}
          </DialogTitle>
          <DialogDescription>
            A página é pública: quem tem o endereço vê os incidentes que você
            publicar nela.
          </DialogDescription>
        </DialogHeader>
        <div className='flex flex-col gap-4'>
          <FieldBlock label='Nome'>
            <Input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              maxLength={120}
              placeholder='Ex.: Acme · Telefonia'
            />
          </FieldBlock>
          {page ? null : (
            <FieldBlock
              label='Endereço (opcional)'
              hint='Letras minúsculas, números e hífens. Vazio: geramos a partir do nome, com um sufixo difícil de adivinhar.'
            >
              <Input
                value={form.slug}
                onChange={(e) => set('slug', e.target.value)}
                maxLength={48}
                placeholder='acme-telefonia'
              />
            </FieldBlock>
          )}
          <FieldBlock label='Descrição (opcional)'>
            <Textarea
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              rows={2}
              maxLength={1000}
            />
          </FieldBlock>
          <FieldBlock
            label='Cliente'
            hint='A página é sugerida nos incidentes dos chamados deste cliente. Sem cliente e sem serviços, vale para todos.'
          >
            <SimpleSelect
              value={form.customerId}
              onChange={(value) => set('customerId', value)}
              allowEmpty
              emptyLabel='Todos os clientes'
              options={(customers.data ?? []).map((c) => ({
                value: c.id,
                label: c.label,
              }))}
            />
          </FieldBlock>
          <div className='flex flex-col gap-1.5'>
            <span className='font-medium text-muted-foreground text-xs'>
              Serviços cobertos
            </span>
            {services.length === 0 ? (
              <p className='text-muted-foreground text-xs'>
                {categories.isLoading
                  ? 'Carregando…'
                  : 'Nenhum serviço no catálogo.'}
              </p>
            ) : (
              <ul className='flex max-h-40 flex-col overflow-y-auto rounded-md border border-border'>
                {services.map((service) => (
                  <li key={service.id}>
                    <label
                      htmlFor={`status-svc-${service.id}`}
                      className='flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-muted/50'
                    >
                      <Checkbox
                        id={`status-svc-${service.id}`}
                        checked={form.serviceIds.includes(service.id)}
                        onCheckedChange={(value) =>
                          set(
                            'serviceIds',
                            value
                              ? [...form.serviceIds, service.id]
                              : form.serviceIds.filter(
                                  (id) => id !== service.id,
                                ),
                          )
                        }
                      />
                      <span className='truncate'>{service.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <ToggleRow
            label='Página publicada'
            description='Despublicada, o endereço deixa de abrir.'
            checked={form.published}
            onCheckedChange={(value) => set('published', value)}
          />
          <ToggleRow
            label='Aceitar inscrições por e-mail'
            description='Mostra o formulário de inscrição (com confirmação por e-mail).'
            checked={form.allowSubscriptions}
            onCheckedChange={(value) => set('allowSubscriptions', value)}
          />
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={form.name.trim().length < 2 || pending}
            onClick={submit}
          >
            {page ? 'Salvar' : 'Criar página'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SubscribersDialog({
  workspaceId,
  page,
  onOpenChange,
}: {
  workspaceId: string
  page: SdStatusPageDTO | null
  onOpenChange: (open: boolean) => void
}) {
  const pageId = page?.id ?? ''
  const list = useSdStatusSubscribers(workspaceId, page?.id ?? null)
  const add = useAddSdStatusSubscriber(workspaceId, pageId)
  const remove = useRemoveSdStatusSubscriber(workspaceId, pageId)
  const [channel, setChannel] = useState<'EMAIL' | 'WHATSAPP'>('EMAIL')
  const [address, setAddress] = useState('')
  const [name, setName] = useState('')

  useEffect(() => {
    if (page) {
      setAddress('')
      setName('')
    }
  }, [page])

  async function submit() {
    try {
      await add.mutateAsync({
        channel,
        address: address.trim(),
        name: name.trim() || undefined,
      })
      setAddress('')
      setName('')
      notify.success('Assinante adicionado')
    } catch (error) {
      notify.error(error)
    }
  }

  const items = list.data?.items ?? []
  return (
    <Dialog open={page !== null} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>Assinantes · {page?.name}</DialogTitle>
          <DialogDescription>
            Recebem as atualizações publicadas por e-mail ou WhatsApp. Quem se
            inscreve na página precisa confirmar por e-mail; os que você
            adiciona aqui já entram confirmados, então só inclua contatos que
            aceitaram receber os avisos.
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-2 sm:grid-cols-[130px_1fr_1fr_auto] sm:items-end'>
          <FieldBlock label='Canal'>
            <SimpleSelect
              value={channel}
              onChange={(value) => value && setChannel(value)}
              options={[
                { value: 'EMAIL', label: 'E-mail' },
                { value: 'WHATSAPP', label: 'WhatsApp' },
              ]}
            />
          </FieldBlock>
          <FieldBlock label={channel === 'EMAIL' ? 'E-mail' : 'WhatsApp'}>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={
                channel === 'EMAIL' ? 'ana@acme.com.br' : '5511999990000'
              }
            />
          </FieldBlock>
          <FieldBlock label='Nome (opcional)'>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </FieldBlock>
          <Button
            disabled={address.trim().length < 5 || add.isPending}
            onClick={submit}
          >
            Adicionar
          </Button>
        </div>
        {items.length === 0 ? (
          <EmptyState>
            {list.isLoading ? 'Carregando…' : 'Nenhum assinante ainda.'}
          </EmptyState>
        ) : (
          <ul className='flex max-h-72 flex-col divide-y divide-border overflow-y-auto rounded-md border border-border'>
            {items.map((item) => (
              <li
                key={item.id}
                className='flex items-center gap-2 px-3 py-2 text-sm'
              >
                <Badge variant='secondary'>
                  {item.channel === 'EMAIL' ? 'E-mail' : 'WhatsApp'}
                </Badge>
                <span className='min-w-0 flex-1 truncate'>
                  {item.address}
                  {item.name ? ` · ${item.name}` : ''}
                </span>
                {item.confirmed ? null : (
                  <Badge variant='outline'>Aguardando confirmação</Badge>
                )}
                <ConfirmDeleteButton
                  title='Remover assinante?'
                  description={`${item.address} deixa de receber os avisos desta página.`}
                  label='Remover'
                  pending={remove.isPending}
                  onConfirm={() =>
                    remove
                      .mutateAsync(item.id)
                      .then(() => notify.success('Assinante removido'))
                      .catch((error) => notify.error(error))
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

function PageCard({
  page,
  isAdmin,
  onEdit,
  onSubscribers,
  onComponents,
  onDelete,
  deleting,
}: {
  page: SdStatusPageDTO
  isAdmin: boolean
  onEdit: () => void
  onSubscribers: () => void
  onComponents: () => void
  onDelete: () => void
  deleting: boolean
}) {
  return (
    <li className='flex flex-col gap-3 rounded-lg border border-border bg-card p-4'>
      <div className='flex flex-wrap items-start justify-between gap-2'>
        <div className='flex min-w-0 flex-col gap-1'>
          <div className='flex flex-wrap items-center gap-2'>
            <span className='font-medium text-sm'>{page.name}</span>
            <Badge variant={page.published ? 'default' : 'secondary'}>
              {page.published ? 'Publicada' : 'Despublicada'}
            </Badge>
            {page.activeIncidentCount > 0 ? (
              <Badge variant='destructive'>
                {page.activeIncidentCount} incidente(s) ativo(s)
              </Badge>
            ) : null}
          </div>
          <a
            href={page.path}
            target='_blank'
            rel='noreferrer'
            className='flex w-fit items-center gap-1 text-muted-foreground text-xs hover:text-foreground hover:underline'
          >
            <SteelIcon icon={Link01Icon} className='size-3.5' />
            {page.path}
          </a>
        </div>
        <div className='flex items-center gap-2'>
          <Button size='sm' variant='outline' onClick={onComponents}>
            Componentes
          </Button>
          <Button size='sm' variant='outline' onClick={onSubscribers}>
            Assinantes ({page.subscriberCount})
          </Button>
          {isAdmin ? (
            <>
              <Button size='sm' variant='outline' onClick={onEdit}>
                Editar
              </Button>
              <ConfirmDeleteButton
                title='Excluir página de status?'
                description='O endereço deixa de abrir e os assinantes são removidos. Os incidentes não são afetados.'
                pending={deleting}
                onConfirm={onDelete}
              />
            </>
          ) : null}
        </div>
      </div>
      <p className='text-muted-foreground text-xs'>
        {page.customer ? `Cliente: ${page.customer.name}` : 'Todos os clientes'}
        {page.services.length > 0
          ? ` · Serviços: ${page.services.map((s) => s.name).join(', ')}`
          : ''}
        {` · Criada em ${formatIncidentDateTime(page.createdAt)}`}
      </p>
    </li>
  )
}

/** Páginas de status por cliente ou serviço (administração). */
export function SdStatusPagesView({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const me = useSdMe(workspaceId)
  const pages = useSdStatusPages(workspaceId)
  const remove = useDeleteSdStatusPage(workspaceId)
  const [editing, setEditing] = useState<SdStatusPageDTO | 'new' | null>(null)
  const [subscribers, setSubscribers] = useState<SdStatusPageDTO | null>(null)
  const [componentsPage, setComponentsPage] = useState<SdStatusPageDTO | null>(
    null,
  )
  const isAdmin = me.data?.isAdmin ?? false
  const items = pages.data?.items ?? []

  return (
    <div className='mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 sm:p-6'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex flex-col'>
          <h1 className='font-semibold text-lg'>Páginas de status</h1>
          <p className='text-muted-foreground text-sm'>
            Uma página pública por cliente ou serviço, com as atualizações dos
            incidentes maiores e aviso por e-mail e WhatsApp.
          </p>
        </div>
        <div className='flex items-center gap-2'>
          <Button
            variant='outline'
            render={<Link href={`/${slug}/servicedesk/major-incidents`} />}
          >
            Incidentes maiores
          </Button>
          {isAdmin ? (
            <Button onClick={() => setEditing('new')}>
              <SteelIcon icon={PlusSignIcon} />
              Nova página
            </Button>
          ) : null}
        </div>
      </div>

      {pages.error ? (
        <EmptyState>{pages.error.message}</EmptyState>
      ) : pages.isLoading ? (
        <EmptyState>Carregando…</EmptyState>
      ) : items.length === 0 ? (
        <div className='flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-8 text-center'>
          <SteelIcon
            icon={Megaphone01Icon}
            className='size-6 text-muted-foreground'
          />
          <p className='text-muted-foreground text-sm'>
            Nenhuma página de status ainda.
            {isAdmin ? ' Crie a primeira para avisar seus clientes.' : ''}
          </p>
        </div>
      ) : (
        <ul className='flex flex-col gap-3'>
          {items.map((page) => (
            <PageCard
              key={page.id}
              page={page}
              isAdmin={isAdmin}
              deleting={remove.isPending}
              onEdit={() => setEditing(page)}
              onSubscribers={() => setSubscribers(page)}
              onComponents={() => setComponentsPage(page)}
              onDelete={() =>
                remove
                  .mutateAsync(page.id)
                  .then(() => notify.success('Página excluída'))
                  .catch((error) => notify.error(error))
              }
            />
          ))}
        </ul>
      )}

      <SdMaintenanceSection workspaceId={workspaceId} />

      <PageFormDialog
        workspaceId={workspaceId}
        page={editing === 'new' ? null : editing}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
      />
      <SubscribersDialog
        workspaceId={workspaceId}
        page={subscribers}
        onOpenChange={(open) => !open && setSubscribers(null)}
      />
      <SdComponentsDialog
        workspaceId={workspaceId}
        page={componentsPage}
        isAdmin={isAdmin}
        onOpenChange={(open) => !open && setComponentsPage(null)}
      />
    </div>
  )
}
