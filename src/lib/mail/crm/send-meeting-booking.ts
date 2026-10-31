import { CrmMeetingBooking } from '@/components/emails/crm/meeting-booking'
import type { CrmMeetingEmailProps } from '@/types/mail'
import { sendEmail } from '../send'

const SUBJECT = {
  confirmation: (title: string) => `Reunião confirmada: ${title}`,
  reminder: (title: string) => `Lembrete: ${title}`,
  canceled: (title: string) => `Reunião cancelada: ${title}`,
} as const

/** Confirmation, reminder and cancellation of a booked meeting (C5). */
export async function sendCrmMeetingEmail(
  props: CrmMeetingEmailProps,
  options: { ics?: string; idempotencyKey?: string } = {},
) {
  return sendEmail(
    {
      to: [props.email],
      subject: SUBJECT[props.kind](props.pageTitle),
      react: CrmMeetingBooking(props),
      ...(options.ics
        ? {
            attachments: [
              {
                filename: 'reuniao.ics',
                content: Buffer.from(options.ics, 'utf-8'),
                contentType: 'text/calendar; charset=utf-8; method=REQUEST',
              },
            ],
          }
        : {}),
    },
    options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {},
  )
}
