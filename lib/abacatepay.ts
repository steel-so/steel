import 'server-only'
import { ABACATE_PAY, ABACATE_PAY_CANCEL_PATH } from '@/lib/env/server'

/**
 * The single AbacatePay client (API v2): base URL, bearer auth and error
 * handling live here for subscriptions, coupons, Pix and boleto. Subscription
 * and coupon calls throw on non-2xx (callers must never see a false success);
 * the transparent (Pix/boleto) calls return the envelope with
 * `success: false` instead, because their providers map failures to `Result`.
 */
const BASE_URL = 'https://api.abacatepay.com/v2'

function authHeaders(extra?: HeadersInit): HeadersInit {
  return {
    Authorization: `Bearer ${ABACATE_PAY}`,
    'Content-Type': 'application/json',
    ...extra,
  }
}

/**
 * Único lugar que descreve o endpoint de cancelamento de assinatura
 * (`POST /subscriptions/cancel`, corpo `{ id }`, doc oficial em
 * https://docs.abacatepay.com/pages/subscriptions/cancel). O caminho é
 * sobrescrevível por `ABACATE_PAY_CANCEL_PATH` para o dia em que o provedor
 * mudar a rota sem precisar de deploy de código. A chamada **nunca** falha
 * em silêncio: qualquer resposta não-2xx vira `Error` (ver `request`).
 */
const CANCEL_SUBSCRIPTION_ENDPOINT = {
  method: 'POST' as const,
  path: ABACATE_PAY_CANCEL_PATH || '/subscriptions/cancel',
}

interface SubscriptionItem {
  id: string
  quantity: number
}

interface CreateSubscriptionRequest {
  items: SubscriptionItem[]
  methods?: string[]
  customerId?: string
  coupons?: string[]
  returnUrl?: string
  completionUrl?: string
  metadata?: Record<string, unknown>
}

export interface AbacatePaySubscription {
  id: string
  url: string
  amount: number
  status: string
  createdAt: string
  updatedAt: string
}

export interface AbacatePayCoupon {
  id: string
  discount: number
  discountKind: 'PERCENTAGE' | 'FIXED'
  status: 'ACTIVE' | 'INACTIVE' | 'EXPIRED'
  redeemsCount: number
  maxRedeems: number
}

interface AbacatePayResponse<T> {
  success: boolean
  data: T
  error: string | null
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<AbacatePayResponse<T>> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: authHeaders(options.headers),
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error ?? `AbacatePay request failed: ${response.status}`)
  }

  return data as AbacatePayResponse<T>
}

export const AbacatePayClient = {
  async createSubscription(
    params: CreateSubscriptionRequest,
  ): Promise<AbacatePayResponse<AbacatePaySubscription>> {
    return request<AbacatePaySubscription>('/subscriptions/create', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  },

  /**
   * Cancela uma assinatura no provedor. O `id` é o mesmo da criação
   * (`subscriptions/create` devolve um checkout `bill_...`), que o Steel
   * guarda em `subscriptions.bill_id`. O cancelamento é imediato e
   * irreversível — não há período de carência.
   *
   * Lança em qualquer resposta não-2xx (inclusive 404 de assinatura
   * inexistente): quem chama decide a política, mas nunca recebe um
   * "cancelou" falso.
   */
  async cancelSubscription(
    id: string,
  ): Promise<AbacatePayResponse<AbacatePaySubscription>> {
    return request<AbacatePaySubscription>(CANCEL_SUBSCRIPTION_ENDPOINT.path, {
      method: CANCEL_SUBSCRIPTION_ENDPOINT.method,
      body: JSON.stringify({ id }),
    })
  },

  async getCoupon(code: string): Promise<AbacatePayCoupon | null> {
    const response = await fetch(
      `${BASE_URL}/coupons/get?id=${encodeURIComponent(code)}`,
      { headers: authHeaders() }
    )

    if (response.status === 404) return null

    const data = await response.json()
    if (!response.ok) {
      throw new Error(
        data.error ?? `AbacatePay coupon fetch failed: ${response.status}`
      )
    }
    return data.data as AbacatePayCoupon
  }
}

export interface TransparentCharge {
  id: string
  /** Amount in cents. */
  amount: number
  status: string
  devMode: boolean
  /** Pix copy-and-paste code (Pix charges and boleto's Pix alternative). */
  brCode?: string | null
  /** Boleto digitable line. */
  barCode?: string | null
  /** Boleto view/print link. */
  url?: string | null
  expiresAt: string
}

export interface TransparentStatus {
  id: string
  status: string
  expiresAt: string
}

export interface TransparentCustomer {
  name: string
  taxId: string
  email?: string
  cellphone?: string
}

export type TransparentCreateInput =
  | {
      method: 'PIX'
      data: {
        amount: number
        description?: string
        expiresIn?: number
        externalId?: string
        metadata?: Record<string, unknown>
      }
    }
  | {
      method: 'BOLETO'
      data: {
        amount: number
        customer: TransparentCustomer
        /** YYYY-MM-DD. */
        dueDate?: string
        description?: string
        /** Hundredths of a percent per month (100 = 1%). */
        interest?: { value: number }
        fine?: { value: number; type: 'PERCENTAGE' | 'FIXED' }
        externalId?: string
        metadata?: Record<string, unknown>
      }
    }


/** Non-throwing variant of `request` for the transparent (Pix/boleto) calls. */
async function transparentCall<T>(
  path: string,
  init: RequestInit = {},
): Promise<AbacatePayResponse<T | null>> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: authHeaders(),
  })
  const body = (await response
    .json()
    .catch(() => null)) as AbacatePayResponse<T | null> | null
  if (!response.ok || !body) {
    return {
      success: false,
      data: null,
      error: body?.error ?? `AbacatePay request failed: ${response.status}`,
    }
  }
  return body
}

export const AbacatePayTransparent = {
  create(input: TransparentCreateInput) {
    return transparentCall<TransparentCharge>('/transparents/create', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },
  check(id: string) {
    return transparentCall<TransparentStatus>(
      `/transparents/check?id=${encodeURIComponent(id)}`,
    )
  },
}
