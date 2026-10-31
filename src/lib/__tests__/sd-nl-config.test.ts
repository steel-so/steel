import { describe, expect, it } from 'vitest'
import {
  createFakeAutomationConfig,
  createFakeEscalationConfig,
  createFakeSdNlRefs,
  createFakeSlaConfig,
} from '@/src/__tests__/factories/nov-sd-nl-config.factory'
import {
  buildNlConfigSystem,
  describeNlConfig,
  diffNlConfig,
  formatMinutes,
  nlConfigRefIds,
} from '../servicedesk/nl-config'

const refs = createFakeSdNlRefs()
const now = new Date('2026-10-30T12:00:00Z')
const text = (fields: { field: string; text: string }[], key: string) =>
  fields.find((f) => f.field === key)?.text

describe('formatMinutes', () => {
  it.each([
    [30, '30 min'],
    [60, '1 hora'],
    [240, '4 horas'],
    [90, '1 h 30 min'],
    [1440, '1 dia'],
    [2880, '2 dias'],
  ])('%i -> %s', (n, label) => {
    expect(formatMinutes(n)).toBe(label)
  })
})

describe('buildNlConfigSystem', () => {
  it('lists the references and the shape of each kind', () => {
    const sla = buildNlConfigSystem({ kind: 'SLA', refs, now })
    expect(sla).toContain('pri-high="Alta"')
    expect(sla).toContain('firstResponseMinutes')
    expect(sla).toContain('2026-10-30')
    expect(buildNlConfigSystem({ kind: 'AUTOMATION', refs, now })).toContain(
      'assign_department',
    )
    expect(buildNlConfigSystem({ kind: 'ESCALATION', refs, now })).toContain(
      'reassignToOnCall',
    )
  })

  it('marks empty lists and embeds the rule being adjusted', () => {
    const empty = createFakeSdNlRefs({ calendars: [] })
    const out = buildNlConfigSystem({
      kind: 'SLA',
      refs: empty,
      now,
      existing: { name: 'Atual' },
    })
    expect(out).toContain('Calendários: (nenhum)')
    expect(out).toContain('AJUSTA')
    expect(out).toContain('"name":"Atual"')
  })
})

describe('describeNlConfig', () => {
  it('describes an SLA with names instead of ids', () => {
    const f = describeNlConfig('SLA', createFakeSlaConfig(), refs)
    expect(text(f, 'calendarId')).toBe('Horário comercial')
    expect(text(f, 'conditions')).toBe('Prioridade é um de Alta')
    expect(text(f, 'targets')).toContain('Alta: 1ª resposta em 15 min')
    expect(text(f, 'isDefault')).toBe('Não')
  })

  it('handles an SLA without calendar, conditions and targets', () => {
    const f = describeNlConfig(
      'SLA',
      createFakeSlaConfig({ calendarId: null, conditions: [], targets: [] }),
      refs,
    )
    expect(text(f, 'calendarId')).toContain('Sem calendário')
    expect(text(f, 'conditions')).toBe('Todos os chamados')
    expect(text(f, 'targets')).toBe('Nenhuma meta')
  })

  it('describes automation actions of every type', () => {
    const actions = [
      {
        type: 'set_field',
        params: { field: 'departmentId', value: 'dep-sup' },
      },
      { type: 'set_field', params: { field: 'channel', value: 'EMAIL' } },
      { type: 'assign_user', params: { userId: 'usr-1' } },
      { type: 'round_robin', params: {} },
      { type: 'round_robin', params: { departmentId: 'dep-net' } },
      { type: 'add_participant', params: { userId: 'usr-2' } },
      { type: 'add_tag', params: { tag: 'vip' } },
      {
        type: 'notify',
        params: {
          userIds: [],
          assignee: true,
          requester: true,
          departmentLeads: false,
          email: false,
          title: 'Aviso',
          message: '',
        },
      },
      {
        type: 'notify',
        params: {
          userIds: [],
          assignee: false,
          requester: false,
          departmentLeads: false,
          email: false,
          title: 'Ninguém',
          message: '',
        },
      },
      { type: 'post_message', params: { body: 'Oi', visibility: 'PUBLIC' } },
      {
        type: 'post_message',
        params: { body: 'Nota', visibility: 'INTERNAL' },
      },
      {
        type: 'create_task',
        params: {
          title: 'Ligar',
          assigneeId: 'usr-1',
          dueInMinutes: 120,
        },
      },
      { type: 'create_task', params: { title: 'Sem dono' } },
      { type: 'apply_template', params: { templateId: 't1' } },
      {
        type: 'escalate',
        params: {
          kind: 'FUNCTIONAL',
          toDepartmentId: 'dep-net',
          toUserId: 'usr-1',
          reason: 'Urgente',
        },
      },
      { type: 'escalate', params: { kind: 'HIERARCHICAL', reason: 'x' } },
      { type: 'mystery', params: {} },
    ]
    const f = describeNlConfig(
      'AUTOMATION',
      createFakeAutomationConfig({ actions, stopProcessing: true }),
      refs,
    )
    const out = text(f, 'actions') ?? ''
    for (const piece of [
      'Definir Departamento = Suporte',
      'Definir Canal = EMAIL',
      'Atribuir a Ana',
      'rodízio no departamento do chamado',
      'rodízio no departamento Redes',
      'Adicionar Bruno como participante',
      'etiqueta “vip”',
      'Notificar responsável, solicitante',
      'Notificar ninguém',
      'mensagem pública',
      'mensagem interna',
      'para Ana (prazo de 2 horas)',
      'Criar tarefa “Sem dono”',
      'Aplicar um modelo',
      'Escalonar (funcional) para Redes para Ana: Urgente',
      'Escalonar (hierárquico): x',
      'mystery',
    ]) {
      expect(out).toContain(piece)
    }
    expect(text(f, 'event')).toBe('Chamado criado')
    expect(text(f, 'conditions')).toBe('Título contém VPN')
    expect(text(f, 'stopProcessing')).toBe('Sim')
  })

  it('describes escalation, including empty-value operators and custom fields', () => {
    const f = describeNlConfig(
      'ESCALATION',
      createFakeEscalationConfig({
        trigger: 'NO_UPDATE',
        thresholdMinutes: 120,
        conditions: [
          { field: 'tags', operator: 'is_empty' },
          { field: 'customFields.regiao', operator: 'equals', value: 'Sul' },
        ],
        actions: {
          kind: 'FUNCTIONAL',
          notifyUserIds: ['usr-1'],
          notifyAssignee: false,
          notifyDepartmentLeads: false,
          reassignDepartmentId: 'dep-sup',
          reassignUserId: 'usr-2',
          raisePriority: true,
          email: true,
          notifyOnCall: true,
          reassignToOnCall: true,
        },
      }),
      refs,
    )
    expect(text(f, 'trigger')).toBe('Chamado sem atualização (2 horas)')
    expect(text(f, 'conditions')).toBe(
      'Etiquetas está vazio e Campo regiao é Sul',
    )
    const actions = text(f, 'actions') ?? ''
    expect(actions).toContain('Escalonamento funcional')
    expect(actions).toContain('passar ao departamento Suporte')
    expect(actions).toContain('passar a Bruno')
    expect(actions).toContain('plantão')
    expect(actions).toContain('subir a prioridade')
    expect(actions).toContain('enviar e-mail')
  })

  it('falls back to the raw id for unknown references', () => {
    const f = describeNlConfig(
      'SLA',
      createFakeSlaConfig({ calendarId: 'zzz' }),
      refs,
    )
    expect(text(f, 'calendarId')).toBe('(zzz)')
  })
})

describe('diffNlConfig', () => {
  it('returns only the fields that change', () => {
    const before = createFakeSlaConfig()
    const after = createFakeSlaConfig({
      targets: [
        {
          priorityId: 'pri-high',
          firstResponseMinutes: 30,
          resolutionMinutes: 240,
        },
      ],
    })
    const rows = diffNlConfig('SLA', before, after, refs)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ field: 'targets', label: 'Metas' })
    expect(rows[0].before).toContain('15 min')
    expect(rows[0].after).toContain('30 min')
    expect(diffNlConfig('SLA', before, before, refs)).toEqual([])
  })
})

describe('nlConfigRefIds', () => {
  it('collects references per kind', () => {
    expect(nlConfigRefIds('SLA', createFakeSlaConfig())).toEqual({
      calendarIds: ['cal-1'],
      priorityIds: ['pri-high'],
      departmentIds: [],
      userIds: [],
    })
    expect(
      nlConfigRefIds(
        'SLA',
        createFakeSlaConfig({ calendarId: null, targets: [] }),
      ),
    ).toMatchObject({ calendarIds: [], priorityIds: [] })
    const esc = nlConfigRefIds(
      'ESCALATION',
      createFakeEscalationConfig({
        actions: {
          notifyUserIds: ['usr-1'],
          reassignUserId: 'usr-2',
          reassignDepartmentId: 'dep-net',
        },
      }),
    )
    expect(esc).toMatchObject({
      userIds: ['usr-1', 'usr-2'],
      departmentIds: ['dep-net'],
    })
    expect(nlConfigRefIds('AUTOMATION', {})).toEqual({
      calendarIds: [],
      priorityIds: [],
      departmentIds: [],
      userIds: [],
    })
    expect(
      nlConfigRefIds('ESCALATION', { actions: undefined }).userIds,
    ).toEqual([])
  })
})

describe('describeNlConfig with sparse input', () => {
  it.each(['SLA', 'AUTOMATION', 'ESCALATION'] as const)(
    'does not break on an empty %s config',
    (kind) => {
      const f = describeNlConfig(kind, {}, refs)
      expect(f[0]).toEqual({ field: 'name', label: 'Nome', text: '' })
    },
  )

  it('resolves names for phase, category and assignee conditions', () => {
    const f = describeNlConfig(
      'SLA',
      createFakeSlaConfig({
        conditions: [
          { field: 'phaseId', operator: 'equals', value: 'ph-1' },
          { field: 'categoryId', operator: 'equals', value: 'cat-1' },
          { field: 'assigneeId', operator: 'not_equals', value: 'usr-2' },
          { field: 'type', operator: 'equals', value: null },
          { field: 'customFields.x', operator: 'weird', value: 1 },
        ],
      }),
      refs,
    )
    expect(text(f, 'conditions')).toBe(
      'Fase é Em andamento e Categoria é Acesso e Responsável não é Bruno e Tipo é e Campo x  1',
    )
  })

  it('treats a non-list conditions value as no condition', () => {
    const f = describeNlConfig(
      'AUTOMATION',
      createFakeAutomationConfig({ conditions: 'x' }),
      refs,
    )
    expect(text(f, 'conditions')).toBe('Todos os chamados')
  })

  it('shows notified users by name and the unknown event as is', () => {
    const f = describeNlConfig(
      'AUTOMATION',
      createFakeAutomationConfig({ event: 'CUSTOM' }),
      refs,
    )
    expect(text(f, 'event')).toBe('CUSTOM')
    expect(text(f, 'actions')).toContain(
      'Notificar líderes do departamento, Ana',
    )
    const e = describeNlConfig(
      'ESCALATION',
      createFakeEscalationConfig({ trigger: 'OTHER' }),
      refs,
    )
    expect(text(e, 'trigger')).toBe('OTHER')
  })
})
