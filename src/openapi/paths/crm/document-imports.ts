import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  DocumentImportContextDTOSchema,
  DocumentImportDTOSchema,
} from '../../schemas/crm/document-imports'
import { CRM_ERRORS, crmAccess, describe } from './shared'

/** CRM · Documentos — importação com IA (ADR 0063): PDF, DOCX ou um pedido
 * em texto viram um documento em rascunho, montado no worker. */

const TAG = ['CRM · Documentos · IA'] as ['CRM · Documentos · IA']

const IMPORT_ID = {
  description: 'Id da importação.',
  example: 'ckw1dimp0000ab7d3k1e5xyz',
}
const IMPORT_NOT_FOUND: ErrorEntry = {
  code: 'DOCUMENT_IMPORT_NOT_FOUND',
  when: 'Importação inexistente, de outro workspace ou de outro usuário (OWNER/ADMIN veem todas)',
}
const ACCESS = crmAccess('documents', 'CREATE')

export const crmDocumentImportRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/crm/documents/imports/context',
    tags: TAG,
    summary: 'Contexto da importação com IA',
    description: describe(
      'Se a IA do CRM está disponível (plano e modelo), se o modelo do workspace lê o PDF inteiro (senão vai o texto extraído de cada página), os limites do arquivo, a cota mensal de IA e o custo estimado: fixo + por página para arquivos, e o de um documento gerado por pedido.',
      ACCESS,
    ),
    responses: {
      200: { description: 'Contexto.', schema: DocumentImportContextDTOSchema },
    },
    errors: [...CRM_ERRORS],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/documents/imports',
    tags: TAG,
    summary: 'Importar PDF/DOCX ou gerar documento com IA',
    description: describe(
      '**Multipart** com `file` (PDF ou DOCX até 20 MB e 60 páginas) e os campos `mode` (`PDF`/`DOCX`; deduzido do arquivo se ausente), `kind` e `title`; ou **JSON** `{ "mode": "PROMPT", "prompt": "…", "kind": "PROPOSAL", "title": "…" }`. O tipo do arquivo é conferido pelo conteúdo e o PDF pelas páginas.',
      'Guarda o arquivo no bucket privado `documents` (`<workspaceId>/imports/<importId>/<arquivo>`) e enfileira a montagem (`documents-ai`). Responde 201 com a importação em `PENDING`; acompanhe por `GET …/imports/{importId}` ou pelo `stream`. DOCX e pedido em texto antes conferem plano, modelo e cota da IA; PDF não.',
      '**PDF não usa IA:** o worker converte cada página em uma imagem PNG (guardada na biblioteca do workspace) e monta o documento com uma seção por página, sem custo nem cota. O documento nasce em `DRAFT`, com o usuário como dono e `source` `PDF_IMPORT`. Com `documentId`, o conteúdo do documento existente é substituído pelas novas páginas (título, destinatários e versões já enviadas ficam; o rascunho passa a diferir da versão atual) e a importação termina com esse mesmo `documentId`.',
      'DOCX e pedido em texto usam o modelo de IA do CRM: o DOCX vai como texto e a saída é um plano estruturado (seções → blocos do catálogo), validado e montado com os presets do catálogo `document` (linhas "Nome: ____" viram campos, assinatura vira bloco de aceite, preços viram tabela de preços). Consomem a cota mensal (até 2 chamadas por importação), com o limite próprio de mensagens de IA por usuário. O documento nasce em `DRAFT` com `source` `PDF_IMPORT` (DOCX) ou `AI_PROMPT`.',
      ACCESS,
    ),
    consent: true,
    body: {
      contentType: 'multipart/form-data',
      description:
        'Também aceita `application/json` para `mode: "PROMPT"` (sem arquivo).',
      schema: {
        type: 'object',
        properties: {
          file: { type: 'string', format: 'binary' },
          mode: { type: 'string', enum: ['PDF', 'DOCX', 'PROMPT'] },
          kind: {
            type: 'string',
            enum: [
              'PROPOSAL',
              'CONTRACT',
              'QUOTE',
              'PRESENTATION',
              'TERMS',
              'REPORT',
              'OTHER',
            ],
          },
          title: { type: 'string', maxLength: 200 },
          prompt: { type: 'string', maxLength: 4000 },
          documentId: {
            type: 'string',
            description:
              'Só com `mode: "PDF"`: troca as páginas deste documento pelas do novo PDF em vez de criar outro (exige a permissão de edição de documentos).',
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Importação criada.',
        schema: DocumentImportDTOSchema,
      },
    },
    errors: [
      ...CRM_ERRORS,
      {
        code: 'DOCUMENT_IMPORT_UNSUPPORTED',
        when: 'Sem arquivo, arquivo vazio, maior que 20 MB, com mais de 60 páginas, protegido por senha ou que não é PDF/DOCX',
      },
      {
        code: 'VALIDATION_ERROR',
        when: 'Campos inválidos ou `PROMPT` sem `prompt`',
      },
      {
        code: 'FEATURE_NOT_ENABLED',
        when: 'Feature `crm.aiAssistant` desligada para o workspace',
      },
      {
        code: 'AI_QUOTA_EXCEEDED',
        when: 'Cota mensal de IA do workspace esgotada',
      },
      {
        code: 'AI_PROVIDER_UNAVAILABLE',
        when: 'Nenhum modelo habilitado com provedor configurado',
      },
      {
        code: 'CONFLICT',
        when: 'O usuário já tem 3 importações na fila ou em andamento',
      },
      'STORAGE_ERROR',
      {
        code: 'DOCUMENT_IMPORT_FAILED',
        when: 'Não foi possível enfileirar a montagem',
      },
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/documents/imports/{importId}',
    tags: TAG,
    summary: 'Ver importação',
    description: describe(
      'Estado e progresso da importação. Em `READY`, `documentId` aponta o documento criado (abra em `/crm/documents/<id>/edit`); em `FAILED`, `error` traz o motivo em pt-BR.',
      ACCESS,
    ),
    params: { importId: IMPORT_ID },
    responses: {
      200: { description: 'Importação.', schema: DocumentImportDTOSchema },
    },
    errors: [...CRM_ERRORS, IMPORT_NOT_FOUND],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/documents/imports/{importId}/stream',
    tags: TAG,
    summary: 'Acompanhar importação (stream)',
    description: describe(
      'Responde em **`text/event-stream`**: um frame `event: import` com o `DocumentImport` inteiro agora e a cada etapa (`lendo o arquivo` → `entendendo a estrutura` → `montando as seções` → `pronto`), comentários `: ping` a cada 15 s, e fecha quando a importação fica `READY` ou `FAILED`.',
      'Erros de permissão ou importação inexistente voltam no envelope JSON, antes do stream.',
      ACCESS,
    ),
    params: { importId: IMPORT_ID },
    responses: {
      200: {
        description: 'Stream do progresso.',
        envelope: false,
        contentType: 'text/event-stream',
        schema: { type: 'string' },
        example:
          'event: import\ndata: {"id":"ckw1dimp0000ab7d3k1e5xyz","status":"RUNNING","progress":{"step":"sections","message":"Montando as seções","pct":60}}\n\n',
      },
    },
    errors: [...CRM_ERRORS, IMPORT_NOT_FOUND],
  },
]
