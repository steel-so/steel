import { z } from 'zod'
import { aiSkillNotFound, validationError } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'
import type { SteelAiTool } from '../tools/types'
import {
  enabledSkillsFor,
  pickSkillBySlug,
  skillInstructionsForModel,
} from './skill-catalog'
import { GET_SKILL_TOOL_NAME, normalizeSkillSlug } from './skill-command'

const Args = z.object({
  slug: z.string().trim().min(1).max(41).transform(normalizeSkillSlug),
})

/**
 * Platform READ tool: the instructions of an enabled skill the caller can
 * see. Lets the model follow a skill it picked from the catalog, and lets a
 * Steel Agent whose instructions mention "/<slug>" load it.
 */
export const getSkillTool: SteelAiTool<z.infer<typeof Args>> = {
  name: GET_SKILL_TOOL_NAME,
  label: 'Abrindo skill',
  module: null,
  kind: 'READ',
  description:
    'Devolve as instruções de uma skill do Steel AI habilitada no workspace, pelo comando (ex.: "my-work" para /my-work). Use quando o pedido citar uma skill ou corresponder a uma delas; depois siga as instruções devolvidas. Comando desconhecido devolve erro.',
  parameters: {
    type: 'object',
    properties: {
      slug: {
        type: 'string',
        description: 'Comando da skill, sem a barra (ex.: "my-work").',
      },
    },
    required: ['slug'],
    additionalProperties: false,
  },
  parse(args): Result<z.infer<typeof Args>> {
    const parsed = Args.safeParse(args ?? {})
    if (parsed.success) return ok(parsed.data)
    return err(
      validationError(
        'Argumentos inválidos para a ferramenta',
        parsed.error.issues,
      ),
    )
  },
  async execute(ctx, args) {
    const skills = await enabledSkillsFor(ctx.workspaceId, ctx.actorId)
    if (!skills.ok) return skills
    const skill = pickSkillBySlug(skills.value, args.slug)
    if (!skill) return err(aiSkillNotFound())
    return ok({
      summary: `/${skill.slug} — ${skill.name}`,
      data: {
        slug: skill.slug,
        name: skill.name,
        instructions: skillInstructionsForModel(skill),
      },
    })
  },
}

export const SKILL_AI_TOOLS = [getSkillTool] as const
