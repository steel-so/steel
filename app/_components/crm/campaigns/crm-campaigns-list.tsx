'use client'

import {
  Add01Icon,
  Mail01Icon,
  MegaphoneIcon,
  WhatsappIcon,
} from '@hugeicons-pro/core-stroke-rounded'
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
import { notify } from '@/lib/notify'
import {
  useCreateCrmCampaign,
  useCrmCampaigns,
} from '@/src/hooks/use-crm-campaigns'
import type { CrmCampaignListItemDTO } from '@/types/crm-campaign'
import {
  CAMPAIGN_STATUS_LABEL,
  CAMPAIGN_STATUS_VARIANT,
  formatCampaignDate,
  percent,
} from './campaign-labels'

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className='min-w-0'>
      <p className='truncate text-muted-foreground text-xs'>{label}</p>
      <p className='font-semibold text-sm tabular-nums'>{value}</p>
    </div>
  )
}

function CampaignCard({
  campaign,
  slug,
}: {
  campaign: CrmCampaignListItemDTO
  slug: string
}) {
  const { kpis } = campaign
  const when =
    campaign.status === 'DRAFT'
      ? `Criada em ${formatCampaignDate(campaign.createdAt)}`
      : campaign.status === 'SCHEDULED'
        ? `Agendada para ${formatCampaignDate(campaign.startAt)}`
        : `Enviada em ${formatCampaignDate(campaign.startAt)}`
  return (
    <Link
      href={`/${slug}/crm/campaigns/${campaign.id}`}
      className='flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40'
    >
      <div className='flex items-start justify-between gap-2'>
        <div className='min-w-0'>
          <p className='truncate font-medium'>{campaign.name}</p>
          <p className='truncate text-muted-foreground text-xs'>{when}</p>
        </div>
        <Badge variant={CAMPAIGN_STATUS_VARIANT[campaign.status]}>
          {CAMPAIGN_STATUS_LABEL[campaign.status]}
        </Badge>
      </div>
      <div className='flex items-center gap-2 text-muted-foreground text-xs'>
        <span className='inline-flex items-center gap-1'>
          <SteelIcon icon={Mail01Icon} size={14} /> E-mail
        </span>
        {campaign.whatsappEnabled ? (
          <span className='inline-flex items-center gap-1'>
            <SteelIcon icon={WhatsappIcon} size={14} /> WhatsApp
          </span>
        ) : null}
      </div>
      <div className='grid grid-cols-2 gap-3'>
        <Kpi
          label='Enviados'
          value={String(kpis.emailSent + kpis.whatsappSent)}
        />
        <Kpi
          label='Abertura'
          value={percent(kpis.emailOpened, kpis.emailSent)}
        />
        <Kpi
          label='Cliques'
          value={percent(kpis.emailClicked, kpis.emailSent)}
        />
        <Kpi label='Conversões' value={String(kpis.conversions)} />
      </div>
    </Link>
  )
}

export function CrmCampaignsList({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const router = useRouter()
  const campaigns = useCrmCampaigns(workspaceId)
  const create = useCreateCrmCampaign(workspaceId)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')

  function handleCreate(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    create.mutate(name.trim(), {
      onSuccess: (campaign) => {
        setOpen(false)
        setName('')
        router.push(`/${slug}/crm/campaigns/${campaign.id}`)
      },
      onError: (error) => notify.error(error, 'Erro ao criar a campanha'),
    })
  }

  const list = campaigns.data ?? []

  return (
    <div className='flex min-w-0 flex-col gap-4 p-4 sm:p-6'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='min-w-0' data-tour='campaigns-header'>
          <h1 className='font-semibold text-lg'>Campanhas</h1>
          <p className='text-muted-foreground text-sm'>
            Leve contatos do e-mail (e do WhatsApp) até uma landing page ou
            formulário e acompanhe as conversões.
          </p>
        </div>
        <Button onClick={() => setOpen(true)} data-tour='campaigns-new'>
          <SteelIcon icon={Add01Icon} /> Nova campanha
        </Button>
      </div>

      {campaigns.isLoading ? (
        <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className='h-40 rounded-xl' />
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className='flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center'>
          <SteelIcon icon={MegaphoneIcon} size={28} className='text-primary' />
          <p className='font-medium'>Nenhuma campanha ainda</p>
          <p className='max-w-md text-muted-foreground text-sm'>
            Escolha o destino, monte o e-mail, defina o público e envie. O
            WhatsApp entra como integração opcional.
          </p>
          <Button variant='outline' onClick={() => setOpen(true)}>
            Criar a primeira campanha
          </Button>
        </div>
      ) : (
        <div
          className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'
          data-tour='campaigns-grid'
        >
          {list.map((campaign) => (
            <CampaignCard key={campaign.id} campaign={campaign} slug={slug} />
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={handleCreate} className='flex flex-col gap-4'>
            <DialogHeader>
              <DialogTitle>Nova campanha</DialogTitle>
              <DialogDescription>
                O nome vira o identificador da campanha nos links
                (utm_campaign).
              </DialogDescription>
            </DialogHeader>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='campaign-name'>Nome</Label>
              <Input
                id='campaign-name'
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder='Ex.: Black Friday 2026'
                maxLength={120}
                autoFocus
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
              <Button type='submit' disabled={!name.trim() || create.isPending}>
                Criar e continuar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
