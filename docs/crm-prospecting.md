# Agente de prospecção e enriquecimento (T5)

Visão do usuário em `content/docs/crm/agente-de-prospeccao.mdx`. API em
`src/openapi/paths/crm/prospecting.ts` (tag "CRM · Leads").

## O que é

Um preset de Steel Agent (A1/A8 já na `main`) com ferramentas novas no
registro do Steel AI. O agente pesquisa a conta na web, completa dados com o
CNPJ (C2) e a Apollo, detecta sinais de compra e grava um **rascunho** de
primeiro contato. A plataforma **nunca envia** o rascunho: uma pessoa aprova e
envia por fora (`mailto:` / `wa.me`) e marca como enviado.

## Peças

- Ferramentas (`src/lib/ai/tools/crm/prospecting.ts`, módulo CRM):
  `crm_web_search`, `crm_web_fetch`, `crm_prospect_lookup_cnpj`,
  `crm_prospect_find_contacts` (leitura); `crm_prospect_enrich_company`
  (UPDATE, só preenche vazio) e `crm_prospect_save_draft` (CREATE, não é
  `customerFacing`: nada sai do workspace). Aparecem também no MCP público,
  com a mesma trava (chave do workspace desligada = recusa).
- Serviço: `src/services/crm-prospecting.service.ts`. Toda ferramenta passa
  por ele: autorização, chave do workspace, cota mensal e auditoria.
- Web: `src/lib/prospecting/web-fetch.ts` (SSRF: mesmo guard dos webhooks,
  ADR 0036, `checkWebhookUrl`; redirecionamentos manuais, no máximo 3, cada salto
  revalidado; corpo lido em stream com teto de 1,5 MB; só tipos de texto) e
  `web-search.ts` (interface `WebSearchProvider`; padrão Brave Search via
  `WEB_SEARCH_API_KEY`; sem chave a busca responde
  `CRM_PROSPECT_SEARCH_NOT_CONFIGURED`).
- Sinais: `src/lib/prospecting/signals.ts`, regras determinísticas + termos do
  workspace. O texto da página volta ao modelo dentro de `<untrusted_content>`
  e, se `scanPromptInjection` pontuar, com um aviso.
- Preset: `src/lib/prospecting/agent-preset.ts`. Fica fora da galeria de
  modelos (`agent-templates.ts`) porque ela tem teto de tamanho próprio.
  Gatilhos: `MANUAL` (atribuição do lead ao agente, A1) ou `EVENT`
  `crm.lead.created`. Leituras em AUTO; gravações em APPROVAL.

## Modelo de dados

- `crm_prospecting_settings` (1 por workspace; sem linha = tudo desligado):
  `enabled`, `monthly_web_limit` (300), `monthly_draft_limit` (100),
  `allowed_channels`, `value_proposition`, `signal_keywords`.
- `crm_prospect_usage` (workspace × mês UTC): contadores `searches`, `fetches`,
  `drafts`. A cota de web soma buscas e leituras.
- `crm_prospect_drafts`: `PENDING → APPROVED → SENT` ou `PENDING → REJECTED`.
  Sem FK para lead/empresa/pessoa (o rascunho sobrevive à mesclagem); os ids
  são validados no workspace ao salvar. Um rascunho pendente por lead (ou
  empresa) e canal.

## Decisões

- Chave desligada por padrão; a cota é checada antes da chamada e a chamada que
  falha também conta (custa uma requisição).
- O rascunho é gravado em APPROVAL no agente **e** passa pela fila de revisão
  humana: a primeira aprovação (cartão do Steel Agents) libera o texto a ser
  salvo, a segunda (fila de Prospecção) libera o envio. O admin pode passar o
  salvar-rascunho a AUTO na edição do agente, mantendo só a revisão humana.
- Sem envio automático por canal conectado (e-mail do CRM / WhatsApp): fica
  para uma evolução, com cadências (C1) como destino natural.
- Auditoria: entidades `crm_prospecting_settings`, `crm_prospect_draft`,
  `crm_prospect_web` (só o host da página, nunca a URL completa).
