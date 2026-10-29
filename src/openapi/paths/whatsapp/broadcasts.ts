import { z } from 'zod'
import { CreateWhatsAppBroadcastSchema } from '@/src/schemas/whatsapp-broadcast.schema'
import { CreateWhatsAppBroadcastImportSchema } from '@/src/schemas/whatsapp-broadcast-import.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  WhatsAppBroadcastDetailDTO,
  WhatsAppBroadcastDTO,
  WhatsAppBroadcastImportResultDTO,
  WhatsAppBroadcastMarketingMetricsDTO,
} from '../../schemas/whatsapp'
import { perm, permErrors } from './shared'

const TAG = 'Comunicação · Transmissões' as const
const PARAMS = { broadcastId: 'Id da lista de transmissão.' }

const FEATURE: ErrorEntry = {
  code: 'FEATURE_NOT_ENABLED',
  when: 'Feature `communication.broadcasts` desligada para o workspace (plano/override)',
}

const OPT_OUT =
  'Contatos descadastrados (opt-out LGPD) nunca recebem: são excluídos na criação e, se descadastrarem depois, marcados `SKIPPED` no disparo.'

export const broadcastRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/broadcasts',
    tags: [TAG],
    summary: 'Listar transmissões',
    description: `Listas de transmissão do workspace com os contadores de envio. Sem paginação. ${perm('broadcasts', 'VIEW')}`,
    responses: {
      200: {
        description: 'Transmissões.',
        schema: z.array(WhatsAppBroadcastDTO),
      },
    },
    errors: permErrors('broadcasts', 'VIEW'),
  },
  {
    method: 'post',
    path: '/workspaces/{id}/whatsapp/broadcasts',
    tags: [TAG],
    summary: 'Criar transmissão',
    description: `Cria uma lista de transmissão em \`DRAFT\` (até 1000 contatos, ids repetidos são ignorados) com texto livre e, opcionalmente, mídia por URL pública — \`mediaMimeType\` é obrigatório com \`mediaUrl\` e define o tipo (imagem até 5 MB; vídeo, áudio e documento até 16 MB, checados por \`mediaSizeBytes\` quando informado). Nada é enviado até \`POST .../start\`. ${OPT_OUT} Auditado. ${perm('broadcasts', 'CREATE')}`,
    body: CreateWhatsAppBroadcastSchema,
    responses: {
      201: {
        description: 'Transmissão criada (rascunho, com destinatários).',
        schema: WhatsAppBroadcastDetailDTO,
      },
    },
    errors: [
      ...permErrors('broadcasts', 'CREATE'),
      FEATURE,
      'WHATSAPP_CONNECTION_NOT_FOUND',
      {
        code: 'WHATSAPP_BROADCAST_NO_RECIPIENTS',
        when: 'Nenhum contato elegível (todos descadastrados ou de outro workspace)',
      },
      {
        code: 'WHATSAPP_BROADCAST_MEDIA_INVALID',
        message:
          'Não foi possível identificar o tipo da mídia. Envie imagem, vídeo, áudio ou documento.',
        when: 'Tipo de mídia não reconhecido',
      },
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/whatsapp/broadcasts/import',
    tags: [TAG],
    summary: 'Importar transmissão agendada (CSV)',
    description: `Cria uma transmissão **agendada por destinatário** a partir de um CSV (conteúdo no campo \`csv\`) e de um template **aprovado** pela Meta — o caso típico é lembrete de consulta/exame.

Formato: cabeçalho com \`telefone\` e \`data_referencia\` (obrigatórias), \`nome\` (opcional) e \`var_1\`…\`var_N\`, onde N é o número de variáveis do BODY do template. Cada linha é agendada para \`data_referencia − sendOffsetHours\` (padrão 24 h); o worker dispara no tick de 5 min.

Os contatos são criados/atualizados pelo telefone. Linhas inválidas (telefone fora de 10–15 dígitos, data inválida, variáveis faltando ou em branco, contato descadastrado) voltam em \`rejectedRows\` sem abortar a importação; se nenhuma linha passar, \`broadcastList\` é \`null\`. A lista criada fica \`QUEUED\`. Auditado. ${perm('broadcasts', 'CREATE')}`,
    consent: true,
    body: CreateWhatsAppBroadcastImportSchema,
    responses: {
      201: {
        description: 'Resultado da importação.',
        schema: WhatsAppBroadcastImportResultDTO,
      },
    },
    errors: [
      ...permErrors('broadcasts', 'CREATE'),
      FEATURE,
      'WHATSAPP_CONNECTION_NOT_FOUND',
      'WHATSAPP_TEMPLATE_NOT_FOUND',
      'WHATSAPP_TEMPLATE_NOT_APPROVED',
      {
        code: 'BAD_REQUEST',
        message:
          'Cabeçalho deve conter as colunas "telefone" e "data_referencia"',
        when: 'CSV sem as colunas obrigatórias (ou sem linhas de dados)',
      },
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/broadcasts/{broadcastId}',
    tags: [TAG],
    summary: 'Detalhar transmissão',
    description: `Transmissão com cada destinatário e seu status de envio (\`PENDING\`, \`SENT\`, \`FAILED\`, \`SKIPPED\`). ${perm('broadcasts', 'VIEW')}`,
    params: PARAMS,
    responses: {
      200: { description: 'Transmissão.', schema: WhatsAppBroadcastDetailDTO },
    },
    errors: [
      ...permErrors('broadcasts', 'VIEW'),
      'WHATSAPP_BROADCAST_NOT_FOUND',
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/broadcasts/{broadcastId}/marketing-metrics',
    tags: [TAG],
    summary: 'Métricas da Marketing Messages Lite',
    description: `Quantos destinatários da transmissão foram enviados pela Marketing Messages Lite API (templates de marketing de conexões Meta, com a opção ligada em Ajustes › Comunicação) e, para eles, os totais enviados/entregues/lidos/cliques que a Meta guarda para o template desde o primeiro envio. Os totais são do template no período, não só desta lista. Se a Meta não responder, os contadores voltam e \`analytics\` fica \`null\` com o motivo. ${perm('broadcasts', 'VIEW')}`,
    params: PARAMS,
    responses: {
      200: {
        description: 'Métricas.',
        schema: WhatsAppBroadcastMarketingMetricsDTO,
      },
    },
    errors: [
      ...permErrors('broadcasts', 'VIEW'),
      'WHATSAPP_BROADCAST_NOT_FOUND',
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/whatsapp/broadcasts/{broadcastId}/start',
    tags: [TAG],
    summary: 'Disparar transmissão',
    description: `Enfileira o envio de um rascunho (\`DRAFT\`): um job por destinatário no worker, espaçados de 4 s. A lista vai para \`RUNNING\` (ou direto para \`DONE\` se todos estiverem descadastrados) e os contadores avançam conforme o worker envia. ${OPT_OUT} Sem corpo. Auditado. ${perm('broadcasts', 'CREATE')}`,
    params: PARAMS,
    responses: {
      200: {
        description: 'Transmissão em andamento.',
        schema: WhatsAppBroadcastDetailDTO,
      },
    },
    errors: [
      ...permErrors('broadcasts', 'CREATE'),
      FEATURE,
      'WHATSAPP_BROADCAST_NOT_FOUND',
      {
        code: 'WHATSAPP_BROADCAST_LOCKED',
        when: 'A transmissão não está mais em `DRAFT`',
      },
    ],
  },
]
