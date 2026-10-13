import 'server-only'

import mysql, { type Pool, type RowDataPacket } from 'mysql2/promise'
import { logger } from '@/lib/axiom/logger'
import { PABX_DEVICE_DB_URL } from '@/lib/env/server'
import type { AppError } from '@/src/errors/app-error'
import { pabxCallFailed, pabxNotConfigured } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'

/** A customer PABX as registered in the central `steel.device` table. */
export interface PabxDevice {
  id: string
  /** Address the Steel servers reach the PABX on (`ip1ext`). */
  host: string
  token: string
}

let pool: Pool | undefined

function getPool(url: string): Pool {
  pool ??= mysql.createPool({
    uri: url,
    connectionLimit: 2,
    connectTimeout: 5_000,
  })
  return pool
}

/**
 * Looks up an active device. `null` when it does not exist, is inactive or has
 * no PABX address. Only `id`, `ativo`, `token` and `ip1ext` are read.
 */
export async function findPabxDevice(
  deviceId: string,
): Promise<Result<PabxDevice | null, AppError>> {
  if (!PABX_DEVICE_DB_URL) return err(pabxNotConfigured())

  try {
    const [rows] = await getPool(PABX_DEVICE_DB_URL).execute<RowDataPacket[]>(
      'SELECT token, ip1ext FROM device WHERE id = ? AND ativo = 1 LIMIT 1',
      [deviceId],
    )
    const row = rows[0]
    const host = String(row?.ip1ext ?? '').trim()
    const token = String(row?.token ?? '').trim()
    if (!row || !host || !token) return ok(null)
    return ok({ id: deviceId, host, token })
  } catch (error) {
    logger.error('pabx device lookup failed', {
      deviceId,
      error: error instanceof Error ? error.message : String(error),
    })
    return err(pabxCallFailed('Não foi possível consultar o device do PABX.'))
  }
}
