import z from 'zod'
import { isWfmShiftValid } from '@/src/lib/servicedesk/wfm-forecast'
import { sdId } from './sd-config.schema'

/** Previsão de demanda e dimensionamento (S5): ajustes e consulta. */

export const SdWfmShiftSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(1).max(24),
  })
  .refine(isWfmShiftValid, {
    message: 'O turno precisa começar e terminar em horas diferentes',
  })

export const UpdateSdWfmSettingsSchema = z
  .object({
    historyWeeks: z.number().int().min(2).max(26),
    ticketsPerAgentHour: z.number().min(0.1).max(60),
    targetOccupancyPercent: z.number().int().min(10).max(100),
    minAgentsPerShift: z.number().int().min(0).max(50),
    shifts: z.array(SdWfmShiftSchema).min(1).max(6),
  })
  .partial()

export const SdWfmForecastQuerySchema = z.object({
  departmentId: sdId.optional(),
})

export type UpdateSdWfmSettingsDTO = z.infer<typeof UpdateSdWfmSettingsSchema>
export type SdWfmForecastQueryDTO = z.infer<typeof SdWfmForecastQuerySchema>
