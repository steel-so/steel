import { normalizeKeys } from './keys'

/**
 * Single source of truth for Steel's keyboard shortcuts.
 *
 * The registry is metadata only: a screen binds the action with
 * `useShortcut(id, handler, { enabled })`, so the cheat sheet can show what
 * is mounted right now and the conflict tests (`shortcuts-registry.test.ts`)
 * can check every entry without rendering anything.
 *
 * To add a shortcut: add an entry here (unique `id`, pt-BR `label`), run the
 * unit tests (they reject duplicates in co-active scopes, sequence prefix
 * collisions, reserved browser/OS combos and Ctrl+Alt), then call
 * `useShortcut(id, handler)` in the component that owns the action.
 */

export type ShortcutScope =
  | 'global'
  | 'list'
  | 'kanban'
  | 'inbox'
  | 'servicedesk'
  | 'servicedesk.board'
  | 'servicedesk.ticket'
  | 'crm'
  | 'crm.tasks'
  | 'crm.record'
  | 'zap'
  | 'zap.conversation'
  | 'wiki'
  | 'ai'
  | 'editor'

type ScopeInfo = {
  /** Inner scopes win when two mounted bindings match the same keys. */
  depth: number
  /** Scopes of different modules are never on screen together. */
  module?: string
  /** Scopes that are never mounted together with this one. */
  excludes?: readonly ShortcutScope[]
  /**
   * Handled by a component (rich editor, composer): listed in the cheat sheet
   * but never dispatched by the provider.
   */
  documentationOnly?: boolean
}

export const SHORTCUT_SCOPES: Record<ShortcutScope, ScopeInfo> = {
  global: { depth: 0 },
  list: { depth: 1 },
  kanban: { depth: 2 },
  inbox: { depth: 1, module: 'inbox', excludes: ['list', 'kanban'] },
  servicedesk: { depth: 1, module: 'servicedesk' },
  'servicedesk.board': { depth: 2, module: 'servicedesk' },
  'servicedesk.ticket': {
    depth: 3,
    module: 'servicedesk',
    excludes: ['list', 'kanban', 'servicedesk.board'],
  },
  crm: { depth: 1, module: 'crm' },
  'crm.tasks': { depth: 2, module: 'crm' },
  'crm.record': { depth: 3, module: 'crm' },
  zap: { depth: 1, module: 'zap', excludes: ['list', 'kanban'] },
  'zap.conversation': {
    depth: 3,
    module: 'zap',
    excludes: ['list', 'kanban'],
  },
  wiki: { depth: 1, module: 'wiki', excludes: ['list', 'kanban'] },
  ai: { depth: 1, module: 'ai', excludes: ['list', 'kanban'] },
  editor: { depth: 9, module: 'editor', documentationOnly: true },
}

/** Can bindings of these two scopes be mounted at the same time? */
export function scopesCoActive(a: ShortcutScope, b: ShortcutScope): boolean {
  if (a === b) return true
  const left = SHORTCUT_SCOPES[a]
  const right = SHORTCUT_SCOPES[b]
  if (left.documentationOnly || right.documentationOnly) return false
  if (left.module && right.module && left.module !== right.module) return false
  if (left.excludes?.includes(b) || right.excludes?.includes(a)) return false
  return true
}

export const SHORTCUT_GROUPS = [
  { id: 'navigation', label: 'Navegação' },
  { id: 'actions', label: 'Ações' },
  { id: 'list', label: 'Listas e tabelas' },
  { id: 'kanban', label: 'Kanban' },
  { id: 'inbox', label: 'Caixa de entrada' },
  { id: 'servicedesk', label: 'ServiceDesk' },
  { id: 'ticket', label: 'Chamado' },
  { id: 'crm', label: 'CRM' },
  { id: 'zap', label: 'Comunicação' },
  { id: 'wiki', label: 'Wiki' },
  { id: 'ai', label: 'Steel AI' },
  { id: 'editor', label: 'Editor e mensagens' },
] as const

export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number]['id']

export type ShortcutDefinition = {
  id: string
  /** Alternatives (`['j', 'arrowdown']`), in the notation of `keys.ts`. */
  keys: readonly string[]
  /** macOS keys when they differ (editor headings use ⌘⌥). */
  macKeys?: readonly string[]
  scope: ShortcutScope
  group: ShortcutGroup
  /** pt-BR, shown in the cheat sheet, the palette and tooltips. */
  label: string
  /** Extra pt-BR note shown under the label in the cheat sheet. */
  note?: string
  /** Fires while focus is in an input/textarea/contenteditable. */
  allowInInput?: boolean
  /** Fires while a dialog or menu is open. */
  allowInDialog?: boolean
  /** Never fires inside the rich editor (the editor owns these keys). */
  notInRichEditor?: boolean
  /** Ids of outer bindings this one deliberately overrides. */
  shadows?: readonly string[]
  priority: 'P1' | 'P2'
}

type Entry = Omit<ShortcutDefinition, 'keys' | 'macKeys'> & {
  keys: string | readonly string[]
  macKeys?: string | readonly string[]
}

function list(keys: string | readonly string[]): readonly string[] {
  return (typeof keys === 'string' ? [keys] : keys).map(normalizeKeys)
}

function define(entries: Entry[]): readonly ShortcutDefinition[] {
  return entries.map(({ keys, macKeys, ...rest }) => ({
    ...rest,
    keys: list(keys),
    ...(macKeys ? { macKeys: list(macKeys) } : {}),
  }))
}

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
const HEADINGS = ['1', '2', '3', '4', '5', '6']

export const SHORTCUTS: readonly ShortcutDefinition[] = define([
  // ── Navegação (todo o workspace) ────────────────────────────────────────
  {
    id: 'nav.home',
    keys: 'g h',
    scope: 'global',
    group: 'navigation',
    label: 'Ir para a Início',
    priority: 'P1',
  },
  {
    id: 'nav.inbox',
    keys: 'g n',
    scope: 'global',
    group: 'navigation',
    label: 'Ir para a Caixa de entrada',
    priority: 'P1',
  },
  {
    id: 'nav.servicedesk',
    keys: 'g s',
    scope: 'global',
    group: 'navigation',
    label: 'Ir para o ServiceDesk',
    priority: 'P1',
  },
  {
    id: 'nav.crm',
    keys: 'g c',
    scope: 'global',
    group: 'navigation',
    label: 'Ir para o CRM',
    priority: 'P1',
  },
  {
    id: 'nav.zap',
    keys: 'g z',
    scope: 'global',
    group: 'navigation',
    label: 'Ir para a Comunicação',
    priority: 'P1',
  },
  {
    id: 'nav.ai',
    keys: 'g i',
    scope: 'global',
    group: 'navigation',
    label: 'Ir para o Steel AI',
    priority: 'P1',
  },
  {
    id: 'nav.wiki',
    keys: 'g w',
    scope: 'global',
    group: 'navigation',
    label: 'Ir para a Wiki',
    priority: 'P2',
  },
  {
    id: 'nav.whiteboard',
    keys: 'g q',
    scope: 'global',
    group: 'navigation',
    label: 'Ir para o Quadro-branco',
    priority: 'P2',
  },
  {
    id: 'nav.settings',
    keys: 'g a',
    scope: 'global',
    group: 'navigation',
    label: 'Ir para os Ajustes do workspace',
    priority: 'P2',
  },
  {
    id: 'nav.switch-workspace',
    keys: 'shift+w',
    scope: 'global',
    group: 'navigation',
    label: 'Trocar de workspace',
    priority: 'P2',
  },
  {
    id: 'nav.toggle-sidebar',
    keys: '[',
    scope: 'global',
    group: 'navigation',
    label: 'Recolher ou expandir a barra lateral do módulo',
    priority: 'P2',
  },

  // ── Ações globais ───────────────────────────────────────────────────────
  {
    id: 'global.search',
    keys: 'mod+k',
    scope: 'global',
    group: 'actions',
    label: 'Busca global e comandos',
    note: 'Dentro do editor de texto, Ctrl+K insere um link.',
    allowInInput: true,
    allowInDialog: true,
    notInRichEditor: true,
    priority: 'P1',
  },
  {
    id: 'global.shortcuts',
    keys: '?',
    scope: 'global',
    group: 'actions',
    label: 'Mostrar os atalhos do teclado',
    priority: 'P1',
  },
  {
    id: 'global.shortcuts-typing',
    keys: 'mod+/',
    scope: 'global',
    group: 'actions',
    label: 'Mostrar os atalhos do teclado (funciona digitando)',
    allowInInput: true,
    allowInDialog: true,
    priority: 'P2',
  },
  {
    id: 'global.ask-ai',
    keys: 'mod+i',
    scope: 'global',
    group: 'actions',
    label: 'Perguntar ao Steel AI sobre esta tela',
    note: 'Dentro do editor de texto, Ctrl+I é itálico.',
    allowInInput: true,
    notInRichEditor: true,
    priority: 'P1',
  },
  {
    id: 'create.ticket',
    keys: 'c t',
    scope: 'global',
    group: 'actions',
    label: 'Novo chamado',
    priority: 'P1',
  },
  {
    id: 'create.lead',
    keys: 'c l',
    scope: 'global',
    group: 'actions',
    label: 'Novo lead',
    priority: 'P1',
  },
  {
    id: 'create.opportunity',
    keys: 'c o',
    scope: 'global',
    group: 'actions',
    label: 'Nova oportunidade',
    priority: 'P2',
  },
  {
    id: 'create.person',
    keys: 'c p',
    scope: 'global',
    group: 'actions',
    label: 'Nova pessoa',
    priority: 'P2',
  },
  {
    id: 'create.company',
    keys: 'c e',
    scope: 'global',
    group: 'actions',
    label: 'Nova empresa',
    priority: 'P2',
  },
  {
    id: 'create.crm-task',
    keys: 'c a',
    scope: 'global',
    group: 'actions',
    label: 'Nova tarefa do CRM',
    priority: 'P2',
  },
  {
    id: 'create.conversation',
    keys: 'c m',
    scope: 'global',
    group: 'actions',
    label: 'Nova conversa de WhatsApp',
    priority: 'P2',
  },
  {
    id: 'create.ai-chat',
    keys: 'c i',
    scope: 'global',
    group: 'actions',
    label: 'Novo chat no Steel AI',
    priority: 'P2',
  },
  {
    id: 'global.submit',
    keys: 'mod+enter',
    scope: 'global',
    group: 'actions',
    label: 'Confirmar o formulário aberto (criar, salvar, enviar)',
    allowInInput: true,
    allowInDialog: true,
    priority: 'P1',
  },
  {
    id: 'global.escape',
    keys: 'escape',
    scope: 'global',
    group: 'actions',
    label: 'Fechar o diálogo ou painel; dentro de um campo, sair do campo',
    allowInInput: true,
    priority: 'P1',
  },
  {
    id: 'global.save',
    keys: 'mod+s',
    scope: 'global',
    group: 'actions',
    label: 'Salvar',
    note: 'Nas telas e painéis com botão Salvar.',
    allowInInput: true,
    allowInDialog: true,
    priority: 'P2',
  },
  {
    id: 'global.copy-link',
    keys: 'shift+l',
    scope: 'global',
    group: 'actions',
    label: 'Copiar o link desta página',
    priority: 'P2',
  },

  // ── Listas e tabelas ────────────────────────────────────────────────────
  {
    id: 'list.next',
    keys: ['j', 'arrowdown'],
    scope: 'list',
    group: 'list',
    label: 'Próximo item',
    priority: 'P1',
  },
  {
    id: 'list.prev',
    keys: ['k', 'arrowup'],
    scope: 'list',
    group: 'list',
    label: 'Item anterior',
    priority: 'P1',
  },
  {
    id: 'list.open',
    keys: ['enter', 'o'],
    scope: 'list',
    group: 'list',
    label: 'Abrir o item em foco',
    priority: 'P1',
  },
  {
    id: 'list.toggle-select',
    keys: 'x',
    scope: 'list',
    group: 'list',
    label: 'Selecionar ou desmarcar o item em foco',
    priority: 'P1',
  },
  {
    id: 'list.extend-down',
    keys: 'shift+j',
    scope: 'list',
    group: 'list',
    label: 'Estender a seleção para baixo',
    priority: 'P2',
  },
  {
    id: 'list.extend-up',
    keys: 'shift+k',
    scope: 'list',
    group: 'list',
    label: 'Estender a seleção para cima',
    priority: 'P2',
  },
  {
    id: 'list.select-all',
    keys: 'mod+a',
    scope: 'list',
    group: 'list',
    label: 'Selecionar todos (com a lista em foco)',
    priority: 'P2',
  },
  {
    id: 'list.clear',
    keys: 'escape',
    scope: 'list',
    group: 'list',
    label: 'Limpar a seleção',
    shadows: ['global.escape'],
    priority: 'P1',
  },
  {
    id: 'list.search',
    keys: '/',
    scope: 'list',
    group: 'list',
    label: 'Ir para a busca da lista',
    priority: 'P1',
  },
  {
    id: 'list.filters',
    keys: 'f',
    scope: 'list',
    group: 'list',
    label: 'Abrir os filtros',
    priority: 'P2',
  },
  {
    id: 'list.new',
    keys: 'n',
    scope: 'list',
    group: 'list',
    label: 'Novo registro nesta lista',
    priority: 'P1',
  },
  {
    id: 'list.edit',
    keys: 'e',
    scope: 'list',
    group: 'list',
    label: 'Editar o item em foco',
    priority: 'P2',
  },
  {
    id: 'list.delete',
    keys: '#',
    scope: 'list',
    group: 'list',
    label: 'Excluir os selecionados',
    priority: 'P2',
  },
  {
    id: 'list.toggle-view',
    keys: 'v',
    scope: 'list',
    group: 'list',
    label: 'Alternar a visualização (tabela, kanban, lista)',
    priority: 'P2',
  },
  {
    id: 'kanban.prev-column',
    keys: 'arrowleft',
    scope: 'kanban',
    group: 'kanban',
    label: 'Coluna anterior',
    priority: 'P2',
  },
  {
    id: 'kanban.next-column',
    keys: ['arrowright'],
    scope: 'kanban',
    group: 'kanban',
    label: 'Coluna seguinte',
    priority: 'P2',
  },
  {
    id: 'kanban.move-left',
    keys: ['shift+arrowleft'],
    scope: 'kanban',
    group: 'kanban',
    label: 'Mover o card para a etapa anterior',
    priority: 'P2',
  },
  {
    id: 'kanban.move-right',
    keys: ['shift+arrowright'],
    scope: 'kanban',
    group: 'kanban',
    label: 'Mover o card para a etapa seguinte',
    priority: 'P2',
  },

  // ── Caixa de entrada ────────────────────────────────────────────────────
  {
    id: 'inbox.next',
    keys: 'j',
    scope: 'inbox',
    group: 'inbox',
    label: 'Próxima notificação',
    priority: 'P1',
  },
  {
    id: 'inbox.prev',
    keys: 'k',
    scope: 'inbox',
    group: 'inbox',
    label: 'Notificação anterior',
    priority: 'P1',
  },
  {
    id: 'inbox.open',
    keys: 'enter',
    scope: 'inbox',
    group: 'inbox',
    label: 'Abrir a notificação em foco',
    priority: 'P1',
  },
  {
    id: 'inbox.back',
    keys: 'u',
    scope: 'inbox',
    group: 'inbox',
    label: 'Voltar para a lista',
    priority: 'P2',
  },
  {
    id: 'inbox.archive',
    keys: 'e',
    scope: 'inbox',
    group: 'inbox',
    label: 'Arquivar ou desarquivar',
    priority: 'P1',
  },
  {
    id: 'inbox.read',
    keys: 'r',
    scope: 'inbox',
    group: 'inbox',
    label: 'Marcar como lida ou não lida',
    priority: 'P1',
  },
  {
    id: 'inbox.snooze',
    keys: 's',
    scope: 'inbox',
    group: 'inbox',
    label: 'Adiar',
    note: 'No diálogo, 1–4 escolhem o horário.',
    priority: 'P1',
  },
  {
    id: 'inbox.delete',
    keys: '#',
    scope: 'inbox',
    group: 'inbox',
    label: 'Excluir',
    priority: 'P1',
  },
  {
    id: 'inbox.select',
    keys: 'x',
    scope: 'inbox',
    group: 'inbox',
    label: 'Selecionar ou desmarcar',
    priority: 'P1',
  },
  {
    id: 'inbox.ai',
    keys: 'i',
    scope: 'inbox',
    group: 'inbox',
    label: 'Alternar para as pendências da IA',
    priority: 'P1',
  },
  {
    id: 'inbox.search',
    keys: '/',
    scope: 'inbox',
    group: 'inbox',
    label: 'Buscar',
    priority: 'P1',
  },
  {
    id: 'inbox.clear',
    keys: 'escape',
    scope: 'inbox',
    group: 'inbox',
    label: 'Limpar a seleção',
    shadows: ['global.escape'],
    priority: 'P1',
  },

  // ── ServiceDesk ─────────────────────────────────────────────────────────
  {
    id: 'sd.go-tickets',
    keys: 'g t',
    scope: 'servicedesk',
    group: 'servicedesk',
    label: 'Todos os chamados',
    priority: 'P1',
  },
  {
    id: 'sd.go-incidents',
    keys: 'g 1',
    scope: 'servicedesk',
    group: 'servicedesk',
    label: 'Incidentes',
    priority: 'P2',
  },
  {
    id: 'sd.go-requests',
    keys: 'g 2',
    scope: 'servicedesk',
    group: 'servicedesk',
    label: 'Requisições',
    priority: 'P2',
  },
  {
    id: 'sd.go-changes',
    keys: 'g 3',
    scope: 'servicedesk',
    group: 'servicedesk',
    label: 'Mudanças',
    priority: 'P2',
  },
  {
    id: 'sd.go-problems',
    keys: 'g 4',
    scope: 'servicedesk',
    group: 'servicedesk',
    label: 'Problemas',
    priority: 'P2',
  },
  {
    id: 'sd.go-knowledge',
    keys: 'g k',
    scope: 'servicedesk',
    group: 'servicedesk',
    label: 'Base de conhecimento',
    priority: 'P2',
  },
  {
    id: 'sd.board.assign-me',
    keys: 'shift+a',
    scope: 'servicedesk.board',
    group: 'servicedesk',
    label: 'Atribuir a mim o chamado em foco',
    priority: 'P1',
  },
  {
    id: 'sd.ticket.reply',
    keys: 'r',
    scope: 'servicedesk.ticket',
    group: 'ticket',
    label: 'Responder',
    priority: 'P1',
  },
  {
    id: 'sd.ticket.note',
    keys: 'shift+r',
    scope: 'servicedesk.ticket',
    group: 'ticket',
    label: 'Nota interna',
    priority: 'P1',
  },
  {
    id: 'sd.ticket.assign',
    keys: 'a',
    scope: 'servicedesk.ticket',
    group: 'ticket',
    label: 'Atribuir',
    priority: 'P1',
  },
  {
    id: 'sd.ticket.assign-me',
    keys: 'shift+a',
    scope: 'servicedesk.ticket',
    group: 'ticket',
    label: 'Atribuir a mim',
    priority: 'P1',
  },
  {
    id: 'sd.ticket.phase',
    keys: 's',
    scope: 'servicedesk.ticket',
    group: 'ticket',
    label: 'Mudar a fase',
    priority: 'P1',
  },
  {
    id: 'sd.ticket.follow',
    keys: 'shift+f',
    scope: 'servicedesk.ticket',
    group: 'ticket',
    label: 'Seguir ou parar de seguir',
    priority: 'P2',
  },
  {
    id: 'sd.ticket.edit-title',
    keys: 'e',
    scope: 'servicedesk.ticket',
    group: 'ticket',
    label: 'Editar o título',
    priority: 'P2',
  },
  {
    id: 'sd.ticket.edit-description',
    keys: 'd',
    scope: 'servicedesk.ticket',
    group: 'ticket',
    label: 'Editar a descrição',
    priority: 'P2',
  },
  {
    id: 'sd.ticket.tab',
    keys: DIGITS,
    scope: 'servicedesk.ticket',
    group: 'ticket',
    label: 'Abrir a aba 1 a 9 (Conversa, WhatsApp, Tarefas…)',
    priority: 'P2',
  },
  {
    id: 'sd.ticket.toggle-details',
    keys: ']',
    scope: 'servicedesk.ticket',
    group: 'ticket',
    label: 'Mostrar ou ocultar o painel de detalhes',
    priority: 'P2',
  },
  {
    id: 'sd.ticket.next',
    keys: 'j',
    scope: 'servicedesk.ticket',
    group: 'ticket',
    label: 'Próximo chamado da lista',
    priority: 'P2',
  },
  {
    id: 'sd.ticket.prev',
    keys: 'k',
    scope: 'servicedesk.ticket',
    group: 'ticket',
    label: 'Chamado anterior da lista',
    priority: 'P2',
  },
  {
    id: 'sd.ticket.back',
    keys: 'u',
    scope: 'servicedesk.ticket',
    group: 'ticket',
    label: 'Voltar para a lista',
    priority: 'P2',
  },

  // ── CRM ─────────────────────────────────────────────────────────────────
  {
    id: 'crm.go-leads',
    keys: 'g l',
    scope: 'crm',
    group: 'crm',
    label: 'Leads',
    priority: 'P1',
  },
  {
    id: 'crm.go-opportunities',
    keys: 'g o',
    scope: 'crm',
    group: 'crm',
    label: 'Oportunidades',
    priority: 'P1',
  },
  {
    id: 'crm.go-people',
    keys: 'g p',
    scope: 'crm',
    group: 'crm',
    label: 'Pessoas',
    priority: 'P2',
  },
  {
    id: 'crm.go-companies',
    keys: 'g e',
    scope: 'crm',
    group: 'crm',
    label: 'Empresas',
    priority: 'P2',
  },
  {
    id: 'crm.go-tasks',
    keys: 'g t',
    scope: 'crm',
    group: 'crm',
    label: 'Tarefas',
    priority: 'P2',
  },
  {
    id: 'crm.go-proposals',
    keys: 'g r',
    scope: 'crm',
    group: 'crm',
    label: 'Documentos',
    priority: 'P2',
  },
  {
    id: 'crm.opportunity.won',
    keys: 'shift+g',
    scope: 'crm.record',
    group: 'crm',
    label: 'Marcar a oportunidade como ganha',
    priority: 'P2',
  },
  {
    id: 'crm.opportunity.lost',
    keys: 'shift+p',
    scope: 'crm.record',
    group: 'crm',
    label: 'Marcar a oportunidade como perdida',
    priority: 'P2',
  },
  {
    id: 'crm.record.new-task',
    keys: 'shift+t',
    scope: 'crm.record',
    group: 'crm',
    label: 'Nova tarefa ligada ao registro',
    priority: 'P2',
  },
  {
    id: 'crm.record.new-note',
    keys: 'shift+n',
    scope: 'crm.record',
    group: 'crm',
    label: 'Nova nota no registro',
    priority: 'P2',
  },
  {
    id: 'crm.record.back',
    keys: 'u',
    scope: 'crm.record',
    group: 'crm',
    label: 'Fechar o registro e voltar para a lista',
    priority: 'P2',
  },
  {
    id: 'crm.task.toggle-done',
    keys: 'shift+c',
    scope: 'crm.tasks',
    group: 'crm',
    label: 'Concluir ou reabrir a tarefa em foco',
    priority: 'P2',
  },

  // ── Comunicação ─────────────────────────────────────────────────────────
  {
    id: 'zap.next',
    keys: ['alt+arrowdown'],
    scope: 'zap',
    group: 'zap',
    label: 'Próxima conversa',
    note: 'Funciona digitando.',
    allowInInput: true,
    priority: 'P1',
  },
  {
    id: 'zap.prev',
    keys: ['alt+arrowup'],
    scope: 'zap',
    group: 'zap',
    label: 'Conversa anterior',
    allowInInput: true,
    priority: 'P1',
  },
  {
    id: 'zap.next-unread',
    keys: ['alt+shift+arrowdown'],
    scope: 'zap',
    group: 'zap',
    label: 'Próxima conversa não lida',
    allowInInput: true,
    priority: 'P2',
  },
  {
    id: 'zap.reply',
    keys: 'r',
    scope: 'zap.conversation',
    group: 'zap',
    label: 'Escrever mensagem',
    priority: 'P1',
  },
  {
    id: 'zap.archive',
    keys: 'e',
    scope: 'zap.conversation',
    group: 'zap',
    label: 'Arquivar ou desarquivar a conversa',
    priority: 'P2',
  },
  {
    id: 'zap.pin',
    keys: 'p',
    scope: 'zap.conversation',
    group: 'zap',
    label: 'Fixar ou desafixar a conversa',
    priority: 'P2',
  },
  {
    id: 'zap.transfer',
    keys: 't',
    scope: 'zap.conversation',
    group: 'zap',
    label: 'Transferir a conversa',
    priority: 'P2',
  },
  {
    id: 'zap.close',
    keys: 'shift+e',
    scope: 'zap.conversation',
    group: 'zap',
    label: 'Encerrar a conversa',
    priority: 'P2',
  },
  {
    id: 'zap.back',
    keys: 'u',
    scope: 'zap.conversation',
    group: 'zap',
    label: 'Fechar a conversa e voltar para a lista',
    priority: 'P2',
  },

  // ── Wiki ────────────────────────────────────────────────────────────────
  {
    id: 'wiki.new',
    keys: 'n',
    scope: 'wiki',
    group: 'wiki',
    label: 'Nova página',
    priority: 'P2',
  },
  {
    id: 'wiki.focus-editor',
    keys: 'e',
    scope: 'wiki',
    group: 'wiki',
    label: 'Editar a página (foca o editor)',
    priority: 'P2',
  },

  // ── Steel AI ────────────────────────────────────────────────────────────
  {
    id: 'ai.new-chat',
    keys: ['mod+shift+o'],
    scope: 'ai',
    group: 'ai',
    label: 'Novo chat',
    allowInInput: true,
    priority: 'P1',
  },
  {
    id: 'ai.stop',
    keys: 'escape',
    scope: 'ai',
    group: 'ai',
    label: 'Parar a resposta em andamento',
    allowInInput: true,
    shadows: ['global.escape'],
    priority: 'P1',
  },
  {
    id: 'ai.toggle-mode',
    keys: 'alt+m',
    scope: 'ai',
    group: 'ai',
    label: 'Alternar o modo Explorar ↔ Agente',
    allowInInput: true,
    priority: 'P2',
  },
  {
    id: 'ai.approve',
    keys: ['mod+shift+enter'],
    scope: 'ai',
    group: 'ai',
    label: 'Aprovar a ação pendente mais recente',
    allowInInput: true,
    priority: 'P2',
  },

  // ── Editor e composers (tratados pelo próprio componente) ────────────────
  {
    id: 'composer.send',
    keys: 'enter',
    scope: 'editor',
    group: 'editor',
    label: 'Enviar a mensagem',
    note: 'Ou Ctrl+Enter, conforme a preferência "Envio rápido"; a outra combinação quebra a linha.',
    priority: 'P1',
  },
  {
    id: 'composer.newline',
    keys: ['shift+enter'],
    scope: 'editor',
    group: 'editor',
    label: 'Quebrar a linha na mensagem',
    priority: 'P1',
  },
  {
    id: 'editor.bold',
    keys: 'mod+b',
    scope: 'editor',
    group: 'editor',
    label: 'Negrito',
    priority: 'P1',
  },
  {
    id: 'editor.italic',
    keys: 'mod+i',
    scope: 'editor',
    group: 'editor',
    label: 'Itálico',
    priority: 'P1',
  },
  {
    id: 'editor.underline',
    keys: 'mod+u',
    scope: 'editor',
    group: 'editor',
    label: 'Sublinhado',
    priority: 'P1',
  },
  {
    id: 'editor.code',
    keys: 'mod+e',
    scope: 'editor',
    group: 'editor',
    label: 'Código inline',
    priority: 'P2',
  },
  {
    id: 'editor.strike',
    keys: ['mod+shift+x'],
    scope: 'editor',
    group: 'editor',
    label: 'Tachado',
    priority: 'P2',
  },
  {
    id: 'editor.heading',
    keys: HEADINGS.map((n) => `mod+shift+${n}`),
    macKeys: HEADINGS.map((n) => `mod+alt+${n}`),
    scope: 'editor',
    group: 'editor',
    label: 'Título 1 a 6',
    priority: 'P2',
  },
  {
    id: 'editor.link',
    keys: 'mod+k',
    scope: 'editor',
    group: 'editor',
    label: 'Inserir ou editar link',
    priority: 'P2',
  },
  {
    id: 'editor.slash',
    keys: '/',
    scope: 'editor',
    group: 'editor',
    label: 'Menu de blocos, mensagens rápidas ou skills',
    note: 'No início do texto: blocos no editor, mensagens rápidas no WhatsApp, skills no Steel AI.',
    priority: 'P2',
  },
  {
    id: 'editor.undo',
    keys: 'mod+z',
    scope: 'editor',
    group: 'editor',
    label: 'Desfazer',
    priority: 'P1',
  },
  {
    id: 'editor.redo',
    keys: ['mod+shift+z'],
    scope: 'editor',
    group: 'editor',
    label: 'Refazer',
    priority: 'P1',
  },
])

const BY_ID = new Map(SHORTCUTS.map((entry) => [entry.id, entry]))

export function getShortcut(id: string): ShortcutDefinition {
  const entry = BY_ID.get(id)
  if (!entry) throw new Error(`Unknown shortcut "${id}"`)
  return entry
}

/** Keys for the platform (macOS may differ, e.g. editor headings). */
export function shortcutKeys(
  entry: ShortcutDefinition,
  isMac: boolean,
): readonly string[] {
  return isMac && entry.macKeys ? entry.macKeys : entry.keys
}

/** The heading/display keys: alternatives collapsed for long ranges. */
export function displayKeys(
  entry: ShortcutDefinition,
  isMac: boolean,
): readonly string[] {
  const keys = shortcutKeys(entry, isMac)
  // 1–9 and heading ranges: show first and last only.
  return keys.length > 3 ? [keys[0], keys[keys.length - 1]] : keys
}

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

/** Every word of the query appears in the text (accents and case ignored). */
export function matchesQuery(text: string, query: string): boolean {
  const haystack = fold(text)
  return fold(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term))
}

/** Accent/case-insensitive search over label, note, group and keys. */
export function searchShortcuts(
  entries: readonly ShortcutDefinition[],
  query: string,
): ShortcutDefinition[] {
  return entries.filter((entry) => {
    const group = SHORTCUT_GROUPS.find((g) => g.id === entry.group)?.label
    return matchesQuery(
      [entry.label, entry.note ?? '', group ?? '', ...entry.keys].join(' '),
      query,
    )
  })
}

/** Entries grouped in cheat-sheet order, empty groups dropped. */
export function groupShortcuts(entries: readonly ShortcutDefinition[]) {
  return SHORTCUT_GROUPS.map((group) => ({
    ...group,
    items: entries.filter((entry) => entry.group === group.id),
  })).filter((group) => group.items.length > 0)
}
