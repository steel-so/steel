# 0035 — API pública v1 e tokens pessoais

- **Status:** Aceita
- **Data:** 2026-10-18
- **Decisores:** product owner + time de engenharia

## Contexto

O `openapi.json` tem mais de mil operações, quase todas feitas para a
interface do app e autenticadas só pelo cookie de sessão. A única chave de
API é a `crm_live_` (workspace, só leads). Um terceiro que automatiza algo no
CI precisa de um contrato estável e de uma credencial que não seja o cookie
do navegador. O MCP resolveu a identidade com OAuth (ADR 0033), mas um token
OAuth exige um cliente registrado e um navegador a cada renovação.

## Decisão

**Existe uma API pública versionada em `/api/v1`, com um recorte curado de
rotas, autenticada por token pessoal (`stl_pat_`). O CLI obtém esse token
pelo fluxo de dispositivo.**

Detalhes para aplicar:

- **Recorte:** `/api/v1` só tem as rotas do contrato (`docs/cli/README.md`).
  As rotas internas continuam livres para mudar. Uma rota v1 reaproveita o
  service existente; nada de regra de negócio nova na camada v1.
- **Contrato estável:** `public/openapi.v1.json` separado, gerado do código e
  verificado no CI: remover um campo, mudar um tipo ou tornar um campo
  obrigatório numa rota v1 falha o build. Campos novos e opcionais podem
  entrar.
- **Depreciação:** uma rota v1 só sai depois de 6 meses com os cabeçalhos
  `Deprecation` e `Sunset` e aviso no changelog de desenvolvedores.
- **Token pessoal (`ApiToken`):** pertence a um usuário e a um workspace, com
  nome, escopos (`api:read`, `api:write`), módulos, validade (padrão 90 dias,
  máximo 1 ano), `lastUsedAt` e revogação. Guardado só como hash; o valor
  aparece uma vez. Criado em Ajustes › Segurança › **Tokens de API**.
- **Resolução:** `Authorization: Bearer stl_pat_...` vale só em `/api/v1`. A
  chamada roda com o `actorId` do dono, então o RBAC (ADR 0013) e o acesso a
  módulos valem como no app. Membro removido, workspace suspenso, token
  revogado ou vencido: 401 na chamada seguinte.
- **Fluxo de dispositivo:** plugin `device-authorization` do Better Auth.
  `steel login` mostra um código; o usuário confirma em `/device` (pt-BR),
  escolhe workspace, módulos e escopo, e o servidor emite um `ApiToken`
  chamado "Steel CLI — <máquina>".
- **Limites:** rate limit por token, além do por usuário.
- **Auditoria:** criação e revogação com `auditAuth`; escritas pela v1 com
  `auditMutation` e `source: 'api'`.

## Consequências

- Quem integra tem um contrato que não quebra a cada deploy.
- O time aceita manter a v1 estável e documentar cada mudança.
- A `CrmIntegrationApiKey` continua para leads; pode ser substituída por um
  `ApiToken` com escopo restrito numa decisão futura.
- O MCP continua com OAuth (ADR 0033); os dois tipos de token aparecem juntos
  em Ajustes › Segurança.
