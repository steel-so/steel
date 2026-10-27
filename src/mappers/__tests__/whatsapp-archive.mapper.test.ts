import { describe, expect, it } from 'vitest'
import {
  createFakeDoneWhatsAppArchive,
  createFakeWhatsAppArchive,
  createFakeWhatsAppArchiveSettings,
} from '@/src/__tests__/factories/whatsapp-archive.factory'
import {
  adminWhatsappArchiveDownloadPath,
  isWhatsAppArchiveDownloadable,
  isWhatsAppArchiveExpired,
  toWhatsAppArchiveDTO,
  toWhatsAppArchiveSettingsDTO,
  whatsappArchiveDownloadPath,
} from '@/src/mappers/whatsapp-archive.mapper'

const NOW = new Date('2026-11-01T12:00:00.000Z')

describe('whatsapp archive mapper', () => {
  it('maps a finished package with its download route', () => {
    const row = createFakeDoneWhatsAppArchive({
      id: 'a1',
      offsiteCopiedAt: new Date('2026-10-26T06:00:00.000Z'),
      triggeredBy: { id: 'u1', name: 'Ops', email: 'ops@x.com' },
    })
    expect(
      toWhatsAppArchiveDTO(row, {
        now: NOW,
        defaultRoot: 'DEFAULT',
        downloadPath: whatsappArchiveDownloadPath,
      }),
    ).toEqual({
      id: 'a1',
      kind: 'WEEKLY',
      status: 'DONE',
      periodStart: '2026-10-19T03:00:00.000Z',
      periodEnd: '2026-10-26T02:59:59.999Z',
      fileName: 'FIDELIZZAMAIS-whatsapp-semanal-2026-10-19-a-2026-10-25.zip',
      sizeBytes: 2048,
      sha256: 'ab'.repeat(32),
      fileCount: 3,
      atendimentoCount: 2,
      offsiteCopiedAt: '2026-10-26T06:00:00.000Z',
      error: null,
      triggeredBy: { id: 'u1', name: 'Ops', email: 'ops@x.com' },
      createdAt: '2026-10-26T05:00:00.000Z',
      completedAt: '2026-10-26T05:10:00.000Z',
      expiresAt: '2027-01-24T05:10:00.000Z',
      expired: false,
      downloadUrl: '/api/workspaces/ws1/whatsapp/archives/a1/download',
    })
  })

  it('maps a queued full package without link, with the default root', () => {
    const dto = toWhatsAppArchiveDTO(
      createFakeWhatsAppArchive({
        kind: 'MONTHLY_FULL',
        periodStart: null,
        periodEnd: new Date('2026-11-01T02:59:59.999Z'),
      }),
      {
        now: NOW,
        defaultRoot: 'DEFAULT',
        downloadPath: whatsappArchiveDownloadPath,
      },
    )
    expect(dto).toMatchObject({
      periodStart: null,
      fileName: 'DEFAULT-whatsapp-completo-ate-2026-10-31.zip',
      sizeBytes: null,
      completedAt: null,
      expiresAt: null,
      offsiteCopiedAt: null,
      expired: false,
      downloadUrl: null,
    })
  })

  it('treats a package past retention or without file as expired', () => {
    const past = createFakeDoneWhatsAppArchive({
      expiresAt: new Date('2026-10-01T00:00:00.000Z'),
    })
    expect(isWhatsAppArchiveExpired(past, NOW)).toBe(true)
    expect(isWhatsAppArchiveDownloadable(past, NOW)).toBe(false)
    const noFile = createFakeDoneWhatsAppArchive({ objectKey: null })
    expect(isWhatsAppArchiveExpired(noFile, NOW)).toBe(true)
    const noExpiry = createFakeDoneWhatsAppArchive({ expiresAt: null })
    expect(isWhatsAppArchiveDownloadable(noExpiry, NOW)).toBe(true)
    expect(isWhatsAppArchiveExpired(createFakeWhatsAppArchive(), NOW)).toBe(
      false,
    )
  })

  it('builds the admin download route', () => {
    expect(adminWhatsappArchiveDownloadPath('ws1', 'a1')).toBe(
      '/api/admin/workspaces/ws1/whatsapp-archive/a1/download',
    )
  })

  it('maps settings, defaulting to off and the slug root', () => {
    expect(toWhatsAppArchiveSettingsDTO(null, 'fidelizza-mais')).toEqual({
      enabled: false,
      rootFolderName: null,
      effectiveRootFolderName: 'FIDELIZZAMAIS',
      updatedAt: null,
    })
    expect(
      toWhatsAppArchiveSettingsDTO(
        createFakeWhatsAppArchiveSettings({ rootFolderName: 'BANCO' }),
        'x',
      ),
    ).toEqual({
      enabled: true,
      rootFolderName: 'BANCO',
      effectiveRootFolderName: 'BANCO',
      updatedAt: '2026-10-20T12:00:00.000Z',
    })
  })
})
