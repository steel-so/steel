import { z } from 'zod'

const serverEnv = {
  POSTGRES_USER: process.env.POSTGRES_USER,
  POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD,
  POSTGRES_DB: process.env.POSTGRES_DB,
  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL,
  REDIS_PASSWORD: process.env.REDIS_PASSWORD,
  REDIS_TLS_ENABLED: process.env.REDIS_TLS_ENABLED,
  REDIS_TLS_CA_PATH: process.env.REDIS_TLS_CA_PATH,
  REALTIME_PORT: process.env.REALTIME_PORT,
  MINIO_ENDPOINT: process.env.MINIO_ENDPOINT,
  MINIO_PUBLIC_URL: process.env.MINIO_PUBLIC_URL,
  MINIO_USER: process.env.MINIO_USER,
  MINIO_PASSWORD: process.env.MINIO_PASSWORD,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  BETTER_AUTH_SECRETS: process.env.BETTER_AUTH_SECRETS,
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  HUGEICONS_TOKEN: process.env.HUGEICONS_TOKEN,
  BILLING_ENABLED: process.env.BILLING_ENABLED,
  ABACATE_PAY: process.env.ABACATE_PAY,
  ABACATE_PAY_WEBHOOK_SECRET: process.env.ABACATE_PAY_WEBHOOK_SECRET,
  ABACATE_PAY_CANCEL_PATH: process.env.ABACATE_PAY_CANCEL_PATH,
  STATUS_COLLECTOR_SECRET: process.env.STATUS_COLLECTOR_SECRET,
  CONNECTION_SECRETS: process.env.CONNECTION_SECRETS,
  ACCOUNT_DELETION_GRACE_OVERRIDE_MS:
    process.env.ACCOUNT_DELETION_GRACE_OVERRIDE_MS,
  WHATSAPP_META_APP_SECRET: process.env.WHATSAPP_META_APP_SECRET,
  WHATSAPP_META_APP_ID: process.env.WHATSAPP_META_APP_ID,
  RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
  WHATSAPP_META_VERIFY_TOKEN: process.env.WHATSAPP_META_VERIFY_TOKEN,
  JITSI_DOMAIN: process.env.JITSI_DOMAIN,
  PABX_DEVICE_DB_URL: process.env.PABX_DEVICE_DB_URL,
  PABX_ENDPOINT_TEMPLATE: process.env.PABX_ENDPOINT_TEMPLATE,
  PABX_WEBPHONE_ENDPOINT_TEMPLATE: process.env.PABX_WEBPHONE_ENDPOINT_TEMPLATE,
  PABX_CALLBACK_URL: process.env.PABX_CALLBACK_URL,
  PIX_PROVIDER: process.env.PIX_PROVIDER,
  PIX_WEBHOOK_SECRET: process.env.PIX_WEBHOOK_SECRET,
  BOLETO_PROVIDER: process.env.BOLETO_PROVIDER,
  BOLETO_WEBHOOK_SECRET: process.env.BOLETO_WEBHOOK_SECRET,
  VOICE_AGENT_AUDIOSOCKET_PORT: process.env.VOICE_AGENT_AUDIOSOCKET_PORT,
  VOICE_AGENT_AUDIOSOCKET_HOST: process.env.VOICE_AGENT_AUDIOSOCKET_HOST,
  VOICE_AGENT_REALTIME_MODEL: process.env.VOICE_AGENT_REALTIME_MODEL,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  WEB_SEARCH_API_KEY: process.env.WEB_SEARCH_API_KEY,
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
  SOCIAL_TOKEN_ENCRYPTION_KEY: process.env.SOCIAL_TOKEN_ENCRYPTION_KEY,
  FACEBOOK_APP_ID: process.env.FACEBOOK_APP_ID,
  FACEBOOK_APP_SECRET: process.env.FACEBOOK_APP_SECRET,
  FACEBOOK_CONFIG_ID: process.env.FACEBOOK_CONFIG_ID,
  TIKTOK_CLIENT_KEY: process.env.TIKTOK_CLIENT_KEY,
  TIKTOK_CLIENT_SECRET: process.env.TIKTOK_CLIENT_SECRET,
  TWITTER_CLIENT_ID: process.env.TWITTER_CLIENT_ID,
  TWITTER_CLIENT_SECRET: process.env.TWITTER_CLIENT_SECRET,
  LINKEDIN_CLIENT_ID: process.env.LINKEDIN_CLIENT_ID,
  LINKEDIN_CLIENT_SECRET: process.env.LINKEDIN_CLIENT_SECRET,
  GOOGLE_ADS_DEVELOPER_TOKEN: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
  DISABLE_AUTH_RATE_LIMIT: process.env.DISABLE_AUTH_RATE_LIMIT,
  MAIL_DRY_RUN: process.env.MAIL_DRY_RUN,
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
  VAPID_SUBJECT: process.env.VAPID_SUBJECT,
  WORKBENCH_USER: process.env.WORKBENCH_USER,
  WORKBENCH_PASS: process.env.WORKBENCH_PASS,
  STATUS_APP_PROBE_URL: process.env.STATUS_APP_PROBE_URL,
  SLACK_ALERTS_WEBHOOK_URL: process.env.SLACK_ALERTS_WEBHOOK_URL,
  BACKUP_OFFSITE_ENDPOINT: process.env.BACKUP_OFFSITE_ENDPOINT,
  BACKUP_OFFSITE_REGION: process.env.BACKUP_OFFSITE_REGION,
  BACKUP_OFFSITE_BUCKET: process.env.BACKUP_OFFSITE_BUCKET,
  BACKUP_OFFSITE_ACCESS_KEY_ID: process.env.BACKUP_OFFSITE_ACCESS_KEY_ID,
  BACKUP_OFFSITE_SECRET_ACCESS_KEY: process.env.BACKUP_OFFSITE_SECRET_ACCESS_KEY,
  BACKUP_OFFSITE_PREFIX: process.env.BACKUP_OFFSITE_PREFIX,
  BACKUP_OFFSITE_FORCE_PATH_STYLE: process.env.BACKUP_OFFSITE_FORCE_PATH_STYLE,
  BACKUP_OFFSITE_SSE: process.env.BACKUP_OFFSITE_SSE,
  BACKUP_OFFSITE_RETENTION_DAYS: process.env.BACKUP_OFFSITE_RETENTION_DAYS,
  GITHUB_RELEASES_TOKEN: process.env.GITHUB_RELEASES_TOKEN,
  GITHUB_RELEASES_REPO: process.env.GITHUB_RELEASES_REPO,
  SLACK_CLIENT_ID: process.env.SLACK_CLIENT_ID,
  SLACK_CLIENT_SECRET: process.env.SLACK_CLIENT_SECRET,
  SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET,
  AXIOM_QUERY_TOKEN: process.env.AXIOM_QUERY_TOKEN,
  AXIOM_QUERY_URL: process.env.AXIOM_QUERY_URL,
  ANALYTICS_FIXTURES: process.env.ANALYTICS_FIXTURES,
  GEOIP_DB_PATH: process.env.GEOIP_DB_PATH,
  SENTRY_ORG: process.env.SENTRY_ORG,
  SENTRY_PROJECT: process.env.SENTRY_PROJECT,
  SENTRY_AUTH_TOKEN: process.env.SENTRY_AUTH_TOKEN,
  CANVAS_LAB: process.env.CANVAS_LAB,
  SITES_ROOT_DOMAIN: process.env.SITES_ROOT_DOMAIN,
  DATABASE_URL_POOLED: process.env.DATABASE_URL_POOLED,
  DB_POOL_MAX: process.env.DB_POOL_MAX,
  NEXT_SERVER_ACTIONS_ENCRYPTION_KEY:
    process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY,
  NEXT_CACHE_TAGS_TIMEOUT_MS: process.env.NEXT_CACHE_TAGS_TIMEOUT_MS,
}

/** String opcional que trata `""` como ausente (não só `undefined`). */
const blankOptional = z.preprocess(
  (v) => (v === '' ? undefined : v),
  z.string().min(1).optional(),
)

/**
 * Flag booleana mantida como string literal (`'true'`/`'false'`). Não usa
 * `.transform` de propósito: com `SKIP_ENV_VALIDATION`/`NODE_ENV=test` o
 * objeto cru é devolvido sem passar pelo schema, então o consumidor compara
 * `=== 'true'` e o comportamento é idêntico nos dois caminhos.
 */
const flag = z.preprocess(
  (v) => (v === '' ? undefined : v),
  z.enum(['true', 'false']).optional(),
)

/** Credentials that only matter while billing is on. */
const BILLING_CREDENTIALS = ['ABACATE_PAY', 'ABACATE_PAY_WEBHOOK_SECRET'] as const

/**
 * The AbacatePay credentials are optional as long as billing is off, and
 * required as soon as `BILLING_ENABLED=true` — turning billing back on must
 * fail at boot, not at the first checkout.
 */
export function requireBillingCredentials(
  env: {
    BILLING_ENABLED?: string
    ABACATE_PAY?: string
    ABACATE_PAY_WEBHOOK_SECRET?: string
  },
  ctx: z.RefinementCtx,
): void {
  if (env.BILLING_ENABLED !== 'true') return
  for (const key of BILLING_CREDENTIALS) {
    if (!env[key]) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `${key} is required when BILLING_ENABLED=true`,
      })
    }
  }
}

export const serverEnvSchema = z.object({
  POSTGRES_USER: z.string().min(2).max(63),
  POSTGRES_PASSWORD: z.string().min(8).max(128),
  POSTGRES_DB: z.string().min(1).max(63),
  DATABASE_URL: z.url().startsWith('postgresql://'),
  REDIS_URL: z
    .url()
    .refine((v) => v.startsWith('redis://') || v.startsWith('rediss://'), {
      message: 'REDIS_URL must start with redis:// or rediss://',
    }),
  REDIS_PASSWORD: z.string().min(8).max(128),
  REDIS_TLS_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  REDIS_TLS_CA_PATH: z.string().min(1).optional(),
  // Wiki collaboration server (realtime/index.ts, Hocuspocus). 1235 and not
  // Hocuspocus' usual 1234, which Nexo's realtime holds on the dev machine.
  REALTIME_PORT: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 1235))
    .refine((v) => Number.isFinite(v) && v > 0, {
      message: 'REALTIME_PORT must be a positive number',
    }),
  MINIO_ENDPOINT: z.url().startsWith('http'),
  // Publicly reachable base URL for objects in public buckets (browsers and
  // external providers like Z-API fetch media from here). Defaults to
  // MINIO_ENDPOINT for local dev, where it's directly reachable; production
  // must set this to a domain the internal MINIO_ENDPOINT (Docker service
  // name) isn't.
  MINIO_PUBLIC_URL: z.url().startsWith('http').optional(),
  MINIO_USER: z.string().min(3).max(63),
  MINIO_PASSWORD: z.string().min(8).max(128),
  BETTER_AUTH_SECRET: z.string().min(16).startsWith('ba_'),
  BETTER_AUTH_SECRETS: z
    .string()
    .regex(/^\d+:.{32,}(,\d+:.{32,})*$/, {
      message:
        'BETTER_AUTH_SECRETS must be "v:secret[,v:secret...]" with secrets >= 32 chars',
    })
    .optional(),
  BETTER_AUTH_URL: z.url().startsWith('http'),
  GOOGLE_CLIENT_ID: z.string().min(10).endsWith('.apps.googleusercontent.com'),
  GOOGLE_CLIENT_SECRET: z.string().min(10).startsWith('GOCSPX-'),
  GITHUB_CLIENT_ID: z.string().min(10).max(40),
  GITHUB_CLIENT_SECRET: z.string().length(40),
  RESEND_API_KEY: z.string().startsWith('re_'),
  HUGEICONS_TOKEN: z.string().regex(/^[A-F0-9]{8}(-[A-F0-9]{8}){3}$/),
  // Billing kill-switch (AbacatePay checkout, coupons, webhook, the status
  // probe and every upgrade CTA). Off by default: with anything but `'true'`
  // the provider is never called and its credentials become optional (see
  // `requireBillingCredentials`). Read it through `isBillingEnabled()`.
  BILLING_ENABLED: flag,
  ABACATE_PAY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).max(100).optional(),
  ),
  ABACATE_PAY_WEBHOOK_SECRET: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).max(100).optional(),
  ),
  // Caminho do cancelamento de assinatura no AbacatePay. Existe só para
  // sobrescrever a rota se o provedor mudá-la; vazio = `/subscriptions/cancel`
  // (o default fica em lib/abacatepay.ts).
  ABACATE_PAY_CANCEL_PATH: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .string()
      .startsWith('/', { message: 'ABACATE_PAY_CANCEL_PATH must start with /' })
      .max(100)
      .optional(),
  ),
  STATUS_COLLECTOR_SECRET: z.string().min(32).max(128),
  CONNECTION_SECRETS: z.string().regex(/^\d+:.{32,}(,\d+:.{32,})*$/, {
    message:
      'CONNECTION_SECRETS must be "v:secret[,v:secret...]" with secrets >= 32 chars',
  }),
  ACCOUNT_DELETION_GRACE_OVERRIDE_MS: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : undefined))
    .refine((v) => v === undefined || (Number.isFinite(v) && v >= 0), {
      message: 'ACCOUNT_DELETION_GRACE_OVERRIDE_MS must be a non-negative number',
    }),
  WHATSAPP_META_APP_SECRET: z.string().min(1).max(255).optional(),
  // Meta app id for the Resumable Upload API (media header of new templates).
  // Optional — without it the app is resolved from the connection's token.
  WHATSAPP_META_APP_ID: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().regex(/^\d+$/).optional(),
  ),
  // Resend webhook signing secret (whsec_...): delivery/bounce events of CRM
  // multichannel campaigns. Optional — without it the endpoint answers 503.
  RESEND_WEBHOOK_SECRET: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().startsWith('whsec_').optional(),
  ),
  WHATSAPP_META_VERIFY_TOKEN: z.string().min(8).max(255).optional(),
  JITSI_DOMAIN: z.string().min(1).max(255).default('meet.jit.si'),
  // Click-to-call from a WhatsApp conversation. Every user device is its own
  // PABX: its address (`ip1ext`) and token come from the central `steel.device`
  // table (MariaDB). Without the database URL the call button answers 503.
  PABX_DEVICE_DB_URL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().startsWith('mysql://').optional(),
  ),
  // Dialer endpoint on each PABX; `{host}` is the device `ip1ext`.
  PABX_ENDPOINT_TEMPLATE: z
    .string()
    .includes('{host}')
    .default('http://{host}:4561/steel_call_endpoint.php'),
  // Browser-calling provisioning endpoint on each PABX; `{host}` is the device
  // `ip1ext`. It hands out the extension's SIP credentials to the Steel backend.
  PABX_WEBPHONE_ENDPOINT_TEMPLATE: z
    .string()
    .includes('{host}')
    .default('http://{host}:4561/steel_webphone_endpoint.php'),
  // Where the PABX dialplan reports the call status. Defaults to
  // `${BETTER_AUTH_URL}/api/pabx/calls/webhook`.
  PABX_CALLBACK_URL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.url().optional(),
  ),
  // Pix in the conversation (Z1): which PSP issues the charges. Only the
  // `mock` provider is the default; `abacatepay` issues real charges with the
  // ABACATE_PAY API key (see src/lib/pix).
  PIX_PROVIDER: z.enum(['mock', 'abacatepay']).default('mock'),
  // HMAC-SHA256 secret that signs the Pix payment webhooks. Unset = the
  // webhook refuses every call.
  PIX_WEBHOOK_SECRET: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(16).optional(),
  ),
  // Boleto charges (C6 proposals, Z1 conversation): `mock` by default;
  // `abacatepay` issues real boletos with ABACATE_PAY.
  BOLETO_PROVIDER: z.enum(['mock', 'abacatepay']).default('mock'),
  // `webhookSecret` query param of the boleto webhook URL (min 16 chars).
  BOLETO_WEBHOOK_SECRET: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(16).optional(),
  ),
  // IVR voice attendant (ADR 0046): TCP port of the Asterisk AudioSocket
  // server inside the worker. Unset = the attendant is not served.
  VOICE_AGENT_AUDIOSOCKET_PORT: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().int().min(1).max(65535).optional(),
  ),
  // Interface the AudioSocket server binds to; restrict the port to the
  // PABX address in the firewall (docs/runbooks/pabx-voice-agent.md).
  VOICE_AGENT_AUDIOSOCKET_HOST: z.string().min(1).default('0.0.0.0'),
  // Realtime model of the voice attendant (default: gpt-realtime).
  VOICE_AGENT_REALTIME_MODEL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).optional(),
  ),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  // Web search of the prospecting agent (Brave Search API); inert without it.
  WEB_SEARCH_API_KEY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).optional(),
  ),
  ANTHROPIC_MODEL: z.string().min(1).optional(),
  // Cifra tokens OAuth de redes sociais em repouso (AES-256-GCM). Sem ela,
  // isTokenCryptoConfigured() é false e o handshake OAuth fica indisponível.
  // `blankOptional`: cada plataforma é opcional e independente — deploys
  // parciais deixam algumas dessas vars como string vazia em vez de ausentes.
  SOCIAL_TOKEN_ENCRYPTION_KEY: blankOptional,
  FACEBOOK_APP_ID: blankOptional,
  FACEBOOK_APP_SECRET: blankOptional,
  FACEBOOK_CONFIG_ID: blankOptional,
  TIKTOK_CLIENT_KEY: blankOptional,
  TIKTOK_CLIENT_SECRET: blankOptional,
  TWITTER_CLIENT_ID: blankOptional,
  TWITTER_CLIENT_SECRET: blankOptional,
  LINKEDIN_CLIENT_ID: blankOptional,
  LINKEDIN_CLIENT_SECRET: blankOptional,
  GOOGLE_ADS_DEVELOPER_TOKEN: blankOptional,
  // Desliga só o rate limiter embutido do better-auth (o app mantém o próprio,
  // Redis). Usado pelo e2e, que roda `next start` em modo produção.
  DISABLE_AUTH_RATE_LIMIT: flag,
  // Kill-switch de envio de e-mail: nada sai pelo Resend quando `'true'`.
  MAIL_DRY_RUN: flag,
  // Web Push (PWA): VAPID key pair (base64url; public = 65-byte uncompressed
  // P-256 point, private = 32-byte scalar) and the contact (`mailto:` or
  // https URL). Without the pair push stays OFF and inert.
  VAPID_PUBLIC_KEY: blankOptional,
  VAPID_PRIVATE_KEY: blankOptional,
  VAPID_SUBJECT: blankOptional,
  // Basic auth do dashboard de filas (`/jobs`, Workbench).
  WORKBENCH_USER: blankOptional,
  WORKBENCH_PASS: blankOptional,
  // URL que o worker usa pra sondar a aplicação na coleta do status page
  // (componente "app"). Sem ela, cai em BETTER_AUTH_URL. Em produção, dentro
  // da rede Docker, use o nome do container (ex.: http://nextjs-app:3000).
  STATUS_APP_PROBE_URL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.url().startsWith('http').optional(),
  ),
  // Incoming Webhook of the #alerts channel: status component transitions and
  // background job deaths (src/lib/alerts/slack.ts). Optional and lenient on
  // purpose -- a malformed webhook must never stop the app from booting. Unset
  // or blank disables alerts (logged no-op); a bad value fails at send time as
  // `alerts.slack.failed`.
  SLACK_ALERTS_WEBHOOK_URL: z
    .string()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : undefined)),
  // Cópia offsite (fora do servidor) do backup FULL diário, em qualquer
  // storage S3-compatível (Backblaze B2, Cloudflare R2, AWS S3, Wasabi...).
  // Tudo opcional: sem ENDPOINT/BUCKET/chaves a cópia offsite fica inerte (só
  // loga um aviso) — ver src/lib/storage/offsite-backup.ts.
  BACKUP_OFFSITE_ENDPOINT: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.url().startsWith('http').optional(),
  ),
  BACKUP_OFFSITE_REGION: blankOptional,
  BACKUP_OFFSITE_BUCKET: blankOptional,
  BACKUP_OFFSITE_ACCESS_KEY_ID: blankOptional,
  BACKUP_OFFSITE_SECRET_ACCESS_KEY: blankOptional,
  BACKUP_OFFSITE_PREFIX: blankOptional,
  BACKUP_OFFSITE_FORCE_PATH_STYLE: flag,
  // Pede criptografia em repouso do lado do provedor (SSE-S3, `AES256`).
  // Default ligado; use `'false'` se o provedor rejeitar o header — o
  // conteúdo já sobe cifrado pela aplicação de qualquer forma.
  BACKUP_OFFSITE_SSE: flag,
  BACKUP_OFFSITE_RETENTION_DAYS: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .string()
      .regex(/^[1-9]\d*$/, {
        message: 'BACKUP_OFFSITE_RETENTION_DAYS must be a positive integer',
      })
      .optional(),
  ),
  // Rascunho do e-mail de novidades a partir da última release do GitHub
  // (painel admin → Changelog). Token fine-grained só com "Contents: read"
  // no repositório; sem ele a busca funciona apenas para repositório público
  // e o admin ainda pode colar as notas à mão.
  GITHUB_RELEASES_TOKEN: blankOptional,
  GITHUB_RELEASES_REPO: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .string()
      .regex(/^[\w.-]+\/[\w.-]+$/, {
        message: 'GITHUB_RELEASES_REPO must look like owner/repo',
      })
      .optional(),
  ),
  // Painel Analytics do admin (`/admin/analytics`): token de API do Axiom só
  // com permissão de *Query* no dataset de NEXT_PUBLIC_AXIOM_DATASET (o
  // token de ingestão público não lê). Sem ele o painel mostra o passo a
  // passo de configuração. Ver docs/admin-analytics.md.
  AXIOM_QUERY_TOKEN: blankOptional,
  // Base da API de consulta (default https://api.axiom.co).
  AXIOM_QUERY_URL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.url().startsWith('http').optional(),
  ),
  // Dados simulados no painel Analytics para desenvolver a UI sem o Axiom.
  // Só vale fora de produção (ignorado com NODE_ENV=production).
  ANALYTICS_FIXTURES: flag,
  // Caminho do GeoLite2-City.mmdb (MaxMind) para o país/cidade dos logs de
  // requisição. Sem o arquivo, o enriquecimento é pulado em silêncio. O IP
  // nunca é gravado: só país/cidade.
  GEOIP_DB_PATH: blankOptional,
  // Integração do ServiceDesk com o Slack (app do Slack, credenciais do
  // nível da instalação — o token de cada workspace vem do OAuth e fica
  // cifrado no banco com CONNECTION_SECRETS). Tudo opcional: sem as três
  // vars a aba Integrações explica que o Slack não está configurado e nada
  // é enviado nem recebido — ver src/lib/servicedesk/integrations.ts.
  SLACK_CLIENT_ID: blankOptional,
  SLACK_CLIENT_SECRET: blankOptional,
  // "Signing Secret" do app do Slack: assina todo request que o Slack manda
  // (eventos, atalhos, slash commands). Sem ele o webhook recusa tudo.
  SLACK_SIGNING_SECRET: blankOptional,
  // Credenciais de **build** do Sentry: só servem para subir source maps, o
  // que acontece apenas no build de imagem do CD. Sem as três, o plugin do
  // `next.config.ts` fica inerte (nenhum release criado, nenhum upload) e o
  // build segue — o DSN de runtime é `NEXT_PUBLIC_SENTRY_DSN`, público, em
  // `lib/env/env.ts`.
  SENTRY_ORG: blankOptional,
  SENTRY_PROJECT: blankOptional,
  SENTRY_AUTH_TOKEN: blankOptional,
  // Playground do editor Steel Canvas (`/[workspace]/canvas-lab`). Fora de
  // produção ele sempre abre; em produção só com `'true'` (homologação, prints).
  CANVAS_LAB: flag,
  // Root domain of the published sites (`<slug>.<SITES_ROOT_DOMAIN>`, e.g.
  // `sites.steel.app`), behind a wildcard DNS record and certificate. Optional:
  // without it sites are served only at `/s/<slug>` on the app's own domain.
  SITES_ROOT_DOMAIN: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .string()
      .regex(
        /^(?=.{1,200}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
        'SITES_ROOT_DOMAIN must be a lower-case domain (e.g. sites.steel.app)',
      )
      .optional(),
  ),
  // App replicas (ADR 0038). Runtime connection through PgBouncer in
  // transaction mode (`steel-pgbouncer`, compose profile `pooler`). Optional:
  // without it the app talks to Postgres directly. Migrations, pg_dump and
  // pg_restore always use DATABASE_URL — DDL and session state do not survive
  // transaction pooling.
  DATABASE_URL_POOLED: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.url().startsWith('postgresql://').optional(),
  ),
  // Connections each process (every app replica, the worker, the realtime)
  // keeps in its pg pool. Kept as a string; `src/lib/db-pool.ts` parses it
  // (default 10).
  DB_POOL_MAX: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .string()
      .regex(/^[1-9][0-9]{0,2}$/, 'DB_POOL_MAX must be an integer from 1 to 999')
      .optional(),
  ),
  // **Build** time: Next embeds it in the server output so every replica and
  // every deploy decrypt the same Server Action closures. Comes from the
  // GitHub secret of the same name (BuildKit secret in the Dockerfile).
  // Without it Next generates a key per build. Base64 of 16, 24 or 32 bytes
  // (`openssl rand -base64 32`).
  NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .string()
      .refine(
        (v) => {
          if (!/^[A-Za-z0-9+/]+={0,2}$/.test(v)) return false
          try {
            return [16, 24, 32].includes(atob(v).length)
          } catch {
            return false
          }
        },
        'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY must be base64 of 16, 24 or 32 bytes',
      )
      .optional(),
  ),
  // Budget (ms) of each Redis call of the shared-tag cache handler
  // (lib/next-cache, read there straight from process.env). Default 150.
  NEXT_CACHE_TAGS_TIMEOUT_MS: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .string()
      .regex(/^[1-9][0-9]{0,4}$/, 'NEXT_CACHE_TAGS_TIMEOUT_MS must be a positive integer')
      .optional(),
  ),
}).superRefine(requireBillingCredentials)

const validatedServerEnv =
  process.env.NODE_ENV === 'test' || process.env.SKIP_ENV_VALIDATION === 'true'
    ? (serverEnv as unknown as z.infer<typeof serverEnvSchema>)
    : serverEnvSchema.parse(serverEnv)

export const {
  POSTGRES_USER,
  POSTGRES_PASSWORD,
  POSTGRES_DB,
  DATABASE_URL,
  REDIS_URL,
  REDIS_PASSWORD,
  REDIS_TLS_ENABLED,
  REDIS_TLS_CA_PATH,
  REALTIME_PORT,
  MINIO_ENDPOINT,
  MINIO_PUBLIC_URL,
  MINIO_USER,
  MINIO_PASSWORD,
  BETTER_AUTH_SECRET,
  BETTER_AUTH_SECRETS,
  BETTER_AUTH_URL,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET,
  RESEND_API_KEY,
  HUGEICONS_TOKEN,
  BILLING_ENABLED,
  ABACATE_PAY,
  ABACATE_PAY_WEBHOOK_SECRET,
  ABACATE_PAY_CANCEL_PATH,
  STATUS_COLLECTOR_SECRET,
  CONNECTION_SECRETS,
  ACCOUNT_DELETION_GRACE_OVERRIDE_MS,
  WHATSAPP_META_APP_SECRET,
  WHATSAPP_META_APP_ID,
  RESEND_WEBHOOK_SECRET,
  WHATSAPP_META_VERIFY_TOKEN,
  JITSI_DOMAIN,
  PABX_DEVICE_DB_URL,
  PABX_ENDPOINT_TEMPLATE,
  PABX_WEBPHONE_ENDPOINT_TEMPLATE,
  PABX_CALLBACK_URL,
  PIX_PROVIDER,
  PIX_WEBHOOK_SECRET,
  BOLETO_PROVIDER,
  BOLETO_WEBHOOK_SECRET,
  VOICE_AGENT_AUDIOSOCKET_PORT,
  VOICE_AGENT_AUDIOSOCKET_HOST,
  VOICE_AGENT_REALTIME_MODEL,
  OPENAI_API_KEY,
  OPENAI_MODEL,
  ANTHROPIC_API_KEY,
  WEB_SEARCH_API_KEY,
  ANTHROPIC_MODEL,
  SOCIAL_TOKEN_ENCRYPTION_KEY,
  FACEBOOK_APP_ID,
  FACEBOOK_APP_SECRET,
  FACEBOOK_CONFIG_ID,
  TIKTOK_CLIENT_KEY,
  TIKTOK_CLIENT_SECRET,
  TWITTER_CLIENT_ID,
  TWITTER_CLIENT_SECRET,
  LINKEDIN_CLIENT_ID,
  LINKEDIN_CLIENT_SECRET,
  GOOGLE_ADS_DEVELOPER_TOKEN,
  DISABLE_AUTH_RATE_LIMIT,
  MAIL_DRY_RUN,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_SUBJECT,
  WORKBENCH_USER,
  WORKBENCH_PASS,
  STATUS_APP_PROBE_URL,
  SLACK_ALERTS_WEBHOOK_URL,
  BACKUP_OFFSITE_ENDPOINT,
  BACKUP_OFFSITE_REGION,
  BACKUP_OFFSITE_BUCKET,
  BACKUP_OFFSITE_ACCESS_KEY_ID,
  BACKUP_OFFSITE_SECRET_ACCESS_KEY,
  BACKUP_OFFSITE_PREFIX,
  BACKUP_OFFSITE_FORCE_PATH_STYLE,
  BACKUP_OFFSITE_SSE,
  BACKUP_OFFSITE_RETENTION_DAYS,
  GITHUB_RELEASES_TOKEN,
  GITHUB_RELEASES_REPO,
  AXIOM_QUERY_TOKEN,
  AXIOM_QUERY_URL,
  ANALYTICS_FIXTURES,
  GEOIP_DB_PATH,
  SLACK_CLIENT_ID,
  SLACK_CLIENT_SECRET,
  SLACK_SIGNING_SECRET,
  SENTRY_ORG,
  SENTRY_PROJECT,
  SENTRY_AUTH_TOKEN,
  CANVAS_LAB,
  SITES_ROOT_DOMAIN,
  DATABASE_URL_POOLED,
  DB_POOL_MAX,
  NEXT_SERVER_ACTIONS_ENCRYPTION_KEY,
  NEXT_CACHE_TAGS_TIMEOUT_MS,
} = validatedServerEnv

/** The Steel Canvas playground opens in dev/test, and in production only
 * with `CANVAS_LAB=true`. */
export const CANVAS_LAB_ENABLED =
  process.env.NODE_ENV !== 'production' || CANVAS_LAB === 'true'
