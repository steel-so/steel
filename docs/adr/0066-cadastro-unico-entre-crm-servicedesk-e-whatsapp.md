# 0066 — Cadastro único: vínculo opcional entre CRM, ServiceDesk e WhatsApp

- **Status:** Aceita
- **Data:** 2026-11-13
- **Decisores:** Gustavo Castro (dono do produto), com a onda `ux2`

## Contexto

O mesmo cliente existe em até quatro tabelas sem ligação entre elas:
`CrmCompany` e `CrmPerson` (CRM), `SdCustomer` e `SdContact` (ServiceDesk) e
`WhatsAppContact` (Comunicação). Hoje o casamento é feito em texto, em lugares
diferentes: CNPJ ou nome exato em `crm-health-signals.repository.ts`, chave de
telefone (DDD + últimos 8 dígitos, `phoneMatchKey`) em `phone-call-link` e
`crm-lead-contact-sync`, e-mail em `crm-duplicate.service.ts`. Isso tem três
problemas: o usuário não consegue ver nem corrigir o casamento, dois cadastros
com nome parecido são ligados por engano sem aviso, e cada tela nova (Visão
360, chamado a partir da conversa) reimplementa a regra.

## Decisão

Três chaves estrangeiras **opcionais**, todas `ON DELETE SET NULL`:

- `SdCustomer.crmCompanyId` → `CrmCompany`;
- `SdContact.crmPersonId` → `CrmPerson`;
- `WhatsAppContact.crmPersonId` → `CrmPerson`.

Não há FK de `WhatsAppContact` para empresa: a empresa do contato é a da
pessoa do CRM. Nenhuma coluna é obrigatória e nenhum módulo passa a depender
do CRM: com o CRM desligado, os campos ficam nulos e tudo funciona como antes.

**Resolução.** O `CustomerLinkService` (`src/services/customer-link.service.ts`)
concentra a regra. `resolve({ workspaceId, companyId? | personId? | phone? |
cnpj? | sdCustomerId? })` devolve a empresa, a pessoa e os cadastros ligados
nos três módulos, cada um com `origin`: `link` (FK gravada) ou `fallback`
(casamento por texto). O vínculo gravado sempre vence; o texto só vale para
quem não tem vínculo. `resolve` não checa permissão (o chamador já autorizou);
`resolveForActor`, usado pela rota, exige CRM e só inclui as partes do
ServiceDesk e do WhatsApp que o usuário pode ver.

**Retroalimentação (backfill).** A migração preenche os vínculos que são
inequívocos, de forma idempotente (só linhas ainda sem vínculo): cliente do
ServiceDesk por CNPJ (14 dígitos), contato do ServiceDesk por e-mail e depois
por chave de telefone, contato do WhatsApp por chave de telefone. Quando mais
de um registro do CRM casa, **nada é gravado**: a ambiguidade vira sugestão na
tela, não vínculo automático.

**Correção pelo usuário.** Nas telas de cliente e de contato do ServiceDesk
aparece o painel "Cadastro no CRM": vínculo atual, sugestões (mesmo CNPJ,
nome, e-mail ou telefone) com "Vincular" e "Desvincular" (com confirmação).
Rotas em `app/api/workspaces/[id]/crm/customer-links/{suggestions,resolve}` e
`POST`/`DELETE` na raiz. Vincular exige edição no CRM (`companies` ou
`people`) e acesso de agente ao módulo de origem; toda alteração é auditada
(`customer_link`).

## Consequências

- Qualquer tela nova chama um único resolvedor em vez de reimplementar o
  casamento; a Visão 360 e o chamado a partir da conversa passam a usá-lo.
- Desvincular não impede o casamento por texto: se o CNPJ, e-mail ou telefone
  ainda coincidem, o `fallback` volta a relacioná-los. A tela avisa isso. Se
  for preciso um "nunca vincular", isso exige uma coluna de supressão (não
  feita agora).
- O texto continua duplicado em SQL (chave de telefone) no repositório do
  vínculo e nos que já existiam; unificá-los fica para uma limpeza futura.
- O contato do WhatsApp só ganha vínculo por pessoa; a conversa de contatos
  identificados só por BSUID não casa por telefone até o número aparecer.
- A tela de contato do WhatsApp (`zap`) ainda não mostra o painel
  (`CustomerLinkPanel kind="whatsapp-contact"` está pronto para ser usado).
