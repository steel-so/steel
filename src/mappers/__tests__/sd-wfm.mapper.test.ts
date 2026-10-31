import { describe, expect, it } from 'vitest'
import { createFakeSdWfmSettings } from '@/src/__tests__/factories/nov-sd-wfm.factory'
import {
  parseWfmShifts,
  SD_WFM_DEFAULT_SETTINGS,
  toSdWfmSettingsDTO,
} from '../sd-wfm.mapper'

describe('sd-wfm mapper', () => {
  it('falls back to the defaults without a row', () => {
    expect(toSdWfmSettingsDTO(null)).toBe(SD_WFM_DEFAULT_SETTINGS)
  })

  it('maps a saved row', () => {
    expect(toSdWfmSettingsDTO(createFakeSdWfmSettings())).toEqual({
      historyWeeks: 4,
      ticketsPerAgentHour: 2,
      targetOccupancyPercent: 100,
      minAgentsPerShift: 1,
      shifts: [{ name: 'Dia', startHour: 8, endHour: 12 }],
    })
  })

  it('drops malformed shifts instead of throwing', () => {
    expect(parseWfmShifts('nope')).toEqual([])
    expect(
      parseWfmShifts([
        null,
        { name: 1, startHour: 1, endHour: 2 },
        { name: 'x', startHour: 5, endHour: 5 },
        { name: 'ok', startHour: 22, endHour: 6 },
      ]),
    ).toEqual([{ name: 'ok', startHour: 22, endHour: 6 }])
  })
})
