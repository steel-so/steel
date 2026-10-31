import { z } from 'zod'
import {
  AddSdMajorIncidentUpdateSchema,
  DeclareSdMajorIncidentSchema,
  LinkSdMajorIncidentTicketsSchema,
  ListSdMajorIncidentsQuerySchema,
  ResolveSdMajorIncidentSchema,
  UpdateSdMajorIncidentSchema,
} from '@/src/schemas/sd-major-incident.schema'
import {
  CreateSdMaintenanceSchema,
  CreateSdStatusComponentSchema,
  UpdateSdMaintenanceSchema,
  UpdateSdStatusComponentSchema,
} from '@/src/schemas/sd-status-maintenance.schema'
import {
  AddSdStatusSubscriberSchema,
  CreateSdStatusPageSchema,
  SdStatusSubscriptionActionSchema,
  SubscribeSdStatusPageSchema,
  UpdateSdStatusPageSchema,
} from '@/src/schemas/sd-status-page.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  SdMajorIncidentDeclareDTO,
  SdMajorIncidentDTO,
  SdMajorIncidentLinkResultDTO,
  SdMajorIncidentListDTO,
  SdMajorIncidentResolveDTO,
  SdMajorIncidentSuggestionListDTO,
  SdPublicStatusPageDTO,
  SdStatusComponentDTO,
  SdStatusComponentListDTO,
  SdStatusMaintenanceDTO,
  SdStatusMaintenanceListDTO,
  SdStatusPageDTO,
  SdStatusPageListDTO,
  SdStatusSubscriberDTO,
  SdStatusSubscriberListDTO,
  SdStatusSubscriptionDTO,
  SdTicketMajorIncidentDTO,
} from '../../schemas/servicedesk/major-incident'

/**
 * ServiceDesk · incidente maior e páginas de status (S2) —
 * `app/api/workspaces/[id]/servicedesk/{major-incidents,status-pages}/**`, a
 * aba do chamado e as rotas públicas `app/api/status-page/**`.
 */

const INCIDENT = 'ServiceDesk · Incidente maior' as const
const PAGES = 'ServiceDesk · Páginas de status' as const

const WS = { id: 'Id do workspace.' }
const INCIDENTS = '/workspaces/{id}/servicedesk/major-incidents'
const INCIDENT_ITEM = `${INCIDENTS}/{incidentId}`
const PAGES_BASE = '/workspaces/{id}/servicedesk/status-pages'
const PAGE_ITEM = `${PAGES_BASE}/{pageId}`
const INCIDENT_PARAMS = { ...WS, incidentId: 'Id do incidente maior.' }
const PAGE_PARAMS = { ...WS, pageId: 'Id da página de status.' }

const ACCESS =
  'Acesso: sessão + agente com o módulo **ServiceDesk** habilitado e a permissão `sd-tickets` do tipo da ação.'
const ADMIN =
  'Acesso: sessão + **administrador** do ServiceDesk (`sd-settings`).'

const AGENT_ERRORS: ErrorEntry[] = [
  {
    code: 'FORBIDDEN',
    when: 'Não é membro do workspace ou o perfil não concede a permissão',
  },
  'WORKSPACE_SUSPENDED',
  { code: 'MODULE_DISABLED', when: 'Módulo ServiceDesk desabilitado' },
  { code: 'SD_NOT_AGENT', when: 'Não é agente do ServiceDesk' },
]
const NOT_FOUND: ErrorEntry = {
  code: 'SD_MAJOR_INCIDENT_NOT_FOUND',
  when: 'Incidente inexistente ou de outro workspace',
}
const RESOLVED: ErrorEntry = {
  code: 'SD_MAJOR_INCIDENT_RESOLVED',
  when: 'O incidente já foi resolvido',
}
const PAGE_NOT_FOUND: ErrorEntry = {
  code: 'SD_STATUS_PAGE_NOT_FOUND',
  when: 'Página inexistente ou de outro workspace',
}
const COMPONENT_NOT_FOUND: ErrorEntry = {
  code: 'SD_STATUS_COMPONENT_NOT_FOUND',
  when: 'Componente inexistente nesta página',
}
const MAINTENANCE_NOT_FOUND: ErrorEntry = {
  code: 'SD_MAINTENANCE_NOT_FOUND',
  when: 'Manutenção inexistente ou de outro workspace',
}
const MAINTENANCE_CLOSED: ErrorEntry = {
  code: 'SD_MAINTENANCE_CLOSED',
  when: 'A manutenção já terminou ou foi cancelada',
}
const MAINTENANCE_INVALID: ErrorEntry = {
  code: 'SD_MAINTENANCE_INVALID',
  when: 'Término antes do início, janela maior que 30 dias, no passado, ou supressão sem itens da CMDB',
}
const MAINTENANCES = '/workspaces/{id}/servicedesk/status-maintenances'
const MAINTENANCE_PARAMS = { ...WS, maintenanceId: 'Id da manutenção.' }
const COMPONENT_PARAMS = { ...PAGE_PARAMS, componentId: 'Id do componente.' }
const DELETED = z.literal(true)

const SLUG = { slug: 'Endereço da página de status.' }
const TOKEN = {
  ...SLUG,
  token: 'Token da inscrição, enviado por e-mail.',
}

export const sdMajorIncidentRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: INCIDENTS,
    tags: [INCIDENT],
    summary: 'Listar incidentes maiores',
    description: `Do mais recente ao mais antigo; \`status\` filtra ativos, resolvidos ou todos (padrão: ativos). ${ACCESS}`,
    params: WS,
    query: ListSdMajorIncidentsQuerySchema,
    responses: {
      200: { description: 'Incidentes.', schema: SdMajorIncidentListDTO },
    },
    errors: AGENT_ERRORS,
  },
  {
    method: 'post',
    path: INCIDENTS,
    tags: [INCIDENT],
    summary: 'Declarar incidente maior',
    description: `Declara o incidente a partir de um chamado do tipo incidente (o principal). Vincula os chamados filhos informados, liga as páginas de status (sem \`pageIds\`, as que combinam com o cliente/serviço do chamado), registra a primeira atualização e, com \`warRoom\`, abre um swarming no chamado principal. O que falhar sem impedir a declaração (sala de guerra, filhos) volta em \`warnings\`. Avisa comandante, responsável e líderes (\`major_incident.declared\`). Auditado. ${ACCESS}`,
    consent: true,
    params: WS,
    body: DeclareSdMajorIncidentSchema,
    responses: {
      201: {
        description: 'Incidente declarado.',
        schema: SdMajorIncidentDeclareDTO,
      },
    },
    errors: [
      ...AGENT_ERRORS,
      'SD_TICKET_NOT_FOUND',
      {
        code: 'SD_TICKET_CLOSED',
        when: 'Chamado principal fechado ou cancelado',
      },
      {
        code: 'SD_MAJOR_INCIDENT_INVALID_TICKET',
        when: 'O chamado principal não é um incidente',
      },
      {
        code: 'SD_MAJOR_INCIDENT_ALREADY_ACTIVE',
        when: 'O chamado já tem um incidente maior ativo',
      },
      {
        code: 'VALIDATION_ERROR',
        when: 'Comandante que não é membro, ou página de outro workspace',
      },
    ],
  },
  {
    method: 'get',
    path: INCIDENT_ITEM,
    tags: [INCIDENT],
    summary: 'Ver incidente maior',
    description: `Linha do tempo (mais recente primeiro) com a situação do envio aos assinantes, chamados filhos e páginas. ${ACCESS}`,
    params: INCIDENT_PARAMS,
    responses: {
      200: { description: 'Incidente.', schema: SdMajorIncidentDTO },
    },
    errors: [...AGENT_ERRORS, NOT_FOUND],
  },
  {
    method: 'patch',
    path: INCIDENT_ITEM,
    tags: [INCIDENT],
    summary: 'Editar incidente maior',
    description: `Título, resumo, impacto, comandante e páginas de status (a lista enviada substitui a atual). Só enquanto o incidente não foi resolvido. Auditado. ${ACCESS}`,
    consent: true,
    params: INCIDENT_PARAMS,
    body: UpdateSdMajorIncidentSchema,
    responses: {
      200: { description: 'Incidente.', schema: SdMajorIncidentDTO },
    },
    errors: [...AGENT_ERRORS, NOT_FOUND, RESOLVED],
  },
  {
    method: 'post',
    path: `${INCIDENT_ITEM}/updates`,
    tags: [INCIDENT],
    summary: 'Publicar atualização',
    description: `Registra uma atualização na linha do tempo e move o incidente para a situação informada (e o impacto, se vier). Com \`publish\` e ao menos uma página ligada, aparece nas páginas e o worker avisa por e-mail e WhatsApp os assinantes confirmados (cada atualização é enviada uma única vez). Os chamados filhos ganham uma entrada no histórico. Auditado. ${ACCESS}`,
    consent: true,
    params: INCIDENT_PARAMS,
    body: AddSdMajorIncidentUpdateSchema,
    responses: {
      201: { description: 'Incidente atualizado.', schema: SdMajorIncidentDTO },
    },
    errors: [...AGENT_ERRORS, NOT_FOUND, RESOLVED],
  },
  {
    method: 'post',
    path: `${INCIDENT_ITEM}/resolve`,
    tags: [INCIDENT],
    summary: 'Resolver incidente maior',
    description: `Encerra o incidente com a mensagem pública de fechamento e, opcionalmente, a nota interna do que resolveu. Os chamados filhos só são resolvidos junto quando \`childTicketIds\` os lista (confirmação do agente): cada um vai para a fase de resolução do tipo e volta com o próprio resultado em \`childResults\` (\`RESOLVED\`, \`SKIPPED\` ou \`FAILED\` com o motivo); um chamado que falha não impede os outros. Avisa o comandante e o responsável (\`major_incident.resolved\`). Auditado. ${ACCESS}`,
    consent: true,
    params: INCIDENT_PARAMS,
    body: ResolveSdMajorIncidentSchema,
    responses: {
      200: {
        description: 'Incidente e resultado dos chamados filhos.',
        schema: SdMajorIncidentResolveDTO,
      },
    },
    errors: [...AGENT_ERRORS, NOT_FOUND, RESOLVED],
  },
  {
    method: 'post',
    path: `${INCIDENT_ITEM}/tickets`,
    tags: [INCIDENT],
    summary: 'Vincular chamados filhos',
    description: `Aceita id, número ou código (\`INC-000123\`). Os que não existem, já estão vinculados ou são o chamado principal voltam em \`skipped\` com o motivo. Cada chamado ganha uma entrada no histórico. Auditado. ${ACCESS}`,
    consent: true,
    params: INCIDENT_PARAMS,
    body: LinkSdMajorIncidentTicketsSchema,
    responses: {
      200: { description: 'Resultado.', schema: SdMajorIncidentLinkResultDTO },
    },
    errors: [...AGENT_ERRORS, NOT_FOUND, RESOLVED],
  },
  {
    method: 'delete',
    path: `${INCIDENT_ITEM}/tickets/{ticketId}`,
    tags: [INCIDENT],
    summary: 'Desvincular chamado filho',
    description: `Tira o chamado do incidente (idempotente). Auditado. ${ACCESS}`,
    consent: true,
    params: { ...INCIDENT_PARAMS, ticketId: 'Id do chamado filho.' },
    responses: { 200: { description: 'Desvinculado.', schema: DELETED } },
    errors: [...AGENT_ERRORS, NOT_FOUND, RESOLVED],
  },
  {
    method: 'get',
    path: `${INCIDENT_ITEM}/suggestions`,
    tags: [INCIDENT],
    summary: 'Sugerir chamados filhos',
    description: `Incidentes abertos nas últimas 24 horas que ainda não estão vinculados e dividem a categoria, o item de configuração ou o cliente com o chamado principal (\`reasons\`). ${ACCESS}`,
    params: INCIDENT_PARAMS,
    responses: {
      200: {
        description: 'Sugestões.',
        schema: SdMajorIncidentSuggestionListDTO,
      },
    },
    errors: [...AGENT_ERRORS, NOT_FOUND, 'SD_TICKET_NOT_FOUND'],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/servicedesk/tickets/{ticketId}/major-incident',
    tags: [INCIDENT],
    summary: 'Incidente maior do chamado',
    description: `O incidente que o chamado comanda, o que ele integra como filho, se pode ser declarado e as páginas sugeridas para a declaração. ${ACCESS}`,
    params: {
      ...WS,
      ticketId: 'Id do chamado, número (`123`) ou código (`INC-000123`).',
    },
    responses: {
      200: { description: 'Situação.', schema: SdTicketMajorIncidentDTO },
    },
    errors: [
      ...AGENT_ERRORS,
      'SD_TICKET_NOT_FOUND',
      { code: 'SD_TICKET_FORBIDDEN', when: 'Sem vínculo com o chamado' },
    ],
  },
  // ----- Status pages (admin) ---------------------------------------------
  {
    method: 'get',
    path: PAGES_BASE,
    tags: [PAGES],
    summary: 'Listar páginas de status',
    description: `Com o número de assinantes confirmados e de incidentes ativos. ${ACCESS}`,
    params: WS,
    responses: {
      200: { description: 'Páginas.', schema: SdStatusPageListDTO },
    },
    errors: AGENT_ERRORS,
  },
  {
    method: 'post',
    path: PAGES_BASE,
    tags: [PAGES],
    summary: 'Criar página de status',
    description: `O endereço público é \`/status-page/<slug>\`. Sem \`slug\`, é gerado do nome com um sufixo aleatório. Auditado. ${ADMIN}`,
    consent: true,
    params: WS,
    body: CreateSdStatusPageSchema,
    responses: {
      201: { description: 'Página criada.', schema: SdStatusPageDTO },
    },
    errors: [
      ...AGENT_ERRORS,
      { code: 'SD_STATUS_PAGE_SLUG_TAKEN', when: 'O endereço já está em uso' },
    ],
  },
  {
    method: 'get',
    path: PAGE_ITEM,
    tags: [PAGES],
    summary: 'Ver página de status',
    description: ACCESS,
    params: PAGE_PARAMS,
    responses: { 200: { description: 'Página.', schema: SdStatusPageDTO } },
    errors: [...AGENT_ERRORS, PAGE_NOT_FOUND],
  },
  {
    method: 'patch',
    path: PAGE_ITEM,
    tags: [PAGES],
    summary: 'Editar página de status',
    description: `O endereço não muda. Despublicar fecha a página pública. Auditado. ${ADMIN}`,
    consent: true,
    params: PAGE_PARAMS,
    body: UpdateSdStatusPageSchema,
    responses: { 200: { description: 'Página.', schema: SdStatusPageDTO } },
    errors: [...AGENT_ERRORS, PAGE_NOT_FOUND],
  },
  {
    method: 'delete',
    path: PAGE_ITEM,
    tags: [PAGES],
    summary: 'Excluir página de status',
    description: `Remove a página e os assinantes; os incidentes ficam. Auditado. ${ADMIN}`,
    consent: true,
    params: PAGE_PARAMS,
    responses: { 200: { description: 'Excluída.', schema: DELETED } },
    errors: [...AGENT_ERRORS, PAGE_NOT_FOUND],
  },
  {
    method: 'get',
    path: `${PAGE_ITEM}/subscribers`,
    tags: [PAGES],
    summary: 'Listar assinantes',
    description: `Até 1000, do mais recente ao mais antigo, com os que aguardam confirmação. ${ACCESS}`,
    params: PAGE_PARAMS,
    responses: {
      200: { description: 'Assinantes.', schema: SdStatusSubscriberListDTO },
    },
    errors: [...AGENT_ERRORS, PAGE_NOT_FOUND],
  },
  {
    method: 'post',
    path: `${PAGE_ITEM}/subscribers`,
    tags: [PAGES],
    summary: 'Adicionar assinante',
    description: `E-mail ou WhatsApp (só dígitos, com DDI). Entra já confirmado: use apenas contatos que aceitaram receber os avisos. Quem já está na lista é devolvido (e um pendente fica confirmado). Auditado. ${ACCESS}`,
    consent: true,
    params: PAGE_PARAMS,
    body: AddSdStatusSubscriberSchema,
    responses: {
      201: { description: 'Assinante.', schema: SdStatusSubscriberDTO },
    },
    errors: [...AGENT_ERRORS, PAGE_NOT_FOUND],
  },
  {
    method: 'delete',
    path: `${PAGE_ITEM}/subscribers/{subscriberId}`,
    tags: [PAGES],
    summary: 'Remover assinante',
    description: `Auditado. ${ACCESS}`,
    consent: true,
    params: { ...PAGE_PARAMS, subscriberId: 'Id do assinante.' },
    responses: { 200: { description: 'Removido.', schema: DELETED } },
    errors: [
      ...AGENT_ERRORS,
      PAGE_NOT_FOUND,
      { code: 'SD_STATUS_SUBSCRIBER_NOT_FOUND', when: 'Assinante inexistente' },
    ],
  },
  // ----- Public (no session) ----------------------------------------------
  {
    method: 'get',
    path: '/status-page/{slug}',
    tags: [PAGES],
    auth: 'public',
    rateLimit: 'ip',
    summary: 'Página de status (pública)',
    description:
      'Sem sessão — o endereço é o acesso. Só expõe texto escrito para o cliente: título, resumo e mensagens publicadas dos incidentes ligados à página (ativos e resolvidos nos últimos 30 dias). `overall` é o pior impacto entre os ativos.',
    params: SLUG,
    responses: {
      200: { description: 'Página.', schema: SdPublicStatusPageDTO },
    },
    errors: [
      {
        code: 'SD_STATUS_PAGE_NOT_FOUND',
        when: 'Endereço desconhecido ou página despublicada',
      },
    ],
  },
  {
    method: 'post',
    path: '/status-page/{slug}/subscribe',
    tags: [PAGES],
    auth: 'public',
    rateLimit: 'ip',
    summary: 'Assinar por e-mail (pública)',
    description:
      'Confirmação em duas etapas: envia um e-mail com o link de confirmação e nada é enviado antes dela. A resposta é a mesma para um endereço novo, pendente ou já confirmado (não revela quem assina).',
    params: SLUG,
    body: SubscribeSdStatusPageSchema,
    responses: {
      202: {
        description: 'Aguardando a confirmação por e-mail.',
        schema: z.object({ pendingConfirmation: z.literal(true) }),
      },
    },
    errors: [
      {
        code: 'SD_STATUS_PAGE_NOT_FOUND',
        when: 'Página desconhecida ou despublicada',
      },
      {
        code: 'SD_STATUS_SUBSCRIPTIONS_CLOSED',
        when: 'A página não aceita inscrições',
      },
    ],
  },
  {
    method: 'get',
    path: '/status-page/{slug}/subscriptions/{token}',
    tags: [PAGES],
    auth: 'public',
    rateLimit: 'ip',
    summary: 'Ver inscrição (pública)',
    description:
      'O token do e-mail é o acesso. O endereço volta mascarado (`j***@acme.com.br`).',
    params: TOKEN,
    responses: {
      200: { description: 'Inscrição.', schema: SdStatusSubscriptionDTO },
    },
    errors: [
      { code: 'SD_STATUS_SUBSCRIBER_NOT_FOUND', when: 'Token desconhecido' },
    ],
  },
  {
    method: 'post',
    path: '/status-page/{slug}/subscriptions/{token}',
    tags: [PAGES],
    auth: 'public',
    rateLimit: 'ip',
    summary: 'Confirmar ou cancelar inscrição (pública)',
    description:
      '`CONFIRM` ativa os avisos; `UNSUBSCRIBE` apaga a inscrição. É um POST de propósito: abrir o link do e-mail não muda nada, só o clique.',
    params: TOKEN,
    body: SdStatusSubscriptionActionSchema,
    responses: {
      200: { description: 'Inscrição.', schema: SdStatusSubscriptionDTO },
    },
    errors: [
      { code: 'SD_STATUS_SUBSCRIBER_NOT_FOUND', when: 'Token desconhecido' },
    ],
  },
  {
    method: 'get',
    path: `${PAGE_ITEM}/components`,
    tags: [PAGES],
    summary: 'Listar componentes da página',
    description: `Serviços com estado próprio, na ordem em que aparecem na página pública. ${ACCESS}`,
    params: PAGE_PARAMS,
    responses: {
      200: { description: 'Componentes.', schema: SdStatusComponentListDTO },
    },
    errors: [...AGENT_ERRORS, PAGE_NOT_FOUND],
  },
  {
    method: 'post',
    path: `${PAGE_ITEM}/components`,
    tags: [PAGES],
    summary: 'Criar componente',
    description: `\`serviceId\` (opcional) liga o componente a um serviço do catálogo. Auditado. ${ADMIN}`,
    consent: true,
    params: PAGE_PARAMS,
    body: CreateSdStatusComponentSchema,
    responses: {
      201: { description: 'Componente.', schema: SdStatusComponentDTO },
    },
    errors: [
      ...AGENT_ERRORS,
      PAGE_NOT_FOUND,
      { code: 'VALIDATION_ERROR', when: 'Serviço inexistente neste workspace' },
    ],
  },
  {
    method: 'patch',
    path: `${PAGE_ITEM}/components/{componentId}`,
    tags: [PAGES],
    summary: 'Alterar componente',
    description:
      'Trocar só o `state` é ação de agente com `sd-tickets` de edição (quem atende o incidente); renomear, religar ao catálogo e reordenar são do administrador. O estado vale na hora na página pública e no estado geral. Auditado.',
    consent: true,
    params: COMPONENT_PARAMS,
    body: UpdateSdStatusComponentSchema,
    responses: {
      200: { description: 'Componente.', schema: SdStatusComponentDTO },
    },
    errors: [...AGENT_ERRORS, COMPONENT_NOT_FOUND],
  },
  {
    method: 'delete',
    path: `${PAGE_ITEM}/components/{componentId}`,
    tags: [PAGES],
    summary: 'Remover componente',
    description: `Auditado. ${ADMIN}`,
    consent: true,
    params: COMPONENT_PARAMS,
    responses: { 200: { description: 'Removido.', schema: DELETED } },
    errors: [...AGENT_ERRORS, COMPONENT_NOT_FOUND],
  },
  {
    method: 'get',
    path: MAINTENANCES,
    tags: [PAGES],
    summary: 'Listar manutenções programadas',
    description: `Janelas que terminam a partir de 7 dias atrás (agendadas, em andamento, concluídas e canceladas), da mais próxima à mais distante. ${ACCESS}`,
    params: WS,
    responses: {
      200: {
        description: 'Manutenções.',
        schema: SdStatusMaintenanceListDTO,
      },
    },
    errors: AGENT_ERRORS,
  },
  {
    method: 'post',
    path: MAINTENANCES,
    tags: [PAGES],
    summary: 'Agendar manutenção',
    description: `Aparece como aviso nas páginas escolhidas (a partir de 14 dias antes) e, com \`notifySubscribers\`, vira o job \`notify-maintenance\` na fila \`servicedesk-mail\` (e-mail e WhatsApp, no máximo uma vez). Com \`suppressMonitoring\`, alertas do monitoramento sobre os itens da CMDB listados não abrem chamado enquanto a janela estiver em andamento (ficam registrados como alertas suprimidos). As datas levam o fuso (\`2026-11-10T19:00:00-03:00\`). Auditado. ${ACCESS}`,
    consent: true,
    params: WS,
    body: CreateSdMaintenanceSchema,
    responses: {
      201: { description: 'Manutenção.', schema: SdStatusMaintenanceDTO },
    },
    errors: [
      ...AGENT_ERRORS,
      MAINTENANCE_INVALID,
      {
        code: 'VALIDATION_ERROR',
        when: 'Página de status ou item da CMDB inexistente neste workspace',
      },
    ],
  },
  {
    method: 'patch',
    path: `${MAINTENANCES}/{maintenanceId}`,
    tags: [PAGES],
    summary: 'Alterar manutenção',
    description: `Só enquanto a janela não terminou e não foi cancelada. Mudar o horário de uma janela já avisada reenvia o aviso como reagendamento. Auditado. ${ACCESS}`,
    consent: true,
    params: MAINTENANCE_PARAMS,
    body: UpdateSdMaintenanceSchema,
    responses: {
      200: { description: 'Manutenção.', schema: SdStatusMaintenanceDTO },
    },
    errors: [
      ...AGENT_ERRORS,
      MAINTENANCE_NOT_FOUND,
      MAINTENANCE_CLOSED,
      MAINTENANCE_INVALID,
      { code: 'VALIDATION_ERROR', when: 'Página ou item da CMDB inexistente' },
    ],
  },
  {
    method: 'delete',
    path: `${MAINTENANCES}/{maintenanceId}`,
    tags: [PAGES],
    summary: 'Cancelar manutenção',
    description: `A janela fica na lista como cancelada e some das páginas públicas; quem recebeu o aviso recebe um aviso de cancelamento. Auditado. ${ACCESS}`,
    consent: true,
    params: MAINTENANCE_PARAMS,
    responses: {
      200: { description: 'Manutenção.', schema: SdStatusMaintenanceDTO },
    },
    errors: [...AGENT_ERRORS, MAINTENANCE_NOT_FOUND, MAINTENANCE_CLOSED],
  },
]
