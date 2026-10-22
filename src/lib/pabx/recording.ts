/**
 * Call recordings uploaded by the PABX (ADR 0043): private bucket, one
 * object per call under the workspace prefix, so the workspace export and
 * purge find them like any other workspace file.
 */
export const PHONE_CALL_RECORDINGS_BUCKET = 'phone-call-recordings'

export interface RecordingFormat {
  mimeType: string
  ext: string
}

/**
 * Audio type from the file's first bytes (the name and the declared type
 * come from the PABX and are not trusted): WAV (`RIFF....WAVE`), MP3 (ID3 tag
 * or an MPEG frame sync) or OGG (`OggS`). Anything else is `null`.
 */
export function sniffRecordingFormat(
  bytes: Uint8Array,
): RecordingFormat | null {
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.subarray(start, end))
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE')
    return { mimeType: 'audio/wav', ext: 'wav' }
  if (bytes.length >= 4 && ascii(0, 4) === 'OggS')
    return { mimeType: 'audio/ogg', ext: 'ogg' }
  if (bytes.length >= 3 && ascii(0, 3) === 'ID3')
    return { mimeType: 'audio/mpeg', ext: 'mp3' }
  // MPEG audio frame: 11 sync bits, then layer bits that are not "reserved".
  if (
    bytes.length >= 2 &&
    bytes[0] === 0xff &&
    (bytes[1] & 0xe0) === 0xe0 &&
    (bytes[1] & 0x06) !== 0
  )
    return { mimeType: 'audio/mpeg', ext: 'mp3' }
  return null
}

export function recordingObjectKey(
  workspaceId: string,
  callId: string,
  ext: string,
): string {
  return `${workspaceId}/${callId}.${ext}`
}

/** Call id of an object key written by {@link recordingObjectKey}. */
export function callIdFromRecordingKey(key: string): string | null {
  const match = /^[^/]+\/([^/.]+)\.[a-z0-9]+$/.exec(key)
  return match?.[1] ?? null
}

/**
 * Key that matches a Brazilian phone with and without the mobile ninth
 * digit and with or without `55`: DDD + last 8 digits of the national
 * number. `null` for anything that is not a 10/11-digit national number.
 * Mirrors the SQL in `PhoneCallLinkRepository.findPersonByPhoneKey`.
 */
export function phoneMatchKey(phone: string): string | null {
  const digits = phone.replace(/\D/g, '')
  const national =
    digits.startsWith('55') && (digits.length === 12 || digits.length === 13)
      ? digits.slice(2)
      : digits
  if (national.length !== 10 && national.length !== 11) return null
  return national.slice(0, 2) + national.slice(-8)
}

/**
 * WhatsApp ids (`waId`) a Brazilian phone may be stored as: with `55`, with
 * and without the mobile ninth digit. Empty for anything that is not a
 * 10/11-digit national number. Counterpart of {@link phoneMatchKey} for
 * exact lookups on `whatsapp_contacts.wa_id`.
 */
export function waIdCandidates(phone: string): string[] {
  const key = phoneMatchKey(phone)
  if (!key) return []
  const ddd = key.slice(0, 2)
  const last8 = key.slice(2)
  return [`55${ddd}${last8}`, `55${ddd}9${last8}`]
}
