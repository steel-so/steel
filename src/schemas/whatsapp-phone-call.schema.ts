import { z } from 'zod'

/** Steps the PABX dialplan reports for a call (see docs/pabx). */
export const PABX_CALL_EVENTS = [
  // The user answered the extension; the PABX is dialing the contact.
  'EXTENSION_ANSWERED',
  // The contact answered.
  'ANSWERED',
  // The call ended (`dialstatus` + `answeredtime` describe how).
  'HANGUP',
  // The extension never answered, so the contact was not dialed.
  'EXTENSION_FAILED',
] as const

const optionalText = z.preprocess(
  (v) => (v === '' || v === null ? undefined : v),
  z.string().max(40).optional(),
)

/** Form body the PABX dialplan posts to the status webhook. */
export const PabxCallWebhookSchema = z.object({
  token: z.string().min(16).max(128),
  event: z.enum(PABX_CALL_EVENTS),
  job: optionalText,
  dialstatus: optionalText,
  answeredtime: z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z.coerce.number().int().min(0).max(86_400).optional(),
  ),
})

export type PabxCallWebhookDTO = z.infer<typeof PabxCallWebhookSchema>

/** Largest recording the PABX may upload (what `proxy.ts` buffers whole). */
export const PABX_RECORDING_MAX_BYTES = 10 * 1024 * 1024

/** Hours after the call was placed during which its recording is accepted. */
export const PABX_RECORDING_UPLOAD_WINDOW_HOURS = 24

/** Text fields of the multipart recording upload (`file` is read apart). */
export const PabxRecordingUploadSchema = z.object({
  token: z.string().min(16).max(128),
})

export type PabxRecordingUploadDTO = z.infer<typeof PabxRecordingUploadSchema>
