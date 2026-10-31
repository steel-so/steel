import type { SdNlConfigKind } from '@/src/schemas/sd-nl-config.schema'

export interface SdNlConfigDiffRowDTO {
  field: string
  label: string
  before: string
  after: string
}

/** Prévia: nada foi salvo. `config` volta intacto no `apply`. */
export interface SdNlConfigPreviewResultDTO {
  kind: SdNlConfigKind
  targetId: string | null
  targetName: string | null
  mode: 'create' | 'update'
  summary: string
  warnings: string[]
  /** Configuração validada (formato de criação). */
  config: Record<string, unknown>
  /** Descrição legível em pt-BR, uma linha por item. */
  lines: string[]
  /** Só em ajustes: campo a campo, antes e depois (apenas o que muda). */
  diff: SdNlConfigDiffRowDTO[] | null
}

export interface SdNlConfigApplyResultDTO {
  kind: SdNlConfigKind
  mode: 'create' | 'update'
  id: string
  name: string
}
