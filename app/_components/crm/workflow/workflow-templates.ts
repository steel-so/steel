import type { CrmWorkflowDefinition } from '@/src/schemas/crm-workflow.schema'

/**
 * Ready-made workflows offered when creating one. Each starts as a draft the
 * user can edit and only runs after "Ativar". Copy is what the user reads.
 */
export type WorkflowTemplate = {
  key: string
  name: string
  description: string
  definition: CrmWorkflowDefinition
}

export const WORKFLOW_TEMPLATES: readonly WorkflowTemplate[] = [
  {
    key: 'task-new-lead',
    name: 'Tarefa para cada novo lead',
    description:
      'Quando um lead chega, cria uma tarefa para alguém entrar em contato.',
    definition: {
      trigger: {
        id: 'trigger',
        position: { x: 120, y: 40 },
        data: { type: 'record-is-created', entity: 'lead' },
      },
      nodes: [
        {
          id: 'n_task',
          position: { x: 120, y: 200 },
          data: {
            type: 'create-record',
            entity: 'task',
            fields: { title: 'Entrar em contato com {{trigger.record.name}}' },
            label: 'Criar tarefa de contato',
          },
        },
      ],
      edges: [{ id: 'e1', source: 'trigger', target: 'n_task' }],
    },
  },
  {
    key: 'welcome-email',
    name: 'E-mail de boas-vindas ao novo lead',
    description:
      'Envia um e-mail automático de agradecimento assim que o lead é criado.',
    definition: {
      trigger: {
        id: 'trigger',
        position: { x: 120, y: 40 },
        data: { type: 'record-is-created', entity: 'lead' },
      },
      nodes: [
        {
          id: 'n_mail',
          position: { x: 120, y: 200 },
          data: {
            type: 'send-email',
            to: '{{trigger.record.email}}',
            subject: 'Recebemos o seu contato',
            body: '<p>Olá, {{trigger.record.name}}!</p><p>Obrigado pelo interesse. Em breve alguém da nossa equipe entra em contato.</p>',
            label: 'Enviar boas-vindas',
          },
        },
      ],
      edges: [{ id: 'e1', source: 'trigger', target: 'n_mail' }],
    },
  },
  {
    key: 'follow-up-3-days',
    name: 'Retomar contato depois de 3 dias',
    description:
      'Espera 3 dias depois que o lead chega e cria uma tarefa de retorno.',
    definition: {
      trigger: {
        id: 'trigger',
        position: { x: 120, y: 40 },
        data: { type: 'record-is-created', entity: 'lead' },
      },
      nodes: [
        {
          id: 'n_wait',
          position: { x: 120, y: 200 },
          data: {
            type: 'delay',
            amount: 3,
            unit: 'days',
            label: 'Esperar 3 dias',
          },
        },
        {
          id: 'n_task',
          position: { x: 120, y: 360 },
          data: {
            type: 'create-record',
            entity: 'task',
            fields: { title: 'Retomar contato com {{trigger.record.name}}' },
            label: 'Criar tarefa de retorno',
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'n_wait' },
        { id: 'e2', source: 'n_wait', target: 'n_task' },
      ],
    },
  },
  {
    key: 'onboarding-won-lead',
    name: 'Começar o atendimento quando o lead for ganho',
    description:
      'Quando um lead é marcado como ganho, cria uma tarefa para iniciar o onboarding.',
    definition: {
      trigger: {
        id: 'trigger',
        position: { x: 120, y: 40 },
        data: {
          type: 'record-is-updated',
          entity: 'lead',
          fields: [],
          leadEvent: 'won',
        },
      },
      nodes: [
        {
          id: 'n_task',
          position: { x: 120, y: 200 },
          data: {
            type: 'create-record',
            entity: 'task',
            fields: { title: 'Iniciar onboarding de {{trigger.record.name}}' },
            label: 'Criar tarefa de onboarding',
          },
        },
      ],
      edges: [{ id: 'e1', source: 'trigger', target: 'n_task' }],
    },
  },
]
