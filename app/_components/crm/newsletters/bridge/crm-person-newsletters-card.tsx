'use client'

import { Mail01Icon, PlusSignIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
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
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import {
  useCrmPersonNewsletters,
  useSubscribeCrmPerson,
  useUnsubscribeCrmPerson,
} from '@/src/hooks/use-crm-person-newsletters'
import type {
  CrmPersonNewsletterSubscriptionDTO,
  CrmPersonNewslettersDTO,
} from '@/src/schemas/crm-newsletter-bridge.schema'
import {
  formatNewsletterDate,
  SUBSCRIBER_STATUS_LABEL,
  SUBSCRIBER_STATUS_VARIANT,
} from '../newsletter-labels'

function subscriptionDetail(s: CrmPersonNewsletterSubscriptionDTO): string {
  if (s.status === 'UNSUBSCRIBED') {
    return `Saiu em ${formatNewsletterDate(s.unsubscribedAt)}`
  }
  const parts = [`Desde ${formatNewsletterDate(s.confirmedAt ?? s.consentAt)}`]
  if (s.lastOpenedAt) {
    parts.push(`última abertura ${formatNewsletterDate(s.lastOpenedAt)}`)
  }
  return parts.join(' · ')
}

function SubscribeDialog({
  workspaceId,
  personId,
  data,
  open,
  onOpenChange,
}: {
  workspaceId: string
  personId: string
  data: CrmPersonNewslettersDTO
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const subscribe = useSubscribeCrmPerson(workspaceId, personId)
  const [newsletterId, setNewsletterId] = useState('')
  const [email, setEmail] = useState('')
  const [sendConfirmation, setSendConfirmation] = useState(false)
  const chosenNewsletter = newsletterId || data.available[0]?.id || ''
  const chosenEmail = email || data.emails[0] || ''
  const names = new Map(data.available.map((n) => [n.id, n.name]))

  function submit(event: React.FormEvent) {
    event.preventDefault()
    subscribe.mutate(
      { newsletterId: chosenNewsletter, email: chosenEmail, sendConfirmation },
      {
        onSuccess: (next) => {
          const row = next.subscriptions.find(
            (s) => s.newsletterId === chosenNewsletter,
          )
          notify.success(
            row?.status === 'PENDING'
              ? 'Enviamos o e-mail de confirmação'
              : 'Pessoa inscrita na newsletter',
          )
          setNewsletterId('')
          setSendConfirmation(false)
          onOpenChange(false)
        },
        onError: (error) => notify.error(error, 'Erro ao inscrever'),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className='flex flex-col gap-4'>
          <DialogHeader>
            <DialogTitle>Inscrever em uma newsletter</DialogTitle>
            <DialogDescription>
              Inscreva só se a pessoa autorizou receber a newsletter. Quem já
              tinha saído recebe um e-mail para confirmar de novo.
            </DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='person-newsletter'>Newsletter</Label>
            <Select
              value={chosenNewsletter}
              onValueChange={(value) => setNewsletterId(String(value ?? ''))}
            >
              <SelectTrigger id='person-newsletter' className='w-full'>
                <SelectValue>
                  {(value: string) => names.get(value) ?? 'Escolha'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {data.available.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {data.emails.length > 1 ? (
            <div className='flex flex-col gap-2'>
              <Label htmlFor='person-newsletter-email'>E-mail</Label>
              <Select
                value={chosenEmail}
                onValueChange={(value) => setEmail(String(value ?? ''))}
              >
                <SelectTrigger id='person-newsletter-email' className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {data.emails.map((e) => (
                    <SelectItem key={e} value={e}>
                      {e}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <p className='text-muted-foreground text-sm'>
              E-mail: <span className='text-foreground'>{chosenEmail}</span>
            </p>
          )}
          <div className='flex items-start gap-2'>
            <Checkbox
              id='person-newsletter-confirm'
              checked={sendConfirmation}
              onCheckedChange={(checked) =>
                setSendConfirmation(checked === true)
              }
            />
            <Label
              htmlFor='person-newsletter-confirm'
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
            <Button
              type='submit'
              disabled={!chosenNewsletter || subscribe.isPending}
            >
              Inscrever
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * "Newsletters" card of the CRM person (ADR 0054 phase 2): subscriptions
 * with status and the member's quick subscribe/unsubscribe. Hidden when the
 * member has no access to the newsletters (resource `email`).
 */
export function CrmPersonNewslettersCard({
  workspaceId,
  personId,
}: {
  workspaceId: string
  personId: string
}) {
  const { data, isLoading, isError } = useCrmPersonNewsletters(
    workspaceId,
    personId,
  )
  const unsubscribe = useUnsubscribeCrmPerson(workspaceId, personId)
  const [subscribing, setSubscribing] = useState(false)
  const [leaving, setLeaving] =
    useState<CrmPersonNewsletterSubscriptionDTO | null>(null)

  if (isError) return null

  function confirmLeave() {
    if (!leaving) return
    unsubscribe.mutate(leaving.subscriberId, {
      onSuccess: () => {
        notify.success('Pessoa descadastrada da newsletter')
        setLeaving(null)
      },
      onError: (error) => notify.error(error, 'Erro ao descadastrar'),
    })
  }

  const canSubscribe =
    !!data && data.emails.length > 0 && data.available.length > 0

  return (
    <section
      className='flex flex-col gap-3'
      aria-labelledby='person-newsletters-title'
    >
      <div className='flex items-center justify-between gap-2'>
        <div className='flex min-w-0 items-center gap-2'>
          <SteelIcon
            icon={Mail01Icon}
            strokeWidth={2}
            className='size-4 shrink-0 text-muted-foreground'
          />
          <span id='person-newsletters-title' className='font-medium text-sm'>
            Newsletters
          </span>
        </div>
        {canSubscribe ? (
          <Button
            size='sm'
            variant='outline'
            onClick={() => setSubscribing(true)}
          >
            <SteelIcon icon={PlusSignIcon} strokeWidth={2} size={14} />
            Inscrever
          </Button>
        ) : null}
      </div>

      {isLoading || !data ? (
        <Skeleton className='h-12 w-full' />
      ) : data.subscriptions.length === 0 ? (
        <p className='text-muted-foreground text-sm'>
          {data.emails.length === 0
            ? 'Cadastre um e-mail para inscrever esta pessoa em uma newsletter.'
            : 'Não assina nenhuma newsletter.'}
        </p>
      ) : (
        <ul className='flex flex-col divide-y divide-border rounded-lg border border-border'>
          {data.subscriptions.map((s) => (
            <li
              key={s.subscriberId}
              className='flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2'
            >
              <div className='min-w-0 flex-1'>
                <p className='truncate font-medium text-sm'>
                  {s.newsletterName}
                  {s.newsletterArchived ? (
                    <span className='font-normal text-muted-foreground'>
                      {' '}
                      (arquivada)
                    </span>
                  ) : null}
                </p>
                <p className='truncate text-muted-foreground text-xs'>
                  {s.email} · {subscriptionDetail(s)}
                </p>
              </div>
              <Badge variant={SUBSCRIBER_STATUS_VARIANT[s.status]}>
                {SUBSCRIBER_STATUS_LABEL[s.status]}
              </Badge>
              {s.canUnsubscribe ? (
                <Button size='sm' variant='ghost' onClick={() => setLeaving(s)}>
                  Descadastrar
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {data && canSubscribe ? (
        <SubscribeDialog
          workspaceId={workspaceId}
          personId={personId}
          data={data}
          open={subscribing}
          onOpenChange={setSubscribing}
        />
      ) : null}

      <AlertDialog
        open={leaving !== null}
        onOpenChange={(open) => !open && setLeaving(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descadastrar da newsletter?</AlertDialogTitle>
            <AlertDialogDescription>
              {leaving?.email} deixa de receber "{leaving?.newsletterName}". O
              histórico de envios continua no relatório. Para voltar, a pessoa
              precisa confirmar a inscrição por e-mail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              disabled={unsubscribe.isPending}
              onClick={confirmLeave}
            >
              Descadastrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
