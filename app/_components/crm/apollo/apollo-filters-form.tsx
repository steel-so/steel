'use client'

import type { ReactNode } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { ApolloSearchFiltersDTO } from '@/src/schemas/crm-apollo.schema'
import {
  EMAIL_STATUS_OPTIONS,
  EMPLOYEE_RANGE_OPTIONS,
  SENIORITY_OPTIONS,
} from './apollo-labels'
import { ApolloTagInput } from './apollo-tag-input'

function Field({
  id,
  label,
  hint,
  children,
  className,
}: {
  id: string
  label: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className ?? ''}`}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className='text-muted-foreground text-xs'>{hint}</p> : null}
    </div>
  )
}

function CheckboxGroup({
  legend,
  options,
  value,
  onChange,
  prefix,
}: {
  legend: string
  options: readonly { value: string; label: string }[]
  value: string[]
  onChange: (next: string[]) => void
  prefix: string
}) {
  return (
    <fieldset className='flex min-w-0 flex-col gap-2'>
      <legend className='mb-1 font-medium text-sm'>{legend}</legend>
      <div className='grid grid-cols-2 gap-x-3 gap-y-2'>
        {options.map((option) => {
          const id = `${prefix}-${option.value.replace(/\W+/g, '-')}`
          return (
            <div key={option.value} className='flex min-w-0 items-center gap-2'>
              <Checkbox
                id={id}
                checked={value.includes(option.value)}
                onCheckedChange={(checked) =>
                  onChange(
                    checked
                      ? [...value, option.value]
                      : value.filter((v) => v !== option.value),
                  )
                }
              />
              <Label htmlFor={id} className='min-w-0 truncate font-normal'>
                {option.label}
              </Label>
            </div>
          )
        })}
      </div>
    </fieldset>
  )
}

/** Filters of the Apollo people search, all in pt-BR. */
export function ApolloFiltersForm({
  value,
  onChange,
}: {
  value: ApolloSearchFiltersDTO
  onChange: (next: ApolloSearchFiltersDTO) => void
}) {
  const set = <K extends keyof ApolloSearchFiltersDTO>(
    key: K,
    next: ApolloSearchFiltersDTO[K],
  ) => onChange({ ...value, [key]: next })

  return (
    <div className='grid min-w-0 gap-4 md:grid-cols-2'>
      <div className='flex min-w-0 flex-col gap-3'>
        <Field
          id='apollo-titles'
          label='Cargos'
          hint='Digite e tecle Enter. Ex.: Diretor de TI, CTO'
        >
          <ApolloTagInput
            id='apollo-titles'
            value={value.personTitles}
            onChange={(next) => set('personTitles', next)}
            placeholder='Adicionar cargo'
          />
        </Field>
        <div className='flex items-center gap-2'>
          <Switch
            id='apollo-similar'
            checked={value.includeSimilarTitles}
            onCheckedChange={(checked) => set('includeSimilarTitles', checked)}
          />
          <Label htmlFor='apollo-similar' className='font-normal'>
            Incluir cargos semelhantes
          </Label>
        </div>
        <CheckboxGroup
          legend='Senioridade'
          prefix='apollo-seniority'
          options={SENIORITY_OPTIONS}
          value={value.seniorities}
          onChange={(next) => set('seniorities', next)}
        />
      </div>
      <div className='flex min-w-0 flex-col gap-3'>
        <Field
          id='apollo-person-locations'
          label='Localização da pessoa'
          hint='Em inglês, como a Apollo grava: "Brazil", "São Paulo, Brazil"'
        >
          <ApolloTagInput
            id='apollo-person-locations'
            value={value.personLocations}
            onChange={(next) => set('personLocations', next)}
            placeholder='Adicionar localização'
          />
        </Field>
        <Field id='apollo-org-locations' label='Localização da empresa'>
          <ApolloTagInput
            id='apollo-org-locations'
            value={value.organizationLocations}
            onChange={(next) => set('organizationLocations', next)}
            placeholder='Adicionar localização'
          />
        </Field>
        <Field
          id='apollo-domains'
          label='Domínios da empresa'
          hint='Ex.: empresa.com.br'
        >
          <ApolloTagInput
            id='apollo-domains'
            value={value.organizationDomains}
            onChange={(next) => set('organizationDomains', next)}
            placeholder='Adicionar domínio'
          />
        </Field>
        <Field id='apollo-keywords' label='Palavras-chave'>
          <Input
            id='apollo-keywords'
            value={value.keywords}
            maxLength={200}
            placeholder='Ex.: telecom, ISP, SaaS'
            onChange={(event) => set('keywords', event.target.value)}
          />
        </Field>
      </div>
      <CheckboxGroup
        legend='Tamanho da empresa (funcionários)'
        prefix='apollo-size'
        options={EMPLOYEE_RANGE_OPTIONS}
        value={value.employeeRanges}
        onChange={(next) => set('employeeRanges', next)}
      />
      <CheckboxGroup
        legend='Status do e-mail'
        prefix='apollo-email-status'
        options={EMAIL_STATUS_OPTIONS}
        value={value.emailStatuses}
        onChange={(next) => set('emailStatuses', next)}
      />
    </div>
  )
}
