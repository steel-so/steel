'use client'

import { Delete02Icon, PlusSignIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { useCan } from '@/app/_components/workspace/workspace-permissions'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmAction } from '@/components/ui/confirm-action'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldGroup } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { notify } from '@/lib/notify'
import {
  useCreateCrmCalendarEvent,
  useCreateCrmEmailAccount,
  useCreateCrmEmailMessage,
  useCrmCalendarEvents,
  useCrmEmailAccounts,
  useCrmEmailMessages,
  useDeleteCrmCalendarEvent,
  useDeleteCrmEmailAccount,
  useDeleteCrmEmailMessage,
} from '@/src/hooks/use-crm-email-sync'
import type {
  CrmEmailProviderDTO,
  CrmMailDirectionDTO,
} from '@/types/crm-email-sync'

export function CrmEmailSyncPanel({ workspaceId }: { workspaceId: string }) {
  return (
    <div className='flex flex-col gap-6'>
      <CrmEmailAccountsSection workspaceId={workspaceId} />
      <CrmEmailMessagesSection workspaceId={workspaceId} />
      <CrmCalendarEventsSection workspaceId={workspaceId} />
    </div>
  )
}

function CrmEmailAccountsSection({ workspaceId }: { workspaceId: string }) {
  const { data: accounts, isLoading } = useCrmEmailAccounts(workspaceId)
  const deleteAccount = useDeleteCrmEmailAccount(workspaceId)
  const canCreate = useCan('email', 'CREATE')
  const canDelete = useCan('email', 'DELETE')
  const [open, setOpen] = useState(false)
  const [provider, setProvider] = useState<CrmEmailProviderDTO>('GMAIL')
  const [email, setEmail] = useState('')
  const createAccount = useCreateCrmEmailAccount(workspaceId)

  function handleClose() {
    setOpen(false)
    setEmail('')
    createAccount.reset()
  }

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    try {
      await createAccount.mutateAsync({ provider, email })
      notify.success('Conta registrada')
      handleClose()
    } catch (err) {
      notify.error(err)
    }
  }

  async function handleDelete(accountId: string) {
    try {
      await deleteAccount.mutateAsync(accountId)
      notify.success('Conta removida')
    } catch (err) {
      notify.error(err)
    }
  }

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center justify-between'>
        <h3 className='font-medium text-sm'>Contas de e-mail</h3>
        <Dialog
          open={open}
          onOpenChange={(v) => (v ? setOpen(true) : handleClose())}
        >
          <DialogTrigger
            render={
              <Button
                variant='default'
                size='xs'
                disabled={!canCreate}
                title={
                  canCreate
                    ? undefined
                    : 'Você não tem permissão para adicionar registros de e-mail'
                }
              >
                <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
                Nova conta
              </Button>
            }
          />
          <DialogContent className='w-full sm:max-w-md'>
            <form onSubmit={handleSubmit} className='flex flex-col gap-4 p-4'>
              <FieldGroup>
                <Field>
                  <Select
                    items={[
                      { value: 'GMAIL', label: 'Gmail' },
                      { value: 'OUTLOOK', label: 'Outlook' },
                    ]}
                    value={provider}
                    onValueChange={(value) =>
                      setProvider(value as CrmEmailProviderDTO)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value='GMAIL'>Gmail</SelectItem>
                        <SelectItem value='OUTLOOK'>Outlook</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <Input
                    placeholder='E-mail'
                    type='email'
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </Field>
              </FieldGroup>
              <div className='flex justify-end gap-2'>
                <DialogClose
                  render={
                    <Button
                      variant='outline'
                      size='sm'
                      type='button'
                      onClick={handleClose}
                    >
                      Cancelar
                    </Button>
                  }
                />
                <Button
                  size='sm'
                  type='submit'
                  disabled={createAccount.isPending || !email}
                >
                  {createAccount.isPending ? 'Criando...' : 'Registrar'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <p className='text-muted-foreground text-xs'>
        Não há sincronização real com Gmail/Outlook — registre a conta para
        agrupar e-mails e eventos lançados manualmente.
      </p>
      <div className='max-h-[26rem] overflow-auto rounded-lg border border-border'>
        <Table containerClassName='overflow-x-visible'>
          <TableHeader className='sticky top-0 z-10 bg-card/85 backdrop-blur-md'>
            <TableRow>
              <TableHead>Provedor</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead className='w-10' />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!isLoading && accounts?.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={3}
                  className='text-center text-muted-foreground'
                >
                  Nenhuma conta registrada
                </TableCell>
              </TableRow>
            )}
            {accounts?.map((account) => (
              <TableRow key={account.id}>
                <TableCell>{account.provider}</TableCell>
                <TableCell>{account.email}</TableCell>
                <TableCell>
                  {canDelete ? (
                    <ConfirmAction
                      trigger={
                        <Button
                          variant='ghost'
                          size='icon-xs'
                          aria-label='Remover conta de e-mail'
                        >
                          <SteelIcon icon={Delete02Icon} strokeWidth={2} />
                        </Button>
                      }
                      title='Remover esta conta?'
                      description='A conta deixa de ser listada aqui. Não é possível desfazer.'
                      confirmLabel='Remover'
                      onConfirm={() => handleDelete(account.id)}
                    />
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function CrmEmailMessagesSection({ workspaceId }: { workspaceId: string }) {
  const { data: messages, isLoading } = useCrmEmailMessages(workspaceId)
  const deleteMessage = useDeleteCrmEmailMessage(workspaceId)
  const canCreate = useCan('email', 'CREATE')
  const canDelete = useCan('email', 'DELETE')
  const [open, setOpen] = useState(false)
  const [direction, setDirection] = useState<CrmMailDirectionDTO>('OUTBOUND')
  const [fromEmail, setFromEmail] = useState('')
  const [toEmail, setToEmail] = useState('')
  const createMessage = useCreateCrmEmailMessage(workspaceId)

  function handleClose() {
    setOpen(false)
    setFromEmail('')
    setToEmail('')
    createMessage.reset()
  }

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    try {
      await createMessage.mutateAsync({
        direction,
        fromEmail,
        toEmails: toEmail ? [toEmail] : [],
        sentAt: new Date().toISOString(),
      })
      notify.success('E-mail registrado')
      handleClose()
    } catch (err) {
      notify.error(err)
    }
  }

  async function handleDelete(messageId: string) {
    try {
      await deleteMessage.mutateAsync(messageId)
      notify.success('Registro removido')
    } catch (err) {
      notify.error(err)
    }
  }

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center justify-between'>
        <h3 className='font-medium text-sm'>E-mails registrados</h3>
        <Dialog
          open={open}
          onOpenChange={(v) => (v ? setOpen(true) : handleClose())}
        >
          <DialogTrigger
            render={
              <Button
                variant='default'
                size='xs'
                disabled={!canCreate}
                title={
                  canCreate
                    ? undefined
                    : 'Você não tem permissão para adicionar registros de e-mail'
                }
              >
                <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
                Registrar e-mail
              </Button>
            }
          />
          <DialogContent className='w-full sm:max-w-md'>
            <form onSubmit={handleSubmit} className='flex flex-col gap-4 p-4'>
              <FieldGroup>
                <Field>
                  <Select
                    items={[
                      { value: 'OUTBOUND', label: 'Enviado' },
                      { value: 'INBOUND', label: 'Recebido' },
                    ]}
                    value={direction}
                    onValueChange={(value) =>
                      setDirection(value as CrmMailDirectionDTO)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value='OUTBOUND'>Enviado</SelectItem>
                        <SelectItem value='INBOUND'>Recebido</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <Input
                    placeholder='De'
                    type='email'
                    value={fromEmail}
                    onChange={(e) => setFromEmail(e.target.value)}
                    required
                  />
                </Field>
                <Field>
                  <Input
                    placeholder='Para'
                    type='email'
                    value={toEmail}
                    onChange={(e) => setToEmail(e.target.value)}
                  />
                </Field>
              </FieldGroup>
              <div className='flex justify-end gap-2'>
                <DialogClose
                  render={
                    <Button
                      variant='outline'
                      size='sm'
                      type='button'
                      onClick={handleClose}
                    >
                      Cancelar
                    </Button>
                  }
                />
                <Button
                  size='sm'
                  type='submit'
                  disabled={createMessage.isPending || !fromEmail}
                >
                  {createMessage.isPending ? 'Salvando...' : 'Registrar'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <div className='max-h-[26rem] overflow-auto rounded-lg border border-border'>
        <Table containerClassName='overflow-x-visible'>
          <TableHeader className='sticky top-0 z-10 bg-card/85 backdrop-blur-md'>
            <TableRow>
              <TableHead>Direção</TableHead>
              <TableHead>De</TableHead>
              <TableHead>Para</TableHead>
              <TableHead className='w-10' />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!isLoading && messages?.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className='text-center text-muted-foreground'
                >
                  Nenhum e-mail registrado
                </TableCell>
              </TableRow>
            )}
            {messages?.map((message) => (
              <TableRow key={message.id}>
                <TableCell>
                  <Badge
                    variant={
                      message.direction === 'OUTBOUND' ? 'default' : 'outline'
                    }
                  >
                    {message.direction}
                  </Badge>
                </TableCell>
                <TableCell>{message.fromEmail}</TableCell>
                <TableCell>{message.toEmails.join(', ') || '-'}</TableCell>
                <TableCell>
                  {canDelete ? (
                    <ConfirmAction
                      trigger={
                        <Button
                          variant='ghost'
                          size='icon-xs'
                          aria-label='Remover e-mail'
                        >
                          <SteelIcon icon={Delete02Icon} strokeWidth={2} />
                        </Button>
                      }
                      title='Remover este e-mail?'
                      description='O registro do e-mail sai do CRM. Não é possível desfazer.'
                      confirmLabel='Remover'
                      onConfirm={() => handleDelete(message.id)}
                    />
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function CrmCalendarEventsSection({ workspaceId }: { workspaceId: string }) {
  const { data: events, isLoading } = useCrmCalendarEvents(workspaceId)
  const deleteEvent = useDeleteCrmCalendarEvent(workspaceId)
  const canCreate = useCan('email', 'CREATE')
  const canDelete = useCan('email', 'DELETE')
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const createEvent = useCreateCrmCalendarEvent(workspaceId)

  function handleClose() {
    setOpen(false)
    setTitle('')
    setStartsAt('')
    setEndsAt('')
    createEvent.reset()
  }

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    try {
      await createEvent.mutateAsync({
        title,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
      })
      notify.success('Evento criado')
      handleClose()
    } catch (err) {
      notify.error(err)
    }
  }

  async function handleDelete(eventId: string) {
    try {
      await deleteEvent.mutateAsync(eventId)
      notify.success('Evento removido')
    } catch (err) {
      notify.error(err)
    }
  }

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center justify-between'>
        <h3 className='font-medium text-sm'>Agenda</h3>
        <Dialog
          open={open}
          onOpenChange={(v) => (v ? setOpen(true) : handleClose())}
        >
          <DialogTrigger
            render={
              <Button
                variant='default'
                size='xs'
                disabled={!canCreate}
                title={
                  canCreate
                    ? undefined
                    : 'Você não tem permissão para adicionar registros de e-mail'
                }
              >
                <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
                Novo evento
              </Button>
            }
          />
          <DialogContent className='w-full sm:max-w-md'>
            <form onSubmit={handleSubmit} className='flex flex-col gap-4 p-4'>
              <FieldGroup>
                <Field>
                  <Input
                    placeholder='Título'
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                  />
                </Field>
                <Field>
                  <Input
                    type='datetime-local'
                    value={startsAt}
                    onChange={(e) => setStartsAt(e.target.value)}
                    required
                  />
                </Field>
                <Field>
                  <Input
                    type='datetime-local'
                    value={endsAt}
                    onChange={(e) => setEndsAt(e.target.value)}
                    required
                  />
                </Field>
              </FieldGroup>
              <div className='flex justify-end gap-2'>
                <DialogClose
                  render={
                    <Button
                      variant='outline'
                      size='sm'
                      type='button'
                      onClick={handleClose}
                    >
                      Cancelar
                    </Button>
                  }
                />
                <Button
                  size='sm'
                  type='submit'
                  disabled={
                    createEvent.isPending || !title || !startsAt || !endsAt
                  }
                >
                  {createEvent.isPending ? 'Criando...' : 'Criar evento'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <div className='max-h-[26rem] overflow-auto rounded-lg border border-border'>
        <Table containerClassName='overflow-x-visible'>
          <TableHeader className='sticky top-0 z-10 bg-card/85 backdrop-blur-md'>
            <TableRow>
              <TableHead>Título</TableHead>
              <TableHead>Início</TableHead>
              <TableHead>Fim</TableHead>
              <TableHead className='w-10' />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!isLoading && events?.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className='text-center text-muted-foreground'
                >
                  Nenhum evento
                </TableCell>
              </TableRow>
            )}
            {events?.map((event) => (
              <TableRow key={event.id}>
                <TableCell>{event.title}</TableCell>
                <TableCell>
                  {new Date(event.startsAt).toLocaleString()}
                </TableCell>
                <TableCell>{new Date(event.endsAt).toLocaleString()}</TableCell>
                <TableCell>
                  {canDelete ? (
                    <ConfirmAction
                      trigger={
                        <Button
                          variant='ghost'
                          size='icon-xs'
                          aria-label='Remover evento'
                        >
                          <SteelIcon icon={Delete02Icon} strokeWidth={2} />
                        </Button>
                      }
                      title='Remover este evento?'
                      description='O evento sai do calendário do CRM. Não é possível desfazer.'
                      confirmLabel='Remover'
                      onConfirm={() => handleDelete(event.id)}
                    />
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
