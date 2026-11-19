import { ok, type Result } from '@/src/lib/result'
import { googleRequest } from './http'

/**
 * Thin typed wrappers over the Google Business Profile REST APIs. Every
 * function takes a fresh access token and returns a `Result` whose error is
 * already user-facing (see `mapGoogleFailure`). Resource names follow Google:
 * `accounts/{id}`, `locations/{id}`; the legacy v4 APIs (reviews and media)
 * want the full `accounts/{id}/locations/{id}`.
 */

const ACCOUNTS_API = 'https://mybusinessaccountmanagement.googleapis.com/v1'
const INFO_API = 'https://mybusinessbusinessinformation.googleapis.com/v1'
const PERFORMANCE_API = 'https://businessprofileperformance.googleapis.com/v1'
const LEGACY_API = 'https://mybusiness.googleapis.com/v4'

/** Fields requested when listing locations (the API demands a read mask). */
const LIST_READ_MASK = 'name,title,storefrontAddress,metadata'

export const LOCATION_READ_MASK = [
  'name',
  'title',
  'phoneNumbers',
  'categories',
  'storefrontAddress',
  'websiteUri',
  'regularHours',
  'profile',
  'latlng',
  'metadata',
].join(',')

/* ------------------------------------------------------------------ */
/* Raw shapes                                                           */
/* ------------------------------------------------------------------ */

export type RawAddress = {
  regionCode?: string
  postalCode?: string
  administrativeArea?: string
  locality?: string
  sublocality?: string
  addressLines?: string[]
}

export type RawCategory = { name?: string; displayName?: string }

export type RawTimeOfDay = { hours?: number; minutes?: number }

export type RawPeriod = {
  openDay?: string
  openTime?: RawTimeOfDay
  closeDay?: string
  closeTime?: RawTimeOfDay
}

export type RawLocation = {
  name?: string
  title?: string
  phoneNumbers?: { primaryPhone?: string; additionalPhones?: string[] }
  categories?: {
    primaryCategory?: RawCategory
    additionalCategories?: RawCategory[]
  }
  storefrontAddress?: RawAddress
  websiteUri?: string
  regularHours?: { periods?: RawPeriod[] }
  profile?: { description?: string }
  latlng?: { latitude?: number; longitude?: number }
  metadata?: { mapsUri?: string; newReviewUri?: string; placeId?: string }
}

export type RawAccount = {
  name?: string
  accountName?: string
  type?: string
}

export type RawReview = {
  name?: string
  reviewId?: string
  reviewer?: {
    displayName?: string
    profilePhotoUrl?: string
    isAnonymous?: boolean
  }
  starRating?: string
  comment?: string
  createTime?: string
  updateTime?: string
  reviewReply?: { comment?: string; updateTime?: string }
}

export type RawMedia = {
  name?: string
  mediaFormat?: string
  googleUrl?: string
  thumbnailUrl?: string
  createTime?: string
  locationAssociation?: { category?: string }
}

export type RawAttribute = {
  name?: string
  valueType?: string
  values?: unknown[]
}

export type RawAttributeMetadata = {
  parent?: string
  valueType?: string
  displayName?: string
  groupDisplayName?: string
  deprecated?: boolean
}

type RawDate = { year?: number; month?: number; day?: number }

export type RawDailyMetricSeries = {
  dailyMetric?: string
  timeSeries?: { datedValues?: { date?: RawDate; value?: string }[] }
}

export const PERFORMANCE_METRICS = [
  'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
  'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
  'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
  'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
  'CALL_CLICKS',
  'BUSINESS_DIRECTION_REQUESTS',
  'WEBSITE_CLICKS',
] as const

/* ------------------------------------------------------------------ */
/* Accounts and locations                                               */
/* ------------------------------------------------------------------ */

export async function listAccounts(
  accessToken: string,
): Promise<Result<RawAccount[]>> {
  const accounts: RawAccount[] = []
  let pageToken: string | undefined
  for (let page = 0; page < 10; page++) {
    const result = await googleRequest<{
      accounts?: RawAccount[]
      nextPageToken?: string
    }>({
      url: `${ACCOUNTS_API}/accounts`,
      accessToken,
      query: { pageSize: 20, pageToken },
    })
    if (!result.ok) return result
    accounts.push(...(result.value.accounts ?? []))
    pageToken = result.value.nextPageToken
    if (!pageToken) break
  }
  return ok(accounts)
}

export async function listLocations(
  accessToken: string,
  accountName: string,
): Promise<Result<RawLocation[]>> {
  const locations: RawLocation[] = []
  let pageToken: string | undefined
  for (let page = 0; page < 10; page++) {
    const result = await googleRequest<{
      locations?: RawLocation[]
      nextPageToken?: string
    }>({
      url: `${INFO_API}/${accountName}/locations`,
      accessToken,
      query: { readMask: LIST_READ_MASK, pageSize: 100, pageToken },
    })
    if (!result.ok) return result
    locations.push(...(result.value.locations ?? []))
    pageToken = result.value.nextPageToken
    if (!pageToken) break
  }
  return ok(locations)
}

export function getLocation(
  accessToken: string,
  locationName: string,
): Promise<Result<RawLocation>> {
  return googleRequest<RawLocation>({
    url: `${INFO_API}/${locationName}`,
    accessToken,
    query: { readMask: LOCATION_READ_MASK },
  })
}

export function patchLocation(
  accessToken: string,
  locationName: string,
  updateMask: string[],
  body: RawLocation,
): Promise<Result<RawLocation>> {
  return googleRequest<RawLocation>({
    method: 'PATCH',
    url: `${INFO_API}/${locationName}`,
    accessToken,
    query: { updateMask: updateMask.join(',') },
    body,
  })
}

export async function searchCategories(
  accessToken: string,
  term: string,
): Promise<Result<RawCategory[]>> {
  const result = await googleRequest<{ categories?: RawCategory[] }>({
    url: `${INFO_API}/categories`,
    accessToken,
    query: {
      regionCode: 'BR',
      languageCode: 'pt-BR',
      view: 'BASIC',
      filter: `displayName=${term}`,
      pageSize: 20,
    },
  })
  if (!result.ok) return result
  return ok(result.value.categories ?? [])
}

/* ------------------------------------------------------------------ */
/* Attributes                                                           */
/* ------------------------------------------------------------------ */

export async function getAttributes(
  accessToken: string,
  locationName: string,
): Promise<Result<RawAttribute[]>> {
  const result = await googleRequest<{ attributes?: RawAttribute[] }>({
    url: `${INFO_API}/${locationName}/attributes`,
    accessToken,
  })
  if (!result.ok) return result
  return ok(result.value.attributes ?? [])
}

export async function listAttributeMetadata(
  accessToken: string,
  locationName: string,
): Promise<Result<RawAttributeMetadata[]>> {
  const items: RawAttributeMetadata[] = []
  let pageToken: string | undefined
  for (let page = 0; page < 5; page++) {
    const result = await googleRequest<{
      attributeMetadata?: RawAttributeMetadata[]
      nextPageToken?: string
    }>({
      url: `${INFO_API}/attributes`,
      accessToken,
      query: {
        parent: locationName,
        languageCode: 'pt-BR',
        pageSize: 200,
        pageToken,
      },
    })
    if (!result.ok) return result
    items.push(...(result.value.attributeMetadata ?? []))
    pageToken = result.value.nextPageToken
    if (!pageToken) break
  }
  return ok(items)
}

export function patchAttributes(
  accessToken: string,
  locationName: string,
  attributes: { name: string; value: boolean }[],
): Promise<Result<unknown>> {
  return googleRequest({
    method: 'PATCH',
    url: `${INFO_API}/${locationName}/attributes`,
    accessToken,
    query: { attributeMask: attributes.map((a) => a.name).join(',') },
    body: {
      name: `${locationName}/attributes`,
      attributes: attributes.map((a) => ({
        name: a.name,
        values: [a.value],
      })),
    },
  })
}

/* ------------------------------------------------------------------ */
/* Reviews (v4)                                                         */
/* ------------------------------------------------------------------ */

export type RawReviewsPage = {
  reviews?: RawReview[]
  averageRating?: number
  totalReviewCount?: number
  nextPageToken?: string
}

export function listReviewsPage(
  accessToken: string,
  fullLocationName: string,
  pageToken?: string,
): Promise<Result<RawReviewsPage>> {
  return googleRequest<RawReviewsPage>({
    url: `${LEGACY_API}/${fullLocationName}/reviews`,
    accessToken,
    query: { pageSize: 50, orderBy: 'updateTime desc', pageToken },
  })
}

export function putReviewReply(
  accessToken: string,
  fullLocationName: string,
  reviewId: string,
  comment: string,
): Promise<Result<{ comment?: string; updateTime?: string }>> {
  return googleRequest({
    method: 'PUT',
    url: `${LEGACY_API}/${fullLocationName}/reviews/${reviewId}/reply`,
    accessToken,
    body: { comment },
  })
}

export function deleteReviewReply(
  accessToken: string,
  fullLocationName: string,
  reviewId: string,
): Promise<Result<unknown>> {
  return googleRequest({
    method: 'DELETE',
    url: `${LEGACY_API}/${fullLocationName}/reviews/${reviewId}/reply`,
    accessToken,
  })
}

/* ------------------------------------------------------------------ */
/* Photos (v4 media)                                                    */
/* ------------------------------------------------------------------ */

export async function listMedia(
  accessToken: string,
  fullLocationName: string,
): Promise<Result<{ items: RawMedia[]; total: number }>> {
  const result = await googleRequest<{
    mediaItems?: RawMedia[]
    totalMediaItemCount?: number
  }>({
    url: `${LEGACY_API}/${fullLocationName}/media`,
    accessToken,
    query: { pageSize: 100 },
  })
  if (!result.ok) return result
  const items = result.value.mediaItems ?? []
  return ok({ items, total: result.value.totalMediaItemCount ?? items.length })
}

export function createMedia(
  accessToken: string,
  fullLocationName: string,
  input: { sourceUrl: string; category: string },
): Promise<Result<RawMedia>> {
  return googleRequest<RawMedia>({
    method: 'POST',
    url: `${LEGACY_API}/${fullLocationName}/media`,
    accessToken,
    body: {
      mediaFormat: 'PHOTO',
      locationAssociation: { category: input.category },
      sourceUrl: input.sourceUrl,
    },
  })
}

export function deleteMedia(
  accessToken: string,
  mediaName: string,
): Promise<Result<unknown>> {
  return googleRequest({
    method: 'DELETE',
    url: `${LEGACY_API}/${mediaName}`,
    accessToken,
  })
}

/* ------------------------------------------------------------------ */
/* Performance                                                          */
/* ------------------------------------------------------------------ */

function dateQuery(prefix: string, date: Date): Record<string, number> {
  return {
    [`${prefix}.year`]: date.getUTCFullYear(),
    [`${prefix}.month`]: date.getUTCMonth() + 1,
    [`${prefix}.day`]: date.getUTCDate(),
  }
}

export async function fetchDailyMetrics(
  accessToken: string,
  locationName: string,
  start: Date,
  end: Date,
): Promise<Result<RawDailyMetricSeries[]>> {
  const result = await googleRequest<{
    multiDailyMetricTimeSeries?: {
      dailyMetricTimeSeries?: RawDailyMetricSeries[]
    }[]
  }>({
    url: `${PERFORMANCE_API}/${locationName}:fetchMultiDailyMetricsTimeSeries`,
    accessToken,
    query: {
      dailyMetrics: [...PERFORMANCE_METRICS],
      ...dateQuery('dailyRange.start_date', start),
      ...dateQuery('dailyRange.end_date', end),
    },
  })
  if (!result.ok) return result
  return ok(
    (result.value.multiDailyMetricTimeSeries ?? []).flatMap(
      (group) => group.dailyMetricTimeSeries ?? [],
    ),
  )
}

export type RawSearchKeyword = {
  searchKeyword?: string
  insightsValue?: { value?: string; threshold?: string }
}

export async function fetchSearchKeywords(
  accessToken: string,
  locationName: string,
  startMonth: Date,
  endMonth: Date,
): Promise<Result<RawSearchKeyword[]>> {
  const result = await googleRequest<{
    searchKeywordsCounts?: RawSearchKeyword[]
  }>({
    url: `${PERFORMANCE_API}/${locationName}/searchkeywords/impressions/monthly`,
    accessToken,
    query: {
      'monthlyRange.start_month.year': startMonth.getUTCFullYear(),
      'monthlyRange.start_month.month': startMonth.getUTCMonth() + 1,
      'monthlyRange.end_month.year': endMonth.getUTCFullYear(),
      'monthlyRange.end_month.month': endMonth.getUTCMonth() + 1,
      pageSize: 50,
    },
  })
  if (!result.ok) return result
  return ok(result.value.searchKeywordsCounts ?? [])
}
