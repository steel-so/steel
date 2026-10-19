import type { PrismaClient } from '@prisma/client'
import { deleteObjects, listObjectKeys, listObjects } from './s3'

export interface WorkspaceBucket {
  /** Nome do bucket no MinIO. */
  name: string
  /** `true` quando o bucket tem policy de leitura pública (`ensurePublicBucket`). */
  public: boolean
  /** Onde o bucket é escrito — serve de mapa pra manter esta lista em dia. */
  writtenBy: string
}

/**
 * Buckets cujas chaves começam por `<workspaceId>/` — dá para listar,
 * arquivar e apagar tudo do workspace por prefixo. Mantenha em sincronia com
 * quem grava (`writtenBy`).
 */
export const WORKSPACE_BUCKETS: readonly WorkspaceBucket[] = [
  {
    name: 'projects-covers',
    public: true,
    writtenBy: 'src/services/media/project-media.service.ts',
  },
  {
    name: 'crm-landing-page-images',
    public: true,
    writtenBy: 'src/services/media/crm-landing-page-media.service.ts',
  },
  {
    name: 'crm-landing-page-videos',
    public: true,
    writtenBy: 'src/services/media/crm-landing-page-media.service.ts',
  },
  {
    name: 'crm-proposal-images',
    public: true,
    writtenBy: 'src/services/media/crm-proposal-media.service.ts',
  },
  {
    name: 'crm-scheduled-posts',
    public: false,
    writtenBy: 'src/services/crm-social.service.ts',
  },
  {
    name: 'crm-social-publish-tmp',
    public: false,
    writtenBy: 'src/services/crm-social-publish-queue.service.ts',
  },
  {
    name: 'whatsapp-media',
    public: false,
    writtenBy: 'src/lib/whatsapp/media.ts',
  },
  {
    name: 'whatsapp-ai-knowledge',
    public: false,
    writtenBy: 'src/services/whatsapp-ai-knowledge-document.service.ts',
  },
  {
    // ServiceDesk (privado): mídia da base de conhecimento em
    // `<ws>/kb/<articleId>/...`, anexos dos chamados em
    // `<ws>/tickets/<ticketId>/<cuid>-<nome>` e assinaturas em
    // `<ws>/tickets/<ticketId>/signatures/<cuid>.png` — sempre com o
    // workspace na frente da chave.
    name: 'servicedesk',
    public: false,
    writtenBy:
      'src/services/sd-kb-media.service.ts, src/services/sd-ticket-attachment.service.ts, src/services/sd-ticket-signature.service.ts',
  },
  {
    // Workspace logo (Ajustes > Geral), public: `<ws>/<uuid>.<ext>`.
    name: 'workspace-logos',
    public: true,
    writtenBy: 'src/services/media/workspace-logo.service.ts',
  },
  {
    // Steel AI (private): files and photos sent to the assistant, in
    // `<ws>/<conversationId>/<id>-<name>`.
    name: 'steel-ai-attachments',
    public: false,
    writtenBy: 'src/services/ai-attachment.service.ts',
  },
  {
    // Visual e-mail builder images (public, read by mail clients):
    // `<ws>/<uuid>.<ext>`.
    name: 'crm-email-images',
    public: true,
    writtenBy: 'src/services/media/crm-email-media.service.ts',
  },
  {
    // Whiteboard (private): canvas images in `<ws>/files/<fileId>` and list
    // previews in `<ws>/thumbnails/<boardId>.png`.
    name: 'whiteboards',
    public: false,
    writtenBy: 'src/services/whiteboard-file.service.ts',
  },
  {
    // Site editor media library (public, served on published sites):
    // `<ws>/<uuid>.<ext>`.
    name: 'site-media',
    public: true,
    writtenBy: 'src/services/site-media.service.ts',
  },
  {
    // PABX call recordings (private, ADR 0043): `<ws>/<callId>.<ext>`.
    name: 'phone-call-recordings',
    public: false,
    writtenBy: 'src/services/phone-call-recording.service.ts',
  },
] as const

export const WORKSPACE_PREFIXED_BUCKETS = WORKSPACE_BUCKETS.map((b) => b.name)

/** Anexos do assistente de IA: chave `<conversationId>/...`, lida da linha. */
export const CRM_AI_ATTACHMENT_BUCKET = 'crm-ai-attachments'

/**
 * Buckets de mídia de CRM que, até 19/09/2026, gravavam na raiz
 * (`<uuid>.<ext>`, sem o workspace na chave). Para esses objetos legados o
 * único vínculo com o workspace é a URL guardada no conteúdo das landing
 * pages/propostas — daí o rastreio por referência.
 */
const LEGACY_FLAT_BUCKETS = [
  'crm-landing-page-images',
  'crm-landing-page-videos',
  'crm-proposal-images',
] as const

const PUBLIC_BY_BUCKET = new Map(
  [
    ...WORKSPACE_BUCKETS.map((b) => [b.name, b.public] as const),
    [CRM_AI_ATTACHMENT_BUCKET, false] as const,
  ].map(([name, isPublic]) => [name, isPublic]),
)

export function isPublicBucket(bucket: string): boolean {
  return PUBLIC_BY_BUCKET.get(bucket) ?? false
}

export interface WorkspaceFilesPurgeResult {
  deleted: number
  byBucket: Record<string, number>
}

/**
 * Apaga os arquivos de um workspace no MinIO. As chaves dos anexos de IA
 * precisam ser coletadas ANTES de apagar as linhas do banco (a chave não
 * carrega o workspace).
 *
 * Fica de fora: objetos legados de landing page/proposta gravados na raiz do
 * bucket (ver `LEGACY_FLAT_BUCKETS`) — eles não são apagados aqui porque uma
 * varredura por referência depende das linhas, que já foram removidas.
 */
export async function purgeWorkspaceFiles(
  workspaceId: string,
  aiAttachmentKeys: string[],
): Promise<WorkspaceFilesPurgeResult> {
  const byBucket: Record<string, number> = {}

  for (const bucket of WORKSPACE_PREFIXED_BUCKETS) {
    const keys = await listObjectKeys(bucket, `${workspaceId}/`)
    byBucket[bucket] = keys.length > 0 ? await deleteObjects(bucket, keys) : 0
  }

  byBucket[CRM_AI_ATTACHMENT_BUCKET] =
    aiAttachmentKeys.length > 0
      ? await deleteObjects(CRM_AI_ATTACHMENT_BUCKET, aiAttachmentKeys)
      : 0

  const deleted = Object.values(byBucket).reduce((sum, n) => sum + n, 0)
  return { deleted, byBucket }
}

export interface WorkspaceFileRef {
  bucket: string
  key: string
  sizeBytes: number
  /** `true` quando o objeto foi achado por referência, não por prefixo. */
  legacy: boolean
}

export interface WorkspaceFileRefs {
  files: WorkspaceFileRef[]
  /** Chaves referenciadas no conteúdo que não existem mais no MinIO. */
  missingLegacyKeys: number
}

/**
 * Extrai as chaves de um bucket citadas numa URL dentro de um JSON.
 *
 * `bucket` sempre vem de `LEGACY_FLAT_BUCKETS` (constantes deste módulo), mas
 * o nome é escapado de todo jeito: o custo é zero e tira a correção da
 * responsabilidade de quem chama. O Semgrep ainda aponta
 * `detect-non-literal-regexp` aqui por a regex não ser literal — o prefixo é
 * variável por natureza, já que a função roda para cada bucket legado.
 */
function referencedKeys(json: string, bucket: string): Set<string> {
  const safeBucket = bucket.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`/${safeBucket}/([A-Za-z0-9._\\-/]+)`, 'g')
  const keys = new Set<string>()
  for (const match of json.matchAll(pattern)) {
    const key = match[1]
    // Chave com `/` já é do formato novo (prefixada) — vem pelo prefixo.
    if (key && !key.includes('/')) keys.add(key)
  }
  return keys
}

/**
 * Conteúdo (JSON) do workspace onde uma URL de mídia pode aparecer: seções
 * de landing page, seções de proposta e de modelo de proposta.
 */
async function legacyContentJson(
  client: PrismaClient,
  workspaceId: string,
): Promise<string> {
  const [pageSections, proposalSections, templateSections] = await Promise.all([
    client.crmLandingPageSection.findMany({
      where: { landingPage: { workspaceId } },
      select: { content: true },
    }),
    client.crmProposalSection.findMany({
      where: { proposal: { workspaceId } },
      select: { content: true },
    }),
    client.crmProposalTemplateSection.findMany({
      where: { template: { workspaceId } },
      select: { defaultContent: true },
    }),
  ])

  return JSON.stringify([pageSections, proposalSections, templateSections])
}

/**
 * Tudo o que o workspace tem no MinIO: os buckets prefixados (exaustivo, por
 * prefixo), os anexos do assistente de IA (pela linha) e — best-effort — as
 * mídias legadas de landing page/proposta citadas no conteúdo.
 *
 * A varredura legada é honestamente incompleta: um objeto antigo que ninguém
 * mais referencia (seção apagada, proposta excluída) não tem como ser
 * atribuído a um workspace e fica de fora.
 */
export async function collectWorkspaceFileRefs(
  client: PrismaClient,
  workspaceId: string,
): Promise<WorkspaceFileRefs> {
  const files: WorkspaceFileRef[] = []

  for (const bucket of WORKSPACE_PREFIXED_BUCKETS) {
    for (const object of await listObjects(bucket, `${workspaceId}/`)) {
      files.push({
        bucket,
        key: object.key,
        sizeBytes: object.size,
        legacy: false,
      })
    }
  }

  const attachments = await client.crmAiAttachment.findMany({
    where: { conversation: { workspaceId } },
    select: { storageKey: true },
  })
  if (attachments.length > 0) {
    const wanted = new Set(attachments.map((row) => row.storageKey))
    const conversationPrefixes = new Set(
      [...wanted].map((key) => `${key.split('/')[0]}/`),
    )
    for (const prefix of conversationPrefixes) {
      for (const object of await listObjects(
        CRM_AI_ATTACHMENT_BUCKET,
        prefix,
      )) {
        if (!wanted.has(object.key)) continue
        files.push({
          bucket: CRM_AI_ATTACHMENT_BUCKET,
          key: object.key,
          sizeBytes: object.size,
          legacy: false,
        })
      }
    }
  }

  let missingLegacyKeys = 0
  const json = await legacyContentJson(client, workspaceId)
  for (const bucket of LEGACY_FLAT_BUCKETS) {
    const wanted = referencedKeys(json, bucket)
    if (wanted.size === 0) continue
    // `delimiter: '/'` para varrer só a raiz do bucket (os objetos legados),
    // sem percorrer os prefixos de todos os outros workspaces.
    const sizeByKey = new Map(
      (await listObjects(bucket, '', { delimiter: '/' })).map((o) => [
        o.key,
        o.size,
      ]),
    )
    for (const key of wanted) {
      const size = sizeByKey.get(key)
      if (size === undefined) {
        missingLegacyKeys += 1
        continue
      }
      files.push({ bucket, key, sizeBytes: size, legacy: true })
    }
  }

  return { files, missingLegacyKeys }
}
