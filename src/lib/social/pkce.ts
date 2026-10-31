import { createHash, randomBytes } from 'node:crypto'

/**
 * PKCE (RFC 7636) para provedores OAuth 2.0 que o exigem (RFC 7636). O
 * `verifier` é um segredo gerado no início do fluxo; o `challenge` (hash S256
 * dele) viaja na URL de autorização. Na troca do code, o provedor confere que
 * o `verifier` bate com o `challenge` — por isso o `verifier` precisa
 * sobreviver do `connect` até o `callback` (carregado num cookie httpOnly de
 * vida curta).
 */
export type PkcePair = {
  /** Segredo (43–128 chars base64url) guardado entre authorize e token. */
  verifier: string
  /** `base64url(SHA256(verifier))` — enviado como `code_challenge` (método S256). */
  challenge: string
}

/** Gera um par PKCE com método S256. */
export function createPkcePair(): PkcePair {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}
