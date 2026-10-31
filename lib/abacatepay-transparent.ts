import 'server-only'
import { ABACATE_PAY } from '@/lib/env/server'

/**
 * AbacatePay API v2 client for transparent charges (Pix and boleto):
 * `POST /transparents/create` and `GET /transparents/check`. Kept apart from
 * `lib/abacatepay.ts` (subscription billing) on purpose; it never throws for
 * HTTP failures, callers read `ok`.
 */
const BASE_URL = 'https://api.abacatepay.com/v2'

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

interface Envelope<T> {
  success: boolean
  data: T | null
  error: string | null
}

async function call<T>(
  path: string,
  init: RequestInit = {},
): Promise<Envelope<T>> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${ABACATE_PAY}`,
      'Content-Type': 'application/json',
    },
  })
  const body = (await response.json().catch(() => null)) as Envelope<T> | null
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
    return call<TransparentCharge>('/transparents/create', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },
  check(id: string) {
    return call<TransparentStatus>(
      `/transparents/check?id=${encodeURIComponent(id)}`,
    )
  },
}
