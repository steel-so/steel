import type { SdNlRefs } from '@/src/lib/servicedesk/nl-config'

/** Referências do workspace usadas nos testes de configuração em texto (S8). */
export function createFakeSdNlRefs(overrides?: Partial<SdNlRefs>): SdNlRefs {
  return {
    priorities: [
      { id: 'pri-high', name: 'Alta' },
      { id: 'pri-low', name: 'Baixa' },
    ],
    calendars: [{ id: 'cal-1', name: 'Horário comercial' }],
    departments: [
      { id: 'dep-net', name: 'Redes' },
      { id: 'dep-sup', name: 'Suporte' },
    ],
    categories: [{ id: 'cat-1', name: 'Acesso' }],
    phases: [{ id: 'ph-1', name: 'Em andamento' }],
    users: [
      { id: 'usr-1', name: 'Ana' },
      { id: 'usr-2', name: 'Bruno' },
    ],
    ...overrides,
  }
}

export function createFakeSlaConfig(overrides?: Record<string, unknown>) {
  return {
    kind: 'SLA',
    name: 'VIP',
    description: null,
    calendarId: 'cal-1',
    conditions: [{ field: 'priorityId', operator: 'in', value: ['pri-high'] }],
    isDefault: false,
    active: true,
    targets: [
      {
        priorityId: 'pri-high',
        firstResponseMinutes: 15,
        resolutionMinutes: 240,
      },
    ],
    ...overrides,
  }
}

export function createFakeAutomationConfig(
  overrides?: Record<string, unknown>,
) {
  return {
    name: 'VPN para Redes',
    description: null,
    event: 'TICKET_CREATED',
    conditions: [{ field: 'title', operator: 'contains', value: 'VPN' }],
    actions: [
      { type: 'assign_department', params: { departmentId: 'dep-net' } },
      {
        type: 'notify',
        params: {
          userIds: ['usr-1'],
          assignee: false,
          requester: false,
          departmentLeads: true,
          email: true,
          title: 'Chamado de VPN',
          message: '',
        },
      },
    ],
    stopProcessing: false,
    active: true,
    ...overrides,
  }
}

export function createFakeEscalationConfig(
  overrides?: Record<string, unknown>,
) {
  return {
    name: 'Resolução em risco',
    trigger: 'RESOLUTION_AT_RISK',
    thresholdMinutes: null,
    conditions: [],
    actions: {
      kind: 'HIERARCHICAL',
      notifyUserIds: ['usr-2'],
      notifyAssignee: true,
      notifyDepartmentLeads: true,
      reassignDepartmentId: null,
      reassignUserId: null,
      raisePriority: true,
      email: false,
      notifyOnCall: false,
      reassignToOnCall: false,
    },
    active: true,
    ...overrides,
  }
}

/** Resposta do modelo no envelope esperado. */
export function modelEnvelope(
  config: unknown,
  overrides?: Partial<{
    understood: boolean
    summary: string
    warnings: string[]
  }>,
): string {
  return JSON.stringify({
    understood: true,
    summary: 'Montei a configuração.',
    warnings: [],
    configJson: JSON.stringify(config),
    ...overrides,
  })
}
