import { describe, expect, it } from 'vitest'
import {
  authenticatedOwner,
  defaultHeaders,
  getJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

async function publishedForm() {
  const { user, workspace } = await authenticatedOwner()
  const created = await (
    await postJson(
      `/api/workspaces/${workspace.id}/crm/forms`,
      {
        name: 'Orçamento',
        action: 'LEAD',
        fields: [
          {
            key: 'nome',
            label: 'Nome',
            type: 'text',
            required: true,
            mapping: { target: 'lead', attribute: 'name' },
          },
          {
            key: 'email',
            label: 'E-mail',
            type: 'email',
            required: true,
            mapping: { target: 'lead', attribute: 'email' },
          },
        ],
      },
      user.cookie,
    )
  ).json()
  await postJson(
    `/api/workspaces/${workspace.id}/crm/forms/${created.data.id}/publish`,
    {},
    user.cookie,
  )
  return { user, workspace, form: created.data }
}

function submit(token: string, values: Record<string, unknown>) {
  return fetch(`${BASE_URL}/api/crm/forms/${token}/submit`, {
    method: 'POST',
    headers: defaultHeaders,
    body: JSON.stringify({ values }),
  })
}

describe('POST /api/crm/forms/{publicToken}/submit — server-side validation', () => {
  it('should answer 422 VALIDATION_ERROR with the field errors and store nothing', async () => {
    const { user, workspace, form } = await publishedForm()

    const res = await submit(form.publicToken, { email: 'nao-e-email' })

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(body.error.details).toEqual([
      {
        code: 'custom',
        path: ['values', 'nome'],
        message: 'Campo obrigatório',
      },
      { code: 'custom', path: ['values', 'email'], message: 'E-mail inválido' },
    ])

    const submissions = await getJson(
      `/api/workspaces/${workspace.id}/crm/forms/${form.id}/submissions`,
      user.cookie,
    )
    expect((await submissions.json()).data).toHaveLength(0)
  })

  it('should accept a valid submission', async () => {
    const { form } = await publishedForm()

    const res = await submit(form.publicToken, {
      nome: 'Carlos Lima',
      email: 'carlos@empresa.com.br',
    })

    expect(res.status).toBe(201)
  })
})
