import { sendingDomainNotVerified } from '@/src/errors'
import { emailDomain } from '@/src/lib/newsletter/urls'
import { err, ok, type Result } from '@/src/lib/result'
import { SendingDomainRepository } from '@/src/repositories/sending-domain.repository'

/**
 * The From address may send marketing e-mail only from a VERIFIED domain of
 * the workspace (ADR 0054). Exact match on the domain: a verified
 * `news.acme.com` does not cover `acme.com`, nor the other way round — the
 * DKIM/SPF records Resend checks belong to that exact name.
 */
export async function resolveVerifiedSender(
  workspaceId: string,
  fromEmail: string,
): Promise<Result<{ sendingDomainId: string }>> {
  const domain = emailDomain(fromEmail)
  if (!domain) return err(sendingDomainNotVerified('Remetente inválido'))

  const found = await SendingDomainRepository.findVerifiedByName(
    workspaceId,
    domain,
  )
  if (!found.ok) return found
  if (!found.value) {
    return err(
      sendingDomainNotVerified(
        `O domínio ${domain} não está verificado neste workspace. Cadastre-o em Ajustes › Domínios de e-mail.`,
      ),
    )
  }
  return ok({ sendingDomainId: found.value.id })
}
