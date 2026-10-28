'use client'

import {
  Delete02Icon,
  Download04Icon,
  MailSend02Icon,
  MoreHorizontalIcon,
  Search01Icon,
  Upload04Icon,
  UserAdd01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useEffect, useState } from 'react'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  type CrmNewsletterSubscriberFilters,
  crmNewsletterExportUrl,
  useAddCrmNewsletterSubscriber,
  useCrmNewsletterSubscribers,
  useRemoveCrmNewsletterSubscriber,
  useResendCrmNewsletterConfirmation,
} from '@/src/hooks/use-crm-newsletters'
import {
  CRM_NEWSLETTER_SUBSCRIBER_SOURCES,
  CRM_NEWSLETTER_SUBSCRIBER_STATUSES,
  type CrmNewsletterDTO,
  type CrmNewsletterSubscriberDTO,
  type CrmNewsletterSubscriberSourceValue,
  type CrmNewsletterSubscriberStatusValue,
} from '@/src/schemas/crm-newsletter.schema'
import { NewsletterImportDialog } from './newsletter-import-dialog'
import {
  formatNewsletterDate,
  SUBSCRIBER_SOURCE_LABEL,
  SUBSCRIBER_STATUS_LABEL,
  SUBSCRIBER_STATUS_VARIANT,
} from './newsletter-labels'

const PAGE_SIZE = 25
const ALL = 'ALL'

function AddSubscriberDialog({
  workspaceId,
  newsletterId,
  open,
  onOpenChange,
}: {
  workspaceId: string
  newsletterId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const add = useAddCrmNewsletterSubscriber(workspaceId, newsletterId)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [sendConfirmation, setSendConfirmation] = useState(false)

  function submit(event: React.FormEvent) {
    event.preventDefault()
    add.mutate(
      {
        email: email.trim(),
        name: name.trim() || undefined,
        consentNote: note.trim() || undefined,
        sendConfirmation,
      },
      {
        onSuccess: (subscriber) => {
          notify.success(
            subscriber.status === 'PENDING'
              ? 'Enviamos o e-mail de confirmação'
              : 'Assinante adicionado',
          )
          setEmail('')
          setName('')
          setNote('')
          setSendConfirmation(false)
          onOpenChange(false)
        },
        onError: (error) => notify.error(error, 'Erro ao adicionar'),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className='flex flex-col gap-4'>
          <DialogHeader>
            <DialogTitle>Adicionar assinante</DialogTitle>
            <DialogDescription>
              Adicione só quem autorizou receber a newsletter. Se a pessoa já
              existe no CRM com este e-mail, o assinante fica ligado a ela.
            </DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='subscriber-email'>E-mail</Label>
            <Input
              id='subscriber-email'
              type='email'
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={254}
              autoFocus
            />
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='subscriber-name'>Nome (opcional)</Label>
            <Input
              id='subscriber-name'
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
            />
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='subscriber-note'>
              Como a pessoa autorizou (opcional)
            </Label>
            <Textarea
              id='subscriber-note'
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder='Ex.: pediu no estande do evento X'
            />
          </div>
          <div className='flex items-start gap-2'>
            <Checkbox
              id='subscriber-confirm'
              checked={sendConfirmation}
              onCheckedChange={(checked) =>
                setSendConfirmation(checked === true)
              }
            />
            <Label
              htmlFor='subscriber-confirm'
              className='font-normal leading-snug'
            >
              Pedir confirmação por e-mail antes de ativar
            </Label>
          </div>
          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type='submit' disabled={!email.trim() || add.isPending}>
              Adicionar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RowActions({
  subscriber,
  onResend,
  onRemove,
}: {
  subscriber: CrmNewsletterSubscriberDTO
  onResend: () => void
  onRemove: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        nativeButton
        render={
          <Button variant='ghost' size='icon-sm' aria-label='Ações'>
            <SteelIcon icon={MoreHorizontalIcon} />
          </Button>
        }
      />
      <DropdownMenuContent align='end'>
        {subscriber.status === 'PENDING' ? (
          <DropdownMenuItem onClick={onResend}>
            <SteelIcon icon={MailSend02Icon} /> Reenviar confirmação
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem variant='destructive' onClick={onRemove}>
          <SteelIcon icon={Delete02Icon} /> Remover
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** "Assinantes" tab: filters, table, add, import and export. */
export function NewsletterSubscribersTab({
  workspaceId,
  newsletter,
}: {
  workspaceId: string
  newsletter: CrmNewsletterDTO
}) {
  const [searchInput, setSearchInput] = useState('')
  const [filters, setFilters] = useState<CrmNewsletterSubscriberFilters>({
    page: 1,
    pageSize: PAGE_SIZE,
  })
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [removing, setRemoving] = useState<CrmNewsletterSubscriberDTO | null>(
    null,
  )

  const page = useCrmNewsletterSubscribers(workspaceId, newsletter.id, filters)
  const remove = useRemoveCrmNewsletterSubscriber(workspaceId, newsletter.id)
  const resend = useResendCrmNewsletterConfirmation(workspaceId, newsletter.id)
  const archived = newsletter.status === 'ARCHIVED'

  // Debounced search.
  useEffect(() => {
    const handle = setTimeout(() => {
      setFilters((current) =>
        (current.search ?? '') === searchInput.trim()
          ? current
          : { ...current, page: 1, search: searchInput.trim() || undefined },
      )
    }, 300)
    return () => clearTimeout(handle)
  }, [searchInput])

  function onResend(subscriber: CrmNewsletterSubscriberDTO) {
    resend.mutate(subscriber.id, {
      onSuccess: ({ sent }) =>
        sent
          ? notify.success('Confirmação reenviada')
          : notify.warning(
              'O provedor de e-mail recusou o envio. Tente de novo mais tarde.',
            ),
      onError: (error) => notify.error(error, 'Erro ao reenviar'),
    })
  }

  function confirmRemove() {
    if (!removing) return
    remove.mutate(removing.id, {
      onSuccess: () => {
        notify.success('Assinante removido')
        setRemoving(null)
      },
      onError: (error) => notify.error(error, 'Erro ao remover'),
    })
  }

  const data = page.data
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  return (
    <div className='flex min-w-0 flex-col gap-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex min-w-0 flex-1 flex-wrap items-center gap-2'>
          <div className='relative w-full min-w-0 sm:w-64'>
            <SteelIcon
              icon={Search01Icon}
              size={16}
              className='pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground'
            />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder='Buscar por e-mail ou nome'
              className='pl-8'
              aria-label='Buscar assinantes'
            />
          </div>
          <Select
            value={filters.status ?? ALL}
            onValueChange={(value) =>
              setFilters({
                ...filters,
                page: 1,
                status:
                  value === ALL
                    ? undefined
                    : (value as CrmNewsletterSubscriberStatusValue),
              })
            }
          >
            <SelectTrigger className='w-full sm:w-52' aria-label='Situação'>
              <SelectValue>
                {(value: string) =>
                  value === ALL
                    ? 'Todas as situações'
                    : SUBSCRIBER_STATUS_LABEL[
                        value as CrmNewsletterSubscriberStatusValue
                      ]
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas as situações</SelectItem>
              {CRM_NEWSLETTER_SUBSCRIBER_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {SUBSCRIBER_STATUS_LABEL[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.source ?? ALL}
            onValueChange={(value) =>
              setFilters({
                ...filters,
                page: 1,
                source:
                  value === ALL
                    ? undefined
                    : (value as CrmNewsletterSubscriberSourceValue),
              })
            }
          >
            <SelectTrigger className='w-full sm:w-44' aria-label='Origem'>
              <SelectValue>
                {(value: string) =>
                  value === ALL
                    ? 'Todas as origens'
                    : SUBSCRIBER_SOURCE_LABEL[
                        value as CrmNewsletterSubscriberSourceValue
                      ]
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas as origens</SelectItem>
              {CRM_NEWSLETTER_SUBSCRIBER_SOURCES.map((source) => (
                <SelectItem key={source} value={source}>
                  {SUBSCRIBER_SOURCE_LABEL[source]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            variant='outline'
            render={
              <a
                href={crmNewsletterExportUrl(workspaceId, newsletter.id)}
                download
              />
            }
          >
            <SteelIcon icon={Download04Icon} /> Exportar
          </Button>
          <Button
            variant='outline'
            disabled={archived}
            onClick={() => setImportOpen(true)}
          >
            <SteelIcon icon={Upload04Icon} /> Importar
          </Button>
          <Button disabled={archived} onClick={() => setAddOpen(true)}>
            <SteelIcon icon={UserAdd01Icon} /> Adicionar
          </Button>
        </div>
      </div>

      {archived ? (
        <p className='text-muted-foreground text-sm'>
          Newsletter arquivada: reative em Configurações para inscrever novas
          pessoas.
        </p>
      ) : null}

      {page.isLoading ? (
        <Skeleton className='h-64 w-full rounded-xl' />
      ) : !data || data.items.length === 0 ? (
        <div className='rounded-xl border border-dashed p-10 text-center text-muted-foreground text-sm'>
          {filters.search || filters.status || filters.source
            ? 'Nenhum assinante com esses filtros.'
            : 'Nenhum assinante ainda. Adicione, importe um CSV ou ligue um formulário do CRM a esta newsletter.'}
        </div>
      ) : (
        <div className='overflow-x-auto rounded-xl border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>E-mail</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Desde</TableHead>
                <TableHead>Última abertura</TableHead>
                <TableHead className='w-10' />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((subscriber) => (
                <TableRow key={subscriber.id}>
                  <TableCell className='max-w-64 truncate font-medium'>
                    {subscriber.email}
                  </TableCell>
                  <TableCell className='max-w-48 truncate'>
                    {subscriber.name ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={SUBSCRIBER_STATUS_VARIANT[subscriber.status]}
                    >
                      {SUBSCRIBER_STATUS_LABEL[subscriber.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {SUBSCRIBER_SOURCE_LABEL[subscriber.source]}
                  </TableCell>
                  <TableCell className='tabular-nums'>
                    {formatNewsletterDate(
                      subscriber.confirmedAt ?? subscriber.createdAt,
                    )}
                  </TableCell>
                  <TableCell className='tabular-nums'>
                    {formatNewsletterDate(subscriber.lastOpenedAt)}
                  </TableCell>
                  <TableCell>
                    <RowActions
                      subscriber={subscriber}
                      onResend={() => onResend(subscriber)}
                      onRemove={() => setRemoving(subscriber)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {data && data.total > PAGE_SIZE ? (
        <div className='flex items-center justify-between gap-3 text-sm'>
          <span className='text-muted-foreground'>
            {data.total.toLocaleString('pt-BR')} assinantes · página{' '}
            {filters.page} de {totalPages}
          </span>
          <div className='flex gap-2'>
            <Button
              variant='outline'
              size='sm'
              disabled={filters.page <= 1}
              onClick={() => setFilters({ ...filters, page: filters.page - 1 })}
            >
              Anterior
            </Button>
            <Button
              variant='outline'
              size='sm'
              disabled={filters.page >= totalPages}
              onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
            >
              Próxima
            </Button>
          </div>
        </div>
      ) : null}

      <AddSubscriberDialog
        workspaceId={workspaceId}
        newsletterId={newsletter.id}
        open={addOpen}
        onOpenChange={setAddOpen}
      />
      <NewsletterImportDialog
        workspaceId={workspaceId}
        newsletterId={newsletter.id}
        open={importOpen}
        onOpenChange={setImportOpen}
      />
      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover assinante?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.email} sai da newsletter e o histórico de envios dele é
              apagado. Para só parar os envios, prefira que a pessoa se
              descadastre pelo link do e-mail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              disabled={remove.isPending}
              onClick={confirmRemove}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
