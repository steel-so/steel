import type {
  FlowCrmAction,
  FlowDefinition,
  FlowPreset,
} from '@/src/schemas/whatsapp-flow.schema'

export interface FlowPresetData {
  definition: FlowDefinition
  crmAction: FlowCrmAction
  category: 'SIGN_UP' | 'APPOINTMENT_BOOKING' | 'SURVEY' | 'OTHER'
  bodyText: string
  ctaLabel: string
  confirmationText: string | null
}

const BLANK: FlowPresetData = {
  category: 'OTHER',
  crmAction: 'NONE',
  bodyText: 'Preencha o formulário para continuar.',
  ctaLabel: 'Preencher',
  confirmationText: null,
  definition: {
    screens: [
      {
        title: 'Formulário',
        heading: 'Seus dados',
        fields: [
          {
            key: 'nome',
            label: 'Nome',
            type: 'text',
            required: true,
            mapping: { target: 'contact', attribute: 'name' },
          },
        ],
      },
    ],
  },
}

const SIGN_UP: FlowPresetData = {
  category: 'SIGN_UP',
  crmAction: 'LEAD',
  bodyText: 'Faça seu cadastro em um minuto, direto por aqui.',
  ctaLabel: 'Cadastrar',
  confirmationText: 'Recebemos seu cadastro. Em breve entramos em contato.',
  definition: {
    screens: [
      {
        title: 'Cadastro',
        heading: 'Seus dados',
        submitLabel: 'Continuar',
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
            mapping: { target: 'lead', attribute: 'phone' },
          },
        ],
      },
      {
        title: 'Sua empresa',
        heading: 'Sobre a empresa',
        submitLabel: 'Enviar',
        fields: [
          {
            key: 'empresa',
            label: 'Empresa',
            type: 'text',
            required: false,
            mapping: { target: 'lead', attribute: 'company' },
          },
          {
            key: 'consentimento',
            label: 'Aceito receber contato da equipe',
            type: 'checkbox',
            required: true,
          },
        ],
      },
    ],
  },
}

const APPOINTMENT: FlowPresetData = {
  category: 'APPOINTMENT_BOOKING',
  crmAction: 'NONE',
  bodyText: 'Escolha o melhor dia e horário para o seu atendimento.',
  ctaLabel: 'Agendar',
  confirmationText: 'Agendamento recebido. Vamos confirmar em instantes.',
  definition: {
    screens: [
      {
        title: 'Agendamento',
        heading: 'Quando você prefere?',
        fields: [
          {
            key: 'nome',
            label: 'Nome',
            type: 'text',
            required: true,
            mapping: { target: 'contact', attribute: 'name' },
          },
          {
            key: 'servico',
            label: 'Serviço',
            type: 'select',
            required: true,
            options: [
              { id: 'consulta', title: 'Consulta' },
              { id: 'retorno', title: 'Retorno' },
              { id: 'outro', title: 'Outro' },
            ],
          },
          { key: 'data', label: 'Data', type: 'date', required: true },
          {
            key: 'periodo',
            label: 'Período',
            type: 'radio',
            required: true,
            options: [
              { id: 'manha', title: 'Manhã' },
              { id: 'tarde', title: 'Tarde' },
            ],
          },
          {
            key: 'observacao',
            label: 'Observação',
            type: 'textarea',
            required: false,
          },
        ],
      },
    ],
  },
}

const SURVEY: FlowPresetData = {
  category: 'SURVEY',
  crmAction: 'NONE',
  bodyText: 'Conte como foi o seu atendimento. Leva menos de um minuto.',
  ctaLabel: 'Responder',
  confirmationText: 'Obrigado pela sua avaliação!',
  definition: {
    screens: [
      {
        title: 'Pesquisa',
        heading: 'Como foi o atendimento?',
        fields: [
          {
            key: 'nota',
            label: 'Sua nota',
            type: 'radio',
            required: true,
            options: [
              { id: '5', title: '5 - Excelente' },
              { id: '4', title: '4 - Bom' },
              { id: '3', title: '3 - Regular' },
              { id: '2', title: '2 - Ruim' },
              { id: '1', title: '1 - Péssimo' },
            ],
          },
          {
            key: 'pontos',
            label: 'O que mais gostou?',
            type: 'multiselect',
            required: false,
            options: [
              { id: 'rapidez', title: 'Rapidez' },
              { id: 'cordialidade', title: 'Cordialidade' },
              { id: 'solucao', title: 'Solução' },
            ],
          },
          {
            key: 'comentario',
            label: 'Comentário',
            type: 'textarea',
            required: false,
          },
        ],
      },
    ],
  },
}

const PRESETS: Record<FlowPreset, FlowPresetData> = {
  BLANK,
  SIGN_UP,
  APPOINTMENT,
  SURVEY,
}

/** A fresh copy of a preset (callers mutate it freely). */
export function flowFromPreset(preset: FlowPreset): FlowPresetData {
  return structuredClone(PRESETS[preset])
}
