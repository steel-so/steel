'use client'

import { Mail01Icon, WhatsappIcon } from '@hugeicons-pro/core-stroke-rounded'
import { LEAD_STAGES, STAGE_LABELS } from '@/app/_components/crm/crm-lead-stage'
import { SteelIcon } from '@/components/icon/icon'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useCrmCampaignAudiencePreview } from '@/src/hooks/use-crm-campaigns'
import type {
  CrmCampaignAudiencePreviewDTO,
  CrmCampaignLegalBasisDTO,
  CrmCampaignOptionsDTO,
} from '@/types/crm-campaign'
import type { CampaignDraft, DraftChange } from './campaign-draft'
import { LEGAL_BASIS_LABEL } from './campaign-labels'

const STAGES = LEAD_STAGES
const LEGAL_BASIS_ITEMS = (
  Object.keys(LEGAL_BASIS_LABEL) as CrmCampaignLegalBasisDTO[]
).map((value) => ({ value, label: LEGAL_BASIS_LABEL[value] }))

/** Reach per channel — opt-outs and contacts without the channel apart. */
export function CampaignAudienceCounts({
  counts,
  whatsappEnabled,
  loading,
}: {
  counts: CrmCampaignAudiencePreviewDTO | undefined
  whatsappEnabled: boolean
  loading: boolean
}) {
  if (loading) return <Skeleton className='h-28 rounded-xl' />
  const total = counts?.total ?? 0
  const rows = [
    { key: 'email', label: 'E-mail', icon: Mail01Icon, reach: counts?.email },
    ...(whatsappEnabled
      ? [
          {
            key: 'whatsapp',
            label: 'WhatsApp',
            icon: WhatsappIcon,
            reach: counts?.whatsapp,
          },
        ]
      : []),
  ]
  return (
    <section
      aria-label='Alcance do público'
      className='flex flex-col gap-3 rounded-xl border bg-muted/30 p-4'
    >
      <p className='text-sm'>
        <span className='font-semibold text-2xl tabular-nums'>{total}</span>{' '}
        <span className='text-muted-foreground'>contato(s) no público</span>
      </p>
      <ul className='flex flex-col gap-2'>
        {rows.map((row) => (
          <li
            key={row.key}
            className='flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm'
          >
            <span className='inline-flex items-center gap-2 font-medium'>
              <SteelIcon icon={row.icon} size={16} /> {row.label}
            </span>
            <span className='text-muted-foreground'>
              <strong className='text-foreground tabular-nums'>
                {row.reach?.reachable ?? 0}
              </strong>{' '}
              alcançáveis · {row.reach?.optedOut ?? 0} descadastrados ·{' '}
              {row.reach?.missing ?? 0} sem{' '}
              {row.key === 'email' ? 'e-mail' : 'WhatsApp'}
            </span>
          </li>
        ))}
      </ul>
      <p className='text-muted-foreground text-xs'>
        Descadastrados (LGPD) nunca recebem — nem se saírem depois do envio
        começar.
      </p>
    </section>
  )
}

export function CampaignAudienceStep({
  workspaceId,
  draft,
  onChange,
  options,
}: {
  workspaceId: string
  draft: CampaignDraft
  onChange: DraftChange
  options: CrmCampaignOptionsDTO
}) {
  const preview = useCrmCampaignAudiencePreview(
    workspaceId,
    draft.audience,
    draft.whatsappEnabled,
  )
  const { audience } = draft

  function toggleList(id: string, checked: boolean) {
    const ids = checked
      ? [...audience.mailingListIds, id]
      : audience.mailingListIds.filter((x) => x !== id)
    onChange({ audience: { ...audience, mailingListIds: ids } })
  }

  function toggleStage(stage: string, checked: boolean) {
    const stages = checked
      ? [...audience.leadStages, stage]
      : audience.leadStages.filter((x) => x !== stage)
    onChange({ audience: { ...audience, leadStages: stages } })
  }

  return (
    <div
      className='grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]'
      data-tour='campaign-audience'
    >
      <div className='flex min-w-0 flex-col gap-6'>
        <fieldset className='flex flex-col gap-3'>
          <legend className='mb-2 font-medium text-sm'>Listas de e-mail</legend>
          {options.mailingLists.length === 0 ? (
            <p className='text-muted-foreground text-sm'>
              Nenhuma lista criada. Use as pessoas ou os leads abaixo.
            </p>
          ) : (
            options.mailingLists.map((list) => (
              <Label
                key={list.id}
                className='flex items-center gap-2 font-normal'
              >
                <Checkbox
                  checked={audience.mailingListIds.includes(list.id)}
                  onCheckedChange={(checked) =>
                    toggleList(list.id, checked === true)
                  }
                />
                {list.name}
              </Label>
            ))
          )}
        </fieldset>

        <Label className='flex items-center justify-between gap-4 font-normal'>
          <span>
            <span className='block font-medium'>Todas as pessoas do CRM</span>
            <span className='text-muted-foreground text-xs'>
              O primeiro e-mail e o primeiro telefone de cada pessoa.
            </span>
          </span>
          <Switch
            checked={audience.allPeople}
            onCheckedChange={(checked) =>
              onChange({ audience: { ...audience, allPeople: checked } })
            }
          />
        </Label>

        <fieldset className='flex flex-col gap-2'>
          <legend className='mb-2 font-medium text-sm'>Leads por etapa</legend>
          <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
            {STAGES.map((stage) => (
              <Label
                key={stage}
                className='flex items-center gap-2 font-normal'
              >
                <Checkbox
                  checked={audience.leadStages.includes(stage)}
                  onCheckedChange={(checked) =>
                    toggleStage(stage, checked === true)
                  }
                />
                {STAGE_LABELS[stage]}
              </Label>
            ))}
          </div>
        </fieldset>

        <div className='flex flex-col gap-2'>
          <Label htmlFor='legal-basis'>Base legal (LGPD)</Label>
          <Select
            items={LEGAL_BASIS_ITEMS}
            value={draft.emailLegalBasis}
            onValueChange={(value) =>
              onChange({
                emailLegalBasis: value as CrmCampaignLegalBasisDTO,
                whatsappLegalBasis: value as CrmCampaignLegalBasisDTO,
              })
            }
          >
            <SelectTrigger id='legal-basis' className='w-full'>
              <SelectValue placeholder='Escolha a base legal' />
            </SelectTrigger>
            <SelectContent>
              {LEGAL_BASIS_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className='text-muted-foreground text-xs'>
            Por que você pode falar com estas pessoas. Vale para todos os
            canais da campanha e fica registrada com quem confirmou e quando.
          </p>
        </div>
      </div>

      <CampaignAudienceCounts
        counts={preview.data}
        whatsappEnabled={draft.whatsappEnabled}
        loading={preview.isLoading}
      />
    </div>
  )
}
