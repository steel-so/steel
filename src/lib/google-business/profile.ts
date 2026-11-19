import {
  GOOGLE_DESCRIPTION_GOOD_MIN,
  GOOGLE_PHOTOS_GOOD_MIN,
  GOOGLE_WEEKDAYS,
  type GoogleCategoryDTO,
  type GoogleCompletenessDTO,
  type GoogleCompletenessItemDTO,
  type GoogleHoursPeriodDTO,
  type GoogleProfileDTO,
  type GoogleWeekday,
  type UpdateGoogleProfileDTO,
} from '@/src/schemas/crm-google-presence.schema'
import type {
  RawAddress,
  RawCategory,
  RawLocation,
  RawPeriod,
  RawTimeOfDay,
} from './client'

/** Pure translation between Google's Location resource and Steel's profile. */

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** `{hours: 8, minutes: 30}` → `08:30` (Google omits zero fields). */
export function timeToString(time: RawTimeOfDay | undefined): string {
  return `${pad(time?.hours ?? 0)}:${pad(time?.minutes ?? 0)}`
}

/** `08:30` → `{hours: 8, minutes: 30}` (`24:00` closes at midnight). */
export function stringToTime(value: string): RawTimeOfDay {
  const [hours, minutes] = value.split(':').map(Number)
  return { hours, minutes }
}

function isWeekday(value: string | undefined): value is GoogleWeekday {
  return (GOOGLE_WEEKDAYS as readonly string[]).includes(value ?? '')
}

export function periodsFromGoogle(
  periods: RawPeriod[] | undefined,
): GoogleHoursPeriodDTO[] {
  return (periods ?? []).flatMap((period) =>
    isWeekday(period.openDay)
      ? [
          {
            day: period.openDay,
            open: timeToString(period.openTime),
            close: timeToString(period.closeTime),
          },
        ]
      : [],
  )
}

/** Weekly hours in order (Monday first), then by opening time. */
export function sortPeriods(
  periods: GoogleHoursPeriodDTO[],
): GoogleHoursPeriodDTO[] {
  return [...periods].sort(
    (a, b) =>
      GOOGLE_WEEKDAYS.indexOf(a.day) - GOOGLE_WEEKDAYS.indexOf(b.day) ||
      a.open.localeCompare(b.open),
  )
}

export function periodsToGoogle(periods: GoogleHoursPeriodDTO[]): RawPeriod[] {
  return sortPeriods(periods).map((period) => ({
    openDay: period.day,
    openTime: stringToTime(period.open),
    closeDay: period.day,
    closeTime: stringToTime(period.close),
  }))
}

/** First problem found in the weekly hours, or `null` when they are fine. */
export function validatePeriods(
  periods: GoogleHoursPeriodDTO[],
): string | null {
  for (const period of periods) {
    if (period.close !== '24:00' && period.close <= period.open) {
      return 'O horário de fechamento deve ser depois do de abertura.'
    }
  }
  const sorted = sortPeriods(periods)
  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1]
    const current = sorted[i]
    if (previous.day === current.day && current.open < previous.close) {
      return 'As faixas de horário do mesmo dia não podem se sobrepor.'
    }
  }
  return null
}

export function formatAddress(address: RawAddress | undefined): string | null {
  if (!address) return null
  const parts = [
    ...(address.addressLines ?? []),
    address.sublocality,
    [address.locality, address.administrativeArea].filter(Boolean).join(' - '),
    address.postalCode,
  ].filter((part): part is string => Boolean(part?.trim()))
  return parts.length > 0 ? parts.join(', ') : null
}

function toCategory(raw: RawCategory | undefined): GoogleCategoryDTO | null {
  return raw?.name
    ? { name: raw.name, displayName: raw.displayName ?? raw.name }
    : null
}

export function mapCategories(raw: RawCategory[] | undefined) {
  return (raw ?? []).flatMap((category) => {
    const mapped = toCategory(category)
    return mapped ? [mapped] : []
  })
}

/** Checklist of what is missing on the profile, and a 0-100 score. */
export function buildCompleteness(input: {
  title: string
  primaryCategory: GoogleCategoryDTO | null
  description: string
  primaryPhone: string | null
  websiteUri: string | null
  hours: GoogleHoursPeriodDTO[]
  address: string | null
  photoCount: number | null
  attributesFilled: number | null
}): GoogleCompletenessDTO {
  const descriptionLength = input.description.trim().length
  const items: GoogleCompletenessItemDTO[] = [
    {
      key: 'title',
      label: 'Nome da empresa',
      done: input.title.trim().length > 0,
      hint: 'Use o nome real do negócio, como aparece na fachada.',
    },
    {
      key: 'category',
      label: 'Categoria principal',
      done: input.primaryCategory !== null,
      hint: 'A categoria define em quais buscas você aparece.',
    },
    {
      key: 'description',
      label: `Descrição com ${GOOGLE_DESCRIPTION_GOOD_MIN}+ caracteres`,
      done: descriptionLength >= GOOGLE_DESCRIPTION_GOOD_MIN,
      hint:
        descriptionLength === 0
          ? 'Conte o que a empresa faz e o que a diferencia.'
          : `Faltam ${GOOGLE_DESCRIPTION_GOOD_MIN - descriptionLength} caracteres para uma descrição completa.`,
    },
    {
      key: 'phone',
      label: 'Telefone',
      done: Boolean(input.primaryPhone?.trim()),
      hint: 'Permite que o cliente ligue direto pelo Google.',
    },
    {
      key: 'website',
      label: 'Site',
      done: Boolean(input.websiteUri?.trim()),
      hint: 'Leva o cliente do Google para o seu site.',
    },
    {
      key: 'hours',
      label: 'Horário de funcionamento',
      done: input.hours.length > 0,
      hint: 'Mostra quando você está aberto, inclusive "aberto agora".',
    },
    {
      key: 'address',
      label: 'Endereço',
      done: Boolean(input.address),
      hint: 'Necessário para aparecer no Google Maps.',
    },
    {
      key: 'photos',
      label: `Pelo menos ${GOOGLE_PHOTOS_GOOD_MIN} fotos`,
      done: (input.photoCount ?? 0) >= GOOGLE_PHOTOS_GOOD_MIN,
      hint: 'Perfis com fotos recebem mais cliques e pedidos de rota.',
    },
    {
      key: 'attributes',
      label: 'Atributos do negócio',
      done: (input.attributesFilled ?? 0) > 0,
      hint: 'Ex.: Wi-Fi, estacionamento, acessibilidade, formas de pagamento.',
    },
  ]
  const done = items.filter((item) => item.done).length
  return { score: Math.round((done / items.length) * 100), items }
}

export function mapLocationToProfile(
  location: RawLocation,
  extras: { photoCount: number | null; attributesFilled: number | null },
): GoogleProfileDTO {
  const title = location.title ?? ''
  const description = location.profile?.description ?? ''
  const primaryCategory = toCategory(location.categories?.primaryCategory)
  const primaryPhone = location.phoneNumbers?.primaryPhone ?? null
  const websiteUri = location.websiteUri ?? null
  const hours = sortPeriods(periodsFromGoogle(location.regularHours?.periods))
  const address = formatAddress(location.storefrontAddress)

  return {
    locationName: location.name ?? '',
    title,
    description,
    primaryPhone,
    additionalPhones: location.phoneNumbers?.additionalPhones ?? [],
    websiteUri,
    primaryCategory,
    additionalCategories: mapCategories(
      location.categories?.additionalCategories,
    ),
    address,
    latitude: location.latlng?.latitude ?? null,
    longitude: location.latlng?.longitude ?? null,
    hours,
    mapsUri: location.metadata?.mapsUri ?? null,
    newReviewUri: location.metadata?.newReviewUri ?? null,
    placeId: location.metadata?.placeId ?? null,
    photoCount: extras.photoCount,
    attributesFilled: extras.attributesFilled,
    completeness: buildCompleteness({
      title,
      primaryCategory,
      description,
      primaryPhone,
      websiteUri,
      hours,
      address,
      ...extras,
    }),
  }
}

/**
 * Phones and categories are written as a whole object, so when the user
 * changes only part of it the rest must come from the current profile —
 * otherwise saving "additional phones" would erase the primary one.
 */
export function mergeWithCurrent(
  dto: UpdateGoogleProfileDTO,
  current: Pick<
    GoogleProfileDTO,
    | 'primaryPhone'
    | 'additionalPhones'
    | 'primaryCategory'
    | 'additionalCategories'
  >,
): UpdateGoogleProfileDTO {
  const merged = { ...dto }
  if (dto.primaryPhone !== undefined || dto.additionalPhones !== undefined) {
    if (dto.primaryPhone === undefined) {
      merged.primaryPhone = current.primaryPhone
    }
    if (dto.additionalPhones === undefined) {
      merged.additionalPhones = current.additionalPhones
    }
  }
  if (
    dto.primaryCategoryName !== undefined ||
    dto.additionalCategoryNames !== undefined
  ) {
    if (dto.primaryCategoryName === undefined && current.primaryCategory) {
      merged.primaryCategoryName = current.primaryCategory.name
    }
    if (dto.additionalCategoryNames === undefined) {
      merged.additionalCategoryNames = current.additionalCategories.map(
        (category) => category.name,
      )
    }
  }
  return merged
}

/**
 * Builds the PATCH for the Business Information API: only the fields the
 * user sent, each with its entry in `updateMask`.
 */
export function buildLocationPatch(dto: UpdateGoogleProfileDTO): {
  updateMask: string[]
  body: RawLocation
} {
  const updateMask: string[] = []
  const body: RawLocation = {}

  if (dto.title !== undefined) {
    updateMask.push('title')
    body.title = dto.title
  }
  if (dto.description !== undefined) {
    updateMask.push('profile')
    body.profile = { description: dto.description }
  }
  if (dto.primaryPhone !== undefined || dto.additionalPhones !== undefined) {
    updateMask.push('phoneNumbers')
    body.phoneNumbers = {
      ...(dto.primaryPhone ? { primaryPhone: dto.primaryPhone } : {}),
      ...(dto.additionalPhones
        ? { additionalPhones: dto.additionalPhones }
        : {}),
    }
  }
  if (dto.websiteUri !== undefined) {
    updateMask.push('websiteUri')
    body.websiteUri = dto.websiteUri ?? ''
  }
  if (
    dto.primaryCategoryName !== undefined ||
    dto.additionalCategoryNames !== undefined
  ) {
    updateMask.push('categories')
    body.categories = {
      ...(dto.primaryCategoryName
        ? { primaryCategory: { name: dto.primaryCategoryName } }
        : {}),
      additionalCategories: (dto.additionalCategoryNames ?? []).map((name) => ({
        name,
      })),
    }
  }
  if (dto.hours !== undefined) {
    updateMask.push('regularHours')
    body.regularHours = { periods: periodsToGoogle(dto.hours) }
  }
  return { updateMask, body }
}
