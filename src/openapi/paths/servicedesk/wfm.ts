import { z } from 'zod'
import {
  SdWfmForecastQuerySchema,
  UpdateSdWfmSettingsSchema,
} from '@/src/schemas/sd-wfm.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'

/**
 * ServiceDesk · Demanda e escala (S5) —
 * `app/api/workspaces/[id]/servicedesk/wfm/**`. Previsão determinística a
 * partir do histórico de chamados (nada passa por IA).
 */

const WFM = 'ServiceDesk · Demanda e escala' as const

const AGENT_ERRORS: ErrorEntry[] = [
  { code: 'FORBIDDEN', when: 'Não é membro do workspace' },
  'WORKSPACE_SUSPENDED',
  { code: 'MODULE_DISABLED', when: 'Módulo ServiceDesk desabilitado' },
  { code: 'SD_NOT_AGENT', when: 'Solicitante (membro sem departamento)' },
]

const ShiftDTO = z.object({
  name: z.string(),
  startHour: z.number().int(),
  endHour: z.number().int(),
})

const SettingsDTO = z.object({
  historyWeeks: z.number().int(),
  ticketsPerAgentHour: z.number(),
  targetOccupancyPercent: z.number().int(),
  minAgentsPerShift: z.number().int(),
  shifts: z.array(ShiftDTO),
})

const ForecastDTO = z.object({
  generatedAt: z.string(),
  timeZone: z.string(),
  departmentId: z.string().nullable(),
  insufficientData: z.boolean(),
  historyTickets: z.number().int(),
  historyWeeksWithData: z.number().int(),
  trend: z.number(),
  teamSize: z.number().int(),
  hasOnCallSchedule: z.boolean(),
  settings: SettingsDTO,
  heatmap: z.array(z.array(z.number())),
  hourly: z.array(
    z.object({
      at: z.string(),
      dateKey: z.string(),
      dow: z.number().int(),
      hour: z.number().int(),
      expected: z.number(),
      low: z.number(),
      high: z.number(),
    }),
  ),
  daily: z.array(
    z.object({
      dateKey: z.string(),
      dow: z.number().int(),
      expected: z.number(),
      low: z.number(),
      high: z.number(),
    }),
  ),
  staffing: z.array(
    z.object({
      dateKey: z.string(),
      dow: z.number().int(),
      shift: z.string(),
      hours: z.number().int(),
      expected: z.number(),
      low: z.number(),
      high: z.number(),
      suggestedAgents: z.number().int(),
      suggestedAgentsHigh: z.number().int(),
      onCallAgents: z.number().int().nullable(),
      understaffed: z.boolean(),
      exceedsTeam: z.boolean(),
    }),
  ),
})

const base = '/workspaces/{id}/servicedesk/wfm'

export const sdWfmRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: `${base}/forecast`,
    tags: [WFM],
    summary: 'Previsão de demanda e escala sugerida',
    description:
      'Volume esperado por hora (7 dias) e por dia (14 dias), com faixa baixa/alta, mapa de calor da semana e agentes sugeridos por turno e dia, comparados ao plantão e ao time. `insufficientData` avisa que o histórico é curto. Acesso: sessão + **agente** do ServiceDesk.',
    query: SdWfmForecastQuerySchema,
    responses: { 200: { description: 'Previsão.', schema: ForecastDTO } },
    errors: [
      ...AGENT_ERRORS,
      { code: 'SD_CONFIG_NOT_FOUND', when: 'Departamento inexistente' },
    ],
  },
  {
    method: 'get',
    path: `${base}/settings`,
    tags: [WFM],
    summary: 'Ajustes da previsão e dos turnos',
    description: 'Acesso: sessão + **agente** do ServiceDesk.',
    responses: { 200: { description: 'Ajustes.', schema: SettingsDTO } },
    errors: AGENT_ERRORS,
  },
  {
    method: 'patch',
    path: `${base}/settings`,
    tags: [WFM],
    summary: 'Alterar os ajustes da previsão e dos turnos',
    description:
      'Semanas de histórico, produtividade por atendente, ocupação alvo, mínimo por turno e turnos (hora local; `endHour` menor que `startHour` vira a meia-noite). Acesso: **admin** do ServiceDesk.',
    consent: true,
    body: UpdateSdWfmSettingsSchema,
    responses: { 200: { description: 'Ajustes salvos.', schema: SettingsDTO } },
    errors: [
      ...AGENT_ERRORS,
      { code: 'FORBIDDEN', when: 'Não é admin do ServiceDesk' },
      { code: 'VALIDATION_ERROR', when: 'Valores fora dos limites' },
    ],
  },
]
