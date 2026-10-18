import { oauthProvider } from '@better-auth/oauth-provider'
import { createId } from '@paralleldrive/cuid2'
import { hash, verify } from 'argon2'
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { emailOTP, twoFactor } from 'better-auth/plugins'
import { auditAuth, auditMutation } from '@/lib/axiom/audit'
import { NODE_ENV } from '@/lib/env/env'
import {
  BETTER_AUTH_SECRET,
  BETTER_AUTH_URL,
  DISABLE_AUTH_RATE_LIMIT,
  GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
} from '@/lib/env/server'
import { PRIVACY_VERSION, TERMS_VERSION } from '@/lib/legal/versions'
import { sendResetPasswordEmail } from '@/src/lib/mail/user/send-reset-password'
import { sendVerify2faAccessOtp } from '@/src/lib/mail/user/send-verify-2fa-access-otp'
import { sendVerifyEmailWithOtp } from '@/src/lib/mail/user/send-verify-email-with-otp'
import { sendWelcomeEmail } from '@/src/lib/mail/user/send-welcome'
import { currentGrantReference } from '@/src/lib/mcp/consent-reference'
import {
  appOrigin,
  mcpResourceUrl,
  OAUTH_SCOPES,
  OAUTH_TOKEN_PREFIX,
  oauthIssuer,
} from '@/src/lib/mcp/oauth-config'
import { UserService } from '@/src/services/user.service'
import { prisma } from './prisma'
import { generateUniqueUsername } from './username'

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  advanced: {
    database: {
      generateId: () => createId(),
    },
  },
  // O app já aplica rate limit próprio (Redis) nas rotas de auth via route.ts.
  // O limiter embutido do better-auth (em memória, ativo só em produção) é
  // redundante e, no e2e — que roda `next start` em modo produção — bloqueia os
  // sign-ups da suíte inteira a partir do mesmo IP. Preserva o default em
  // produção real e desliga apenas quando o e2e seta o flag.
  rateLimit: {
    enabled:
      DISABLE_AUTH_RATE_LIMIT === 'true' ? false : NODE_ENV === 'production',
  },
  baseURL: BETTER_AUTH_URL,
  trustedOrigins: [BETTER_AUTH_URL],
  secret: BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    password: {
      hash: async (password) => hash(password),
      verify: async ({ hash: hashed, password }) => verify(hashed, password),
    },
    // A redefinição de senha costuma ocorrer após comprometimento da conta;
    // derrubar as demais sessões expulsa um eventual atacante.
    revokeSessionsOnPasswordReset: true,
    // `url` is the full reset link better-auth builds for us: it points at
    // the API verification endpoint that validates the token and then
    // redirects to the `redirectTo` page (/reset-password) with `?token=`.
    // Without this callback, POST /auth/request-password-reset is a no-op.
    sendResetPassword: async ({ user, url }) => {
      auditAuth({ event: 'auth.reset_password.requested', userId: user.id })
      try {
        await sendResetPasswordEmail({
          email: user.email,
          username: user.name ?? undefined,
          redirectUrl: url,
        })
      } catch (error) {
        auditAuth({
          event: 'auth.reset_password.send_failed',
          userId: user.id,
          outcome: 'failure',
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    },
    onPasswordReset: async ({ user }) => {
      auditAuth({ event: 'auth.reset_password.completed', userId: user.id })
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    afterEmailVerification: async (user) => {
      auditAuth({ event: 'user.email_verified', userId: user.id })
      try {
        await sendWelcomeEmail({
          email: user.email,
          username: user.name ?? 'there',
          trialDays: '14',
        })
      } catch (error) {
        auditAuth({
          event: 'auth.welcome_email.send_failed',
          userId: user.id,
          outcome: 'failure',
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    },
  },
  socialProviders: {
    google: {
      clientId: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
    },
    github: {
      clientId: GITHUB_CLIENT_ID,
      clientSecret: GITHUB_CLIENT_SECRET,
    },
  },
  user: {
    additionalFields: {
      // Accepted at the email/password signup form (Onda 3). Declared
      // here so better-auth's parseUserInput on POST /sign-up/email
      // accepts the fields and persists them; OAuth flows skip
      // parseUserInput entirely, so these stay null for social
      // signups until the consent gate (Onda 4) collects them.
      username: { type: 'string', input: false, required: false },
      acceptedTermsAt: { type: 'date', input: true, required: false },
      acceptedPrivacyAt: { type: 'date', input: true, required: false },
      // Aplicativo autenticador confirmado. Declarado aqui para a sessão
      // carregar o campo (`session.user.twoFactorTotpEnabled`), do mesmo jeito
      // que já carrega `twoFactorEnabled`: a aba de segurança precisa
      // distinguir "2FA por e-mail" de "2FA por app". `input: false` porque
      // quem escreve é o nosso serviço, depois de verificar um código real —
      // nunca o corpo de um request.
      twoFactorTotpEnabled: {
        type: 'boolean',
        input: false,
        required: false,
      },
    },
  },
  account: {
    accountLinking: {
      enabled: true,
      // Google/GitHub already verify the email on their end, so don't also
      // require our own local account to have emailVerified: true before
      // linking — without this, a user who signed up with email/password
      // but never clicked the verification link gets stuck on
      // "account not linked" when trying to sign in with Google/GitHub
      // using that same address.
      trustedProviders: ['google', 'github'],
      requireLocalEmailVerified: false,
    },
    // Encrypt OAuth access/refresh/id tokens at rest using better-auth's
    // native XChaCha20-Poly1305 envelope ($ba$<version>$<ct>). Keys come
    // from BETTER_AUTH_SECRETS (versioned, comma-separated "v:secret"
    // pairs); BETTER_AUTH_SECRET stays as the legacy fallback for
    // pre-envelope payloads. Existing plain tokens are read as-is and
    // re-encrypted lazily on the next OAuth refresh/login.
    encryptOAuthTokens: true,
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (data) => {
          // Derive a unique username from the email local-part. Runs for
          // every signup path (email/password + OAuth), so the column is
          // always populated before insert (it's NOT NULL @unique)
          const username = await generateUniqueUsername(
            data.email,
            async (u) =>
              (await prisma.user.count({ where: { username: u } })) > 0,
          )

          // Trust the server clock, not the client. The signup form
          // sends `new Date()` for each accepted document; we replace
          // those with the server's `now` so a tampered client can't
          // backdate (or postdate) its acceptance.
          const now = new Date()
          return {
            data: {
              ...data,
              username,
              ...(data.acceptedTermsAt ? { acceptedTermsAt: now } : {}),
              ...(data.acceptedPrivacyAt ? { acceptedPrivacyAt: now } : {}),
            },
          }
        },
        after: async (user, context) => {
          auditAuth({ event: 'user.created', userId: user.id })

          if (user.acceptedTermsAt || user.acceptedPrivacyAt) {
            const reqHeaders = context?.request?.headers
            const ipAddress =
              reqHeaders?.get('x-forwarded-for')?.split(',')[0]?.trim() ||
              reqHeaders?.get('x-real-ip') ||
              null
            const userAgent = reqHeaders?.get('user-agent') ?? null

            const events: {
              userId: string
              document: 'TERMS' | 'PRIVACY'
              version: string
              action: 'GRANTED'
              ipAddress: string | null
              userAgent: string | null
            }[] = []
            if (user.acceptedTermsAt) {
              events.push({
                userId: user.id,
                document: 'TERMS',
                version: TERMS_VERSION,
                action: 'GRANTED',
                ipAddress,
                userAgent,
              })
            }
            if (user.acceptedPrivacyAt) {
              events.push({
                userId: user.id,
                document: 'PRIVACY',
                version: PRIVACY_VERSION,
                action: 'GRANTED',
                ipAddress,
                userAgent,
              })
            }
            try {
              await prisma.consentEvent.createMany({ data: events })
              auditMutation({
                entity: 'consent',
                action: 'grant',
                actorId: user.id,
                targetId: user.id,
                meta: {
                  documents: events.map((e) => e.document),
                  termsVersion: TERMS_VERSION,
                  privacyVersion: PRIVACY_VERSION,
                },
              })
            } catch (error) {
              // Don't fail the signup if the audit trail write fails;
              // the User.acceptedXxxAt columns still hold the current
              // state. Log loudly so we notice.
              auditMutation({
                entity: 'consent',
                action: 'grant',
                actorId: user.id,
                targetId: user.id,
                outcome: 'failure',
                reason: error instanceof Error ? error.message : String(error),
              })
            }
          }

          if (!user.emailVerified) return
          try {
            await sendWelcomeEmail({
              email: user.email,
              username: user.name ?? 'there',
              trialDays: '14',
            })
          } catch (error) {
            auditAuth({
              event: 'auth.welcome_email.send_failed',
              userId: user.id,
              outcome: 'failure',
              reason: error instanceof Error ? error.message : String(error),
            })
          }
        },
      },
    },
    session: {
      create: {
        after: async (session) => {
          auditAuth({
            event: 'session.created',
            userId: session.userId,
            meta: { sessionId: session.id },
          })

          // Auto-cancel pending account deletion when a user logs back
          // in during the grace period: re-authenticating signals they
          // changed their mind. This is intentional UX, not a bug — but
          // it means manual end-to-end tests of the deletion flow must
          // NOT relog before the worker fires, or the schedule is wiped.
          try {
            const result = await UserService.cancelDeletion(session.userId)
            if (result.ok && result.value.canceled) {
              auditAuth({
                event: 'user.deletion_canceled_on_login',
                userId: session.userId,
                meta: { sessionId: session.id },
              })
            }
          } catch (error) {
            auditAuth({
              event: 'user.deletion_cancel_failed',
              userId: session.userId,
              outcome: 'failure',
              reason: error instanceof Error ? error.message : String(error),
              meta: { sessionId: session.id },
            })
          }
        },
      },
    },
  },
  plugins: [
    // OAuth 2.1 provider for integrations — MCP clients today, the Steel CLI
    // later (ADR 0033, docs/mcp/README.md). Authorization code + PKCE,
    // dynamic client registration, refresh and revocation.
    oauthProvider({
      // Both prompts land on our consent page: without a session the proxy
      // sends the user to /sign-in and back (`?redirect=`), so the login
      // step needs no `oauth_query` support in the sign-in form.
      loginPage: '/oauth/consent',
      consentPage: '/oauth/consent',
      scopes: [...OAUTH_SCOPES],
      // MCP clients send `resource=<app>/api/mcp` (RFC 8707). The issuer and
      // the bare origin stay valid for clients that send one of those.
      validAudiences: [mcpResourceUrl(), oauthIssuer(), appOrigin()],
      grantTypes: ['authorization_code', 'refresh_token'],
      // MCP clients (Claude, ChatGPT, Cursor) register themselves; the
      // consent screen is where the user decides, not the registration.
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      // Opaque tokens only: every call resolves the token to its grant in the
      // database, so a revocation or a removed membership cuts access on the
      // next request — a self-contained JWT would outlive both.
      disableJwtPlugin: true,
      prefix: { ...OAUTH_TOKEN_PREFIX },
      // The grant (workspace + modules) is chosen on the consent page; its id
      // becomes the `referenceId` of the consent, code and tokens.
      postLogin: {
        page: '/oauth/consent',
        shouldRedirect: () => false,
        consentReferenceId: () => currentGrantReference(),
      },
      silenceWarnings: { oauthAuthServerConfig: true },
    }),
    emailOTP({
      overrideDefaultEmailVerification: true,
      async sendVerificationOTP({ email, otp, type }) {
        if (type !== 'email-verification' && type !== 'sign-in') return
        auditAuth({
          event: 'auth.email_otp.requested',
          meta: { otpType: type },
        })
        try {
          await sendVerifyEmailWithOtp({
            email,
            validationCode: otp,
          })
        } catch (error) {
          auditAuth({
            event: 'auth.email_otp.send_failed',
            outcome: 'failure',
            reason: error instanceof Error ? error.message : String(error),
            meta: { otpType: type },
          })
        }
      },
    }),
    twoFactor({
      // Nome que o aplicativo autenticador mostra ao lado do código.
      issuer: 'Steel',
      // Nesta versão do better-auth (1.6.x) o `enable()` é um interruptor
      // único: ele grava o segredo, gera os códigos de backup e devolve a
      // `totpURI` de uma vez, sem parâmetro `method`. Mantemos
      // `skipVerificationOnEnable: true` porque o fluxo que já existe é o OTP
      // por e-mail — o endereço já está verificado nesse ponto, não sobra
      // nada a provar, e sem isso `twoFactorEnabled` não persistiria e a
      // ativação "sumiria" ao recarregar a sessão.
      //
      // O aplicativo autenticador exige um passo a mais, que é nosso:
      // `users.two_factor_totp_enabled` só vira `true` depois de
      // `POST /api/users/me/two-factor/totp` verificar um código que o app
      // realmente gerou (ver `src/services/two-factor.service.ts`). Ninguém
      // fica com "aplicativo ativo" por um QR que nunca escaneou.
      skipVerificationOnEnable: true,
      // O plugin reserva 10 tentativas; cinco bastam para um código de 6
      // dígitos e cortam a superfície de adivinhação pela metade. Os dois
      // valores eram implícitos antes — e o lockout escreve em colunas de
      // `two_factors` que o schema só ganhou na migration
      // `two_factor_totp_and_lockout`.
      accountLockout: {
        enabled: true,
        maxFailedAttempts: 5,
        durationSeconds: 900,
      },
      totpOptions: {
        // Janela padrão do RFC 6238, que é o que todo aplicativo
        // autenticador assume (Google Authenticator, 1Password, Bitwarden).
        period: 30,
        digits: 6,
      },
      otpOptions: {
        period: 5,
        // O padrão é "plain": o segundo fator vivo ficaria em texto claro na
        // tabela de verificação, então quem tivesse leitura nela poderia
        // concluir o login de outra pessoa.
        storeOTP: 'hashed',
        async sendOTP({ user, otp }) {
          try {
            await sendVerify2faAccessOtp({
              email: user.email,
              username: user.name ?? undefined,
              validationCode: otp,
            })
          } catch (error) {
            auditAuth({
              event: 'auth.2fa_otp.send_failed',
              userId: user.id,
              outcome: 'failure',
              reason: error instanceof Error ? error.message : String(error),
            })
          }
        },
      },
    }),
  ],
})
