import type {
  ListResourcesResult,
  ReadResourceResult,
  Resource,
  ResourceTemplate,
} from '@modelcontextprotocol/sdk/types.js'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import type { AppError } from '@/src/errors/app-error'
import { ERROR_CODES } from '@/src/errors/codes'
import type { AiToolAccess } from '@/src/lib/ai/tools/registry'
import type { Result } from '@/src/lib/result'
import { extractSdKbPlainText } from '@/src/lib/servicedesk/sd-kb-text'
import { SdKbArticleService } from '@/src/services/sd-kb-article.service'
import { WikiPageService } from '@/src/services/wiki-page.service'
import type { McpGrant } from './grant'

/**
 * Resources of the MCP server (ADR 0032): published ServiceDesk knowledge
 * base articles and Wiki pages the grant's user can read. Reads go through
 * the domain services, so their access rules (module, RBAC, requester-only
 * portal articles, wiki switch) are the same as in the app.
 */

export const KB_URI_PREFIX = 'steel://servicedesk/kb/'
export const WIKI_URI_PREFIX = 'steel://wiki/pages/'
export const RESOURCES_PAGE_SIZE = 50

/** JSON-RPC code the MCP spec reserves for "resource not found". */
export const RESOURCE_NOT_FOUND_CODE = -32002

const MIME_TYPE = 'text/markdown'

export const MCP_RESOURCE_TEMPLATES: ResourceTemplate[] = [
  {
    uriTemplate: `${KB_URI_PREFIX}{articleId}`,
    name: 'servicedesk_kb_article',
    title: 'Artigo da base de conhecimento',
    description:
      'Artigo publicado da base de conhecimento do ServiceDesk, em Markdown.',
    mimeType: MIME_TYPE,
  },
  {
    uriTemplate: `${WIKI_URI_PREFIX}{pageId}`,
    name: 'wiki_page',
    title: 'Página da Wiki',
    description: 'Página da Wiki do workspace, em Markdown.',
    mimeType: MIME_TYPE,
  },
]

function kbEnabled(grant: McpGrant, access: AiToolAccess): boolean {
  return (
    grant.modules.includes('SERVICE_DESK') &&
    access.modules.includes('SERVICE_DESK')
  )
}

/** Access-type failures (4xx) mean "nothing for you here", not an outage. */
function isClientError(error: AppError): boolean {
  return ERROR_CODES[error.code].status < 500
}

function internal(error: AppError): McpError {
  logger.error(
    'mcp.resource_failed',
    logFields({ component: 'McpServer', message: error.message }),
  )
  return new McpError(ErrorCode.InternalError, 'Falha ao carregar os recursos')
}

/** Entries of one source; access denials become an empty list. */
function entriesOf<T>(result: Result<T[]>): T[] {
  if (result.ok) return result.value
  if (isClientError(result.error)) return []
  throw internal(result.error)
}

async function listKb(grant: McpGrant): Promise<Resource[]> {
  const articles = entriesOf(
    await SdKbArticleService.list(grant.userId, grant.workspaceId, {
      archived: false,
    }),
  )
  return articles
    .filter((a) => a.status === 'PUBLISHED' && a.archivedAt === null)
    .map((a) => ({
      uri: `${KB_URI_PREFIX}${a.id}`,
      name: a.title,
      title: a.title,
      description: 'Artigo da base de conhecimento do ServiceDesk',
      mimeType: MIME_TYPE,
      annotations: { lastModified: a.updatedAt },
    }))
}

async function listWiki(grant: McpGrant): Promise<Resource[]> {
  const pages = entriesOf(
    await WikiPageService.list(grant.userId, grant.workspaceId),
  )
  return pages
    .filter((p) => p.archivedAt === null)
    .map((p) => ({
      uri: `${WIKI_URI_PREFIX}${p.id}`,
      name: p.title || 'Sem título',
      title: p.title || 'Sem título',
      description: 'Página da Wiki',
      mimeType: MIME_TYPE,
      annotations: { lastModified: p.updatedAt },
    }))
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0
  const offset = Number(Buffer.from(cursor, 'base64url').toString('utf8'))
  if (!Number.isInteger(offset) || offset < 0) {
    throw new McpError(ErrorCode.InvalidParams, 'Cursor inválido')
  }
  return offset
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64url')
}

/** `resources/list`, paginated by an opaque offset cursor. */
export async function listMcpResources(
  grant: McpGrant,
  access: AiToolAccess,
  cursor?: string,
): Promise<ListResourcesResult> {
  const offset = decodeCursor(cursor)
  const [kb, wiki] = await Promise.all([
    kbEnabled(grant, access) ? listKb(grant) : Promise.resolve([]),
    listWiki(grant),
  ])
  const all = [...kb, ...wiki]
  const next = offset + RESOURCES_PAGE_SIZE
  return {
    resources: all.slice(offset, next),
    ...(next < all.length && { nextCursor: encodeCursor(next) }),
  }
}

function notFound(uri: string): McpError {
  return new McpError(RESOURCE_NOT_FOUND_CODE, 'Recurso não encontrado', {
    uri,
  })
}

function markdown(title: string, content: unknown): string {
  const body = extractSdKbPlainText(content)
  return body ? `# ${title}\n\n${body}\n` : `# ${title}\n`
}

/** `resources/read`; anything unreadable answers as not found. */
export async function readMcpResource(
  grant: McpGrant,
  access: AiToolAccess,
  uri: string,
): Promise<ReadResourceResult> {
  if (uri.startsWith(KB_URI_PREFIX)) {
    const id = uri.slice(KB_URI_PREFIX.length)
    if (!id || !kbEnabled(grant, access)) throw notFound(uri)
    const article = await SdKbArticleService.getById(
      grant.userId,
      grant.workspaceId,
      id,
    )
    if (!article.ok) {
      if (isClientError(article.error)) throw notFound(uri)
      throw internal(article.error)
    }
    const a = article.value
    if (a.status !== 'PUBLISHED' || a.archivedAt !== null) throw notFound(uri)
    return {
      contents: [
        { uri, mimeType: MIME_TYPE, text: markdown(a.title, a.content) },
      ],
    }
  }

  if (uri.startsWith(WIKI_URI_PREFIX)) {
    const id = uri.slice(WIKI_URI_PREFIX.length)
    if (!id) throw notFound(uri)
    const page = await WikiPageService.getById(
      grant.userId,
      grant.workspaceId,
      id,
    )
    if (!page.ok) {
      if (isClientError(page.error)) throw notFound(uri)
      throw internal(page.error)
    }
    const p = page.value
    if (p.archivedAt !== null) throw notFound(uri)
    return {
      contents: [
        {
          uri,
          mimeType: MIME_TYPE,
          text: markdown(p.title || 'Sem título', p.content),
        },
      ],
    }
  }

  throw notFound(uri)
}
