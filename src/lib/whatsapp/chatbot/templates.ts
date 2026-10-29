import type { ChatbotFlow } from '@/src/schemas/whatsapp-chatbot.schema'

/** Starting flows offered when a bot is created. */

const edge = (source: string, sourceHandle: string, target: string) => ({
  id: `e-${source}-${sourceHandle}`,
  source,
  sourceHandle,
  target,
})

export function blankFlow(): ChatbotFlow {
  return {
    nodes: [
      { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
      {
        id: 'welcome',
        type: 'message',
        position: { x: 280, y: 0 },
        data: {
          text: 'Olá, {{contact_name}}! Obrigado por entrar em contato.',
        },
      },
      {
        id: 'handoff',
        type: 'handoff-human',
        position: { x: 560, y: 0 },
        data: { text: 'Já vou chamar um atendente para ajudar você.' },
      },
    ],
    edges: [
      edge('start', 'next', 'welcome'),
      edge('welcome', 'next', 'handoff'),
    ],
  }
}

export function menuFlow(): ChatbotFlow {
  return {
    nodes: [
      { id: 'start', type: 'start', position: { x: 0, y: 120 }, data: {} },
      {
        id: 'menu',
        type: 'menu',
        position: { x: 280, y: 120 },
        data: {
          text: 'Olá, {{contact_name}}! Como podemos ajudar?',
          options: [
            { id: 'sales', label: 'Comercial' },
            { id: 'support', label: 'Suporte' },
            { id: 'other', label: 'Outro assunto' },
          ],
          maxAttempts: 2,
        },
      },
      {
        id: 'to-sales',
        type: 'handoff-human',
        position: { x: 620, y: 0 },
        data: { text: 'Certo! Um consultor comercial vai falar com você.' },
      },
      {
        id: 'to-support',
        type: 'handoff-human',
        position: { x: 620, y: 140 },
        data: { text: 'Certo! Nosso suporte vai atender você.' },
      },
      {
        id: 'to-ai',
        type: 'handoff-ai',
        position: { x: 620, y: 280 },
        data: { text: 'Pode me contar o que você precisa.' },
      },
    ],
    edges: [
      edge('start', 'next', 'menu'),
      edge('menu', 'sales', 'to-sales'),
      edge('menu', 'support', 'to-support'),
      edge('menu', 'other', 'to-ai'),
    ],
  }
}

export function leadCaptureFlow(): ChatbotFlow {
  return {
    nodes: [
      { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
      {
        id: 'ask-name',
        type: 'question',
        position: { x: 280, y: 0 },
        data: {
          text: 'Olá! Para começar, qual é o seu nome?',
          variable: 'nome',
          validation: 'TEXT',
          maxAttempts: 2,
        },
      },
      {
        id: 'ask-email',
        type: 'question',
        position: { x: 560, y: 0 },
        data: {
          text: 'Prazer, {{nome}}! Qual é o seu e-mail?',
          variable: 'email',
          validation: 'EMAIL',
          errorText: 'Esse e-mail não parece válido. Pode digitar de novo?',
          maxAttempts: 3,
        },
      },
      {
        id: 'handoff',
        type: 'handoff-human',
        position: { x: 840, y: 0 },
        data: {
          text: 'Obrigado, {{nome}}! Um consultor vai falar com você em instantes.',
        },
      },
    ],
    edges: [
      edge('start', 'next', 'ask-name'),
      edge('ask-name', 'next', 'ask-email'),
      edge('ask-email', 'next', 'handoff'),
    ],
  }
}

export function flowFromTemplate(
  template: 'blank' | 'menu' | 'lead-capture',
): ChatbotFlow {
  if (template === 'menu') return menuFlow()
  if (template === 'lead-capture') return leadCaptureFlow()
  return blankFlow()
}
