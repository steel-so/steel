'use client'

import { Download01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useWhatsAppAdReport,
  whatsappAdExportUrl,
} from '@/src/hooks/use-whatsapp-ads'
import {
  COST_PRESET_LABELS,
  type CostPreset,
  presetRange,
} from '../costs/whatsapp-costs-format'
import { WhatsAppAdsSettings } from './whatsapp-ads-settings'
import { WhatsAppAdSpends } from './whatsapp-ads-spends'
import { AdTable, AdTotals } from './whatsapp-ads-table'

const PRESETS = Object.keys(COST_PRESET_LABELS) as CostPreset[]

/**
 * "Anúncios" tab of the zap reports: funnel and ROI of the Click-to-WhatsApp
 * ads, typed spend and the opt-in. OWNER/ADMIN only (the API refuses the
 * rest): it shows money.
 */
export function WhatsAppAdsTab({ workspaceId }: { workspaceId: string }) {
  const [range, setRange] = useState(() => presetRange('month'))
  const [preset, setPreset] = useState<CostPreset | 'custom'>('month')
  const {
    data: report,
    isLoading,
    error,
  } = useWhatsAppAdReport(workspaceId, range)

  function choosePreset(next: CostPreset) {
    setPreset(next)
    setRange(presetRange(next))
  }

  function changeDate(key: 'from' | 'to', value: string) {
    if (!value) return
    setPreset('custom')
    setRange((current) => ({ ...current, [key]: value }))
  }

  return (
    <div className='space-y-4 p-6'>
      <div>
        <h3 className='font-medium text-sm'>Anúncios Click-to-WhatsApp</h3>
        <p className='text-muted-foreground text-xs'>
          Quantas conversas, leads e vendas cada anúncio trouxe e quanto
          retornou sobre o que foi gasto. A receita é o valor fechado dos leads
          ganhos no CRM.
        </p>
      </div>

      <div className='flex flex-wrap items-end gap-3'>
        <fieldset className='m-0 flex min-w-0 flex-wrap gap-1.5 border-0 p-0'>
          <legend className='sr-only'>Período</legend>
          {PRESETS.map((key) => (
            <Button
              key={key}
              type='button'
              size='sm'
              variant={preset === key ? 'default' : 'outline'}
              aria-pressed={preset === key}
              onClick={() => choosePreset(key)}
            >
              {COST_PRESET_LABELS[key]}
            </Button>
          ))}
        </fieldset>
        <div className='space-y-1'>
          <Label htmlFor='adsFrom' className='text-xs'>
            De
          </Label>
          <Input
            id='adsFrom'
            type='date'
            value={range.from}
            max={range.to}
            onChange={(event) => changeDate('from', event.target.value)}
          />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='adsTo' className='text-xs'>
            Até
          </Label>
          <Input
            id='adsTo'
            type='date'
            value={range.to}
            min={range.from}
            onChange={(event) => changeDate('to', event.target.value)}
          />
        </div>
        <Button
          type='button'
          size='sm'
          variant='outline'
          className='ml-auto'
          render={<a href={whatsappAdExportUrl(workspaceId, range)} download />}
        >
          <SteelIcon icon={Download01Icon} />
          Exportar CSV
        </Button>
      </div>

      {isLoading ? (
        <div className='space-y-3' aria-busy>
          <Skeleton className='h-24 w-full rounded-xl' />
          <Skeleton className='h-48 w-full rounded-xl' />
        </div>
      ) : report ? (
        <div className='space-y-4'>
          <AdTotals report={report} />
          <AdTable report={report} />
        </div>
      ) : (
        <p className='text-destructive text-sm'>
          {error instanceof Error
            ? error.message
            : 'Não foi possível carregar o relatório de anúncios.'}
        </p>
      )}

      <WhatsAppAdSpends
        workspaceId={workspaceId}
        knownAds={(report?.rows ?? []).map((row) => ({
          sourceId: row.sourceId,
          name: row.name,
        }))}
      />
      <WhatsAppAdsSettings workspaceId={workspaceId} />
    </div>
  )
}
