import { createHash, randomBytes } from 'node:crypto'
import type { ModuleKind } from '@prisma/client'
import { API_SCOPES, type ApiScope } from '@/src/lib/api/session'

/**
 * Wire format of personal API tokens (ADR 0035): `stl_pat_` + 43 random
 * base64url characters (32 bytes). Only the SHA-256 (hex) of the whole value
 * is stored; the first 8 characters after the prefix are kept for display.
 */

export const API_TOKEN_PREFIX = 'stl_pat_'
export const API_TOKEN_DISPLAY_LENGTH = 8
const RANDOM_BYTES = 32
/** 32 bytes in base64url, unpadded. */
const RANDOM_LENGTH = 43
const TOKEN_PATTERN = /^stl_pat_[A-Za-z0-9_-]{32,128}$/

/** Default and maximum validity, in days. */
export const API_TOKEN_DEFAULT_DAYS = 90
export const API_TOKEN_MAX_DAYS = 365
const DAY_MS = 24 * 60 * 60 * 1000

export const API_MODULE_ORDER: readonly ModuleKind[] = [
  'SERVICE_DESK',
  'CRM',
  'COMMUNICATION',
]

export interface GeneratedApiToken {
  /** The value handed to the user once. */
  token: string
  tokenHash: string
  prefix: string
}

export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function generateApiToken(): GeneratedApiToken {
  const random = randomBytes(RANDOM_BYTES).toString('base64url')
  const token = `${API_TOKEN_PREFIX}${random.slice(0, RANDOM_LENGTH)}`
  return {
    token,
    tokenHash: hashApiToken(token),
    prefix: random.slice(0, API_TOKEN_DISPLAY_LENGTH),
  }
}

/** Whether `value` looks like a personal token (cheap pre-check before the DB). */
export function isApiTokenFormat(value: string): boolean {
  return TOKEN_PATTERN.test(value)
}

export function apiTokenExpiry(now: Date, days: number): Date {
  return new Date(now.getTime() + days * DAY_MS)
}

/** Modules in canonical order, deduplicated. */
export function sortApiModules(modules: Iterable<ModuleKind>): ModuleKind[] {
  const set = new Set(modules)
  return API_MODULE_ORDER.filter((module) => set.has(module))
}

/** Keeps only the API scopes, in canonical order. */
export function toApiScopes(scopes: readonly string[]): ApiScope[] {
  return API_SCOPES.filter((scope) => scopes.includes(scope))
}
