import { describe, expect, it } from 'vitest'
import { createFakeWorkspaceAccessLog } from '@/src/__tests__/factories/workspace-access-log.factory'
import { csvRow } from '@/src/lib/csv-writer'
import {
  ACCESS_LOG_CSV_HEADER,
  formatAccessLogTimestamp,
  toWorkspaceAccessLogCsvCells,
  toWorkspaceAccessLogDTO,
} from '../workspace-access-log.mapper'

describe('toWorkspaceAccessLogDTO', () => {
  it('maps every field and serializes the date', () => {
    const row = createFakeWorkspaceAccessLog({ outcome: 'BLOCKED' })
    expect(toWorkspaceAccessLogDTO(row)).toEqual({
      id: row.id,
      userId: row.userId,
      userEmail: 'ana@acme.com.br',
      userName: 'Ana Souza',
      ip: '200.1.2.3',
      userAgent: 'Mozilla/5.0',
      outcome: 'BLOCKED',
      surface: 'APP',
      path: '/acme/home',
      createdAt: '2026-10-27T13:00:00.000Z',
    })
  })
})

describe('formatAccessLogTimestamp', () => {
  it('formats in São Paulo with seconds, whatever the server zone', () => {
    expect(formatAccessLogTimestamp(new Date('2026-10-27T13:04:05.000Z'))).toBe(
      '2026-10-27 10:04:05',
    )
    // Just after midnight UTC is still the previous day in São Paulo.
    expect(formatAccessLogTimestamp(new Date('2026-10-28T02:30:00.000Z'))).toBe(
      '2026-10-27 23:30:00',
    )
  })
})

describe('access log CSV', () => {
  it('has pt-BR headers', () => {
    expect(ACCESS_LOG_CSV_HEADER).toEqual([
      'Data e hora (São Paulo)',
      'Resultado',
      'Canal',
      'Nome',
      'E-mail',
      'ID do usuário',
      'IP',
      'Caminho',
      'Navegador (user agent)',
    ])
  })

  it('writes labels in Portuguese and keeps the user snapshot', () => {
    const row = createFakeWorkspaceAccessLog({
      userId: 'u_1',
      outcome: 'BLOCKED',
      surface: 'API',
      path: '/api/workspaces/ws_1/crm/leads',
    })
    expect(toWorkspaceAccessLogCsvCells(row)).toEqual([
      '2026-10-27 10:00:00',
      'Bloqueado',
      'API',
      'Ana Souza',
      'ana@acme.com.br',
      'u_1',
      '200.1.2.3',
      '/api/workspaces/ws_1/crm/leads',
      'Mozilla/5.0',
    ])
    expect(
      toWorkspaceAccessLogCsvCells(
        createFakeWorkspaceAccessLog({ outcome: 'ALLOWED', surface: 'APP' }),
      ).slice(1, 3),
    ).toEqual(['Permitido', 'App'])
  })

  it('leaves unknown values empty and neutralizes formulas', () => {
    const row = createFakeWorkspaceAccessLog({
      userId: null,
      userEmail: null,
      userName: '=HYPERLINK("x")',
      ip: null,
      userAgent: null,
      path: null,
    })
    expect(csvRow(toWorkspaceAccessLogCsvCells(row))).toBe(
      `2026-10-27 10:00:00,Permitido,App,"'=HYPERLINK(""x"")",,,,,\r\n`,
    )
  })
})
