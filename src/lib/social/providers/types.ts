import type { Result } from '@/src/lib/result'
import type { CRM_SOCIAL_PLATFORMS } from '@/src/schemas/crm-social.schema'

/** Tokens normalizados retornados pela troca do authorization code. */
export type TokenSet = {
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
  scope: string | null
}

/** Dados mínimos da conta conectada (para exibir e identificar). */
export type SocialAccount = {
  externalId: string
  name: string | null
  /**
   * Alguns provedores trocam o token do usuário por um token de sub-conta
   * após descobrir a conta (ex.: Facebook Page token via `/me/accounts`).
   * Quando presente, este token substitui o de `exchangeCode` no que é
   * persistido — é com ele que se posta e se lê insights. `null`/ausente =
   * usa o token original.
   */
  accessTokenOverride?: {
    accessToken: string
    expiresAt: Date | null
  } | null
}

/**
 * Contrato de um provedor OAuth. Cada plataforma implementa as 4 etapas do
 * authorization-code flow. Falhas de rede/HTTP devem virar `crmSocialOauthFailed`.
 */
export type SocialProvider = {
  platform: (typeof CRM_SOCIAL_PLATFORMS)[number]
  /** Credenciais presentes no env? Gateia o botão "Conectar" no frontend. */
  isConfigured(): boolean
  /**
   * Provedor exige PKCE (RFC 7636)? Quando `true`, o service gera um par e
   * passa `codeChallenge` para `buildAuthorizeUrl` e `codeVerifier` para
   * `exchangeCode` (RFC 7636). Demais provedores ignoram ambos.
   */
  usesPkce?: boolean
  buildAuthorizeUrl(args: {
    redirectUri: string
    state: string
    /** `code_challenge` S256, presente só quando `usesPkce`. */
    codeChallenge?: string
  }): string
  exchangeCode(args: {
    code: string
    redirectUri: string
    /** `code_verifier` PKCE, presente só quando `usesPkce`. */
    codeVerifier?: string
  }): Promise<Result<TokenSet>>
  /** Lista todas as contas/subcontas que o usuário concedeu (ex.: Páginas do FB). */
  fetchAccounts(tokens: TokenSet): Promise<Result<SocialAccount[]>>
  /**
   * Troca o refresh token por um novo access token. Opcional: nem todo
   * provedor emite refresh token (ex.: Instagram/Facebook usam long-lived
   * tokens). Quando ausente, o token expirado simplesmente exige reconexão.
   */
  refreshAccessToken?(refreshToken: string): Promise<Result<TokenSet>>
}
