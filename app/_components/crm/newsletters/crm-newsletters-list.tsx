'use client'

import { Add01Icon, NewsIcon } from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import {
  useCreateCrmNewsletter,
  useCrmNewsletters,
} from '@/src/hooks/use-crm-newsletters'
import type { CrmNewsletterDTO } from '@/src/schemas/crm-newsletter.schema'
import { formatNewsletterDate } from './newsletter-labels'
import { NewsletterSenderBadge } from './newsletter-sender-badge'
import { NewsletterUsageSummary } from './newsletter-usage-summary'

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className='min-w-0'>
      <p className='truncate text-muted-foreground text-xs'>{label}</p>
      <p className='font-semibold text-sm tabular-nums'>{value}</p>
    </div>
  )
}

function NewsletterCard({
  newsletter,
  slug,
}: {
  newsletter: CrmNewsletterDTO
  slug: string
}) {
  const archived = newsletter.status === 'ARCHIVED'
  return (
    <Link
      href={`/${slug}/crm/newsletters/${newsletter.id}`}
      className='flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40'
    >
      <div className='flex items-start justify-between gap-2'>
        <div className='min-w-0'>
          <p className='truncate font-medium'>{newsletter.name}</p>
          <p className='truncate text-muted-foreground text-xs'>
            {newsletter.fromName} · {newsletter.fromEmail}
          </p>
        </div>
        <Badge variant={archived ? 'outline' : 'secondary'}>
          {archived ? 'Arquivada' : 'Ativa'}
        </Badge>
      </div>
      <div className='grid grid-cols-3 gap-3'>
        <Kpi
          label='Assinantes'
          value={newsletter.counts.active.toLocaleString('pt-BR')}
        />
        <Kpi
          label='Edições'
          value={newsletter.counts.issuesSent.toLocaleString('pt-BR')}
        />
        <Kpi
          label='Última edição'
          value={formatNewsletterDate(newsletter.lastIssueSentAt)}
        />
      </div>
      <div className='flex flex-wrap items-center gap-2'>
        <NewsletterSenderBadge
          verified={newsletter.senderVerified}
          workspaceSlug={slug}
          linked={false}
        />
        {newsletter.counts.pending > 0 ? (
          <span className='text-muted-foreground text-xs'>
            {newsletter.counts.pending.toLocaleString('pt-BR')} aguardando
            confirmação
          </span>
        ) : null}
      </div>
    </Link>
  )
}

type Draft = {
  name: string
  fromName: string
  fromEmail: string
  doubleOptIn: boolean
}

const EMPTY_DRAFT: Draft = {
  name: '',
  fromName: '',
  fromEmail: '',
  doubleOptIn: true,
}

/** CRM › Newsletters: cards with subscribers, last issue and sender state. */
export function CrmNewslettersList({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const router = useRouter()
  const newsletters = useCrmNewsletters(workspaceId)
  const create = useCreateCrmNewsletter(workspaceId)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)

  const valid =
    draft.name.trim() && draft.fromName.trim() && draft.fromEmail.includes('@')

  function handleCreate(event: React.FormEvent) {
    event.preventDefault()
    if (!valid) return
    create.mutate(
      {
        name: draft.name.trim(),
        fromName: draft.fromName.trim(),
        fromEmail: draft.fromEmail.trim(),
        doubleOptIn: draft.doubleOptIn,
      },
      {
        onSuccess: (newsletter) => {
          setOpen(false)
          setDraft(EMPTY_DRAFT)
          if (!newsletter.senderVerified) {
            notify.warning(
              'Newsletter criada. Verifique o domínio do remetente para poder enviar.',
            )
          }
          router.push(`/${slug}/crm/newsletters/${newsletter.id}`)
        },
        onError: (error) => notify.error(error, 'Erro ao criar a newsletter'),
      },
    )
  }

  const list = newsletters.data ?? []

  return (
    <div className='flex min-w-0 flex-col gap-4 p-4 sm:p-6'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='min-w-0'>
          <h1 className='font-semibold text-lg'>Newsletters</h1>
          <p className='text-muted-foreground text-sm'>
            Publicações com assinantes próprios, enviadas do domínio da sua
            empresa.
          </p>
          <NewsletterUsageSummary workspaceId={workspaceId} className='mt-1' />
        </div>
        <Button onClick={() => setOpen(true)}>
          <SteelIcon icon={Add01Icon} /> Nova newsletter
        </Button>
      </div>

      {newsletters.isLoading ? (
        <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className='h-40 rounded-xl' />
          ))}
        </div>
      ) : newsletters.isError ? (
        <p className='text-destructive text-sm'>
          Não foi possível carregar as newsletters.
        </p>
      ) : list.length === 0 ? (
        <div className='flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center'>
          <SteelIcon icon={NewsIcon} size={28} className='text-primary' />
          <p className='font-medium'>Nenhuma newsletter ainda</p>
          <p className='max-w-md text-muted-foreground text-sm'>
            Crie a newsletter, reúna os assinantes (formulário, página pública
            ou importação) e envie as edições do seu próprio domínio.
          </p>
          <Button variant='outline' onClick={() => setOpen(true)}>
            Criar a primeira newsletter
          </Button>
        </div>
      ) : (
        <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
          {list.map((newsletter) => (
            <NewsletterCard
              key={newsletter.id}
              newsletter={newsletter}
              slug={slug}
            />
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={handleCreate} className='flex flex-col gap-4'>
            <DialogHeader>
              <DialogTitle>Nova newsletter</DialogTitle>
              <DialogDescription>
                O remetente precisa ser de um domínio verificado em Ajustes ›
                Domínios de e-mail para enviar. Dá para criar antes e verificar
                depois.
              </DialogDescription>
            </DialogHeader>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='newsletter-name'>Nome</Label>
              <Input
                id='newsletter-name'
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder='Ex.: Novidades da Acme'
                maxLength={120}
                autoFocus
              />
            </div>
            <div className='grid gap-4 sm:grid-cols-2'>
              <div className='flex min-w-0 flex-col gap-2'>
                <Label htmlFor='newsletter-from-name'>Nome do remetente</Label>
                <Input
                  id='newsletter-from-name'
                  value={draft.fromName}
                  onChange={(e) =>
                    setDraft({ ...draft, fromName: e.target.value })
                  }
                  placeholder='Ex.: Acme'
                  maxLength={80}
                />
              </div>
              <div className='flex min-w-0 flex-col gap-2'>
                <Label htmlFor='newsletter-from-email'>
                  E-mail do remetente
                </Label>
                <Input
                  id='newsletter-from-email'
                  type='email'
                  value={draft.fromEmail}
                  onChange={(e) =>
                    setDraft({ ...draft, fromEmail: e.target.value })
                  }
                  placeholder='news@news.suaempresa.com.br'
                  maxLength={254}
                />
              </div>
            </div>
            <div className='flex items-start justify-between gap-3 rounded-lg border p-3'>
              <div className='min-w-0'>
                <p className='font-medium text-sm'>Confirmação dupla</p>
                <p className='text-muted-foreground text-xs'>
                  Quem se inscreve recebe um e-mail para confirmar antes de
                  entrar na lista. Recomendado.
                </p>
              </div>
              <Switch
                checked={draft.doubleOptIn}
                onCheckedChange={(checked) =>
                  setDraft({ ...draft, doubleOptIn: checked })
                }
                aria-label='Confirmação dupla'
              />
            </div>
            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                onClick={() => setOpen(false)}
              >
                Cancelar
              </Button>
              <Button type='submit' disabled={!valid || create.isPending}>
                Criar newsletter
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
