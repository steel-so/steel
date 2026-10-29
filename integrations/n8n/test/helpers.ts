import { vi } from 'vitest'

export type Params = Record<string, unknown>

export const NODE = { name: 'Steel', type: 'steel', typeVersion: 1 }

/** The credential every fake context hands out. */
export const CREDENTIALS = {
  baseUrl: 'https://steel.example.com.br/',
  token: 'stl_pat_test',
}

export function ok<T>(data: T, status = 200) {
  return { ok: true as const, status, data }
}

export function fail(status: number, code: string, message?: string) {
  return { ok: false as const, error: { status, code, message } }
}

export function page<T>(items: T[], nextCursor: string | null = null) {
  return ok({ items, nextCursor })
}

/** A fake `IExecuteFunctions` / hook / load-options context. */
export function makeContext(
  params: Params = {},
  extra: Record<string, unknown> = {},
) {
  const staticData: Record<string, unknown> = {}
  const ctx = {
    getNode: () => NODE,
    getCredentials: vi.fn(async () => ({ ...CREDENTIALS })),
    getNodeParameter: vi.fn((name: string, ...rest: unknown[]) => {
      // (name, itemIndex, fallback) in execute; (name, fallback) in hooks.
      const fallback = rest.length > 1 ? rest[1] : rest[0]
      if (name in params) return params[name]
      if (fallback !== undefined && typeof fallback !== 'number') {
        return fallback
      }
      if (typeof fallback === 'number' && rest.length > 1) return fallback
      throw new Error(`Parameter "${name}" not set in the test`)
    }),
    getInputData: vi.fn(() => [{ json: {} }]),
    continueOnFail: vi.fn(() => false),
    getWorkflowStaticData: vi.fn(() => staticData),
    helpers: {
      returnJsonArray: (rows: unknown) =>
        (Array.isArray(rows) ? rows : [rows]).map((json) => ({ json })),
      constructExecutionMetaData: (
        rows: Array<Record<string, unknown>>,
        meta: { itemData: unknown },
      ) => rows.map((row) => ({ ...row, pairedItem: meta.itemData })),
    },
    ...extra,
  }
  return Object.assign(ctx, { staticData })
}
