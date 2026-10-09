import { z } from 'zod'
import { SubmitCrmFormSchema } from '@/src/schemas/crm-form.schema'
import { IngestCrmLeadSchema } from '@/src/schemas/crm-integration-key.schema'
import { RecordCrmLandingPageViewSchema } from '@/src/schemas/crm-landing-page.schema'
import {
  AcceptCrmProposalSchema,
  RecordCrmProposalViewSchema,
} from '@/src/schemas/crm-proposal.schema'
import type { ErrorEntry, OpenApiRegistry, RouteConfig } from '../registry'
import {
  CrmFormPublicDTO,
  CrmFormSubmissionDTO,
  CrmLandingPagePublicDTO,
  CrmLeadDTO,
  CrmProposalPublicDTO,
  CrmWorkflowRunDTO,
} from '../schemas/public'

/**
 * APIs públicas do CRM (`app/api/crm/*`): consumidas por visitantes (páginas
 * `/f`, `/p`, `/l`, `/unsubscribe`) e por sistemas de clientes (API de leads,
 * webhooks de workflow). Sem sessão — o token no path (ou a chave de API) é
 * o acesso. Todas respondem no envelope padrão e aplicam rate limit por IP.
 */

const CRM_DISABLED: ErrorEntry = {
  code: 'MODULE_DISABLED',
  when: 'O workspace dono do recurso está com o CRM desabilitado',
}

const PUBLIC = { auth: 'public', rateLimit: 'ip' } as const

const lead = {
  id: 'ckw1lead0000ab7d3k1e5xyz',
  workspaceId: 'ckv9x2p0h0000ws7d3k1e5abc',
  name: 'Carlos Lima',
  emails: ['carlos@empresa.com.br'],
  phones: ['+5511999990000'],
  company: 'Empresa Exemplo Ltda',
  jobTitle: 'Gerente de TI',
  city: 'São Paulo',
  linkedin: null,
  source: 'site',
  channel: 'API',
  stage: 'RECEIVED',
  score: 40,
  ownerId: 'ckv9x2p0h0000us7d3k1e5abc',
  convertedPersonId: null,
  closeResult: null,
  closedAt: null,
  contractSignedAt: null,
  billingType: null,
  closedAmount: null,
  lostReason: null,
  lostNote: null,
  retryAt: null,
  createdById: 'ckv9x2p0h0000us7d3k1e5abc',
  updatedById: null,
  position: 0,
  createdAt: '2026-09-18T13:00:00.000Z',
  updatedAt: '2026-09-18T13:00:00.000Z',
}

const routes: RouteConfig[] = [
  /* ------------------------------ formulários ----------------------------- */
  {
    ...PUBLIC,
    method: 'get',
    path: '/crm/forms/{publicToken}',
    tags: ['CRM público · Formulários'],
    summary: 'Obter formulário publicado',
    description:
      'Estrutura do formulário para renderizar (é o que a página `/f/<publicToken>` usa). Só formulários com status `PUBLISHED` respondem.',
    params: {
      publicToken: {
        description:
          'Token público do formulário (vem no link de compartilhamento).',
        example: 'f_9Qm2xL7aP0',
      },
    },
    responses: {
      200: {
        description: 'Formulário.',
        schema: CrmFormPublicDTO,
        example: {
          id: 'ckw1form0000ab7d3k1e5xyz',
          name: 'Solicite um orçamento',
          description: 'Retornamos em até 1 dia útil.',
          fields: [
            {
              key: 'nome',
              label: 'Nome',
              type: 'text',
              required: true,
              mapping: { target: 'lead', attribute: 'name' },
            },
            {
              key: 'email',
              label: 'E-mail',
              type: 'email',
              required: true,
              mapping: { target: 'lead', attribute: 'email' },
            },
            {
              key: 'telefone',
              label: 'Telefone',
              type: 'phone',
              required: false,
              placeholder: '(11) 99999-0000',
              mapping: { target: 'lead', attribute: 'phone' },
            },
          ],
          phases: [],
          successMessage: 'Obrigado! Entraremos em contato.',
          redirectUrl: null,
        },
      },
    },
    errors: [
      {
        code: 'RESOURCE_NOT_FOUND',
        message: 'CrmForm not found',
        when: 'Token inexistente',
      },
      { code: 'CRM_FORM_NOT_PUBLISHED', when: 'Formulário em rascunho' },
      CRM_DISABLED,
    ],
  },
  {
    ...PUBLIC,
    method: 'post',
    path: '/crm/forms/{publicToken}/submit',
    tags: ['CRM público · Formulários'],
    summary: 'Enviar formulário',
    description: [
      'Registra o envio e cria o registro configurado no formulário (`action`): pessoa, empresa ou lead. Leads passam pelo mesmo pipeline da criação manual (dedupe contra leads em aberto, score e roteamento).',
      '',
      '`values` é chaveado pela `key` de cada campo: `checkbox` → boolean, os demais → string. O `Referer` da requisição é gravado como origem.',
      '',
      "O servidor valida cada valor contra a definição do campo: obrigatórios (checkbox obrigatório precisa ser `true`), e-mail, telefone (8 a 15 dígitos, `+` opcional), número, URL http(s), data `AAAA-MM-DD`, opção de `select` e tamanho (1.000 caracteres; 10.000 em `textarea`). Chaves que não são campos do formulário são descartadas. Erros voltam em `422 VALIDATION_ERROR`, com um item por campo em `error.details` (`path: ['values', <key>]`).",
    ].join('\n'),
    params: { publicToken: 'Token público do formulário.' },
    body: {
      schema: SubmitCrmFormSchema,
      example: {
        values: {
          nome: 'Carlos Lima',
          email: 'carlos@empresa.com.br',
          telefone: '+5511999990000',
        },
      },
    },
    responses: {
      201: { description: 'Envio registrado.', schema: CrmFormSubmissionDTO },
    },
    errors: [
      {
        code: 'RESOURCE_NOT_FOUND',
        message: 'CrmForm not found',
        when: 'Token inexistente',
      },
      { code: 'CRM_FORM_NOT_PUBLISHED', when: 'Formulário em rascunho' },
      {
        code: 'VALIDATION_ERROR',
        message: 'Dados inválidos',
        when: 'Campo obrigatório ausente ou valor inválido',
      },
      CRM_DISABLED,
    ],
  },

  /* ------------------------------- propostas ------------------------------ */
  {
    ...PUBLIC,
    method: 'get',
    path: '/crm/proposals/{shareToken}',
    tags: ['CRM público · Propostas'],
    summary: 'Obter proposta compartilhada',
    description:
      'Conteúdo da proposta para a página `/p/<shareToken>`. A primeira leitura de uma proposta `SENT` a marca como `VIEWED`. `canAccept` diz se o botão de aceite deve aparecer.',
    params: {
      shareToken: {
        description: 'Token de compartilhamento da proposta.',
        example: 'p_Hk3v0Qz8',
      },
    },
    responses: {
      200: {
        description: 'Proposta.',
        schema: CrmProposalPublicDTO,
        example: {
          id: 'ckw1prop0000ab7d3k1e5xyz',
          name: 'Proposta — Implantação ServiceDesk',
          status: 'VIEWED',
          validUntil: '2026-10-15T23:59:59.000Z',
          isExpired: false,
          canAccept: true,
          acceptedAt: null,
          acceptedByName: null,
          sections: [],
        },
      },
    },
    errors: ['CRM_PROPOSAL_NOT_FOUND', CRM_DISABLED],
  },
  {
    ...PUBLIC,
    method: 'post',
    path: '/crm/proposals/{shareToken}/view',
    tags: ['CRM público · Propostas'],
    summary: 'Registrar visualização da proposta',
    description:
      'Telemetria de leitura enviada pela página pública (tempo, rolagem, se chegou ao fim). Repita com o mesmo `viewId` para atualizar a mesma visita. O IP é gravado apenas como hash.',
    params: { shareToken: 'Token de compartilhamento da proposta.' },
    body: {
      schema: RecordCrmProposalViewSchema,
      example: {
        viewId: '6f1c2a0e-5b7d-4c1e-9a33-2f0d8c1b7e55',
        durationMs: 42000,
        reachedEnd: true,
        scrolledPct: 100,
      },
    },
    responses: {
      200: { description: 'Visualização registrada.', schema: null },
    },
    errors: ['CRM_PROPOSAL_NOT_FOUND', CRM_DISABLED],
  },
  {
    ...PUBLIC,
    method: 'post',
    path: '/crm/proposals/{shareToken}/accept',
    tags: ['CRM público · Propostas'],
    summary: 'Aceitar proposta',
    description:
      'Aceite do cliente pelo link (sem login): grava o nome informado e a data, e a proposta passa a `ACCEPTED`. Só é possível para propostas enviadas/vistas e dentro da validade; aceites simultâneos gravam uma única vez. O IP fica na auditoria apenas como hash.',
    params: { shareToken: 'Token de compartilhamento da proposta.' },
    body: { schema: AcceptCrmProposalSchema, example: { name: 'Carlos Lima' } },
    responses: {
      200: {
        description: 'Proposta aceita (estado atualizado).',
        schema: CrmProposalPublicDTO,
      },
    },
    errors: [
      'CRM_PROPOSAL_NOT_FOUND',
      {
        code: 'CRM_PROPOSAL_EXPIRED',
        message:
          'A validade desta proposta expirou em 15/10/2026. Ela não pode mais ser aceita — peça uma nova proposta ou a extensão da validade a quem a enviou.',
        when: 'Validade vencida',
      },
      {
        code: 'CRM_PROPOSAL_NOT_ACCEPTABLE',
        message: 'Esta proposta já foi aceita',
        when: 'Já aceita',
      },
      {
        code: 'CRM_PROPOSAL_NOT_ACCEPTABLE',
        when: 'Rascunho, recusada ou expirada',
      },
      CRM_DISABLED,
    ],
  },

  /* ----------------------------- landing pages ---------------------------- */
  {
    ...PUBLIC,
    method: 'get',
    path: '/crm/landing-pages/{shareToken}',
    tags: ['CRM público · Landing pages'],
    summary: 'Obter landing page publicada',
    description:
      'Seções da landing page para a página `/l/<shareToken>`. Só páginas `PUBLISHED`.',
    params: {
      shareToken: {
        description: 'Token de compartilhamento da landing page.',
        example: 'l_Zt4b8Rw1',
      },
    },
    responses: {
      200: { description: 'Landing page.', schema: CrmLandingPagePublicDTO },
    },
    errors: [
      {
        code: 'RESOURCE_NOT_FOUND',
        message: 'CrmLandingPage not found',
        when: 'Token inexistente ou página em rascunho',
      },
      CRM_DISABLED,
    ],
  },
  {
    ...PUBLIC,
    method: 'post',
    path: '/crm/landing-pages/{shareToken}/view',
    tags: ['CRM público · Landing pages'],
    summary: 'Registrar visualização da landing page',
    description:
      'Telemetria da visita (tempo e cliques em CTA). Repita com o mesmo `viewId` para atualizar a visita. O IP é gravado apenas como hash.',
    params: { shareToken: 'Token de compartilhamento da landing page.' },
    body: {
      schema: RecordCrmLandingPageViewSchema,
      example: {
        viewId: '0b8e7d7a-1f4c-4d2e-8f0a-3c9b5e6a1d22',
        durationMs: 18000,
        ctaClicks: 1,
        referrer: 'https://www.google.com/',
      },
    },
    responses: {
      200: { description: 'Visualização registrada.', schema: null },
    },
    errors: [
      { code: 'RESOURCE_NOT_FOUND', message: 'CrmLandingPage not found' },
      CRM_DISABLED,
    ],
  },

  /* ------------------------------ API de leads ---------------------------- */
  {
    method: 'post',
    path: '/crm/integrations/leads',
    tags: ['CRM público · Integrações'],
    summary: 'Criar lead via API',
    auth: 'integrationKey',
    rateLimit: 'integrationKey',
    description: [
      'Entrada de leads para sistemas externos (site, ERP, automações). Autentique com a chave de API do workspace:',
      '',
      '```http',
      'POST /api/crm/integrations/leads',
      'Authorization: Bearer crm_live_...',
      'Content-Type: application/json',
      '```',
      '',
      'O lead passa pelo mesmo pipeline da criação manual: validação (informe **ao menos um e-mail ou telefone**), **dedupe** contra leads em aberto com o mesmo e-mail/telefone, pontuação pelas regras de score e dono pelas regras de roteamento. Sem `source`/`channel`, grava `integration`/`API`.',
      '',
      '- **201** — lead novo criado.',
      '- **200** — já existia um lead em aberto com o mesmo contato; devolve esse lead (nada é duplicado).',
      '',
      'Exemplo com cURL:',
      '',
      '```bash',
      'curl -X POST https://homologacao.stratustelecom.com.br/api/crm/integrations/leads \\',
      '  -H "Authorization: Bearer $STEEL_CRM_KEY" \\',
      '  -H "Content-Type: application/json" \\',
      '  -d \'{"name":"Carlos Lima","emails":["carlos@empresa.com.br"],"company":"Empresa Exemplo Ltda","source":"site"}\'',
      '```',
    ].join('\n'),
    body: {
      schema: IngestCrmLeadSchema,
      example: {
        name: 'Carlos Lima',
        emails: ['carlos@empresa.com.br'],
        phones: ['+5511999990000'],
        company: 'Empresa Exemplo Ltda',
        jobTitle: 'Gerente de TI',
        city: 'São Paulo',
        source: 'site',
      },
    },
    responses: {
      200: {
        description: 'Lead em aberto já existente (dedupe).',
        schema: CrmLeadDTO,
        example: lead,
      },
      201: { description: 'Lead criado.', schema: CrmLeadDTO, example: lead },
    },
    errors: [
      {
        code: 'UNAUTHORIZED',
        message: 'API key ausente',
        when: 'Header Authorization ausente',
      },
      {
        code: 'CRM_INTEGRATION_KEY_INVALID',
        when: 'Chave inválida ou revogada',
      },
      {
        code: 'VALIDATION_ERROR',
        message: 'Dados inválidos',
        when: 'Sem e-mail nem telefone, ou campo inválido',
      },
      CRM_DISABLED,
    ],
  },

  /* ------------------------------- workflows ------------------------------ */
  {
    ...PUBLIC,
    method: 'post',
    path: '/crm/workflows/{webhookToken}/trigger',
    tags: ['CRM público · Workflows'],
    summary: 'Disparar workflow por webhook',
    description:
      'Inicia uma execução do workflow cujo gatilho é **webhook**, usando a versão ativa. O corpo JSON (qualquer objeto) vira o `triggerPayload`, disponível para os nós do workflow. Responde com a execução já processada (ou `WAITING` se parou num formulário).',
    params: {
      webhookToken: 'Token do webhook, exibido no gatilho do workflow.',
    },
    body: {
      schema: {
        type: 'object',
        additionalProperties: true,
        description:
          'Payload livre (JSON). Corpo vazio (ou JSON que não é objeto) é tratado como `{}`; JSON malformado é recusado com `422`.',
      },
      required: false,
      example: {
        pedido: 'PV-1042',
        valor: 1890.5,
        cliente: { email: 'carlos@empresa.com.br' },
      },
    },
    responses: {
      201: { description: 'Execução criada.', schema: CrmWorkflowRunDTO },
    },
    errors: [
      {
        code: 'CRM_WORKFLOW_WEBHOOK_INVALID',
        when: 'Token inexistente ou workflow sem versão ativa',
      },
      { code: 'VALIDATION_ERROR', when: 'JSON malformado' },
      CRM_DISABLED,
    ],
  },

  /* ------------------------------ descadastro ----------------------------- */
  {
    ...PUBLIC,
    method: 'get',
    path: '/crm/unsubscribe/{token}',
    tags: ['CRM público · Descadastro'],
    summary: 'Link de descadastro (redireciona)',
    description:
      'Redireciona (303) para a página de confirmação `/unsubscribe/<token>`. **Nunca** descadastra em GET — scanners de link de provedores de e-mail abrem links sozinhos.',
    rateLimit: false,
    params: {
      token:
        'Token HMAC do link de descadastro (`<recipientId>.<assinatura>`, base64url).',
    },
    responses: {
      303: {
        description: 'Redireciona para `/unsubscribe/<token>`.',
        envelope: false,
      },
    },
  },
  {
    ...PUBLIC,
    method: 'post',
    path: '/crm/unsubscribe/{token}',
    tags: ['CRM público · Descadastro'],
    summary: 'Descadastrar das campanhas de e-mail',
    description: [
      'Descadastro LGPD do destinatário das campanhas de e-mail do workspace. Dois usos:',
      '',
      '- **One-click (RFC 8058)** — o provedor de e-mail faz `POST` com corpo `application/x-www-form-urlencoded` `List-Unsubscribe=One-Click` (o e-mail traz `List-Unsubscribe` e `List-Unsubscribe-Post`).',
      '- **Página de confirmação** — clique do titular em `/unsubscribe/<token>` (corpo vazio).',
      '',
      'Idempotente: repetir devolve `alreadyOptedOut: true`. O token é assinado com HMAC; não há sessão.',
    ].join('\n'),
    params: { token: 'Token HMAC do link de descadastro.' },
    body: {
      contentType: 'application/x-www-form-urlencoded',
      required: false,
      schema: {
        type: 'object',
        properties: {
          'List-Unsubscribe': {
            type: 'string',
            enum: ['One-Click'],
            description: 'Presente no one-click do RFC 8058.',
          },
        },
      },
      example: { 'List-Unsubscribe': 'One-Click' },
    },
    responses: {
      200: {
        description: 'Descadastrado.',
        schema: z.object({
          email: z.string().meta({
            description: 'E-mail descadastrado (para a página de confirmação).',
            example: 'carlos@empresa.com.br',
          }),
          alreadyOptedOut: z.boolean(),
        }),
        example: { email: 'carlos@empresa.com.br', alreadyOptedOut: false },
      },
    },
    errors: [
      {
        code: 'CRM_EMAIL_UNSUBSCRIBE_INVALID',
        message:
          'Link de descadastro inválido. Verifique se copiou o endereço completo.',
        when: 'Token malformado ou assinatura inválida',
      },
    ],
  },
]

export function registerPublicPaths(registry: OpenApiRegistry): void {
  for (const route of routes) registry.registerRoute(route)
}
