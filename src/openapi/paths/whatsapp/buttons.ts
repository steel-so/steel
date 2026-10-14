import { UpdateWhatsAppTemplateButtonsSchema } from '@/src/schemas/whatsapp-button.schema'
import { SendWhatsAppQuickReplyMessageSchema } from '@/src/schemas/whatsapp-message.schema'
import type { RouteConfig } from '../../registry'
import { WhatsAppMessageDTO, WhatsAppTemplateDTO } from '../../schemas/whatsapp'
import {
  CONVERSATION_PARAM,
  perm,
  permErrors,
  SEND_ERRORS,
  SEND_NOTE,
} from './shared'

/**
 * Botões com ações no clique: configurar as ações de um template e enviar
 * uma mensagem pronta com botões.
 */
export const buttonRoutes: RouteConfig[] = [
  {
    method: 'patch',
    path: '/workspaces/{id}/whatsapp/templates/{templateId}/buttons',
    tags: ['Comunicação · Templates e respostas rápidas'],
    summary: 'Configurar ações dos botões do template',
    description: `Define o que cada botão de **resposta** do template faz quando o contato clica (responder, atribuir a um atendente ou equipe, mudar o status/fechar, disparar um workflow do CRM, chamar uma URL externa assinada com HMAC-SHA256 em \`X-Steel-Signature\`, instrução para a IA). Vale também para templates sincronizados da Meta (ids \`b1\`, \`b2\`…). Os botões precisam ser **os mesmos do template aprovado** — mesma ordem, tipo, rótulo e link; só os ids e as ações mudam. Auditado. ${perm('message-templates', 'EDIT')}`,
    params: { templateId: 'Id do template.' },
    body: UpdateWhatsAppTemplateButtonsSchema,
    responses: {
      200: { description: 'Template atualizado.', schema: WhatsAppTemplateDTO },
    },
    errors: [
      ...permErrors('message-templates', 'EDIT'),
      'WHATSAPP_TEMPLATE_NOT_FOUND',
      {
        code: 'VALIDATION_ERROR',
        message:
          'Os botões precisam ser os mesmos do template aprovado — só as ações podem mudar',
        when: 'Botões diferentes dos aprovados pela Meta (quantidade, tipo, rótulo ou link)',
      },
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/whatsapp/conversations/{conversationId}/messages/quick-reply',
    tags: ['Comunicação · Conversas'],
    summary: 'Enviar mensagem pronta',
    description: `Envia uma mensagem pronta com corpo, mídia e botões. As variáveis \`{nome_cliente}\`, \`{nome_usuario}\` e \`{workspace}\` são resolvidas no servidor; \`variables\` sobrescreve qualquer \`{token}\`. Botões: na **Z-API** saem como botões de ação (\`/send-button-actions\`, resposta + link) ou lista de botões (\`/send-button-list\`, só resposta) — dependem do suporte do WhatsApp a APIs não oficiais e podem não aparecer em alguns aparelhos; na **Meta** saem como mensagem interativa (só dentro da janela de 24 h): até 2 botões de resposta, ou um link (\`cta_url\`); um link junto de resposta vai no fim do texto. Mídia que o provedor não aceita junto dos botões (áudio; vídeo/documento na Z-API) sai antes, como mensagem própria. Os botões de resposta levam o payload \`stl:q:<quickReplyId>:<botão>\`, então o clique dispara as ações configuradas. Bloqueado enquanto a IA atende a conversa. ${SEND_NOTE} Devolve a última mensagem criada (com \`buttons\`); todas são publicadas no SSE (\`message.created\` + \`conversation.updated\`). Auditado. ${perm('conversations', 'CREATE')}`,
    params: { conversationId: CONVERSATION_PARAM },
    body: SendWhatsAppQuickReplyMessageSchema,
    responses: {
      201: { description: 'Mensagem enviada.', schema: WhatsAppMessageDTO },
    },
    errors: [
      ...permErrors('conversations', 'CREATE'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
      'WHATSAPP_QUICK_REPLY_NOT_FOUND',
      {
        code: 'WHATSAPP_CONNECTION_NOT_FOUND',
        when: 'A conexão da conversa foi removida',
      },
      {
        code: 'WHATSAPP_CONVERSATION_AI_HANDLING',
        when: 'A IA está atendendo a conversa (`aiActive`)',
      },
      {
        code: 'WHATSAPP_BUTTONS_UNSUPPORTED',
        when: 'Meta: o texto com botões passa de 1024 caracteres',
      },
      ...SEND_ERRORS,
    ],
  },
]
