import type { JsonSchema } from '../json-schema'
import { component, type OpenApiRegistry, type RouteConfig } from '../registry'

/**
 * Better Auth — `app/api/auth/[...all]/route.ts` delega tudo ao handler do
 * Better Auth (`src/lib/auth.ts`). Documentamos os fluxos usados pelo app;
 * a referência completa dos endpoints está em https://www.better-auth.com/docs.
 * Respostas fora do envelope padrão do Steel.
 */

const BETTER_AUTH_NOTE =
  'Endpoint do [Better Auth](https://www.better-auth.com/docs) (catch-all `/api/auth/[...all]`); a resposta segue o formato do Better Auth, **fora** do envelope padrão. Erros vêm como `{ "code": "...", "message": "..." }`.'

const AUTH_USER: JsonSchema = {
  type: 'object',
  description: 'Usuário como o Better Auth devolve nas respostas de sessão.',
  properties: {
    id: {
      type: 'string',
      description: 'cuid2',
      example: 'ckv9x2p0h0000us7d3k1e5abc',
    },
    name: { type: 'string', example: 'Maria Souza' },
    email: { type: 'string', format: 'email', example: 'maria@acme.com.br' },
    emailVerified: { type: 'boolean', example: true },
    image: { type: ['string', 'null'], example: null },
    twoFactorEnabled: { type: 'boolean', example: false },
    acceptedTermsAt: { type: ['string', 'null'], format: 'date-time' },
    acceptedPrivacyAt: { type: ['string', 'null'], format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
}

const AuthSession = component('AuthSession', {
  type: 'object',
  description: 'Sessão ativa com o respectivo usuário.',
  properties: {
    session: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        userId: { type: 'string' },
        token: { type: 'string' },
        expiresAt: { type: 'string', format: 'date-time' },
        ipAddress: { type: ['string', 'null'] },
        userAgent: { type: ['string', 'null'] },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
    user: { $ref: '#/components/schemas/AuthUser' },
  },
})

const RATE_LIMITED_AUTH = {
  code: 'RATE_LIMITED',
  when: 'Rate limit do app (Redis) por IP e rota',
} as const

function betterAuth(
  config: Omit<RouteConfig, 'tags' | 'auth' | 'description'> & {
    description: string
    session?: boolean
  },
): RouteConfig {
  const { session, description, ...rest } = config
  return {
    ...rest,
    tags: ['Autenticação'],
    auth: session ? 'session' : 'public',
    rateLimit: false,
    autoErrors: false,
    description: `${description}\n\n${BETTER_AUTH_NOTE}`,
  }
}

const email = {
  type: 'string',
  format: 'email',
  example: 'maria@acme.com.br',
} as const

export function registerAuthPaths(registry: OpenApiRegistry): void {
  const routes: RouteConfig[] = [
    betterAuth({
      method: 'post',
      path: '/auth/sign-up/email',
      summary: 'Criar conta com e-mail e senha',
      description:
        'Cria a conta e envia um OTP de verificação por e-mail (`requireEmailVerification`): a sessão só é emitida depois de `/auth/email-otp/verify-email`. `acceptedTermsAt`/`acceptedPrivacyAt` registram o consentimento aos documentos legais — o servidor sobrescreve os valores com o próprio relógio.',
      body: {
        schema: {
          type: 'object',
          required: ['name', 'email', 'password'],
          properties: {
            name: { type: 'string', minLength: 2, example: 'Maria Souza' },
            email,
            password: {
              type: 'string',
              minLength: 8,
              example: 'senha-forte-123',
            },
            acceptedTermsAt: { type: 'string', format: 'date-time' },
            acceptedPrivacyAt: { type: 'string', format: 'date-time' },
          },
        },
      },
      responses: {
        200: {
          description:
            'Conta criada; OTP de verificação enviado. `token` fica `null` até a verificação.',
          envelope: false,
          schema: {
            type: 'object',
            properties: {
              token: { type: ['string', 'null'], example: null },
              user: { $ref: '#/components/schemas/AuthUser' },
            },
          },
        },
        422: {
          description:
            'E-mail já cadastrado ou dados inválidos (`USER_ALREADY_EXISTS`, ...).',
          envelope: false,
        },
      },
      errors: [RATE_LIMITED_AUTH],
    }),
    betterAuth({
      method: 'post',
      path: '/auth/sign-in/email',
      summary: 'Login com e-mail e senha',
      description:
        'Autentica e define o cookie de sessão. Com dois fatores ativo, responde `twoFactorRedirect: true` e define um cookie parcial `better-auth.two_factor`; a sessão completa só sai após `/auth/two-factor/verify-otp`.',
      body: {
        schema: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email,
            password: { type: 'string', example: 'senha-forte-123' },
            rememberMe: { type: 'boolean', default: true },
            callbackURL: {
              type: 'string',
              description: 'Destino após o login.',
            },
          },
        },
      },
      responses: {
        200: {
          description:
            'Login realizado (ou `twoFactorRedirect` quando há 2FA).',
          envelope: false,
          schema: {
            type: 'object',
            properties: {
              redirect: { type: 'boolean' },
              token: { type: 'string' },
              twoFactorRedirect: { type: 'boolean' },
              user: { $ref: '#/components/schemas/AuthUser' },
            },
          },
        },
        401: {
          description: 'Credenciais inválidas (`INVALID_EMAIL_OR_PASSWORD`).',
          envelope: false,
        },
        403: {
          description: 'E-mail ainda não verificado (`EMAIL_NOT_VERIFIED`).',
          envelope: false,
        },
      },
      errors: [RATE_LIMITED_AUTH],
    }),
    betterAuth({
      method: 'post',
      path: '/auth/sign-in/social',
      summary: 'Login com Google ou GitHub',
      description:
        'Inicia o fluxo OAuth e devolve a URL do provedor para redirecionar o navegador.',
      body: {
        schema: {
          type: 'object',
          required: ['provider'],
          properties: {
            provider: { type: 'string', enum: ['google', 'github'] },
            callbackURL: { type: 'string', example: '/' },
          },
        },
      },
      responses: {
        200: {
          description: 'URL de autorização do provedor.',
          envelope: false,
          schema: {
            type: 'object',
            properties: {
              url: { type: 'string', format: 'uri' },
              redirect: { type: 'boolean' },
            },
          },
        },
      },
      errors: [RATE_LIMITED_AUTH],
    }),
    betterAuth({
      method: 'get',
      path: '/auth/callback/{provider}',
      summary: 'Callback OAuth (Google/GitHub)',
      description:
        'Destino configurado nos provedores OAuth. Troca o `code` pela conta, cria a sessão e redireciona para o `callbackURL`. Chamado pelo navegador, não por clientes da API.',
      params: {
        provider: {
          description: 'Provedor OAuth.',
          schema: { type: 'string', enum: ['google', 'github'] },
        },
      },
      responses: {
        302: {
          description: 'Redireciona para o app com o cookie de sessão.',
          envelope: false,
        },
      },
    }),
    betterAuth({
      method: 'post',
      path: '/auth/sign-out',
      session: true,
      summary: 'Encerrar sessão',
      description: 'Revoga a sessão atual e limpa o cookie.',
      responses: {
        200: {
          description: 'Sessão encerrada.',
          envelope: false,
          schema: {
            type: 'object',
            properties: { success: { type: 'boolean' } },
          },
        },
      },
    }),
    betterAuth({
      method: 'get',
      path: '/auth/get-session',
      session: true,
      summary: 'Sessão atual',
      description:
        'Devolve a sessão e o usuário do cookie — ou `null` sem sessão (não responde 401).',
      responses: {
        200: {
          description: 'Sessão ativa ou `null`.',
          envelope: false,
          schema: {
            anyOf: [
              { $ref: '#/components/schemas/AuthSession' },
              { type: 'null' },
            ],
          },
        },
      },
    }),
    betterAuth({
      method: 'get',
      path: '/auth/list-accounts',
      session: true,
      summary: 'Contas vinculadas',
      description:
        'Lista os métodos de login vinculados ao usuário (`credential`, `google`, `github`).',
      responses: {
        200: {
          description: 'Contas vinculadas.',
          envelope: false,
          schema: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                providerId: { type: 'string', example: 'credential' },
                accountId: { type: 'string' },
                createdAt: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
      },
    }),
    betterAuth({
      method: 'post',
      path: '/auth/email-otp/send-verification-otp',
      summary: 'Enviar OTP por e-mail',
      description:
        'Envia um código de uso único. `email-verification` confirma a conta; `sign-in` permite login sem senha. Redefinição de senha não usa OTP — veja `/auth/request-password-reset`.',
      body: {
        schema: {
          type: 'object',
          required: ['email', 'type'],
          properties: {
            email,
            type: { type: 'string', enum: ['email-verification', 'sign-in'] },
          },
        },
      },
      responses: {
        200: {
          description: 'OTP enviado.',
          envelope: false,
          schema: {
            type: 'object',
            properties: { success: { type: 'boolean' } },
          },
        },
      },
      errors: [RATE_LIMITED_AUTH],
    }),
    betterAuth({
      method: 'post',
      path: '/auth/email-otp/verify-email',
      summary: 'Verificar e-mail com OTP',
      description: 'Confirma o e-mail com o código enviado e inicia a sessão.',
      body: {
        schema: {
          type: 'object',
          required: ['email', 'otp'],
          properties: { email, otp: { type: 'string', example: '123456' } },
        },
      },
      responses: {
        200: {
          description: 'E-mail verificado e sessão iniciada.',
          envelope: false,
          schema: AuthSession,
        },
        400: { description: 'OTP inválido ou expirado.', envelope: false },
      },
      errors: [RATE_LIMITED_AUTH],
    }),
    betterAuth({
      method: 'post',
      path: '/auth/request-password-reset',
      summary: 'Solicitar redefinição de senha',
      description:
        'Envia o e-mail de redefinição. O link valida o token e redireciona para `redirectTo?token=...` (ou `?error=INVALID_TOKEN`). Resposta neutra mesmo se a conta não existir.',
      body: {
        schema: {
          type: 'object',
          required: ['email'],
          properties: {
            email,
            redirectTo: { type: 'string', example: '/reset-password' },
          },
        },
      },
      responses: {
        200: {
          description: 'Pedido aceito.',
          envelope: false,
          schema: {
            type: 'object',
            properties: { status: { type: 'boolean' } },
          },
        },
      },
      errors: [RATE_LIMITED_AUTH],
    }),
    betterAuth({
      method: 'post',
      path: '/auth/reset-password',
      summary: 'Redefinir senha',
      description:
        'Define a nova senha a partir do token do e-mail. Todas as outras sessões do usuário são revogadas (`revokeSessionsOnPasswordReset`).',
      body: {
        schema: {
          type: 'object',
          required: ['newPassword', 'token'],
          properties: {
            newPassword: { type: 'string', minLength: 8 },
            token: { type: 'string' },
          },
        },
      },
      responses: {
        200: {
          description: 'Senha redefinida.',
          envelope: false,
          schema: {
            type: 'object',
            properties: { status: { type: 'boolean' } },
          },
        },
        400: { description: 'Token inválido ou expirado.', envelope: false },
      },
      errors: [RATE_LIMITED_AUTH],
    }),
    betterAuth({
      method: 'post',
      path: '/auth/two-factor/enable',
      session: true,
      summary: 'Ativar dois fatores',
      description:
        'Ativa o 2º fator por OTP **via e-mail** (não TOTP): a ativação é imediata (`skipVerificationOnEnable`). Devolve os códigos de backup.',
      body: {
        schema: {
          type: 'object',
          required: ['password'],
          properties: {
            password: { type: 'string', description: 'Senha atual.' },
          },
        },
      },
      responses: {
        200: {
          description: 'Dois fatores ativado.',
          envelope: false,
          schema: {
            type: 'object',
            properties: {
              method: {
                type: 'string',
                enum: ['totp', 'otp'],
                description:
                  'Método ativado. Sem `method` no corpo, o padrão é `totp`, que grava o segredo e devolve `totpURI` e os códigos de backup; `otp` só liga o 2º fator e não devolve os dois campos.',
              },
              totpURI: { type: 'string' },
              backupCodes: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
      errors: [RATE_LIMITED_AUTH],
    }),
    betterAuth({
      method: 'post',
      path: '/auth/two-factor/disable',
      session: true,
      summary: 'Desativar dois fatores',
      description:
        'Desativa o 2º fator do usuário autenticado (exige a senha).',
      body: {
        schema: {
          type: 'object',
          required: ['password'],
          properties: { password: { type: 'string' } },
        },
      },
      responses: {
        200: {
          description: 'Dois fatores desativado.',
          envelope: false,
          schema: {
            type: 'object',
            properties: { status: { type: 'boolean' } },
          },
        },
      },
      errors: [RATE_LIMITED_AUTH],
    }),
    betterAuth({
      method: 'post',
      path: '/auth/two-factor/generate-backup-codes',
      session: true,
      summary: 'Gerar novos códigos de backup',
      description:
        'Invalida os códigos de backup anteriores e devolve novos (exige a senha).',
      body: {
        schema: {
          type: 'object',
          required: ['password'],
          properties: { password: { type: 'string' } },
        },
      },
      responses: {
        200: {
          description: 'Novos códigos.',
          envelope: false,
          schema: {
            type: 'object',
            properties: {
              status: { type: 'boolean' },
              backupCodes: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
      errors: [RATE_LIMITED_AUTH],
    }),
    betterAuth({
      method: 'post',
      path: '/auth/two-factor/send-otp',
      summary: 'Enviar OTP de dois fatores',
      description:
        'Envia o código do 2º fator por e-mail durante o login. Usa o cookie parcial `better-auth.two_factor` criado pelo sign-in (rate limit extra por usuário/cookie).',
      responses: {
        200: {
          description: 'OTP enviado.',
          envelope: false,
          schema: {
            type: 'object',
            properties: { status: { type: 'boolean' } },
          },
        },
      },
      errors: [RATE_LIMITED_AUTH],
    }),
    betterAuth({
      method: 'post',
      path: '/auth/two-factor/verify-otp',
      summary: 'Verificar OTP de dois fatores',
      description:
        'Conclui o login com o código do 2º fator e emite a sessão completa.',
      body: {
        schema: {
          type: 'object',
          required: ['code'],
          properties: {
            code: { type: 'string', example: '123456' },
            trustDevice: { type: 'boolean', default: false },
          },
        },
      },
      responses: {
        200: {
          description: 'Sessão iniciada.',
          envelope: false,
          schema: AuthSession,
        },
        401: { description: 'Código inválido ou expirado.', envelope: false },
      },
      errors: [RATE_LIMITED_AUTH],
    }),
    betterAuth({
      method: 'post',
      path: '/auth/two-factor/verify-backup-code',
      summary: 'Entrar com código de backup',
      description:
        'Alternativa ao OTP quando o usuário não tem acesso ao e-mail. Cada código vale uma vez.',
      body: {
        schema: {
          type: 'object',
          required: ['code'],
          properties: {
            code: { type: 'string' },
            trustDevice: { type: 'boolean', default: false },
          },
        },
      },
      responses: {
        200: {
          description: 'Sessão iniciada.',
          envelope: false,
          schema: AuthSession,
        },
        401: { description: 'Código inválido.', envelope: false },
      },
      errors: [RATE_LIMITED_AUTH],
    }),
  ]

  registry.addSchema('AuthUser', AUTH_USER)
  for (const route of routes) registry.registerRoute(route)
}
