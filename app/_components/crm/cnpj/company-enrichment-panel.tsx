'use client'

import { RefreshIcon, Search01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import {
  useCrmCompanyEnrichment,
  useEnrichCrmCompany,
} from '@/src/hooks/use-crm-cnpj-enrichment'
import { isValidCnpj } from '@/src/lib/crm-cnpj'
import type { CrmCompanyEnrichmentDTO } from '@/types/crm-cnpj'
import {
  appliedSummary,
  formatBrl,
  formatCnae,
  formatIsoDate,
  formatMoment,
  SIZE_LABELS,
} from './cnpj-labels'

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className='flex min-w-0 flex-col gap-0.5'>
      <dt className='text-muted-foreground text-xs'>{label}</dt>
      <dd className='break-words text-sm'>{value}</dd>
    </div>
  )
}

function Profile({ data }: { data: CrmCompanyEnrichmentDTO }) {
  return (
    <div className='flex flex-col gap-3'>
      <dl className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
        <Field label='Razão social' value={data.legalName} />
        <Field label='Nome fantasia' value={data.tradeName} />
        <Field label='Situação cadastral' value={data.registrationStatus} />
        <Field label='Abertura' value={formatIsoDate(data.openedAt)} />
        <Field
          label='Porte'
          value={data.size ? SIZE_LABELS[data.size] : null}
        />
        <Field label='Natureza jurídica' value={data.legalNature} />
        <Field label='Capital social' value={formatBrl(data.shareCapital)} />
        <Field
          label='CNAE principal'
          value={
            data.cnaeCode
              ? `${formatCnae(data.cnaeCode)}${data.cnaeDescription ? ` · ${data.cnaeDescription}` : ''}`
              : null
          }
        />
      </dl>

      {data.secondaryCnaes.length > 0 ? (
        <details className='text-sm'>
          <summary className='cursor-pointer text-muted-foreground text-xs'>
            CNAEs secundários ({data.secondaryCnaes.length})
          </summary>
          <ul className='mt-1.5 flex flex-col gap-1'>
            {data.secondaryCnaes.map((cnae) => (
              <li key={cnae.code} className='break-words'>
                {formatCnae(cnae.code)}
                {cnae.description ? ` · ${cnae.description}` : ''}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {data.partners.length > 0 ? (
        <div className='flex flex-col gap-1.5'>
          <span className='text-muted-foreground text-xs'>
            Sócios e administradores ({data.partners.length})
          </span>
          <ul className='flex flex-col gap-1'>
            {data.partners.map((partner) => (
              <li
                key={`${partner.name}-${partner.enteredAt ?? ''}`}
                className='flex flex-wrap items-baseline gap-x-2 text-sm'
              >
                <span className='break-words font-medium'>{partner.name}</span>
                {partner.qualification ? (
                  <span className='text-muted-foreground text-xs'>
                    {partner.qualification}
                  </span>
                ) : null}
                {partner.enteredAt ? (
                  <span className='text-muted-foreground text-xs'>
                    desde {formatIsoDate(partner.enteredAt)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className='text-muted-foreground text-xs'>
        Consultado em {formatMoment(data.fetchedAt)} · Receita Federal
      </p>
    </div>
  )
}

/**
 * "Dados da Receita" in the company side panel: razão social, CNAE, porte,
 * sócios, and the button that fetches (or refreshes) them from the CNPJ.
 */
export function CompanyEnrichmentPanel({
  workspaceId,
  companyId,
  cnpj,
  canEdit,
  onApplied,
}: {
  workspaceId: string
  companyId: string
  cnpj: string | null
  canEdit: boolean
  /** Reloads the list: the enrichment may have filled name/address. */
  onApplied: () => void
}) {
  const enrichment = useCrmCompanyEnrichment(workspaceId, companyId)
  const enrich = useEnrichCrmCompany(workspaceId, companyId, onApplied)
  const [overwrite, setOverwrite] = useState(false)
  const hasCnpj = cnpj !== null && isValidCnpj(cnpj)

  function run() {
    enrich.mutate(
      { overwrite },
      {
        onSuccess: (result) => notify.success(appliedSummary(result.applied)),
        onError: (error) => notify.error(error.message),
      },
    )
  }

  return (
    <section className='flex flex-col gap-3 rounded-lg border p-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h3 className='font-medium text-sm'>Dados da Receita</h3>
        {canEdit && hasCnpj ? (
          <Button
            size='sm'
            variant='outline'
            onClick={run}
            disabled={enrich.isPending}
          >
            <SteelIcon
              icon={enrichment.data ? RefreshIcon : Search01Icon}
              strokeWidth={2}
            />
            {enrich.isPending
              ? 'Consultando…'
              : enrichment.data
                ? 'Atualizar da Receita'
                : 'Buscar na Receita'}
          </Button>
        ) : null}
      </div>

      {!hasCnpj ? (
        <p className='text-muted-foreground text-sm'>
          {cnpj
            ? 'O CNPJ desta empresa é inválido. Corrija-o para buscar os dados na Receita.'
            : 'Informe o CNPJ da empresa para preencher razão social, CNAE, porte e sócios.'}
        </p>
      ) : enrichment.isLoading ? (
        <div className='flex flex-col gap-2'>
          <Skeleton className='h-4 w-2/3' />
          <Skeleton className='h-4 w-1/2' />
        </div>
      ) : enrichment.error ? (
        <p role='alert' className='text-destructive text-sm'>
          {enrichment.error.message}
        </p>
      ) : enrichment.data ? (
        <Profile data={enrichment.data} />
      ) : (
        <p className='text-muted-foreground text-sm'>
          Ainda não consultado. Busque o CNPJ na Receita para preencher razão
          social, CNAE, porte e sócios.
        </p>
      )}

      {canEdit && hasCnpj ? (
        <div className='flex items-center gap-2'>
          <Switch
            id={`cnpj-overwrite-${companyId}`}
            checked={overwrite}
            onCheckedChange={setOverwrite}
          />
          <Label
            htmlFor={`cnpj-overwrite-${companyId}`}
            className='font-normal text-muted-foreground text-xs'
          >
            Substituir nome e endereço já preenchidos
          </Label>
        </div>
      ) : null}
    </section>
  )
}
