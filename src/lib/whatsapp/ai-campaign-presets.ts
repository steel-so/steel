import type { AiCampaignActionKind } from '@/src/schemas/whatsapp-ai-campaign.schema'

/**
 * Modelos prontos de campanha (ponto de partida editável): objetivo,
 * instruções e as ações sugeridas — sem o destino (atendente, equipe,
 * status...), que cada workspace escolhe ao aplicar o modelo.
 */

export interface AiCampaignPresetAction {
  kind: AiCampaignActionKind
  label: string
  when: string
  /** Só FOLLOW_UP. */
  delayHours?: number
  /** Só WEBHOOK. */
  fields?: { key: string; description: string }[]
}

export interface AiCampaignPreset {
  id: string
  name: string
  description: string
  objective: string
  instructions: string
  actions: AiCampaignPresetAction[]
}

export const AI_CAMPAIGN_PRESETS: AiCampaignPreset[] = [
  {
    id: 'billing',
    name: 'Cobrança',
    description: 'Lembrete de pagamento, 2ª via e negociação.',
    objective:
      'Lembrar o cliente do pagamento em aberto e ajudar a regularizar.',
    instructions: [
      'Seja cordial e direto, sem tom de ameaça.',
      'Se o cliente disser que já pagou, agradeça e peça que guarde o comprovante.',
      'Se pedir a 2ª via ou o boleto, avise que um atendente vai enviar.',
      'Se quiser negociar ou parcelar, transfira para a equipe financeira.',
      'Nunca invente valores, datas ou descontos.',
    ].join('\n'),
    actions: [
      {
        kind: 'CLOSE',
        label: 'Pagamento confirmado',
        when: 'O cliente confirmou que já pagou ou vai pagar hoje.',
      },
      {
        kind: 'TRANSFER_TEAM',
        label: 'Negociação',
        when: 'O cliente quer negociar, parcelar, contestar o valor ou pediu a 2ª via.',
      },
      {
        kind: 'FOLLOW_UP',
        label: 'Lembrar depois',
        when: 'O cliente disse que vai pagar em outro dia e pediu para ser lembrado.',
        delayHours: 24,
      },
      {
        kind: 'OPT_OUT',
        label: 'Não quer mais mensagens',
        when: 'O cliente pediu para não receber mais mensagens.',
      },
    ],
  },
  {
    id: 'scheduling',
    name: 'Agendamento / Clínica',
    description: 'Confirmar, remarcar ou cancelar horários.',
    objective: 'Confirmar o horário agendado e remarcar quando necessário.',
    instructions: [
      'Confirme o horário informado na mensagem enviada.',
      'Se o cliente confirmar, agradeça e lembre de chegar com 15 minutos de antecedência.',
      'Se quiser remarcar, colete a melhor data e período e transfira para a recepção.',
      'Se cancelar, agradeça o aviso.',
    ].join('\n'),
    actions: [
      {
        kind: 'CLOSE',
        label: 'Presença confirmada',
        when: 'O cliente confirmou que vai comparecer.',
      },
      {
        kind: 'CLOSE',
        label: 'Cancelado',
        when: 'O cliente cancelou e não quer remarcar.',
      },
      {
        kind: 'TRANSFER_TEAM',
        label: 'Remarcar',
        when: 'O cliente quer remarcar o horário — depois de saber a data/período preferido.',
      },
      {
        kind: 'ADD_NOTE',
        label: 'Anotar preferência',
        when: 'O cliente informou uma preferência de dia, horário ou profissional.',
      },
    ],
  },
  {
    id: 'sales',
    name: 'Vendas / Qualificação',
    description: 'Apresentar uma oferta e qualificar o interesse.',
    objective:
      'Apresentar a oferta, entender o interesse e passar os quentes para vendas.',
    instructions: [
      'Apresente a oferta de forma curta e pergunte se faz sentido para o cliente.',
      'Descubra a necessidade, o prazo e quem decide a compra.',
      'Se houver interesse real, transfira para um vendedor com um resumo.',
      'Se não houver interesse, agradeça e encerre sem insistir.',
    ].join('\n'),
    actions: [
      {
        kind: 'TRANSFER_USER',
        label: 'Lead quente',
        when: 'O cliente demonstrou interesse claro em comprar ou pediu proposta/preço final.',
      },
      {
        kind: 'CRM_WORKFLOW',
        label: 'Criar oportunidade no CRM',
        when: 'O cliente tem interesse e informou necessidade e prazo.',
      },
      {
        kind: 'CLOSE',
        label: 'Sem interesse',
        when: 'O cliente disse que não tem interesse.',
      },
      {
        kind: 'FOLLOW_UP',
        label: 'Retomar contato',
        when: 'O cliente pediu para falar mais tarde ou em outro momento.',
        delayHours: 48,
      },
    ],
  },
  {
    id: 'satisfaction',
    name: 'Pesquisa de satisfação',
    description: 'Nota de 0 a 10 e motivo, com alerta para detratores.',
    objective: 'Coletar a nota de 0 a 10 do atendimento e o motivo.',
    instructions: [
      'Peça uma nota de 0 a 10 e, depois, o motivo em poucas palavras.',
      'Agradeça qualquer resposta.',
      'Notas de 0 a 6 são detratores: transfira para a equipe de sucesso do cliente.',
    ].join('\n'),
    actions: [
      {
        kind: 'WEBHOOK',
        label: 'Registrar nota',
        when: 'O cliente informou a nota (e o motivo, se deu).',
        fields: [
          { key: 'nota', description: 'A nota de 0 a 10 dada pelo cliente.' },
          {
            key: 'motivo',
            description: 'O motivo da nota, nas palavras do cliente.',
          },
        ],
      },
      {
        kind: 'TRANSFER_TEAM',
        label: 'Detrator',
        when: 'A nota foi de 0 a 6.',
      },
      {
        kind: 'CLOSE',
        label: 'Pesquisa respondida',
        when: 'A nota foi de 7 a 10 e o cliente já respondeu o motivo.',
      },
    ],
  },
  {
    id: 'reactivation',
    name: 'Reativação de clientes',
    description: 'Trazer de volta quem parou de comprar.',
    objective: 'Reconquistar clientes inativos com uma condição especial.',
    instructions: [
      'Mostre que sentimos falta do cliente e apresente a condição especial da mensagem.',
      'Pergunte o que fez ele parar de comprar e anote.',
      'Se voltar a ter interesse, transfira para um vendedor.',
    ].join('\n'),
    actions: [
      {
        kind: 'ADD_NOTE',
        label: 'Motivo da saída',
        when: 'O cliente contou por que parou de comprar.',
      },
      {
        kind: 'TRANSFER_USER',
        label: 'Quer voltar',
        when: 'O cliente quer aproveitar a condição ou voltar a comprar.',
      },
      {
        kind: 'OPT_OUT',
        label: 'Não quer contato',
        when: 'O cliente pediu para não ser mais contatado.',
      },
    ],
  },
  {
    id: 'attendance',
    name: 'Confirmação de presença',
    description: 'Eventos, aulas e reuniões.',
    objective: 'Confirmar a presença no evento informado na mensagem.',
    instructions: [
      'Pergunte se a pessoa confirma a presença.',
      'Tire dúvidas de data, horário e local apenas com o que está na mensagem enviada.',
      'Se tiver outra dúvida, transfira para a organização.',
    ].join('\n'),
    actions: [
      {
        kind: 'CLOSE',
        label: 'Confirmou presença',
        when: 'A pessoa confirmou que vai.',
      },
      {
        kind: 'CLOSE',
        label: 'Não vai',
        when: 'A pessoa avisou que não vai.',
      },
      {
        kind: 'TRANSFER_TEAM',
        label: 'Dúvida',
        when: 'A pessoa tem uma dúvida que a mensagem não responde.',
      },
    ],
  },
]
