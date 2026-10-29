import { z } from 'zod'
import {
  CrmEmailBrandSchema,
  RenderCrmEmailTemplateSchema,
} from '@/src/schemas/crm-email-builder.schema'
import {
  CreateCrmEmailCampaignSchema,
  UpdateCrmEmailCampaignSchema,
} from '@/src/schemas/crm-email-campaign.schema'
import {
  CreateCrmEmailAccountSchema,
  CreateCrmEmailMessageSchema,
} from '@/src/schemas/crm-email-sync.schema'
import {
  CreateCrmEmailTemplateSchema,
  PreviewCrmEmailTemplateLayoutSchema,
  UpdateCrmEmailTemplateSchema,
} from '@/src/schemas/crm-email-template.schema'
import {
  AddCrmMailingListMemberSchema,
  CreateCrmMailingListSchema,
  UpdateCrmMailingListSchema,
} from '@/src/schemas/crm-mailing-list.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import { MediaUrlDTO } from '../../schemas/core'
import {
  CrmEmailAccountDTO,
  CrmEmailBrandDTO,
  CrmEmailCampaignDTO,
  CrmEmailCampaignRecipientDTO,
  CrmEmailLinkTargetsDTO,
  CrmEmailMessageDTO,
  CrmEmailOptOutDTO,
  CrmEmailRenderDTO,
  CrmEmailSenderOptionsDTO,
  CrmEmailTemplateDTO,
  CrmEmailTemplatePreviewDTO,
  CrmEmailTestSendDTO,
  CrmMailingListDTO,
  CrmMailingListMemberDTO,
} from '../../schemas/crm/email'
import { CRM_ERRORS, crmAccess, describe, notFoundError } from './shared'

/**
 * CRM · E-mail marketing — `email-templates`, `email-campaigns`,
 * `mailing-lists`, `email-opt-outs`, `email-accounts`, `email-messages`.
 * Tudo sob a permissão `email`.
 */

const TAGS: RouteConfig['tags'] = ['CRM · E-mail marketing']

const TEMPLATE_ID = 'ID do template de e-mail.'
const CAMPAIGN_ID = 'ID da campanha.'
const LIST_ID = 'ID da lista de e-mail.'

const TEMPLATE_NOT_FOUND = notFoundError(
  'CrmEmailTemplate',
  'Template inexistente no workspace',
)
const CAMPAIGN_NOT_FOUND = notFoundError(
  'CrmEmailCampaign',
  'Campanha inexistente no workspace',
)
const LIST_NOT_FOUND = notFoundError(
  'CrmMailingList',
  'Lista inexistente no workspace',
)
const ALREADY_SENT: ErrorEntry = {
  code: 'CRM_EMAIL_CAMPAIGN_ALREADY_SENT',
  when: 'Campanha fora de `DRAFT`/`SCHEDULED`',
}
const LAYOUT_UNKNOWN: ErrorEntry = {
  code: 'VALIDATION_ERROR',
  message: 'Dados inválidos',
  when: '`templateId` não é um layout do catálogo (`promo-announcement`, `newsletter-update`)',
}

const NOT_BUILDER: ErrorEntry = {
  code: 'CRM_EMAIL_TEMPLATE_NOT_BUILDER',
  when: '`builderDocument` enviado para um template `LEGACY`',
}
const CANVAS_INVALID: ErrorEntry = {
  code: 'CRM_EMAIL_CANVAS_INVALID',
  when: 'Documento versão 2 fora das regras do catálogo de e-mail (bloco fora de uma coluna, mais de 4 colunas, rodapé ausente ou fora do fim, propriedades inválidas); `details.issues` lista todos os problemas',
}
const CANVAS_HTML_FORBIDDEN: ErrorEntry = {
  code: 'CRM_EMAIL_CANVAS_HTML_FORBIDDEN',
  when: 'Quem não é OWNER/ADMIN do workspace adicionou ou alterou um bloco de HTML',
}
const STRUCTURE_LOCKED: ErrorEntry = {
  code: 'CRM_EMAIL_BUILDER_STRUCTURE_LOCKED',
  when: 'Documento fora da estrutura travada do modelo (seção adicionada, removida, de outro tipo, ocultada sem ser opcional ou fora de posição), troca de modelo ou HTML livre num template `BUILDER`',
}

/** Visual e-mail builder (editor de templates prontos). */
const builderRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/crm/email-templates/{templateId}',
    tags: TAGS,
    summary: 'Detalhe do template de e-mail',
    description: crmAccess('email', 'VIEW'),
    params: { templateId: TEMPLATE_ID },
    responses: {
      200: { description: 'Template.', schema: CrmEmailTemplateDTO },
    },
    errors: [...CRM_ERRORS, TEMPLATE_NOT_FOUND],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/email-templates/{templateId}/render',
    tags: TAGS,
    summary: 'Renderizar template para um contato',
    description: describe(
      'Renderiza o template com as variáveis (`{{nome}}`, `{{empresa}}`, `{{campaign_link}}`…) resolvidas para uma pessoa do CRM (`personId`) ou um contato de exemplo (`sample`; padrão: contato fictício). O link de descadastro aponta para a página genérica. Nada é salvo.',
      crmAccess('email', 'VIEW'),
    ),
    params: { templateId: TEMPLATE_ID },
    body: {
      schema: RenderCrmEmailTemplateSchema,
      example: { campaignLink: 'https://acme.com.br/l/abc?utm_source=email' },
    },
    responses: {
      200: { description: 'E-mail renderizado.', schema: CrmEmailRenderDTO },
    },
    errors: [
      ...CRM_ERRORS,
      TEMPLATE_NOT_FOUND,
      STRUCTURE_LOCKED,
      CANVAS_INVALID,
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/email-templates/{templateId}/test-send',
    tags: TAGS,
    summary: 'Enviar e-mail de teste',
    description: describe(
      'Envia o template renderizado (assunto com `[Teste]`) para o e-mail de quem chama. Limite de envio por usuário.',
      crmAccess('email', 'EDIT'),
    ),
    params: { templateId: TEMPLATE_ID },
    body: { schema: RenderCrmEmailTemplateSchema, example: {} },
    responses: {
      200: { description: 'Teste enviado.', schema: CrmEmailTestSendDTO },
    },
    errors: [
      ...CRM_ERRORS,
      TEMPLATE_NOT_FOUND,
      STRUCTURE_LOCKED,
      CANVAS_INVALID,
      'MAIL_ERROR',
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/email-brand',
    tags: TAGS,
    summary: 'Marca dos e-mails',
    description: describe(
      'Nome, logo, cor primária, endereço e site usados pelos templates do editor visual. Sem marca salva, devolve os padrões (nome/logo do workspace).',
      crmAccess('email', 'VIEW'),
    ),
    responses: { 200: { description: 'Marca.', schema: CrmEmailBrandDTO } },
    errors: CRM_ERRORS,
  },
  {
    method: 'put',
    path: '/workspaces/{id}/crm/email-brand',
    tags: TAGS,
    summary: 'Salvar marca dos e-mails',
    description: crmAccess('email', 'EDIT'),
    consent: true,
    body: {
      schema: CrmEmailBrandSchema,
      example: {
        companyName: 'Acme Ltda.',
        logoUrl: '',
        primaryColor: '#2893CC',
        address: 'Av. Paulista, 1000 — São Paulo, SP',
        website: 'https://acme.com.br',
      },
    },
    responses: {
      200: { description: 'Marca salva.', schema: CrmEmailBrandDTO },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/email-builder/images',
    tags: TAGS,
    summary: 'Enviar imagem de e-mail',
    description: describe(
      'Corpo **binário** (não multipart) com o `Content-Type` da imagem. JPEG, PNG ou WebP até 5 MB. Devolve a URL pública para os blocos de imagem do editor.',
      crmAccess('email', 'EDIT'),
    ),
    rateLimit: 'upload',
    body: {
      contentType: 'image/*',
      schema: { type: 'string', format: 'binary' },
      description: 'Bytes da imagem.',
    },
    responses: { 201: { description: 'Imagem salva.', schema: MediaUrlDTO } },
    errors: [
      ...CRM_ERRORS,
      {
        code: 'BAD_REQUEST',
        message: 'Content-Type é obrigatório',
        when: 'Sem header `Content-Type`',
      },
      {
        code: 'BAD_REQUEST',
        message: 'Arquivo muito grande. Máximo 5 MB',
        when: '`Content-Length` acima de 5 MB',
      },
      {
        code: 'VALIDATION_ERROR',
        message: 'Formato não suportado. Use JPEG, PNG ou WebP',
      },
      'STORAGE_ERROR',
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/email-builder/links',
    tags: TAGS,
    summary: 'Links rápidos do editor de e-mail',
    description: describe(
      'Landing pages e formulários publicados do workspace, com a URL pública, para o seletor de link do editor.',
      crmAccess('email', 'VIEW'),
    ),
    responses: {
      200: { description: 'Destinos.', schema: CrmEmailLinkTargetsDTO },
    },
    errors: CRM_ERRORS,
  },
]

export const crmEmailRoutes: RouteConfig[] = [
  ...builderRoutes,
  /* ------------------------------- templates ------------------------------ */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/email-templates',
    tags: TAGS,
    summary: 'Listar templates de e-mail',
    description: describe(
      'Templates reutilizáveis para campanhas (excluídos não aparecem).',
      crmAccess('email', 'VIEW'),
    ),
    responses: {
      200: { description: 'Templates.', schema: z.array(CrmEmailTemplateDTO) },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/email-templates',
    tags: TAGS,
    summary: 'Criar template de e-mail',
    description: describe(
      'Conteúdo livre (`contentHtml`, com o estado do editor em `contentJson`) **ou** a partir de um layout fixo (`templateId` + `templateProps`) — nesse caso o HTML é renderizado pelo servidor e `contentHtml` pode ser omitido. Com `builderLayout`, cria um template do editor visual com o conteúdo do modelo: versão 1 (estrutura travada) por padrão, ou documento Steel Canvas com `builderVersion: 2`. Com `builderDocument` (documento Steel Canvas, versão 2 — por exemplo o modelo em branco da galeria), cria o template já com esse documento, validado como num salvamento; ele tem precedência sobre `builderLayout`.',
      crmAccess('email', 'CREATE'),
    ),
    consent: true,
    body: {
      schema: CreateCrmEmailTemplateSchema,
      example: {
        name: 'Newsletter mensal',
        subject: 'Novidades de setembro',
        contentHtml: '<h1>Olá!</h1><p>Confira as novidades.</p>',
      },
    },
    responses: {
      201: { description: 'Template criado.', schema: CrmEmailTemplateDTO },
    },
    errors: [...CRM_ERRORS, LAYOUT_UNKNOWN],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/email-templates/preview',
    tags: TAGS,
    summary: 'Pré-visualizar layout de e-mail',
    description: describe(
      'Renderiza um layout fixo com os campos informados, para o preview ao vivo do editor. Nada é salvo.',
      crmAccess('email', 'VIEW'),
    ),
    body: {
      schema: PreviewCrmEmailTemplateLayoutSchema,
      example: {
        templateId: 'newsletter-update',
        templateProps: {
          heading: 'Novidades de setembro',
          body: 'Confira o que mudou.',
        },
      },
    },
    responses: {
      200: {
        description: 'HTML renderizado.',
        schema: CrmEmailTemplatePreviewDTO,
      },
    },
    errors: [...CRM_ERRORS, LAYOUT_UNKNOWN],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/email-templates/{templateId}',
    tags: TAGS,
    summary: 'Atualizar template de e-mail',
    description: describe(
      'Atualização parcial. Mudar `templateId` ou `templateProps` re-renderiza o HTML a partir do layout (ignorando `contentHtml`); senão, `contentHtml` enviado é gravado como está. Em templates `BUILDER`, `builderDocument` aceita a versão 1 ou a 2 (Steel Canvas); um template passa da 1 para a 2, nunca o contrário. Blocos de HTML só podem ser adicionados ou alterados por OWNER/ADMIN.',
      crmAccess('email', 'EDIT'),
    ),
    params: { templateId: TEMPLATE_ID },
    consent: true,
    body: UpdateCrmEmailTemplateSchema,
    responses: {
      200: { description: 'Template atualizado.', schema: CrmEmailTemplateDTO },
    },
    errors: [
      ...CRM_ERRORS,
      TEMPLATE_NOT_FOUND,
      LAYOUT_UNKNOWN,
      NOT_BUILDER,
      STRUCTURE_LOCKED,
      CANVAS_INVALID,
      CANVAS_HTML_FORBIDDEN,
    ],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/crm/email-templates/{templateId}',
    tags: TAGS,
    summary: 'Excluir template de e-mail',
    description: describe(
      'Exclusão lógica (soft delete).',
      crmAccess('email', 'DELETE'),
    ),
    params: { templateId: TEMPLATE_ID },
    consent: true,
    responses: { 200: { description: 'Template excluído.', schema: null } },
    errors: [...CRM_ERRORS, TEMPLATE_NOT_FOUND],
  },

  /* ------------------------------- campanhas ------------------------------ */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/email-campaigns',
    tags: TAGS,
    summary: 'Listar campanhas de e-mail',
    description: crmAccess('email', 'VIEW'),
    responses: {
      200: { description: 'Campanhas.', schema: z.array(CrmEmailCampaignDTO) },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/email-campaigns',
    tags: TAGS,
    summary: 'Criar campanha de e-mail',
    description: describe(
      [
        'Cria a campanha em `DRAFT` (ou `SCHEDULED` com `scheduledAt` — o worker dispara as agendadas vencidas a cada 5 min) e já grava a lista de destinatários:',
        '',
        '- `recipientScope: ALL` → todas as pessoas do CRM com e-mail (o primeiro e-mail de cada uma);',
        '- `recipientScope: SELECTED` → união de `personIds`, membros de `mailingListIds` e `extraEmails`, sem duplicar endereços. Seleção vazia é erro (nunca cai em "todos").',
        '',
        'Descadastrados (opt-out LGPD, por e-mail ou por pessoa) são removidos. Sem nenhum destinatário elegível a campanha não é criada.',
      ].join('\n'),
      crmAccess('email', 'CREATE'),
    ),
    consent: true,
    body: {
      schema: CreateCrmEmailCampaignSchema,
      example: {
        subject: 'Conheça o ServiceDesk',
        contentHtml: '<h1>Olá!</h1>',
        fromAddress: 'marketing@acme.com.br',
        recipientScope: 'SELECTED',
        mailingListIds: ['ckw1mlst0000ab7d3k1e5xyz'],
      },
    },
    responses: {
      201: { description: 'Campanha criada.', schema: CrmEmailCampaignDTO },
    },
    errors: [
      ...CRM_ERRORS,
      {
        code: 'CRM_EMAIL_CAMPAIGN_NO_RECIPIENTS',
        message:
          'Nenhum destinatário elegível: a seleção está vazia ou todos se descadastraram',
        when: 'Nenhum destinatário elegível após o opt-out',
      },
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/email-campaigns/{campaignId}',
    tags: TAGS,
    summary: 'Detalhe da campanha',
    description: crmAccess('email', 'VIEW'),
    params: { campaignId: CAMPAIGN_ID },
    responses: {
      200: { description: 'Campanha.', schema: CrmEmailCampaignDTO },
    },
    errors: [...CRM_ERRORS, CAMPAIGN_NOT_FOUND],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/email-campaigns/{campaignId}',
    tags: TAGS,
    summary: 'Atualizar campanha',
    description: describe(
      'Só campanhas em `DRAFT` ou `SCHEDULED`. Os destinatários não mudam (foram fixados na criação).',
      crmAccess('email', 'EDIT'),
    ),
    params: { campaignId: CAMPAIGN_ID },
    consent: true,
    body: UpdateCrmEmailCampaignSchema,
    responses: {
      200: { description: 'Campanha atualizada.', schema: CrmEmailCampaignDTO },
    },
    errors: [...CRM_ERRORS, CAMPAIGN_NOT_FOUND, ALREADY_SENT],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/email-campaigns/{campaignId}/recipients',
    tags: TAGS,
    summary: 'Listar destinatários da campanha',
    description: describe(
      'Destinatários gravados na criação, com o status de envio de cada um.',
      crmAccess('email', 'VIEW'),
    ),
    params: { campaignId: CAMPAIGN_ID },
    responses: {
      200: {
        description: 'Destinatários.',
        schema: z.array(CrmEmailCampaignRecipientDTO),
      },
    },
    errors: [...CRM_ERRORS, CAMPAIGN_NOT_FOUND],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/email-campaigns/{campaignId}/send',
    tags: TAGS,
    summary: 'Enviar campanha agora',
    description: describe(
      [
        'Dispara a campanha de forma **síncrona** (a resposta só volta ao fim do envio), usando apenas os destinatários gravados na criação.',
        '',
        'O opt-out é revalidado no disparo: quem se descadastrou nesse meio-tempo vira `SKIPPED`. Cada e-mail leva o rodapé com link de descadastro e os headers `List-Unsubscribe` (RFC 8058). Falhas individuais viram `FAILED` no destinatário; a campanha termina `SENT`, ou `FAILED` se todos os envios tentados falharem.',
        '',
        'O remetente (`fromAddress`) precisa ser de um domínio de envio **verificado** do workspace ou o endereço da plataforma (ADR 0055); senão nada é enviado e a campanha fica como estava (uma agendada vira `FAILED` no disparo do worker e o criador é avisado).',
      ].join('\n'),
      crmAccess('email', 'EDIT'),
    ),
    params: { campaignId: CAMPAIGN_ID },
    consent: true,
    responses: {
      200: {
        description: 'Campanha após o envio (contadores atualizados).',
        schema: CrmEmailCampaignDTO,
      },
    },
    errors: [
      ...CRM_ERRORS,
      CAMPAIGN_NOT_FOUND,
      ALREADY_SENT,
      {
        code: 'CRM_EMAIL_CAMPAIGN_NO_RECIPIENTS',
        when: 'Campanha sem destinatários gravados',
      },
      {
        code: 'SENDING_DOMAIN_NOT_VERIFIED',
        when: 'Remetente fora dos domínios verificados do workspace e diferente do endereço da plataforma',
      },
    ],
  },

  /* -------------------------------- listas -------------------------------- */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/mailing-lists',
    tags: TAGS,
    summary: 'Listar listas de e-mail',
    description: crmAccess('email', 'VIEW'),
    responses: {
      200: { description: 'Listas.', schema: z.array(CrmMailingListDTO) },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/mailing-lists',
    tags: TAGS,
    summary: 'Criar lista de e-mail',
    description: crmAccess('email', 'CREATE'),
    consent: true,
    body: {
      schema: CreateCrmMailingListSchema,
      example: { name: 'Clientes ativos' },
    },
    responses: {
      201: { description: 'Lista criada.', schema: CrmMailingListDTO },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/mailing-lists/{listId}',
    tags: TAGS,
    summary: 'Atualizar lista de e-mail',
    description: crmAccess('email', 'EDIT'),
    params: { listId: LIST_ID },
    consent: true,
    body: UpdateCrmMailingListSchema,
    responses: {
      200: { description: 'Lista atualizada.', schema: CrmMailingListDTO },
    },
    errors: [...CRM_ERRORS, LIST_NOT_FOUND],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/crm/mailing-lists/{listId}',
    tags: TAGS,
    summary: 'Excluir lista de e-mail',
    description: crmAccess('email', 'DELETE'),
    params: { listId: LIST_ID },
    consent: true,
    responses: { 200: { description: 'Lista excluída.', schema: null } },
    errors: [...CRM_ERRORS, LIST_NOT_FOUND],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/mailing-lists/{listId}/members',
    tags: TAGS,
    summary: 'Listar membros da lista',
    description: crmAccess('email', 'VIEW'),
    params: { listId: LIST_ID },
    responses: {
      200: {
        description: 'Membros.',
        schema: z.array(CrmMailingListMemberDTO),
      },
    },
    errors: [...CRM_ERRORS, LIST_NOT_FOUND],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/mailing-lists/{listId}/members',
    tags: TAGS,
    summary: 'Adicionar membro à lista',
    description: describe(
      'Adiciona um endereço (opcionalmente vinculado a uma pessoa do CRM por `personId`).',
      crmAccess('email', 'EDIT'),
    ),
    params: { listId: LIST_ID },
    consent: true,
    body: {
      schema: AddCrmMailingListMemberSchema,
      example: { email: 'carlos@empresa.com.br', name: 'Carlos Lima' },
    },
    responses: {
      201: {
        description: 'Membro adicionado.',
        schema: CrmMailingListMemberDTO,
      },
    },
    errors: [
      ...CRM_ERRORS,
      LIST_NOT_FOUND,
      {
        code: 'CRM_MAILING_LIST_MEMBER_CONFLICT',
        when: 'E-mail já está na lista',
      },
    ],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/crm/mailing-lists/{listId}/members/{memberId}',
    tags: TAGS,
    summary: 'Remover membro da lista',
    description: describe(
      'Um `memberId` inexistente responde `500 DATABASE_ERROR` (a remoção não verifica a existência antes).',
      crmAccess('email', 'EDIT'),
    ),
    params: { listId: LIST_ID, memberId: 'ID do membro da lista.' },
    consent: true,
    responses: { 200: { description: 'Membro removido.', schema: null } },
    errors: [...CRM_ERRORS, LIST_NOT_FOUND],
  },

  /* ----------------------------- descadastros ----------------------------- */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/email-opt-outs',
    tags: TAGS,
    summary: 'Listar descadastros',
    description: describe(
      'Endereços/pessoas que se descadastraram das campanhas (LGPD) pelo link do rodapé ou pelo one-click (RFC 8058). São excluídos automaticamente de novas campanhas e do disparo.',
      crmAccess('email', 'VIEW'),
    ),
    responses: {
      200: { description: 'Descadastros.', schema: z.array(CrmEmailOptOutDTO) },
    },
    errors: CRM_ERRORS,
  },

  /* ----------------------------- contas de e-mail ------------------------- */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/email-accounts',
    tags: TAGS,
    summary: 'Listar contas de e-mail',
    description: describe(
      'Contas de todos os usuários do workspace. Não há sincronização real com Gmail/Outlook: a conta só agrupa e-mails e eventos registrados manualmente.',
      crmAccess('email', 'VIEW'),
    ),
    responses: {
      200: { description: 'Contas.', schema: z.array(CrmEmailAccountDTO) },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/email-accounts',
    tags: TAGS,
    summary: 'Conectar conta de e-mail',
    description: describe(
      'Registra uma conta do usuário autenticado (uma por provedor, por usuário, por workspace). Nenhuma credencial é pedida nem guardada.',
      crmAccess('email', 'CREATE'),
    ),
    consent: true,
    body: {
      schema: CreateCrmEmailAccountSchema,
      example: { provider: 'GMAIL', email: 'maria@acme.com.br' },
    },
    responses: {
      201: { description: 'Conta registrada.', schema: CrmEmailAccountDTO },
    },
    errors: [
      ...CRM_ERRORS,
      {
        code: 'CRM_EMAIL_ACCOUNT_CONFLICT',
        when: 'Usuário já tem conta deste provedor no workspace',
      },
    ],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/crm/email-accounts/{accountId}',
    tags: TAGS,
    summary: 'Remover conta de e-mail',
    description: crmAccess('email', 'DELETE'),
    params: { accountId: 'ID da conta de e-mail.' },
    consent: true,
    responses: { 200: { description: 'Conta removida.', schema: null } },
    errors: [
      ...CRM_ERRORS,
      notFoundError('CrmEmailAccount', 'Conta inexistente no workspace'),
    ],
  },

  /* ---------------------------- e-mails registrados ----------------------- */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/email-messages',
    tags: TAGS,
    summary: 'Listar e-mails registrados',
    description: describe(
      'E-mails registrados manualmente no CRM, opcionalmente filtrados por pessoa ou oportunidade.',
      crmAccess('email', 'VIEW'),
    ),
    query: {
      type: 'object',
      properties: {
        personId: {
          type: 'string',
          description: 'Só e-mails vinculados a esta pessoa.',
        },
        opportunityId: {
          type: 'string',
          description: 'Só e-mails vinculados a esta oportunidade.',
        },
      },
    },
    responses: {
      200: { description: 'E-mails.', schema: z.array(CrmEmailMessageDTO) },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/email-messages',
    tags: TAGS,
    summary: 'Registrar e-mail',
    description: describe(
      'Registra um e-mail trocado com o contato (entrada ou saída) para o histórico. Nada é enviado.',
      crmAccess('email', 'CREATE'),
    ),
    consent: true,
    body: {
      schema: CreateCrmEmailMessageSchema,
      example: {
        direction: 'OUTBOUND',
        subject: 'Proposta comercial',
        fromEmail: 'maria@acme.com.br',
        toEmails: ['carlos@empresa.com.br'],
        personId: 'ckw1pers0000ab7d3k1e5xyz',
        sentAt: '2026-09-18T13:00:00.000Z',
      },
    },
    responses: {
      201: { description: 'E-mail registrado.', schema: CrmEmailMessageDTO },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/crm/email-messages/{messageId}',
    tags: TAGS,
    summary: 'Excluir e-mail registrado',
    description: crmAccess('email', 'DELETE'),
    params: { messageId: 'ID do e-mail registrado.' },
    consent: true,
    responses: { 200: { description: 'E-mail excluído.', schema: null } },
    errors: [
      ...CRM_ERRORS,
      notFoundError('CrmEmailMessage', 'E-mail inexistente no workspace'),
    ],
  },

  /* ------------------------------ remetentes ------------------------------ */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/email-senders',
    tags: TAGS,
    summary: 'Remetentes permitidos para campanhas',
    description: describe(
      'Opções do seletor de remetente das campanhas (ADR 0055): os nomes dos domínios de envio verificados do workspace e o endereço da plataforma, aceito sem domínio próprio. Só nomes de domínio — registros DNS e ids ficam em Ajustes.',
      crmAccess('email', 'VIEW'),
    ),
    responses: {
      200: {
        description: 'Remetentes permitidos.',
        schema: CrmEmailSenderOptionsDTO,
      },
    },
    errors: CRM_ERRORS,
  },
]
