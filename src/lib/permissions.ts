/**
 * Catálogo de permissões do RBAC. Um perfil tem um mapa `recurso → [ações]`.
 * Perfis de sistema (OWNER/ADMIN/MEMBER/VIEWER) têm matrizes padrão definidas
 * aqui — o código é a fonte da verdade delas, não o JSON salvo no banco.
 *
 * Regra geral: **negação por padrão**. Recurso ou ação ausente do mapa =
 * bloqueado.
 */

export const PERMISSION_ACTIONS = ['VIEW', 'CREATE', 'EDIT', 'DELETE'] as const
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number]

/** Recursos protegidos. Cada service de mutação referencia um destes. */
export const PERMISSION_RESOURCES = [
  'companies',
  'people',
  'opportunities',
  'products',
  'pipelines',
  'quotas',
  'custom-fields',
  'tasks',
  'notes',
  'documents',
  'forms',
  'landing-pages',
  'email',
  'dashboards',
  'workflows',
  'social',
  'integrations',
  'members',
  'settings',
  'audit-logs',
  'leads',
  'reports',
  // Comunicação (WhatsApp)
  'conversations',
  'contacts',
  'groups',
  'broadcasts',
  'message-templates',
  'quick-replies',
  // ServiceDesk — além da matriz, o service distingue agente (membro de algum
  // departamento) de solicitante (só portal e os próprios chamados).
  'sd-tickets',
  'sd-customers',
  'sd-contacts',
  'sd-config-items',
  'sd-knowledge',
  'sd-dashboards',
  'sd-portal',
  'sd-settings',
  // ServiceDesk — canais de entrada e portal do contato externo
  'sd-channels',
  // ServiceDesk — contratos e horas, mudanças (CAB) e plantão
  'sd-contracts',
  'sd-change-calendar',
  'sd-oncall',
  // ServiceDesk — relatórios agendados e integrações (Slack/GitHub)
  'sd-reports',
  'sd-integrations',
  // Steel AI — agentes autônomos: admin gerencia, membro visualiza
  'steel-agents',
] as const
export type PermissionResource = (typeof PERMISSION_RESOURCES)[number]

export type PermissionMap = Partial<Record<string, PermissionAction[]>>

const ALL: PermissionAction[] = ['VIEW', 'CREATE', 'EDIT', 'DELETE']
const RWC: PermissionAction[] = ['VIEW', 'CREATE', 'EDIT']
const READ: PermissionAction[] = ['VIEW']

/** Recursos que um Membro pode criar/editar (mas não excluir). */
const MEMBER_ENTITIES = new Set<PermissionResource>([
  'companies',
  'people',
  'opportunities',
  'products',
  'tasks',
  'notes',
  'documents',
  'forms',
  'landing-pages',
  'email',
  'dashboards',
  'workflows',
  'social',
  'leads',
  'reports',
  'conversations',
  'contacts',
  'groups',
  'quick-replies',
  'sd-tickets',
  'sd-customers',
  'sd-contacts',
  'sd-config-items',
  'sd-knowledge',
  'sd-dashboards',
  'sd-portal',
  // Agente aponta hora e enxerga a agenda de mudanças e o plantão; mexer em
  // contrato e em escala é coisa de admin (MEMBER_READONLY abaixo).
  'sd-change-calendar',
  'sd-oncall',
])

/**
 * Recursos que o Membro só pode visualizar: configuração do CRM e, na
 * Comunicação, transmissões e templates (criação restrita a admins).
 */
const MEMBER_READONLY = new Set<PermissionResource>([
  'pipelines',
  'quotas',
  'custom-fields',
  'audit-logs',
  'broadcasts',
  'message-templates',
  'sd-settings',
  'sd-channels',
  'sd-contracts',
  // Agente lê o histórico de relatórios; agendar e definir destinatários é
  // coisa de admin. Integrações (`sd-integrations`) nem aparecem: conectar
  // Slack/GitHub exige token do workspace.
  'sd-reports',
  // Membro acompanha os agentes e as execuções; criar e editar é de admin.
  'steel-agents',
])

function fullMatrix(): PermissionMap {
  const map: PermissionMap = {}
  for (const r of PERMISSION_RESOURCES) map[r] = [...ALL]
  return map
}

function memberMatrix(): PermissionMap {
  const map: PermissionMap = {}
  for (const r of PERMISSION_RESOURCES) {
    if (MEMBER_ENTITIES.has(r)) map[r] = [...RWC]
    else if (MEMBER_READONLY.has(r)) map[r] = [...READ]
    else map[r] = [] // members, settings, integrations: sem acesso
  }
  return map
}

/**
 * Visualizador: somente leitura (VIEW) em tudo que o Membro enxerga. Nunca
 * cria, edita ou exclui, e não vê membros, configurações nem integrações.
 */
function viewerMatrix(): PermissionMap {
  const map: PermissionMap = {}
  for (const r of PERMISSION_RESOURCES) {
    map[r] = MEMBER_ENTITIES.has(r) || MEMBER_READONLY.has(r) ? [...READ] : []
  }
  return map
}

/** Matrizes padrão dos perfis de sistema, por `systemKey`. */
export const SYSTEM_PROFILE_PERMISSIONS: Record<string, PermissionMap> = {
  OWNER: fullMatrix(),
  ADMIN: fullMatrix(),
  MEMBER: memberMatrix(),
  VIEWER: viewerMatrix(),
}

/** Definição dos perfis de sistema semeados em toda workspace. */
export const SYSTEM_PROFILES = [
  { systemKey: 'OWNER', name: 'Proprietário' },
  { systemKey: 'ADMIN', name: 'Administrador' },
  { systemKey: 'MEMBER', name: 'Membro' },
  { systemKey: 'VIEWER', name: 'Visualizador' },
] as const

/** Mapa `role` (enum legado) → `systemKey` do perfil. */
export const ROLE_TO_SYSTEM_KEY: Record<string, string> = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MEMBER: 'MEMBER',
  VIEWER: 'VIEWER',
}

/**
 * Recurso de permissão de cada segmento de rota/tabela do CRM (o nome usado
 * nas URLs e no `DataTable` nem sempre é o do catálogo).
 */
export const CRM_ROUTE_RESOURCE: Record<string, PermissionResource> = {
  companies: 'companies',
  people: 'people',
  opportunities: 'opportunities',
  products: 'products',
  pipelines: 'pipelines',
  tasks: 'tasks',
  notes: 'notes',
  proposals: 'documents',
  'proposal-templates': 'documents',
  forms: 'forms',
  'landing-pages': 'landing-pages',
  'email-campaigns': 'email',
  campaigns: 'email',
  'email-templates': 'email',
  'mailing-lists': 'email',
  newsletters: 'email',
  dashboards: 'dashboards',
  reports: 'reports',
  workflows: 'workflows',
  competitors: 'social',
  'hook-vault': 'social',
  leads: 'leads',
  cadences: 'leads',
  duplicates: 'people',
}

/** O perfil concede a ação no recurso? */
export function can(
  permissions: PermissionMap,
  resource: string,
  action: PermissionAction,
): boolean {
  const actions = permissions[resource]
  return Array.isArray(actions) && actions.includes(action)
}

/** Mantém só pares recurso/ação válidos (saneia entrada de perfis custom). */
export function sanitizePermissions(input: unknown): PermissionMap {
  const out: PermissionMap = {}
  if (!input || typeof input !== 'object') return out
  for (const [resource, actions] of Object.entries(
    input as Record<string, unknown>,
  )) {
    if (!(PERMISSION_RESOURCES as readonly string[]).includes(resource))
      continue
    if (!Array.isArray(actions)) continue
    const valid = actions.filter((a): a is PermissionAction =>
      (PERMISSION_ACTIONS as readonly string[]).includes(a),
    )
    out[resource] = [...new Set(valid)]
  }
  return out
}
