/**
 * Link previews (WhatsApp, Slack, e-mail scanners...) fetch `/d/<token>` as
 * soon as the link is sent. They must not mark the document as viewed.
 */
const PREVIEW_BOT =
  /bot|crawler|spider|preview|facebookexternalhit|whatsapp|slack|telegram|discord|skypeuripreview|linkedin|embedly|google-pagerenderer|headlesschrome/i

export function isLinkPreviewBot(
  userAgent: string | null | undefined,
): boolean {
  if (!userAgent) return true
  return PREVIEW_BOT.test(userAgent)
}
