import { describe, expect, it } from 'vitest'
import {
  AI_FOLDER,
  ArchivePathRegistry,
  AttendantFolders,
  archiveClock,
  archiveDayKey,
  archiveExpiry,
  archiveFileName,
  archiveIndexHeader,
  archiveIndexLine,
  archiveObjectKey,
  archivePeriod,
  archiveTimeLabel,
  atendimentoBaseName,
  attendantLabels,
  attributeAttendants,
  contactSegment,
  defaultArchiveRootFolder,
  formatDayKey,
  mediaFileName,
  NO_ATTENDANT_FOLDER,
  resolveArchiveRootFolder,
  slugifySegment,
  toPdfSafeText,
  windowsSafeSegment,
} from '@/src/lib/whatsapp/archive/layout'

/**
 * Package layout of the WhatsApp archive (ADR 0052): São Paulo periods and
 * days, Windows-safe unique names and who owns each atendimento.
 */

const out = (senderUserId: string | null, senderName: string | null) => ({
  direction: 'OUT' as const,
  senderUserId,
  senderName,
  sentByAi: false,
})
const ai = {
  direction: 'OUT' as const,
  senderUserId: null,
  senderName: null,
  sentByAi: true,
}
const inbound = {
  direction: 'IN' as const,
  senderUserId: null,
  senderName: null,
  sentByAi: false,
}

describe('archivePeriod', () => {
  it('covers the previous Monday 00:00 to Sunday 23:59:59.999 in São Paulo', () => {
    // Monday 26/10/2026 02:00 in São Paulo (cron time).
    const period = archivePeriod('WEEKLY', new Date('2026-10-26T05:00:00.000Z'))
    expect(period.periodStart?.toISOString()).toBe('2026-10-19T03:00:00.000Z')
    expect(period.periodEnd.toISOString()).toBe('2026-10-26T02:59:59.999Z')
  })

  it('uses the São Paulo day, not UTC, near midnight', () => {
    // Sunday 25/10 23:30 in São Paulo is already Monday in UTC.
    const period = archivePeriod('WEEKLY', new Date('2026-10-26T02:30:00.000Z'))
    expect(period.periodStart?.toISOString()).toBe('2026-10-12T03:00:00.000Z')
    expect(period.periodEnd.toISOString()).toBe('2026-10-19T02:59:59.999Z')
  })

  it('gives the same week for any day of the current week', () => {
    const wednesday = archivePeriod(
      'WEEKLY',
      new Date('2026-10-28T15:00:00.000Z'),
    )
    const monday = archivePeriod('WEEKLY', new Date('2026-10-26T05:00:00.000Z'))
    expect(wednesday).toEqual(monday)
  })

  it('MONTHLY_FULL is all history up to the end of the previous month', () => {
    const period = archivePeriod(
      'MONTHLY_FULL',
      new Date('2026-11-01T05:30:00.000Z'),
    )
    expect(period.periodStart).toBeNull()
    expect(period.periodEnd.toISOString()).toBe('2026-11-01T02:59:59.999Z')
  })

  it('MONTHLY_FULL in January closes December of the previous year', () => {
    const period = archivePeriod(
      'MONTHLY_FULL',
      new Date('2027-01-01T05:30:00.000Z'),
    )
    expect(period.periodEnd.toISOString()).toBe('2027-01-01T02:59:59.999Z')
    expect(archiveDayKey(period.periodEnd)).toBe('2026-12-31')
  })
})

describe('archiveExpiry', () => {
  it('keeps weekly packages 90 days', () => {
    expect(
      archiveExpiry(
        'WEEKLY',
        new Date('2026-10-26T05:00:00.000Z'),
      ).toISOString(),
    ).toBe('2027-01-24T05:00:00.000Z')
  })

  it('keeps monthly packages 12 months', () => {
    expect(
      archiveExpiry(
        'MONTHLY_FULL',
        new Date('2026-11-01T05:30:00.000Z'),
      ).toISOString(),
    ).toBe('2027-11-01T05:30:00.000Z')
  })
})

describe('root folder', () => {
  it('uppercases the slug and keeps only letters and digits', () => {
    expect(defaultArchiveRootFolder('fidelizza-mais')).toBe('FIDELIZZAMAIS')
    expect(defaultArchiveRootFolder('ação_2026')).toBe('ACAO2026')
  })

  it('falls back to STEEL when nothing is left', () => {
    expect(defaultArchiveRootFolder('---')).toBe('STEEL')
  })

  it('never yields a Windows device name', () => {
    expect(defaultArchiveRootFolder('con')).toBe('CON_')
    expect(defaultArchiveRootFolder('lpt-1')).toBe('LPT1_')
  })

  it('caps the length at 40', () => {
    expect(defaultArchiveRootFolder('a'.repeat(60))).toHaveLength(40)
  })

  it('prefers the configured folder', () => {
    expect(resolveArchiveRootFolder('BANCO_X', 'fidelizza')).toBe('BANCO_X')
    expect(resolveArchiveRootFolder('  ', 'fidelizza')).toBe('FIDELIZZA')
    expect(resolveArchiveRootFolder(null, 'fidelizza')).toBe('FIDELIZZA')
  })
})

describe('slugifySegment', () => {
  it('strips accents, lower-cases and joins with hyphens', () => {
    expect(slugifySegment('João da Conceição')).toBe('joao-da-conceicao')
  })

  it('removes path separators and characters Windows forbids', () => {
    expect(slugifySegment('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j')
  })

  it('drops emoji and leading/trailing separators', () => {
    expect(slugifySegment('  😀 Maria!! ')).toBe('maria')
  })

  it('truncates without a trailing hyphen', () => {
    expect(slugifySegment('abc def', 4)).toBe('abc')
  })

  it('returns empty for nothing usable', () => {
    expect(slugifySegment('😀😀')).toBe('')
  })
})

describe('windowsSafeSegment', () => {
  it('suffixes reserved device names in any case', () => {
    expect(windowsSafeSegment('con')).toBe('con_')
    expect(windowsSafeSegment('Aux')).toBe('Aux_')
    expect(windowsSafeSegment('com9')).toBe('com9_')
  })

  it('keeps ordinary names', () => {
    expect(windowsSafeSegment('console')).toBe('console')
  })
})

describe('contactSegment', () => {
  it('joins the name slug and the phone', () => {
    expect(contactSegment('Maria Silva', '5511988887777')).toBe(
      'maria-silva-5511988887777',
    )
  })

  it('uses only the phone without a name', () => {
    expect(contactSegment(null, '5511988887777')).toBe('5511988887777')
    expect(contactSegment('😀', '5511988887777')).toBe('5511988887777')
  })

  it('slugifies a BSUID contact without a phone', () => {
    expect(contactSegment('Ana', 'BR.1234ABC')).toBe('ana-br-1234abc')
    expect(contactSegment(null, 'BR.99')).toBe('br-99')
  })

  it('caps very long names', () => {
    const segment = contactSegment('x'.repeat(200), '5511988887777')
    expect(segment).toBe(`${'x'.repeat(50)}-5511988887777`)
  })

  it('falls back to "contato" and avoids device names', () => {
    expect(contactSegment(null, '...')).toBe('contato')
    expect(contactSegment('nul', '')).toBe('nul_')
  })
})

describe('times and names', () => {
  const at = new Date('2026-10-20T17:05:09.000Z') // 14:05:09 in São Paulo

  it('formats the São Paulo time of the file name and the clock', () => {
    expect(archiveTimeLabel(at)).toBe('14h05')
    expect(archiveClock(at)).toBe('14:05:09')
  })

  it('uses 00h, never 24h, after midnight', () => {
    expect(archiveTimeLabel(new Date('2026-10-21T03:01:00.000Z'))).toBe('00h01')
  })

  it('gives the São Paulo day and its pt-BR form', () => {
    expect(archiveDayKey(new Date('2026-10-21T02:30:00.000Z'))).toBe(
      '2026-10-20',
    )
    expect(formatDayKey('2026-10-20')).toBe('20/10/2026')
  })

  it('builds the atendimento base name', () => {
    expect(atendimentoBaseName('maria-5511988887777', '2026-10-20', at)).toBe(
      'maria-5511988887777-2026-10-20-14h05',
    )
  })

  it('names the zip after the root, kind and period', () => {
    expect(
      archiveFileName('FIDELIZZAMAIS', 'WEEKLY', {
        periodStart: new Date('2026-10-19T03:00:00.000Z'),
        periodEnd: new Date('2026-10-26T02:59:59.999Z'),
      }),
    ).toBe('FIDELIZZAMAIS-whatsapp-semanal-2026-10-19-a-2026-10-25.zip')
    expect(
      archiveFileName('FIDELIZZAMAIS', 'MONTHLY_FULL', {
        periodStart: null,
        periodEnd: new Date('2026-11-01T02:59:59.999Z'),
      }),
    ).toBe('FIDELIZZAMAIS-whatsapp-completo-ate-2026-10-31.zip')
  })

  it('keys the object by workspace and archive', () => {
    expect(archiveObjectKey('ws1', 'a1')).toBe('ws1/a1.zip')
  })
})

describe('attributeAttendants', () => {
  it('lists every human who replied, in order, once each', () => {
    expect(
      attributeAttendants(
        [inbound, out('u2', 'Bia'), out('u1', 'Ana'), out('u2', 'Bia'), ai],
        { id: 'u9', name: 'Zé' },
      ),
    ).toEqual([
      { kind: 'user', userId: 'u2', name: 'Bia' },
      { kind: 'user', userId: 'u1', name: 'Ana' },
    ])
  })

  it('ignores a human id on an inbound message', () => {
    expect(
      attributeAttendants(
        [{ ...inbound, senderUserId: 'u1', senderName: 'Ana' }],
        null,
      ),
    ).toEqual([{ kind: 'none' }])
  })

  it('gives the AI when only the AI replied', () => {
    expect(
      attributeAttendants([inbound, ai], { id: 'u1', name: 'Ana' }),
    ).toEqual([{ kind: 'ai' }])
  })

  it('falls back to the assignee when nobody replied', () => {
    expect(
      attributeAttendants([inbound, out(null, null)], {
        id: 'u1',
        name: 'Ana',
      }),
    ).toEqual([{ kind: 'user', userId: 'u1', name: 'Ana' }])
  })

  it('is nobody without replies or assignee', () => {
    expect(attributeAttendants([inbound], null)).toEqual([{ kind: 'none' }])
  })

  it('keeps an empty name when the sender user has none', () => {
    expect(attributeAttendants([out('u1', null)], null)).toEqual([
      { kind: 'user', userId: 'u1', name: '' },
    ])
  })
})

describe('attendantLabels', () => {
  it('names users, the AI and nobody', () => {
    expect(
      attendantLabels(
        [
          { kind: 'user', userId: 'u1', name: '' },
          { kind: 'ai' },
          { kind: 'none' },
        ],
        [],
      ),
    ).toEqual(['Atendente', 'IA', 'Sem atendente'])
  })

  it('adds IA when it also replied next to a human', () => {
    expect(
      attendantLabels(
        [{ kind: 'user', userId: 'u1', name: 'Ana' }],
        [out('u1', 'Ana'), ai],
      ),
    ).toEqual(['Ana', 'IA'])
  })

  it('does not repeat IA when the AI is the attendant', () => {
    expect(attendantLabels([{ kind: 'ai' }], [ai])).toEqual(['IA'])
  })
})

describe('AttendantFolders', () => {
  it('maps the AI and nobody to fixed folders', () => {
    const folders = new AttendantFolders()
    expect(folders.folderFor({ kind: 'ai' })).toBe(AI_FOLDER)
    expect(folders.folderFor({ kind: 'none' })).toBe(NO_ATTENDANT_FOLDER)
  })

  it('is stable for the same user', () => {
    const folders = new AttendantFolders()
    const ana = { kind: 'user' as const, userId: 'u1', name: 'Ana Souza' }
    expect(folders.folderFor(ana)).toBe('ana-souza')
    expect(folders.folderFor({ ...ana, name: 'Renamed' })).toBe('ana-souza')
  })

  it('separates two users with the same name', () => {
    const folders = new AttendantFolders()
    expect(
      folders.folderFor({ kind: 'user', userId: 'aaa111', name: 'Ana' }),
    ).toBe('ana')
    expect(
      folders.folderFor({ kind: 'user', userId: 'bbb222', name: 'Ana' }),
    ).toBe('ana-bbb222')
  })

  it('never lets a user named "IA" share the AI folder (case-insensitive)', () => {
    const folders = new AttendantFolders()
    expect(folders.folderFor({ kind: 'user', userId: 'u1', name: 'IA' })).toBe(
      'ia-u1',
    )
    expect(
      folders.folderFor({ kind: 'user', userId: 'u2', name: 'Sem Atendente' }),
    ).toBe('sem-atendente-u2')
  })

  it('numbers further collisions of the same name and id prefix', () => {
    const folders = new AttendantFolders()
    const name = 'Ana'
    expect(folders.folderFor({ kind: 'user', userId: 'abcdefgh1', name })).toBe(
      'ana',
    )
    expect(folders.folderFor({ kind: 'user', userId: 'abcdefgh2', name })).toBe(
      'ana-abcdefgh',
    )
    expect(folders.folderFor({ kind: 'user', userId: 'abcdefgh3', name })).toBe(
      'ana-abcdefgh-2',
    )
  })

  it('names a user without a usable name by id', () => {
    const folders = new AttendantFolders()
    expect(folders.folderFor({ kind: 'user', userId: 'U1x', name: '😀' })).toBe(
      'atendente-u1x',
    )
    expect(folders.folderFor({ kind: 'user', userId: '__', name: '' })).toBe(
      'atendente-id',
    )
  })

  it('avoids Windows device names', () => {
    const folders = new AttendantFolders()
    expect(folders.folderFor({ kind: 'user', userId: 'u1', name: 'Con' })).toBe(
      'con_',
    )
  })
})

describe('ArchivePathRegistry', () => {
  it('suffixes repeated paths case-insensitively', () => {
    const paths = new ArchivePathRegistry()
    expect(paths.reserve('2026-10-20/ana', 'maria-1-2026-10-20-14h05')).toBe(
      '2026-10-20/ana/maria-1-2026-10-20-14h05.pdf',
    )
    expect(paths.reserve('2026-10-20/ana', 'MARIA-1-2026-10-20-14h05')).toBe(
      '2026-10-20/ana/MARIA-1-2026-10-20-14h05-2.pdf',
    )
    expect(paths.reserve('2026-10-20/ana', 'maria-1-2026-10-20-14h05')).toBe(
      '2026-10-20/ana/maria-1-2026-10-20-14h05-3.pdf',
    )
  })

  it('treats other folders as different paths', () => {
    const paths = new ArchivePathRegistry()
    paths.reserve('2026-10-20/ana', 'x')
    expect(paths.reserve('2026-10-20/bia', 'x', '.csv')).toBe(
      '2026-10-20/bia/x.csv',
    )
  })
})

describe('integrity index', () => {
  it('starts with a BOM and the column names', () => {
    expect(archiveIndexHeader()).toBe(
      '﻿arquivo,data,hora_inicio,atendente,contato,telefone,mensagens,sha256\r\n',
    )
  })

  it('writes one escaped CRLF line per file', () => {
    expect(
      archiveIndexLine({
        file: '2026-10-20/ana/maria-2026-10-20-14h05.pdf',
        dayKey: '2026-10-20',
        firstMessageAt: new Date('2026-10-20T17:05:09.000Z'),
        attendant: 'Ana',
        contact: 'Silva, Maria "Mari"',
        phone: '+5511988887777',
        messageCount: 12,
        sha256: 'ff'.repeat(32),
      }),
    ).toBe(
      `2026-10-20/ana/maria-2026-10-20-14h05.pdf,20/10/2026,14:05:09,Ana,"Silva, Maria ""Mari""",+5511988887777,12,${'ff'.repeat(32)}\r\n`,
    )
  })

  it('neutralizes spreadsheet formulas but keeps phones', () => {
    const line = archiveIndexLine({
      file: 'a.pdf',
      dayKey: '2026-10-20',
      firstMessageAt: new Date('2026-10-20T17:05:09.000Z'),
      attendant: '@ana',
      contact: '=HYPERLINK("x")',
      phone: '+5511988887777',
      messageCount: 1,
      sha256: 'x',
    })
    expect(line).toContain(`'@ana`)
    expect(line).toContain(`"'=HYPERLINK(""x"")"`)
    expect(line).toContain(',+5511988887777,')
  })
})

describe('toPdfSafeText', () => {
  it('keeps Portuguese text and Windows-1252 punctuation', () => {
    expect(toPdfSafeText('Ação “ok” — € 10…')).toBe('Ação “ok” — € 10…')
  })

  it('turns each emoji sequence into one [emoji]', () => {
    expect(toPdfSafeText('Oi 👍🏽 👨‍👩‍👧 🇧🇷 1️⃣!')).toBe(
      'Oi [emoji] [emoji] [emoji] 1[emoji]!',
    )
  })

  it('replaces other characters the font lacks with ?', () => {
    expect(toPdfSafeText('漢字 Ω')).toBe('?? ?')
  })

  it('keeps newlines and tabs, drops other control characters', () => {
    expect(toPdfSafeText('a\r\nb\tc\u0007\u0085d')).toBe('a\nb\tcd')
  })
})

describe('mediaFileName', () => {
  it('returns the decoded file name of a stored media', () => {
    expect(mediaFileName('/media/ws/123/recibo%20maio.pdf?x=1')).toBe(
      'recibo maio.pdf',
    )
  })

  it('returns null without a file name', () => {
    expect(mediaFileName(null)).toBeNull()
    expect(
      mediaFileName('https://lookaside.fbsbx.com/whatsapp/12345'),
    ).toBeNull()
  })

  it('keeps a name that is not valid URI encoding', () => {
    expect(mediaFileName('x/100%.pdf')).toBe('100%.pdf')
  })
})
