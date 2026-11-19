import z from 'zod'

/**
 * Contratos da Presença no Google (CRM > Atrair): perfil da empresa
 * (Google Business Profile), desempenho no Google/Maps e avaliações. A
 * conexão é por workspace, via OAuth; o que o Google devolve fica em cache
 * no banco (avaliações e métricas diárias).
 */

export const GOOGLE_WEEKDAYS = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
] as const
export type GoogleWeekday = (typeof GOOGLE_WEEKDAYS)[number]

export const GOOGLE_WEEKDAY_LABELS: Record<GoogleWeekday, string> = {
  MONDAY: 'Segunda-feira',
  TUESDAY: 'Terça-feira',
  WEDNESDAY: 'Quarta-feira',
  THURSDAY: 'Quinta-feira',
  FRIDAY: 'Sexta-feira',
  SATURDAY: 'Sábado',
  SUNDAY: 'Domingo',
}

/** Limite da descrição do perfil (Google). */
export const GOOGLE_DESCRIPTION_MAX = 750
/** Tamanho a partir do qual a descrição conta como "completa" no checklist. */
export const GOOGLE_DESCRIPTION_GOOD_MIN = 250
/** Limite de uma resposta a avaliação (Google). */
export const GOOGLE_REPLY_MAX = 4096
/** Fotos a partir das quais o checklist considera a galeria "boa". */
export const GOOGLE_PHOTOS_GOOD_MIN = 5
/** Nota a partir da qual (inclusive, para menos) a avaliação gera alerta. */
export const GOOGLE_NEGATIVE_MAX_STARS = 2

/* ------------------------------------------------------------------ */
/* Conexão                                                              */
/* ------------------------------------------------------------------ */

export type CrmGoogleConnectionDTO = {
  /** O servidor tem credenciais OAuth do Google (e a chave de cifra)? */
  configured: boolean
  connected: boolean
  /** `EXPIRED`/`REVOKED` exigem reconexão. */
  status: 'CONNECTED' | 'EXPIRED' | 'REVOKED' | null
  googleEmail: string | null
  location: {
    accountName: string
    locationName: string
    title: string
    placeId: string | null
    mapsUri: string | null
    newReviewUri: string | null
  } | null
  replyTone: string | null
  averageRating: number | null
  totalReviewCount: number | null
  lastReviewsSyncAt: string | null
  lastMetricsSyncAt: string | null
  lastSyncError: string | null
}

export type CrmGoogleLocationOptionDTO = {
  accountName: string
  accountLabel: string
  locationName: string
  title: string
  address: string | null
  placeId: string | null
}

export const SelectGoogleLocationSchema = z.object({
  accountName: z
    .string()
    .regex(/^accounts\/[\w-]+$/, 'Conta do Google inválida'),
  locationName: z
    .string()
    .regex(/^locations\/[\w-]+$/, 'Local do Google inválido'),
})
export type SelectGoogleLocationDTO = z.infer<typeof SelectGoogleLocationSchema>

export const UpdateGoogleSettingsSchema = z.object({
  replyTone: z
    .string()
    .trim()
    .max(500, 'Descreva o tom em até 500 caracteres')
    .nullable(),
})
export type UpdateGoogleSettingsDTO = z.infer<typeof UpdateGoogleSettingsSchema>

/* ------------------------------------------------------------------ */
/* Perfil                                                               */
/* ------------------------------------------------------------------ */

const TimeSchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'Horário inválido (HH:MM)')

export const GoogleHoursPeriodSchema = z.object({
  day: z.enum(GOOGLE_WEEKDAYS),
  open: TimeSchema,
  close: TimeSchema,
})
export type GoogleHoursPeriodDTO = z.infer<typeof GoogleHoursPeriodSchema>

export type GoogleCategoryDTO = { name: string; displayName: string }

export type GoogleCompletenessItemDTO = {
  key:
    | 'title'
    | 'category'
    | 'description'
    | 'phone'
    | 'website'
    | 'hours'
    | 'address'
    | 'photos'
    | 'attributes'
  label: string
  done: boolean
  hint: string
}

export type GoogleCompletenessDTO = {
  /** 0 a 100. */
  score: number
  items: GoogleCompletenessItemDTO[]
}

export type GoogleProfileDTO = {
  locationName: string
  title: string
  description: string
  primaryPhone: string | null
  additionalPhones: string[]
  websiteUri: string | null
  primaryCategory: GoogleCategoryDTO | null
  additionalCategories: GoogleCategoryDTO[]
  address: string | null
  latitude: number | null
  longitude: number | null
  hours: GoogleHoursPeriodDTO[]
  mapsUri: string | null
  newReviewUri: string | null
  placeId: string | null
  photoCount: number | null
  attributesFilled: number | null
  completeness: GoogleCompletenessDTO
}

export const UpdateGoogleProfileSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Informe o nome da empresa')
      .max(100, 'O nome aceita até 100 caracteres')
      .optional(),
    description: z
      .string()
      .trim()
      .max(
        GOOGLE_DESCRIPTION_MAX,
        `A descrição aceita até ${GOOGLE_DESCRIPTION_MAX} caracteres`,
      )
      .optional(),
    /** `null` ou vazio remove o telefone principal. */
    primaryPhone: z
      .string()
      .trim()
      .max(30, 'Telefone muito longo')
      .nullable()
      .optional(),
    additionalPhones: z
      .array(z.string().trim().min(1).max(30))
      .max(2, 'O Google aceita até 2 telefones adicionais')
      .optional(),
    websiteUri: z
      .union([
        z.literal(''),
        z.url('Informe um endereço válido (https://…)').max(2048),
      ])
      .nullable()
      .optional(),
    primaryCategoryName: z
      .string()
      .regex(/^categories\/[\w:.-]+$/, 'Categoria inválida')
      .optional(),
    additionalCategoryNames: z
      .array(z.string().regex(/^categories\/[\w:.-]+$/, 'Categoria inválida'))
      .max(9, 'O Google aceita até 9 categorias adicionais')
      .optional(),
    hours: z.array(GoogleHoursPeriodSchema).max(28).optional(),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: 'Nada para atualizar',
  })
export type UpdateGoogleProfileDTO = z.infer<typeof UpdateGoogleProfileSchema>

export const SearchGoogleCategoriesSchema = z.object({
  q: z.string().trim().min(2, 'Digite ao menos 2 letras').max(80),
})

export type GoogleAttributeDTO = {
  /** `attributes/has_wifi` etc. */
  name: string
  displayName: string
  group: string | null
  /** Só atributos "sim/não" são editáveis aqui. */
  editable: boolean
  value: boolean | null
}

export const UpdateGoogleAttributesSchema = z.object({
  attributes: z
    .array(
      z.object({
        name: z.string().regex(/^attributes\/[\w.-]+$/, 'Atributo inválido'),
        value: z.boolean(),
      }),
    )
    .min(1, 'Nada para atualizar')
    .max(100),
})
export type UpdateGoogleAttributesDTO = z.infer<
  typeof UpdateGoogleAttributesSchema
>

export const GOOGLE_PHOTO_CATEGORIES = [
  'ADDITIONAL',
  'COVER',
  'PROFILE',
  'EXTERIOR',
  'INTERIOR',
  'PRODUCT',
  'AT_WORK',
  'TEAMS',
] as const
export const GOOGLE_PHOTO_CATEGORY_LABELS: Record<
  (typeof GOOGLE_PHOTO_CATEGORIES)[number],
  string
> = {
  ADDITIONAL: 'Outras fotos',
  COVER: 'Capa',
  PROFILE: 'Logotipo',
  EXTERIOR: 'Fachada',
  INTERIOR: 'Interior',
  PRODUCT: 'Produtos',
  AT_WORK: 'Em ação',
  TEAMS: 'Equipe',
}
export const GoogleDeletePhotoSchema = z.object({
  name: z
    .string()
    .regex(/^accounts\/[\w-]+\/locations\/[\w-]+\/media\/[\w-]+$/),
})
export const GOOGLE_PHOTO_MAX_BYTES = 5 * 1024 * 1024
export const GOOGLE_PHOTO_TYPES = ['image/jpeg', 'image/png'] as const

export type GooglePhotoDTO = {
  name: string
  url: string
  thumbnailUrl: string
  category: string | null
  createdAt: string | null
}

export type GoogleDescriptionSuggestionDTO = {
  suggestion: string
}

/* ------------------------------------------------------------------ */
/* Desempenho (Maps)                                                    */
/* ------------------------------------------------------------------ */

export const GOOGLE_PERFORMANCE_RANGES = ['7d', '28d', '90d'] as const
export const GOOGLE_PERFORMANCE_RANGE_DAYS: Record<
  (typeof GOOGLE_PERFORMANCE_RANGES)[number],
  number
> = { '7d': 7, '28d': 28, '90d': 90 }

export const GooglePerformanceQuerySchema = z.object({
  range: z.enum(GOOGLE_PERFORMANCE_RANGES).default('28d'),
})
export type GooglePerformanceRange = z.infer<
  typeof GooglePerformanceQuerySchema
>['range']

export type GooglePerformanceTotalsDTO = {
  /** Aparições na Busca do Google (desktop + celular). */
  searchImpressions: number
  /** Aparições no Google Maps (desktop + celular). */
  mapsImpressions: number
  callClicks: number
  directionRequests: number
  websiteClicks: number
}

export type GooglePerformancePointDTO = {
  date: string
  searchImpressions: number
  mapsImpressions: number
  callClicks: number
  directionRequests: number
  websiteClicks: number
}

export type GooglePerformanceDTO = {
  range: GooglePerformanceRange
  startDate: string
  endDate: string
  totals: GooglePerformanceTotalsDTO
  /** Mesmo tamanho de janela, imediatamente antes — base da variação. */
  previousTotals: GooglePerformanceTotalsDTO
  /** Onde o negócio aparece: Maps/Busca × celular/computador. */
  surfaces: {
    mapsMobile: number
    mapsDesktop: number
    searchMobile: number
    searchDesktop: number
  }
  series: GooglePerformancePointDTO[]
  syncedAt: string | null
  /** O Google atrasa de 2 a 3 dias o fechamento das métricas. */
  hasData: boolean
}

export type GoogleKeywordDTO = {
  keyword: string
  /** `true` quando o Google só informa "menos que N". */
  approximate: boolean
  impressions: number
}

export type GoogleLinksDTO = {
  mapsUrl: string | null
  reviewUrl: string | null
  directionsUrl: string | null
  embedUrl: string | null
  latitude: number | null
  longitude: number | null
  address: string | null
  title: string
}

/* ------------------------------------------------------------------ */
/* Avaliações                                                           */
/* ------------------------------------------------------------------ */

export const ListGoogleReviewsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  replied: z.enum(['yes', 'no']).optional(),
  q: z.string().trim().max(100).optional(),
})
export type ListGoogleReviewsQuery = z.infer<
  typeof ListGoogleReviewsQuerySchema
>

export const ReplyGoogleReviewSchema = z.object({
  comment: z
    .string()
    .trim()
    .min(1, 'Escreva a resposta')
    .max(
      GOOGLE_REPLY_MAX,
      `A resposta aceita até ${GOOGLE_REPLY_MAX} caracteres`,
    ),
})
export type ReplyGoogleReviewDTO = z.infer<typeof ReplyGoogleReviewSchema>

export type GoogleReviewDTO = {
  id: string
  reviewerName: string
  reviewerPhotoUrl: string | null
  starRating: number
  comment: string | null
  reviewedAt: string
  reply: { comment: string; updatedAt: string | null } | null
}

export type GoogleReviewsPageDTO = {
  items: GoogleReviewDTO[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export type GoogleRatingEvolutionPointDTO = {
  /** `YYYY-MM`. */
  month: string
  count: number
  /** Média das avaliações do mês (`null` sem avaliações). */
  average: number | null
  /** Média acumulada até o fim do mês. */
  cumulativeAverage: number | null
}

export type GoogleReviewsSummaryDTO = {
  /** Média e total oficiais do Google (do último sync). */
  averageRating: number | null
  totalReviewCount: number | null
  cachedCount: number
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>
  repliedCount: number
  unrepliedCount: number
  /** 0 a 1 — respondidas / total em cache. */
  responseRate: number | null
  evolution: GoogleRatingEvolutionPointDTO[]
  lastSyncAt: string | null
}

export type GoogleReviewSuggestionDTO = {
  suggestion: string
}
