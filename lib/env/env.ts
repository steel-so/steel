import { z } from 'zod'
import { POSTHOG_DEFAULT_HOST } from '@/lib/posthog/constants'

const publicEnv = {
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_AXIOM_TOKEN: process.env.NEXT_PUBLIC_AXIOM_TOKEN,
  NEXT_PUBLIC_AXIOM_DATASET: process.env.NEXT_PUBLIC_AXIOM_DATASET,
  NEXT_PUBLIC_URL: process.env.NEXT_PUBLIC_URL,
  NEXT_PUBLIC_REALTIME_URL: process.env.NEXT_PUBLIC_REALTIME_URL,
  NEXT_PUBLIC_GA_ID: process.env.NEXT_PUBLIC_GA_ID,
  NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  // O default existe para o `posthog-js` ter um `ui_host` válido mesmo sem
  // configuração; nada o lê sem uma chave (ver `lib/posthog/client.ts`).
  NEXT_PUBLIC_POSTHOG_HOST:
    process.env.NEXT_PUBLIC_POSTHOG_HOST || POSTHOG_DEFAULT_HOST,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_META_APP_ID: process.env.NEXT_PUBLIC_META_APP_ID,
  NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID:
    process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID,
  NEXT_PUBLIC_SENTRY_RELEASE: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
  NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
}

/**
 * Opcional que trata `""` como ausente, não só `undefined`.
 *
 * Um `.env` com `NEXT_PUBLIC_SENTRY_DSN=` (linha presente, valor vazio) é o
 * estado natural de quem ainda não criou a conta — e sem isto o
 * `z.url().optional()` recusaria a string vazia e o app **não subiria**. É o
 * mesmo `blankOptional` que `lib/env/_server.ts` já usa.
 */
const blankOptional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional())

const publicEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  // Opcionais: sem token/dataset (ex.: máquina local) o logger só escreve no
  // console e nada é enviado ao Axiom — o dataset fica só com o que é deploy.
  NEXT_PUBLIC_AXIOM_TOKEN: blankOptional(z.string().startsWith('xaat-')),
  NEXT_PUBLIC_AXIOM_DATASET: blankOptional(z.string().min(1).max(128)),
  NEXT_PUBLIC_URL: z.url().startsWith('http'),
  // WebSocket of the wiki's realtime server. Unset means same origin
  // (`/realtime`, which nginx proxies to the Hocuspocus container), so the
  // production build needs no build-arg; dev points it at the local server.
  NEXT_PUBLIC_REALTIME_URL: blankOptional(z.url().startsWith('ws')),
  NEXT_PUBLIC_GA_ID: z.string().startsWith('G-').optional(),
  // Opcionais de propósito: sem chave, o PostHog nunca carrega e nunca pede
  // nada à rede — o app sobe igual (mesmo contrato do
  // `src/lib/storage/offsite-backup.ts`).
  NEXT_PUBLIC_POSTHOG_KEY: blankOptional(z.string().startsWith('phc_')),
  NEXT_PUBLIC_POSTHOG_HOST: z.url().startsWith('https://'),
  // Mesmo contrato para o Sentry: sem DSN, sem SDK, sem rede.
  NEXT_PUBLIC_SENTRY_DSN: blankOptional(z.url().startsWith('https://')),
  // WhatsApp Embedded Signup (build time): without both, the "Conectar com a
  // Meta" button stays hidden and the CSP gets no Facebook origin.
  NEXT_PUBLIC_META_APP_ID: blankOptional(z.string().regex(/^\d+$/)),
  NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID: blankOptional(
    z.string().regex(/^\d+$/),
  ),
  NEXT_PUBLIC_SENTRY_RELEASE: blankOptional(z.string().min(1).max(200)),
  NEXT_PUBLIC_SENTRY_ENVIRONMENT: blankOptional(z.string().min(1).max(64)),
})

const validatedPublicEnv =
  process.env.NODE_ENV === 'test' || process.env.SKIP_ENV_VALIDATION === 'true'
    ? (publicEnv as z.infer<typeof publicEnvSchema>)
    : publicEnvSchema.parse(publicEnv)

export const {
  NODE_ENV,
  NEXT_PUBLIC_AXIOM_TOKEN,
  NEXT_PUBLIC_AXIOM_DATASET,
  NEXT_PUBLIC_URL,
  NEXT_PUBLIC_REALTIME_URL,
  NEXT_PUBLIC_GA_ID,
  NEXT_PUBLIC_POSTHOG_KEY,
  NEXT_PUBLIC_POSTHOG_HOST,
  NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_META_APP_ID,
  NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID,
  NEXT_PUBLIC_SENTRY_RELEASE,
  NEXT_PUBLIC_SENTRY_ENVIRONMENT,
} = validatedPublicEnv
