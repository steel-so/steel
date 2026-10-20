import {
  ConfigureWhatsAppAutoOutreachSchema,
  QueueWhatsAppAutoOutreachSchema,
} from '@/src/schemas/whatsapp-auto-outreach.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import { WhatsAppAutoOutreachDTO } from '../../schemas/whatsapp'
import { perm, permErrors } from './shared'

const TAG = 'Comunicação · Disparo automático' as const
const BASE = '/workspaces/{id}/whatsapp/auto-outreach'

const RUNNING: ErrorEntry = {
  code: 'WHATSAPP_AUTO_OUTREACH_RUNNING',
  when: 'O disparo está rodando — pause antes',
}

export const autoOutreachRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: BASE,
    tags: [TAG],
    summary: 'Disparo automático',
    description: `Estado do disparo automático do workspace: conexão e template escolhidos, situação (\`IDLE\`, \`RUNNING\`, \`PAUSED\`, \`DONE\`), contagem da fila e o motivo da última pausa automática. Sem configuração salva devolve \`IDLE\` zerado. ${perm('broadcasts', 'VIEW')}`,
    responses: {
      200: { description: 'Disparo.', schema: WhatsAppAutoOutreachDTO },
    },
    errors: permErrors('broadcasts', 'VIEW'),
  },
  {
    method: 'patch',
    path: BASE,
    tags: [TAG],
    summary: 'Configurar disparo (template e agressividade)',
    description: `Define a conexão (API oficial da Meta, módulo Comunicação) e o template **aprovado** que a IA envia — os dois juntos, só com o disparo parado — e/ou o nível de agressividade \`intervalSeconds\` (segundos entre dois envios, de 20 a 60), que vale já no próximo envio, mesmo rodando. Variáveis de texto (\`{{n}}\`) recebem o primeiro nome do contato; templates com botão de link dinâmico são recusados. Auditado. ${perm('broadcasts', 'EDIT')}`,
    body: ConfigureWhatsAppAutoOutreachSchema,
    responses: {
      200: {
        description: 'Disparo atualizado.',
        schema: WhatsAppAutoOutreachDTO,
      },
    },
    errors: [
      ...permErrors('broadcasts', 'EDIT'),
      { ...RUNNING, when: 'Troca de template com o disparo rodando' },
      'WHATSAPP_CONNECTION_NOT_FOUND',
      'WHATSAPP_TEMPLATE_NOT_FOUND',
      {
        code: 'WHATSAPP_AUTO_OUTREACH_NOT_READY',
        when: 'Conexão não é da Meta, template não aprovado ou com link dinâmico',
      },
    ],
  },
  {
    method: 'post',
    path: `${BASE}/recipients`,
    tags: [TAG],
    summary: 'Adicionar contatos à fila',
    description: `Coloca contatos na fila (\`contactIds\`, ou \`all: true\` para todos — até 10.000). Descadastrados (opt-out) ficam de fora; quem já está na fila, em qualquer situação, não entra de novo. Um disparo concluído (\`DONE\`) volta a \`PAUSED\` para enviar aos novos. Devolve o disparo com \`added\`. Auditado. ${perm('broadcasts', 'EDIT')}`,
    body: QueueWhatsAppAutoOutreachSchema,
    responses: {
      200: { description: 'Fila atualizada.', schema: WhatsAppAutoOutreachDTO },
    },
    errors: permErrors('broadcasts', 'EDIT'),
  },
  {
    method: 'delete',
    path: `${BASE}/recipients`,
    tags: [TAG],
    summary: 'Limpar fila',
    description: `Remove os contatos pendentes; \`?all=true\` apaga também o histórico (enviados, falhas e pulados podem entrar de novo). Só com o disparo parado. Auditado. ${perm('broadcasts', 'EDIT')}`,
    query: {
      type: 'object',
      properties: {
        all: {
          type: 'boolean',
          description: 'Apagar também o histórico (padrão false).',
        },
      },
    },
    responses: {
      200: { description: 'Fila limpa.', schema: WhatsAppAutoOutreachDTO },
    },
    errors: [...permErrors('broadcasts', 'EDIT'), RUNNING],
  },
  {
    method: 'post',
    path: `${BASE}/play`,
    tags: [TAG],
    summary: 'Iniciar disparo (play)',
    description: `Liga o disparo: o worker envia o template a um contato da fila por vez, abre (ou reabre) a conversa com a IA respondendo conforme a configuração de IA do workspace e registra a mensagem como enviada pela IA. Contatos já em atendimento ou descadastrados são pulados. Para sozinho ao esvaziar a fila (\`DONE\`) ou ao bater o limite mensal (\`PAUSED\` com \`lastError\`). Já rodando = sem efeito. Auditado. ${perm('broadcasts', 'EDIT')}`,
    responses: {
      200: { description: 'Disparo ligado.', schema: WhatsAppAutoOutreachDTO },
    },
    errors: [
      ...permErrors('broadcasts', 'EDIT'),
      'WHATSAPP_CONNECTION_NOT_FOUND',
      'WHATSAPP_TEMPLATE_NOT_FOUND',
      {
        code: 'WHATSAPP_AUTO_OUTREACH_NOT_READY',
        when: 'Sem conexão/template válidos ou fila vazia',
      },
    ],
  },
  {
    method: 'post',
    path: `${BASE}/pause`,
    tags: [TAG],
    summary: 'Pausar disparo',
    description: `Pausa o disparo; o envio em andamento termina e nenhum outro sai até o próximo play. Parado = sem efeito. Auditado. ${perm('broadcasts', 'EDIT')}`,
    responses: {
      200: { description: 'Disparo pausado.', schema: WhatsAppAutoOutreachDTO },
    },
    errors: permErrors('broadcasts', 'EDIT'),
  },
]
