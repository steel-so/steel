import type { WhatsAppArchiveKind } from '@prisma/client'
import { csvField } from '@/src/lib/crm-export'
import {
  addDayKey,
  localDayKey,
  localDayStart,
  weekStartKey,
} from '@/src/lib/productivity/period'
import { WhatsappArchiveRetention } from '@/src/lib/queue/retention'
import { isWhatsAppPhone } from '@/src/lib/whatsapp/phone'
import { WINDOWS_RESERVED_NAMES } from '@/src/schemas/whatsapp-archive.schema'

/**
 * Pure layout of a WhatsApp archive package (ADR 0052): periods, folder and
 * file names, attendant attribution and the integrity index. Every "day"
 * and time is São Paulo civil time. Every path segment is ASCII
 * `[A-Za-z0-9_-]`, short, unique case-insensitively and never a Windows
 * device name, so the zip extracts the same on Linux, macOS and Windows.
 */

export const ARCHIVE_TIME_ZONE = 'America/Sao_Paulo'

/** MinIO bucket of the packages (private; downloads go through the app). */
export const WHATSAPP_ARCHIVE_BUCKET = 'whatsapp-archives'

/** Fixed folder under the root, as the banks asked. */
export const ARCHIVE_CHANNEL_FOLDER = 'WHATSAPP'
export const ARCHIVE_INDEX_FILE = 'INDICE.csv'
export const AI_FOLDER = 'IA'
export const NO_ATTENDANT_FOLDER = 'sem-atendente'
const FALLBACK_ROOT = 'STEEL'

/** Longest slug of an attendant or contact name inside a path. */
export const SEGMENT_MAX = 50

const MS = 1

/* ------------------------------------------------------------------ */
/* Periods                                                             */
/* ------------------------------------------------------------------ */

export interface ArchivePeriod {
  /** Inclusive; `null` = since the first message (MONTHLY_FULL). */
  periodStart: Date | null
  /** Inclusive: 23:59:59.999 of the last day, São Paulo. */
  periodEnd: Date
}

/**
 * WEEKLY = the previous full week (Monday 00:00 → Sunday 23:59:59.999);
 * MONTHLY_FULL = everything up to the last instant of the previous month.
 * Both relative to the São Paulo day `now` falls on, so a manual run and the
 * cron on the same day cover exactly the same messages.
 */
export function archivePeriod(
  kind: WhatsAppArchiveKind,
  now: Date,
): ArchivePeriod {
  const today = localDayKey(now, ARCHIVE_TIME_ZONE)
  if (kind === 'WEEKLY') {
    const thisMonday = weekStartKey(today)
    const previousMonday = addDayKey(thisMonday, -7)
    return {
      periodStart: localDayStart(previousMonday, ARCHIVE_TIME_ZONE),
      periodEnd: new Date(
        localDayStart(thisMonday, ARCHIVE_TIME_ZONE).getTime() - MS,
      ),
    }
  }
  const firstOfMonth = `${today.slice(0, 8)}01`
  return {
    periodStart: null,
    periodEnd: new Date(
      localDayStart(firstOfMonth, ARCHIVE_TIME_ZONE).getTime() - MS,
    ),
  }
}

/** When a finished package is deleted (90 days weekly, 12 months monthly). */
export function archiveExpiry(kind: WhatsAppArchiveKind, from: Date): Date {
  if (kind === 'WEEKLY') {
    return new Date(
      from.getTime() +
        WhatsappArchiveRetention.weeklyDays * 24 * 60 * 60 * 1000,
    )
  }
  const expiry = new Date(from)
  expiry.setUTCMonth(
    expiry.getUTCMonth() + WhatsappArchiveRetention.monthlyFullMonths,
  )
  return expiry
}

/* ------------------------------------------------------------------ */
/* Names                                                               */
/* ------------------------------------------------------------------ */

/** `fidelizza-mais` → `FIDELIZZAMAIS` (only A-Z and 0-9). */
export function defaultArchiveRootFolder(workspaceSlug: string): string {
  const root = stripAccents(workspaceSlug)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 40)
  if (!root) return FALLBACK_ROOT
  return WINDOWS_RESERVED_NAMES.has(root) ? `${root}_` : root
}

export function resolveArchiveRootFolder(
  rootFolderName: string | null | undefined,
  workspaceSlug: string,
): string {
  return rootFolderName?.trim() || defaultArchiveRootFolder(workspaceSlug)
}

function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Lower-case ASCII slug (`a-z0-9-`), at most `max` characters. */
export function slugifySegment(text: string, max = SEGMENT_MAX): string {
  return stripAccents(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '')
}

/** A segment Windows would refuse (`con`, `lpt1`) gets a trailing `_`. */
export function windowsSafeSegment(segment: string): string {
  return WINDOWS_RESERVED_NAMES.has(segment.toUpperCase())
    ? `${segment}_`
    : segment
}

/** `maria-silva-5511999990000`, the phone alone, or the BSUID slug. */
export function contactSegment(name: string | null, waId: string): string {
  const id = isWhatsAppPhone(waId) ? waId : slugifySegment(waId, 40)
  const slug = name ? slugifySegment(name) : ''
  const base = [slug, id].filter(Boolean).join('-')
  return windowsSafeSegment(base || 'contato')
}

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: ARCHIVE_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

function timeParts(at: Date): { hour: string; minute: string; second: string } {
  const parts = timeFormatter.formatToParts(at)
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '00'
  return { hour: get('hour'), minute: get('minute'), second: get('second') }
}

/** `YYYY-MM-DD` of the São Paulo day of `at`. */
export function archiveDayKey(at: Date): string {
  return localDayKey(at, ARCHIVE_TIME_ZONE)
}

/** `14h05` (São Paulo), the time part of a PDF name. */
export function archiveTimeLabel(at: Date): string {
  const { hour, minute } = timeParts(at)
  return `${hour}h${minute}`
}

/** `14:05:09` (São Paulo), for the PDF and the index. */
export function archiveClock(at: Date): string {
  const { hour, minute, second } = timeParts(at)
  return `${hour}:${minute}:${second}`
}

/** `dd/mm/aaaa` of a `YYYY-MM-DD` key. */
export function formatDayKey(dayKey: string): string {
  const [year, month, day] = dayKey.split('-')
  return `${day}/${month}/${year}`
}

/** `<contact>-<YYYY-MM-DD>-<HHhMM>` (no extension). */
export function atendimentoBaseName(
  contact: string,
  dayKey: string,
  firstMessageAt: Date,
): string {
  return `${contact}-${dayKey}-${archiveTimeLabel(firstMessageAt)}`
}

/** `FIDELIZZAMAIS-whatsapp-semanal-2026-10-19-a-2026-10-25.zip`. */
export function archiveFileName(
  root: string,
  kind: WhatsAppArchiveKind,
  period: ArchivePeriod,
): string {
  const end = archiveDayKey(period.periodEnd)
  if (kind === 'WEEKLY' && period.periodStart) {
    const start = archiveDayKey(period.periodStart)
    return `${root}-whatsapp-semanal-${start}-a-${end}.zip`
  }
  return `${root}-whatsapp-completo-ate-${end}.zip`
}

export function archiveObjectKey(
  workspaceId: string,
  archiveId: string,
): string {
  return `${workspaceId}/${archiveId}.zip`
}

/* ------------------------------------------------------------------ */
/* Attendants                                                          */
/* ------------------------------------------------------------------ */

export interface AttributableMessage {
  direction: 'IN' | 'OUT'
  senderUserId: string | null
  senderName: string | null
  sentByAi: boolean
}

export interface ArchivePerson {
  id: string
  name: string
}

export type ArchiveAttendant =
  | { kind: 'user'; userId: string; name: string }
  | { kind: 'ai' }
  | { kind: 'none' }

/**
 * Who owns an atendimento (one conversation, one day): every distinct human
 * sender of an outbound message, in order of first reply; if only the AI
 * replied, the AI; if nobody replied, the conversation's assignee; else
 * nobody.
 */
export function attributeAttendants(
  messages: AttributableMessage[],
  assignee: ArchivePerson | null,
): ArchiveAttendant[] {
  const humans = new Map<string, string>()
  let aiReplied = false
  for (const message of messages) {
    if (message.direction !== 'OUT') continue
    if (message.senderUserId) {
      if (!humans.has(message.senderUserId)) {
        humans.set(message.senderUserId, message.senderName ?? '')
      }
    } else if (message.sentByAi) {
      aiReplied = true
    }
  }
  if (humans.size > 0) {
    return [...humans].map(([userId, name]) => ({
      kind: 'user' as const,
      userId,
      name,
    }))
  }
  if (aiReplied) return [{ kind: 'ai' }]
  if (assignee) {
    return [{ kind: 'user', userId: assignee.id, name: assignee.name }]
  }
  return [{ kind: 'none' }]
}

/** Names for the PDF header: the attendants, plus "IA" when it also replied. */
export function attendantLabels(
  attendants: ArchiveAttendant[],
  messages: AttributableMessage[],
): string[] {
  const labels = attendants.map((attendant) =>
    attendant.kind === 'user'
      ? attendant.name || 'Atendente'
      : attendant.kind === 'ai'
        ? 'IA'
        : 'Sem atendente',
  )
  const aiAlso =
    attendants.some((attendant) => attendant.kind === 'user') &&
    messages.some(
      (message) =>
        message.direction === 'OUT' &&
        !message.senderUserId &&
        message.sentByAi,
    )
  return aiAlso ? [...labels, 'IA'] : labels
}

/**
 * Folder of each attendant, stable for the whole package: a user always
 * lands in the same folder, and two users with the same name (or a user
 * named "IA") never share one — the second gets a short id suffix.
 * Comparison is case-insensitive (Windows and macOS file systems).
 */
export class AttendantFolders {
  private readonly byKey = new Map<string, string>()
  private readonly taken = new Set<string>([
    AI_FOLDER.toLowerCase(),
    NO_ATTENDANT_FOLDER,
  ])

  folderFor(attendant: ArchiveAttendant): string {
    if (attendant.kind === 'ai') return AI_FOLDER
    if (attendant.kind === 'none') return NO_ATTENDANT_FOLDER
    const known = this.byKey.get(attendant.userId)
    if (known) return known

    const idSlug = slugifySegment(attendant.userId, 8) || 'id'
    const base = windowsSafeSegment(
      slugifySegment(attendant.name) || `atendente-${idSlug}`,
    )
    let folder = base
    if (this.taken.has(folder.toLowerCase())) folder = `${base}-${idSlug}`
    let n = 2
    while (this.taken.has(folder.toLowerCase())) {
      folder = `${base}-${idSlug}-${n}`
      n += 1
    }
    this.taken.add(folder.toLowerCase())
    this.byKey.set(attendant.userId, folder)
    return folder
  }
}

/**
 * Guarantees unique file paths in the package (case-insensitive): the
 * second `maria-5511…-2026-10-20-14h05.pdf` in the same folder becomes
 * `…-14h05-2.pdf`.
 */
export class ArchivePathRegistry {
  private readonly taken = new Set<string>()

  reserve(folder: string, baseName: string, extension = '.pdf'): string {
    let path = `${folder}/${baseName}${extension}`
    let n = 2
    while (this.taken.has(path.toLowerCase())) {
      path = `${folder}/${baseName}-${n}${extension}`
      n += 1
    }
    this.taken.add(path.toLowerCase())
    return path
  }
}

/* ------------------------------------------------------------------ */
/* Integrity index                                                     */
/* ------------------------------------------------------------------ */

export const ARCHIVE_INDEX_COLUMNS = [
  'arquivo',
  'data',
  'hora_inicio',
  'atendente',
  'contato',
  'telefone',
  'mensagens',
  'sha256',
] as const

export interface ArchiveIndexRow {
  /** Path relative to the `WHATSAPP/` folder (where the index lives). */
  file: string
  dayKey: string
  firstMessageAt: Date
  attendant: string
  contact: string
  phone: string
  messageCount: number
  sha256: string
}

/** First line of `INDICE.csv`, with the BOM Excel needs for UTF-8. */
export function archiveIndexHeader(): string {
  return `﻿${ARCHIVE_INDEX_COLUMNS.join(',')}\r\n`
}

/** One CSV line (RFC 4180), terminated by CRLF. */
export function archiveIndexLine(row: ArchiveIndexRow): string {
  return `${[
    row.file,
    formatDayKey(row.dayKey),
    archiveClock(row.firstMessageAt),
    row.attendant,
    row.contact,
    row.phone,
    String(row.messageCount),
    row.sha256,
  ]
    .map((value) => csvField(neutralizeFormula(value)))
    .join(',')}\r\n`
}

/** Excel must not evaluate a contact name like `=HYPERLINK(...)`. */
function neutralizeFormula(value: string): string {
  return /^[=+\-@]/.test(value) && !/^\+\d+$/.test(value) ? `'${value}` : value
}

/* ------------------------------------------------------------------ */
/* PDF text                                                            */
/* ------------------------------------------------------------------ */

const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u

/** Emoji, or a piece that only exists inside an emoji sequence. */
function isEmojiPart(char: string, code: number): boolean {
  return (
    PICTOGRAPHIC.test(char) ||
    (code >= 0x1f1e6 && code <= 0x1f1ff) || // regional indicators (flags)
    (code >= 0x1f3fb && code <= 0x1f3ff) || // skin tones
    (code >= 0xe0020 && code <= 0xe007f) || // tag sequences
    code === 0x200d || // zero width joiner
    code === 0xfe0e ||
    code === 0xfe0f || // variation selectors
    code === 0x20e3 // keycap
  )
}

/**
 * Text the PDF's built-in Helvetica can draw (Windows-1252). Each emoji
 * (with its joiners, skin tones and flags) becomes `[emoji]`; any other
 * character outside the font becomes `?`, so nothing turns into garbage.
 */
export function toPdfSafeText(text: string): string {
  let out = ''
  let inEmoji = false
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (isEmojiPart(char, code)) {
      if (!inEmoji) out += '[emoji]'
      inEmoji = true
      continue
    }
    inEmoji = false
    if (char === '\n' || char === '\t') out += char
    else if (char === '\r') continue
    else if (code >= 0x20 && code <= 0x7e) out += char
    else if (code >= 0xa0 && code <= 0xff) out += char
    else if (WIN_ANSI_EXTRA.has(char)) out += char
    else if (code < 0x20 || (code >= 0x7f && code < 0xa0)) continue
    else out += '?'
  }
  return out
}

/** File name of a stored media (`…/recibo.pdf` → `recibo.pdf`), if any. */
export function mediaFileName(mediaUrl: string | null): string | null {
  if (!mediaUrl) return null
  const path = mediaUrl.split(/[?#]/)[0]
  const last = path.split('/').pop() ?? ''
  if (!/\.[A-Za-z0-9]{1,5}$/.test(last)) return null
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}
