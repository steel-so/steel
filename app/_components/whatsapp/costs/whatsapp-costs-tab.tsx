'use client'

import { Download01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useWhatsAppCostSettings,
  useWhatsAppCosts,
  whatsappCostExportUrl,
} from '@/src/hooks/use-whatsapp-costs'
import { CostBreakdowns } from './whatsapp-costs-breakdowns'
import {
  COST_PRESET_LABELS,
  type CostPreset,
  presetRange,
} from './whatsapp-costs-format'
import { CostProviders } from './whatsapp-costs-providers'
import { WhatsAppCostsSettings } from './whatsapp-costs-settings'
import { CostBudgetCard, CostTotals, CostTrend } from './whatsapp-costs-summary'

const ALL_CONNECTIONS = 'all'
const PRESETS = Object.keys(COST_PRESET_LABELS) as CostPreset[]

/**
 * "Custos" tab of the zap reports (ADR 0050): spend estimate for Meta and
 * Z-API, OWNER/ADMIN only (the API refuses everyone else).
 */
export function WhatsAppCostsTab({ workspaceId }: { workspaceId: string }) {
  const [range, setRange] = useState(() => presetRange('month'))
  const [preset, setPreset] = useState<CostPreset | 'custom'>('month')
  const [connectionId, setConnectionId] = useState(ALL_CONNECTIONS)

  const filters = {
    ...range,
    ...(connectionId === ALL_CONNECTIONS ? {} : { connectionId }),
  }
  const connections =
    useWhatsAppCostSettings(workspaceId).data?.connections ?? []
  const {
    data: report,
    isLoading,
    error,
  } = useWhatsAppCosts(workspaceId, filters)

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
        <h3 className='font-medium text-sm'>Custos</h3>
        <p className='text-muted-foreground text-xs'>
          Estimativa do gasto com WhatsApp. Os valores da Meta são calculados
          pela tabela de preços abaixo; confira sempre a fatura da Meta. O
          histórico começa na data em que este recurso foi ativado.
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
          <Label htmlFor='costFrom' className='text-xs'>
            De
          </Label>
          <Input
            id='costFrom'
            type='date'
            value={range.from}
            max={range.to}
            onChange={(event) => changeDate('from', event.target.value)}
          />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='costTo' className='text-xs'>
            Até
          </Label>
          <Input
            id='costTo'
            type='date'
            value={range.to}
            min={range.from}
            onChange={(event) => changeDate('to', event.target.value)}
          />
        </div>
        {connections.length > 0 ? (
          <div className='space-y-1'>
            <Label htmlFor='costConnection' className='text-xs'>
              Conexão
            </Label>
            <Select
              value={connectionId}
              onValueChange={(value) =>
                setConnectionId(value ?? ALL_CONNECTIONS)
              }
            >
              <SelectTrigger id='costConnection' className='w-48'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  <SelectItem value={ALL_CONNECTIONS}>Todas</SelectItem>
                  {connections.map((row) => (
                    <SelectItem key={row.id} value={row.id}>
                      {row.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <Button
          type='button'
          size='sm'
          variant='outline'
          className='ml-auto'
          render={
            <a href={whatsappCostExportUrl(workspaceId, filters)} download />
          }
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
          <CostTotals report={report} />
          <div className='grid gap-4 lg:grid-cols-2'>
            <CostBudgetCard report={report} />
            <CostTrend report={report} />
          </div>
          <CostProviders report={report} />
          <CostBreakdowns report={report} />
        </div>
      ) : (
        <p className='text-destructive text-sm'>
          {error instanceof Error
            ? error.message
            : 'Não foi possível carregar a análise de custos.'}
        </p>
      )}

      <WhatsAppCostsSettings workspaceId={workspaceId} />
    </div>
  )
}
