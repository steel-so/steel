'use client'

import { Delete02Icon, PlusSignIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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

const PROVIDER_LABELS: Record<string, string> = {
  GMAIL: 'Gmail',
  OUTLOOK: 'Outlook',
}

export function CrmEmailSyncPanel({ workspaceId }: { workspaceId: string }) {
  return (
    <div className='flex flex-col gap-6'>
      <div
        role='note'
        className='rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm'
      >
        <p className='font-medium'>
          Esta tela é um registro manual, não uma sincronização.
        </p>
        <p className='mt-1 text-muted-foreground text-xs'>
          O Steel ainda não lê a sua caixa de entrada do Gmail ou do Outlook.
          Aqui você anota e-mails e compromissos importantes à mão, para que a
          equipe veja o histórico no CRM. Nada é enviado nem recebido a partir
          desta tela.
        </p>
      </div>
      <CrmEmailAccountsSection workspaceId={workspaceId} />
      <CrmEmailMessagesSection workspaceId={workspaceId} />
      <CrmCalendarEventsSection workspaceId={workspaceId} />
    </div>
  )
}

function CrmEmailAccountsSection({ workspaceId }: { workspaceId: string }) {
  const { data: accounts, isLoading } = useCrmEmailAccounts(workspaceId)
  const deleteAccount = useDeleteCrmEmailAccount(workspaceId)
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
              <Button variant='default' size='xs'>
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
        Registrar uma conta não conecta a caixa de entrada: serve só para
        agrupar os e-mails e eventos que você lançar manualmente.
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
                <TableCell>{PROVIDER_LABELS[account.provider] ?? account.provider}</TableCell>
                <TableCell>{account.email}</TableCell>
                <TableCell>
                  <Button
                    variant='ghost'
                    size='icon-xs'
                    aria-label={`Remover a conta ${account.email}`}
                    onClick={() => handleDelete(account.id)}
                  >
                    <SteelIcon icon={Delete02Icon} strokeWidth={2} />
                  </Button>
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
              <Button variant='default' size='xs'>
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
                    {message.direction === 'OUTBOUND' ? 'Enviado' : 'Recebido'}
                  </Badge>
                </TableCell>
                <TableCell>{message.fromEmail}</TableCell>
                <TableCell>{message.toEmails.join(', ') || '-'}</TableCell>
                <TableCell>
                  <Button
                    variant='ghost'
                    size='icon-xs'
                    onClick={() => handleDelete(message.id)}
                  >
                    <SteelIcon icon={Delete02Icon} strokeWidth={2} />
                  </Button>
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
              <Button variant='default' size='xs'>
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
                  <Button
                    variant='ghost'
                    size='icon-xs'
                    onClick={() => handleDelete(event.id)}
                  >
                    <SteelIcon icon={Delete02Icon} strokeWidth={2} />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
