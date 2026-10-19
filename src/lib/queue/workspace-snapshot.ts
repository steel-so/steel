import { Prisma, type PrismaClient } from '@prisma/client'

/**
 * Snapshot lógico de um workspace (backup WORKSPACE, restore e exclusão
 * definitiva). Fonte única de "quais linhas pertencem a um workspace":
 *
 * - **Tabelas com `workspaceId`** — descobertas pelo DMMF, então modelo novo
 *   com a coluna entra sozinho.
 * - **Tabelas-filhas sem `workspaceId`** (estágios de pipeline, itens de
 *   oportunidade, destinatários de transmissão...) — só chegam ao workspace
 *   por uma relação. O DMMF de runtime do Prisma 7 não expõe as FKs, então a
 *   lista é explícita; `workspace-snapshot.test.ts` lê o `schema.prisma` e
 *   falha se um modelo-filho novo ficar de fora.
 */

type Where = Record<string, unknown>

/** Delegate (camelCase) → filtro que prende a linha-filha ao workspace. */
export const WORKSPACE_CHILD_MODELS: Record<string, (ws: string) => Where> = {
  projectMember: (ws) => ({ project: { workspaceId: ws } }),
  projectFavorite: (ws) => ({ project: { workspaceId: ws } }),
  whatsAppBroadcastRecipient: (ws) => ({
    broadcastList: { workspaceId: ws },
  }),
  whatsAppGroupParticipant: (ws) => ({ group: { workspaceId: ws } }),
  whatsAppTeamMember: (ws) => ({ team: { workspaceId: ws } }),
  crmPipelineStage: (ws) => ({ pipeline: { workspaceId: ws } }),
  crmOpportunityLineItem: (ws) => ({ opportunity: { workspaceId: ws } }),
  crmLeadInterestProduct: (ws) => ({ lead: { workspaceId: ws } }),
  crmLeadQualification: (ws) => ({ lead: { workspaceId: ws } }),
  crmLeadProposalPresentation: (ws) => ({ lead: { workspaceId: ws } }),
  crmCustomFieldValue: (ws) => ({ definition: { workspaceId: ws } }),
  crmDashboardWidget: (ws) => ({ dashboard: { workspaceId: ws } }),
  crmProposalTemplateSection: (ws) => ({ template: { workspaceId: ws } }),
  crmProposalSection: (ws) => ({ proposal: { workspaceId: ws } }),
  crmProposalView: (ws) => ({ proposal: { workspaceId: ws } }),
  crmFormSubmission: (ws) => ({ form: { workspaceId: ws } }),
  crmAiMessage: (ws) => ({ conversation: { workspaceId: ws } }),
  crmAiAttachment: (ws) => ({ conversation: { workspaceId: ws } }),
  aiMessage: (ws) => ({ conversation: { workspaceId: ws } }),
  aiEvalCase: (ws) => ({ set: { workspaceId: ws } }),
  aiEvalResult: (ws) => ({ run: { workspaceId: ws } }),
  crmEmailCampaignRecipient: (ws) => ({ campaign: { workspaceId: ws } }),
  crmCampaignConversion: (ws) => ({ campaign: { workspaceId: ws } }),
  crmMailingListMember: (ws) => ({ mailingList: { workspaceId: ws } }),
  crmWorkflowVersion: (ws) => ({ workflow: { workspaceId: ws } }),
  crmWorkflowRun: (ws) => ({ workflow: { workspaceId: ws } }),
  crmWorkflowRunStep: (ws) => ({ run: { workflow: { workspaceId: ws } } }),
  crmLandingPageSection: (ws) => ({ landingPage: { workspaceId: ws } }),
  crmLandingPageView: (ws) => ({ landingPage: { workspaceId: ws } }),
  crmSocialConnectionMetricSnapshot: (ws) => ({
    connection: { workspaceId: ws },
  }),
  crmCompetitorMetricSnapshot: (ws) => ({ competitor: { workspaceId: ws } }),
  crmCompetitorPost: (ws) => ({ competitor: { workspaceId: ws } }),
  crmCompetitorIdeaSet: (ws) => ({ competitor: { workspaceId: ws } }),
  crmSocialConnectionPost: (ws) => ({ connection: { workspaceId: ws } }),
  crmScheduledPostTarget: (ws) => ({ post: { workspaceId: ws } }),
  crmScheduledPostMedia: (ws) => ({ post: { workspaceId: ws } }),
  sdDepartmentMember: (ws) => ({ department: { workspaceId: ws } }),
  sdContactCustomer: (ws) => ({ contact: { workspaceId: ws } }),
  sdSlaTarget: (ws) => ({ policy: { workspaceId: ws } }),
  sdTicketParticipant: (ws) => ({ ticket: { workspaceId: ws } }),
  sdTicketFollower: (ws) => ({ ticket: { workspaceId: ws } }),
  sdTicketKbLink: (ws) => ({ ticket: { workspaceId: ws } }),
  sdKbComment: (ws) => ({ article: { workspaceId: ws } }),
  // Fundação da leva de contratos/CAB/plantão (commit 00384d45): modelos-filhos
  // sem `workspaceId` que chegam ao workspace pelo pai.
  sdContractRate: (ws) => ({ contract: { workspaceId: ws } }),
  sdCabMember: (ws) => ({ board: { workspaceId: ws } }),
  sdOnCallLayer: (ws) => ({ schedule: { workspaceId: ws } }),
  sdOnCallParticipant: (ws) => ({
    layer: { schedule: { workspaceId: ws } },
  }),
  // Steel Agents: allowed tools and run timeline hang off agent/run.
  steelAgentTool: (ws) => ({ agent: { workspaceId: ws } }),
  steelAgentRunStep: (ws) => ({ run: { workspaceId: ws } }),
  // Wiki: comments and page labels reach the workspace through the page.
  wikiComment: (ws) => ({ wikiPage: { workspaceId: ws } }),
  wikiPageLabel: (ws) => ({ wikiPage: { workspaceId: ws } }),
  wikiPageFavorite: (ws) => ({ wikiPage: { workspaceId: ws } }),
  // Whiteboard: the version history reaches the workspace through the board.
  whiteboardVersion: (ws) => ({ whiteboard: { workspaceId: ws } }),
  // Site builder: pages, globals, published versions and views of a site.
  sitePage: (ws) => ({ site: { workspaceId: ws } }),
  siteGlobal: (ws) => ({ site: { workspaceId: ws } }),
  siteVersion: (ws) => ({ site: { workspaceId: ws } }),
  siteView: (ws) => ({ site: { workspaceId: ws } }),
  siteRedirect: (ws) => ({ site: { workspaceId: ws } }),
  // Site blog and collections (slice site-blog), parents first.
  siteAuthor: (ws) => ({ site: { workspaceId: ws } }),
  siteBlogCategory: (ws) => ({ site: { workspaceId: ws } }),
  siteBlogTag: (ws) => ({ site: { workspaceId: ws } }),
  sitePost: (ws) => ({ site: { workspaceId: ws } }),
  sitePostCategory: (ws) => ({ post: { site: { workspaceId: ws } } }),
  sitePostTag: (ws) => ({ post: { site: { workspaceId: ws } } }),
  siteCollection: (ws) => ({ site: { workspaceId: ws } }),
  siteCollectionItem: (ws) => ({ collection: { site: { workspaceId: ws } } }),
  siteExperiment: (ws) => ({ site: { workspaceId: ws } }),
  siteExperimentEvent: (ws) => ({
    experiment: { site: { workspaceId: ws } },
  }),
}

/**
 * Modelos com `workspaceId` que NÃO são dado do workspace: registros de
 * plataforma que precisam sobreviver a ele (e nunca entram no snapshot).
 */
const PLATFORM_MODELS = new Set(['Backup', 'AdminOperation'])

const toDelegate = (model: string) =>
  model.charAt(0).toLowerCase() + model.slice(1)

export function workspaceScopedDelegates(): string[] {
  return Prisma.dmmf.datamodel.models
    .filter(
      (model) =>
        !PLATFORM_MODELS.has(model.name) &&
        model.fields.some((field) => field.name === 'workspaceId'),
    )
    .map((model) => toDelegate(model.name))
}

type FindManyDelegate = {
  findMany: (args: { where: Where }) => Promise<unknown[]>
}

export interface WorkspaceSnapshot {
  schemaVersion: 2
  exportedAt: string
  workspaceId: string
  data: { workspace: Record<string, unknown> | null } & Record<string, unknown>
}

export async function gatherWorkspaceData(
  client: PrismaClient,
  workspaceId: string,
): Promise<WorkspaceSnapshot['data']> {
  const workspace = await client.workspace.findUnique({
    where: { id: workspaceId },
  })
  if (!workspace) return { workspace: null }

  const data: WorkspaceSnapshot['data'] = { workspace }
  const delegates = client as unknown as Record<string, FindManyDelegate>

  for (const name of workspaceScopedDelegates()) {
    const delegate = delegates[name]
    if (!delegate?.findMany) continue
    data[name] = await delegate.findMany({ where: { workspaceId } })
  }
  for (const [name, where] of Object.entries(WORKSPACE_CHILD_MODELS)) {
    const delegate = delegates[name]
    if (!delegate?.findMany) continue
    data[name] = await delegate.findMany({ where: where(workspaceId) })
  }

  return data
}

type DeleteManyDelegate = {
  deleteMany: (args: { where: Where }) => Promise<unknown>
}

/**
 * Apaga todas as linhas do workspace (a cascata das FKs cuida das filhas).
 * Oportunidades vão primeiro por precaução: a FK delas para pipeline/estágio
 * é `RESTRICT`; hoje a cascata a partir do workspace resolve, mas apagar
 * explicitamente não depende da ordem em que o Postgres dispara as cascatas.
 */
export async function purgeWorkspaceRows(
  tx: Prisma.TransactionClient,
  workspaceId: string,
): Promise<void> {
  const delegates = tx as unknown as Record<string, DeleteManyDelegate>
  await delegates.crmOpportunity.deleteMany({ where: { workspaceId } })
  await tx.workspace.deleteMany({ where: { id: workspaceId } })
}

type CreateManyDelegate = {
  createMany: (args: { data: unknown[] }) => Promise<unknown>
}

/**
 * Normaliza o workspace do snapshot antes de recriar: um backup tirado no
 * meio de uma exclusão traz `DELETING`, que deixaria o workspace restaurado
 * bloqueado. Suspensão explícita é preservada.
 */
function normalizeWorkspaceRow(
  row: Record<string, unknown>,
): Record<string, unknown> {
  if (row.status === 'SUSPENDED') return row
  return {
    ...row,
    status: 'ACTIVE',
    suspendedAt: null,
    suspendedReason: null,
    suspendedById: null,
  }
}

/**
 * Restaura um snapshot: apaga o estado atual do workspace e recria tudo numa
 * única transação (falhou → nada muda). Tabelas são inseridas em rodadas até
 * todas as FKs estarem satisfeitas.
 */
export async function restoreWorkspaceSnapshot(
  client: PrismaClient,
  snapshot: Pick<WorkspaceSnapshot, 'workspaceId' | 'data'>,
): Promise<{ tables: number; rows: number }> {
  const { workspace, ...tables } = snapshot.data
  if (!workspace) {
    throw new Error('Snapshot sem o registro do workspace.')
  }

  let rows = 0
  const populated = Object.entries(tables).filter(
    ([, value]) => Array.isArray(value) && value.length > 0,
  ) as [string, unknown[]][]

  await client.$transaction(
    async (tx) => {
      await purgeWorkspaceRows(tx, snapshot.workspaceId)
      await tx.workspace.create({
        data: normalizeWorkspaceRow(workspace) as Prisma.WorkspaceCreateInput,
      })

      const remaining = new Map(populated)
      const lastError = new Map<string, string>()
      let madeProgress = true
      while (remaining.size > 0 && madeProgress) {
        madeProgress = false
        for (const [name, data] of [...remaining]) {
          const delegate = (
            tx as unknown as Record<string, CreateManyDelegate>
          )[name]
          if (!delegate?.createMany) {
            remaining.delete(name)
            continue
          }
          // Um createMany fora de ordem (FK ainda não existente) aborta a
          // transação inteira no Postgres até um rollback — savepoint por
          // tentativa isola a falha pra não derrubar as tabelas seguintes.
          await tx.$executeRawUnsafe('SAVEPOINT restore_step')
          try {
            await delegate.createMany({ data })
            await tx.$executeRawUnsafe('RELEASE SAVEPOINT restore_step')
            remaining.delete(name)
            rows += data.length
            madeProgress = true
          } catch (error) {
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT restore_step')
            lastError.set(
              name,
              error instanceof Error
                ? (error.message.split('\n').at(-1) ?? error.message)
                : String(error),
            )
          }
        }
      }

      if (remaining.size > 0) {
        throw new Error(
          `Não foi possível restaurar: ${[...remaining.keys()]
            .map((name) => `${name} (${lastError.get(name) ?? '?'})`)
            .join('; ')}`,
        )
      }
    },
    { timeout: 120_000 },
  )

  return { tables: populated.length, rows }
}
