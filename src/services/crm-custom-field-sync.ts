import type { CrmCustomFieldDefinition } from '@prisma/client'
import { crmCustomFieldInvalid } from '@/src/errors'
import { coerceCustomFieldValue } from '@/src/lib/custom-field-value'
import { err, ok, type Result } from '@/src/lib/result'
import {
  CrmCustomFieldDefinitionRepository,
  CrmCustomFieldValueRepository,
} from '@/src/repositories/crm-custom-field.repository'
import type { CrmCustomFieldEntityDTO } from '@/types/crm-custom-field'

/**
 * Ponte entre as entidades (Company/Person/Opportunity) e o armazenamento
 * EAV. Os valores trafegam achatados no DTO como chaves `cf_<definitionId>`,
 * dentro de uma propriedade `customFields`.
 */

export const CUSTOM_FIELD_PREFIX = 'cf_'

export type CustomFieldMap = Record<string, unknown>

function coerceValue(
  def: CrmCustomFieldDefinition,
  raw: unknown,
): Result<string | number | boolean | null> {
  const coerced = coerceCustomFieldValue(def, raw)
  return coerced.ok
    ? ok(coerced.value)
    : err(crmCustomFieldInvalid(coerced.message))
}

export interface CustomFieldWrite {
  definitionId: string
  recordId: string
  value: unknown
}

/**
 * Valida e normaliza os valores recebidos (mapa `definitionId → valor`) sem
 * gravar nada. Ignora chaves que não correspondem a definições vivas da
 * entidade. Permite validar antes de criar o registro dono.
 */
export async function resolveCustomFieldWrites(
  workspaceId: string,
  entity: CrmCustomFieldEntityDTO,
  recordId: string,
  values: CustomFieldMap,
): Promise<Result<CustomFieldWrite[]>> {
  if (Object.keys(values).length === 0) return ok([])

  const defsResult = await CrmCustomFieldDefinitionRepository.listByWorkspace(
    workspaceId,
    { entity },
  )
  if (!defsResult.ok) return defsResult
  const byId = new Map(defsResult.value.map((d) => [d.id, d]))

  const writes: CustomFieldWrite[] = []
  for (const [definitionId, raw] of Object.entries(values)) {
    const def = byId.get(definitionId)
    if (!def) continue // definição inexistente/desativada — ignora
    const coerced = coerceValue(def, raw)
    if (!coerced.ok) return coerced
    writes.push({ definitionId, recordId, value: coerced.value })
  }
  return ok(writes)
}

/** Aplica os valores recebidos (mapa `definitionId → valor`) a um registro. */
export async function applyCustomFieldValues(
  workspaceId: string,
  entity: CrmCustomFieldEntityDTO,
  recordId: string,
  values: CustomFieldMap,
): Promise<Result<void>> {
  if (Object.keys(values).length === 0) return ok(undefined)
  const writes = await resolveCustomFieldWrites(
    workspaceId,
    entity,
    recordId,
    values,
  )
  if (!writes.ok) return writes
  return CrmCustomFieldValueRepository.applyForRecord(writes.value)
}

/**
 * Carrega os valores de vários registros como mapas achatados
 * `{ cf_<definitionId>: value }`, para mesclar nos DTOs.
 */
export async function loadCustomFieldMaps(
  recordIds: string[],
): Promise<Result<Map<string, CustomFieldMap>>> {
  const result = await CrmCustomFieldValueRepository.listByRecords(recordIds)
  if (!result.ok) return result

  const maps = new Map<string, CustomFieldMap>()
  for (const v of result.value) {
    let map = maps.get(v.recordId)
    if (!map) {
      map = {}
      maps.set(v.recordId, map)
    }
    map[`${CUSTOM_FIELD_PREFIX}${v.definitionId}`] = v.value
  }
  return ok(maps)
}

/** Mescla um único registro com seus valores custom (achatados `cf_<id>`). */
export async function withCustomFields<T extends { id: string }>(
  dto: T,
): Promise<Result<T & { customFields: CustomFieldMap }>> {
  const maps = await loadCustomFieldMaps([dto.id])
  if (!maps.ok) return maps
  return ok({ ...dto, customFields: maps.value.get(dto.id) ?? {} })
}

/** Mescla uma lista de DTOs com seus valores custom em batch (use em list). */
export async function withCustomFieldsList<T extends { id: string }>(
  dtos: T[],
): Promise<Result<(T & { customFields: CustomFieldMap })[]>> {
  if (dtos.length === 0) return ok([])
  const maps = await loadCustomFieldMaps(dtos.map((d) => d.id))
  if (!maps.ok) return maps
  return ok(
    dtos.map((d) => ({ ...d, customFields: maps.value.get(d.id) ?? {} })),
  )
}
