import type { CanvasOpError } from '@/src/lib/canvas/ops'
import type { CanvasCatalog } from '@/src/lib/canvas/registry'
import type { CanvasHistorySkip } from '@/src/lib/canvas/store'
import type { CanvasBreakpoint } from '@/src/lib/canvas/types'

export const BREAKPOINT_LABELS: Record<CanvasBreakpoint, string> = {
  base: 'Desktop',
  tablet: 'Tablet',
  mobile: 'Celular',
}

/** pt-BR label of a component type ("Botão"); the raw type when unknown. */
export function typeLabel(catalog: CanvasCatalog, type: string): string {
  return catalog.components[type]?.label ?? type
}

/** Toast copy for a refused operation. */
export function opErrorMessage(
  error: CanvasOpError,
  catalog: CanvasCatalog,
): string {
  switch (error.code) {
    case 'NOT_ACCEPTED':
      return `${typeLabel(catalog, error.childType)} não pode ficar dentro de ${typeLabel(catalog, error.parentType)}.`
    case 'MAX_CHILDREN':
      return `${typeLabel(catalog, error.parentType)} aceita no máximo ${error.max} ${error.max === 1 ? 'item' : 'itens'}.`
    case 'MIN_CHILDREN':
      return `${typeLabel(catalog, error.parentType)} precisa de pelo menos ${error.min} ${error.min === 1 ? 'item' : 'itens'}.`
    case 'REQUIRED':
      return `${typeLabel(catalog, error.type)} é obrigatório e não pode ser removido.`
    case 'UNIQUE':
      return `Só pode haver um ${typeLabel(catalog, error.type)} no documento.`
    case 'LOCKED':
      return 'Este elemento está travado. Destrave-o em Camadas para mover ou excluir.'
    case 'ROOT':
      return 'O elemento principal do documento não pode ser movido nem excluído.'
    case 'CYCLE':
      return 'Um elemento não pode ficar dentro dele mesmo.'
    case 'INVALID_PROPS':
      return 'Valor inválido para este campo.'
    case 'UNKNOWN_TYPE':
      return 'Este componente não está disponível neste editor.'
    case 'NODE_NOT_FOUND':
      return 'O elemento não existe mais.'
    case 'DUPLICATE_ID':
    case 'INVALID_DOCUMENT':
      return 'Não foi possível aplicar a alteração.'
  }
}

/** Toast copy for an undo/redo that left fields someone else changed. */
export function historySkipMessage(skip: CanvasHistorySkip): string {
  const action = skip.direction === 'undo' ? 'desfazer' : 'refazer'
  return skip.whole
    ? `Nada a ${action} neste passo: outra pessoa alterou os mesmos campos.`
    : `Parte do ${action} foi ignorada porque outra pessoa alterou o mesmo campo.`
}
