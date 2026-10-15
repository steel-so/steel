'use client'

import { Add01Icon, Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { type ReactNode, useEffect, useId, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  SITE_BUSINESS_TYPES,
  type SiteBusinessProfileDTO,
  SiteBusinessProfileSchema,
  type SiteBusinessType,
  WEEK_DAYS,
} from '@/src/schemas/site-search.schema'
import { MediaPickButton } from '../media-pick-button'

export const BUSINESS_TYPE_LABELS: Record<SiteBusinessType, string> = {
  Organization: 'Empresa (sem atendimento no local)',
  LocalBusiness: 'Negócio local',
  ProfessionalService: 'Serviço profissional',
  MedicalBusiness: 'Clínica ou consultório',
  Dentist: 'Odontologia',
  LegalService: 'Advocacia',
  AccountingService: 'Contabilidade',
  FinancialService: 'Serviço financeiro',
  RealEstateAgent: 'Imobiliária',
  Store: 'Loja',
  Restaurant: 'Restaurante',
  BeautySalon: 'Salão de beleza',
  AutomotiveBusiness: 'Automotivo',
  EducationalOrganization: 'Escola ou curso',
  HomeAndConstructionBusiness: 'Casa e construção',
  SportsActivityLocation: 'Academia ou esporte',
  TravelAgency: 'Agência de viagens',
}

const DAY_LABELS: Record<(typeof WEEK_DAYS)[number], string> = {
  Monday: 'Seg',
  Tuesday: 'Ter',
  Wednesday: 'Qua',
  Thursday: 'Qui',
  Friday: 'Sex',
  Saturday: 'Sáb',
  Sunday: 'Dom',
}

/** Form state: every text as a string (lists one per line). */
interface Draft {
  type: SiteBusinessType | ''
  name: string
  legalName: string
  description: string
  category: string
  phone: string
  email: string
  street: string
  district: string
  city: string
  region: string
  postalCode: string
  latitude: string
  longitude: string
  serviceArea: string
  foundingYear: string
  logoUrl: string
  sameAs: string
  priceRange: string
  hours: Array<{ days: string[]; opens: string; closes: string }>
  people: Array<{ name: string; role: string; url: string }>
}

export function toDraft(profile: SiteBusinessProfileDTO): Draft {
  return {
    type: profile.type ?? '',
    name: profile.name ?? '',
    legalName: profile.legalName ?? '',
    description: profile.description ?? '',
    category: profile.category ?? '',
    phone: profile.phone ?? '',
    email: profile.email ?? '',
    street: profile.address?.street ?? '',
    district: profile.address?.district ?? '',
    city: profile.address?.city ?? '',
    region: profile.address?.region ?? '',
    postalCode: profile.address?.postalCode ?? '',
    latitude: profile.geo ? String(profile.geo.latitude) : '',
    longitude: profile.geo ? String(profile.geo.longitude) : '',
    serviceArea: (profile.serviceArea ?? []).join('\n'),
    foundingYear: profile.foundingYear ? String(profile.foundingYear) : '',
    logoUrl: profile.logoUrl ?? '',
    sameAs: (profile.sameAs ?? []).join('\n'),
    priceRange: profile.priceRange ?? '',
    hours: (profile.hours ?? []).map((slot) => ({
      ...slot,
      days: [...slot.days],
    })),
    people: (profile.people ?? []).map((person) => ({
      name: person.name,
      role: person.role ?? '',
      url: person.url ?? '',
    })),
  }
}

const opt = (value: string) => value.trim() || undefined
const lines = (value: string) => {
  const list = value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  return list.length ? list : undefined
}

/** Draft → profile (validated by the caller with the schema). */
export function fromDraft(draft: Draft): Record<string, unknown> {
  const address = {
    street: opt(draft.street),
    district: opt(draft.district),
    city: opt(draft.city),
    region: opt(draft.region),
    postalCode: opt(draft.postalCode),
  }
  const hasAddress = Object.values(address).some(Boolean)
  const hasGeo = draft.latitude.trim() && draft.longitude.trim()
  const hours = draft.hours.filter((slot) => slot.days.length)
  const people = draft.people
    .filter((person) => person.name.trim())
    .map((person) => ({
      name: person.name.trim(),
      role: opt(person.role),
      url: opt(person.url),
    }))
  return {
    type: draft.type || undefined,
    name: opt(draft.name),
    legalName: opt(draft.legalName),
    description: opt(draft.description),
    category: opt(draft.category),
    phone: opt(draft.phone),
    email: opt(draft.email),
    address: hasAddress ? address : undefined,
    geo: hasGeo
      ? { latitude: Number(draft.latitude), longitude: Number(draft.longitude) }
      : undefined,
    hours: hours.length ? hours : undefined,
    serviceArea: lines(draft.serviceArea),
    foundingYear: draft.foundingYear.trim()
      ? Number(draft.foundingYear)
      : undefined,
    logoUrl: opt(draft.logoUrl),
    sameAs: lines(draft.sameAs),
    people: people.length ? people : undefined,
    priceRange: opt(draft.priceRange),
  }
}

/** pt-BR message of the first invalid field. */
const FIELD_NAMES: Record<string, string> = {
  email: 'E-mail',
  logoUrl: 'Logo',
  sameAs: 'Perfis oficiais',
  geo: 'Coordenadas',
  foundingYear: 'Ano de fundação',
  hours: 'Horário',
  people: 'Pessoas',
}

function Field({
  label,
  htmlFor,
  hint,
  children,
  wide,
}: {
  label: string
  htmlFor: string
  hint?: string
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div className={wide ? 'grid gap-1.5 sm:col-span-2' : 'grid gap-1.5'}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className='text-muted-foreground text-xs'>{hint}</p> : null}
    </div>
  )
}

/**
 * "Perfil do negócio": the facts every engine uses (name, address, phone,
 * hours, profiles, people). Feeds the Organization/LocalBusiness of every
 * page and the "Fatos" of llms.txt.
 */
export function BusinessProfileForm({
  profile,
  prefilled,
  workspaceId,
  canEdit,
  onSave,
}: {
  profile: SiteBusinessProfileDTO
  prefilled: boolean
  workspaceId: string
  canEdit: boolean
  onSave: (profile: SiteBusinessProfileDTO) => Promise<boolean>
}) {
  const id = useId()
  const [draft, setDraft] = useState(() => toDraft(profile))
  const [saving, setSaving] = useState(false)
  useEffect(() => setDraft(toDraft(profile)), [profile])
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const parsed = SiteBusinessProfileSchema.safeParse(fromDraft(draft))
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const field = FIELD_NAMES[String(issue.path[0])] ?? 'Um campo'
      notify.error(`${field}: ${issue.message}`)
      return
    }
    setSaving(true)
    await onSave(parsed.data)
    setSaving(false)
  }

  const text = (
    key: keyof Draft,
    label: string,
    extra: {
      hint?: string
      placeholder?: string
      wide?: boolean
      type?: string
    } = {},
  ) => (
    <Field
      label={label}
      htmlFor={`${id}-${key}`}
      hint={extra.hint}
      wide={extra.wide}
    >
      <Input
        id={`${id}-${key}`}
        type={extra.type}
        value={draft[key] as string}
        placeholder={extra.placeholder}
        onChange={(event) => set(key, event.target.value as never)}
      />
    </Field>
  )

  return (
    <form
      onSubmit={submit}
      className='grid gap-6'
      data-testid='business-profile'
    >
      {prefilled ? (
        <p className='rounded-md border bg-muted/40 px-3 py-2 text-muted-foreground text-sm'>
          Rascunho montado com os dados do workspace, da marca de e-mail e do
          SEO do site. Revise e salve.
        </p>
      ) : null}
      <fieldset
        disabled={!canEdit}
        className='m-0 grid min-w-0 gap-6 border-0 p-0'
      >
        <section className='grid gap-4 sm:grid-cols-2'>
          <h3 className='font-medium text-sm sm:col-span-2'>Identidade</h3>
          {text('name', 'Nome da marca', {
            placeholder: 'Como as pessoas buscam',
          })}
          {text('legalName', 'Razão social')}
          <Field label='Tipo de negócio' htmlFor={`${id}-type`}>
            <Select
              value={draft.type || null}
              onValueChange={(value) =>
                set(
                  'type',
                  (typeof value === 'string' ? value : '') as Draft['type'],
                )
              }
            >
              <SelectTrigger id={`${id}-type`} className='w-full'>
                <SelectValue placeholder='Escolha'>
                  {(value: string | null) =>
                    value
                      ? BUSINESS_TYPE_LABELS[value as SiteBusinessType]
                      : 'Escolha'
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {SITE_BUSINESS_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {BUSINESS_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {text('category', 'Categoria', {
            placeholder: 'Ex.: Clínica odontológica',
          })}
          <Field
            label='Descrição'
            htmlFor={`${id}-description`}
            hint='Duas ou três frases: o que faz, para quem e o diferencial.'
            wide
          >
            <Textarea
              id={`${id}-description`}
              rows={3}
              maxLength={600}
              value={draft.description}
              onChange={(event) => set('description', event.target.value)}
            />
          </Field>
          <Field label='Logo' htmlFor={`${id}-logoUrl`} wide>
            <div className='flex gap-2'>
              <Input
                id={`${id}-logoUrl`}
                value={draft.logoUrl}
                placeholder='https://'
                onChange={(event) => set('logoUrl', event.target.value)}
              />
              <MediaPickButton
                workspaceId={workspaceId}
                label='Mídia'
                onPick={(url) => set('logoUrl', url)}
              />
            </div>
          </Field>
          {text('foundingYear', 'Ano de fundação', {
            type: 'number',
            placeholder: '2010',
          })}
          {text('priceRange', 'Faixa de preço', { placeholder: 'R$ 100–300' })}
        </section>

        <section className='grid gap-4 sm:grid-cols-2'>
          <h3 className='font-medium text-sm sm:col-span-2'>
            Contato e endereço
          </h3>
          {text('phone', 'Telefone', {
            placeholder: '(11) 3333-4444',
            hint: 'Use o mesmo número que aparece no site.',
          })}
          {text('email', 'E-mail', { type: 'email' })}
          {text('street', 'Endereço', {
            placeholder: 'Rua, número e complemento',
            wide: true,
          })}
          {text('district', 'Bairro')}
          {text('city', 'Cidade')}
          {text('region', 'Estado (UF)', { placeholder: 'SP' })}
          {text('postalCode', 'CEP')}
          {text('latitude', 'Latitude', { placeholder: '-23.5613' })}
          {text('longitude', 'Longitude', { placeholder: '-46.6565' })}
          <Field
            label='Área atendida'
            htmlFor={`${id}-serviceArea`}
            hint='Uma cidade, estado ou região por linha.'
            wide
          >
            <Textarea
              id={`${id}-serviceArea`}
              rows={2}
              value={draft.serviceArea}
              onChange={(event) => set('serviceArea', event.target.value)}
            />
          </Field>
        </section>

        <section className='grid gap-3'>
          <h3 className='font-medium text-sm'>Horário de funcionamento</h3>
          {draft.hours.map((slot, index) => (
            <div
              key={index}
              className='flex flex-wrap items-center gap-3 rounded-md border p-2'
            >
              <div className='flex flex-wrap gap-2'>
                {WEEK_DAYS.map((day) => (
                  <div key={day} className='flex items-center gap-1'>
                    <Checkbox
                      id={`${id}-h${index}-${day}`}
                      checked={slot.days.includes(day)}
                      onCheckedChange={(value) =>
                        set(
                          'hours',
                          draft.hours.map((item, i) =>
                            i === index
                              ? {
                                  ...item,
                                  days:
                                    value === true
                                      ? WEEK_DAYS.filter(
                                          (d) =>
                                            d === day || item.days.includes(d),
                                        )
                                      : item.days.filter((d) => d !== day),
                                }
                              : item,
                          ),
                        )
                      }
                    />
                    <Label
                      htmlFor={`${id}-h${index}-${day}`}
                      className='font-normal text-xs'
                    >
                      {DAY_LABELS[day]}
                    </Label>
                  </div>
                ))}
              </div>
              <div className='flex items-center gap-1.5'>
                <Input
                  type='time'
                  aria-label='Abre às'
                  value={slot.opens}
                  className='h-8 w-28'
                  onChange={(event) =>
                    set(
                      'hours',
                      draft.hours.map((item, i) =>
                        i === index
                          ? { ...item, opens: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
                <span className='text-muted-foreground text-xs'>às</span>
                <Input
                  type='time'
                  aria-label='Fecha às'
                  value={slot.closes}
                  className='h-8 w-28'
                  onChange={(event) =>
                    set(
                      'hours',
                      draft.hours.map((item, i) =>
                        i === index
                          ? { ...item, closes: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
              </div>
              <Button
                type='button'
                size='icon-sm'
                variant='ghost'
                aria-label='Remover horário'
                onClick={() =>
                  set(
                    'hours',
                    draft.hours.filter((_, i) => i !== index),
                  )
                }
              >
                <SteelIcon icon={Delete02Icon} className='size-4' />
              </Button>
            </div>
          ))}
          <div>
            <Button
              type='button'
              size='sm'
              variant='outline'
              disabled={draft.hours.length >= 14}
              onClick={() =>
                set('hours', [
                  ...draft.hours,
                  {
                    days: [
                      'Monday',
                      'Tuesday',
                      'Wednesday',
                      'Thursday',
                      'Friday',
                    ],
                    opens: '08:00',
                    closes: '18:00',
                  },
                ])
              }
            >
              <SteelIcon icon={Add01Icon} data-icon='inline-start' />
              Horário
            </Button>
          </div>
        </section>

        <section className='grid gap-4 sm:grid-cols-2'>
          <h3 className='font-medium text-sm sm:col-span-2'>
            Presença e pessoas
          </h3>
          <Field
            label='Perfis oficiais'
            htmlFor={`${id}-sameAs`}
            hint='Um endereço por linha: Instagram, LinkedIn, Google Meu Negócio, YouTube… Ajuda as IAs a ligar o site à empresa certa.'
            wide
          >
            <Textarea
              id={`${id}-sameAs`}
              rows={3}
              value={draft.sameAs}
              placeholder='https://instagram.com/suaempresa'
              onChange={(event) => set('sameAs', event.target.value)}
            />
          </Field>
          <div className='grid gap-2 sm:col-span-2'>
            <p className='text-sm'>Pessoas-chave</p>
            {draft.people.map((person, index) => (
              <div
                key={index}
                className='grid gap-2 rounded-md border p-2 sm:grid-cols-[1fr_1fr_1fr_auto]'
              >
                {(['name', 'role', 'url'] as const).map((field) => (
                  <Input
                    key={field}
                    aria-label={
                      field === 'name'
                        ? 'Nome'
                        : field === 'role'
                          ? 'Cargo'
                          : 'Perfil (https://)'
                    }
                    placeholder={
                      field === 'name'
                        ? 'Nome'
                        : field === 'role'
                          ? 'Cargo'
                          : 'https://linkedin.com/in/…'
                    }
                    value={person[field]}
                    onChange={(event) =>
                      set(
                        'people',
                        draft.people.map((item, i) =>
                          i === index
                            ? { ...item, [field]: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                ))}
                <Button
                  type='button'
                  size='icon-sm'
                  variant='ghost'
                  aria-label='Remover pessoa'
                  onClick={() =>
                    set(
                      'people',
                      draft.people.filter((_, i) => i !== index),
                    )
                  }
                >
                  <SteelIcon icon={Delete02Icon} className='size-4' />
                </Button>
              </div>
            ))}
            <div>
              <Button
                type='button'
                size='sm'
                variant='outline'
                disabled={draft.people.length >= 10}
                onClick={() =>
                  set('people', [
                    ...draft.people,
                    { name: '', role: '', url: '' },
                  ])
                }
              >
                <SteelIcon icon={Add01Icon} data-icon='inline-start' />
                Pessoa
              </Button>
            </div>
          </div>
        </section>
      </fieldset>
      {canEdit ? (
        <div>
          <Button type='submit' disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar perfil'}
          </Button>
        </div>
      ) : null}
    </form>
  )
}
