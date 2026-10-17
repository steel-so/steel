import { getAllEntries } from '@/src/lib/changelog/entries'
import { mcpToolCatalogMarkdown } from '@/src/lib/dev/mcp-tools'
import { getAllDevPages } from '@/src/lib/dev/pages'
import { getAllDocs } from '@/src/lib/docs/pages'
import { buildLlmsFullTxt } from '@/src/lib/seo/llms'

export async function GET() {
  const [entries, docs, dev] = await Promise.all([
    getAllEntries(),
    getAllDocs(),
    getAllDevPages(),
  ])
  return new Response(
    buildLlmsFullTxt(entries, docs, dev, mcpToolCatalogMarkdown()),
    {
      headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
    },
  )
}
