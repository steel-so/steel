import 'server-only'
import { ABACATE_PAY, ABACATE_PAY_CANCEL_PATH } from '@/lib/env/server'

const BASE_URL = 'https://api.abacatepay.com/v2'

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
    headers: {
      Authorization: `Bearer ${ABACATE_PAY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
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
      {
        headers: {
          Authorization: `Bearer ${ABACATE_PAY}`,
          'Content-Type': 'application/json'
        }
      }
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
