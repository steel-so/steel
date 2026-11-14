# 0068 — Remover o editor antigo de landing pages e apagar as não migradas

- **Status:** Aceita
- **Data:** 2026-11-14
- **Decisores:** Gustavo Castro (dono do produto)

## Contexto

Desde a onda de Sites (2026-10-15) as landing pages do CRM têm um substituto:
**CRM > Sites**, no Steel Canvas. Um banner na lista de sites e a rota
`POST /api/workspaces/{id}/crm/sites/migrate-landing-pages` convertiam cada
landing page em um site de uma página (`sites.source_landing_page_id`), e o
endereço público `/l/<shareToken>` passou a redirecionar para o site
publicado. O editor antigo (`app/_components/crm/landing-page`), o render
público, a API, os modelos e as tabelas `crm_landing_pages`,
`crm_landing_page_sections` e `crm_landing_page_views` continuaram no
código só para quem ainda não tinha migrado, e as campanhas tinham um
destino `LANDING_PAGE` ao lado de formulário e página de site.

## Decisão

O editor antigo sai por inteiro, **com os dados**. O que não foi migrado para
Sites é apagado; não há nova rota de migração.

- Código: UI, rotas públicas e privadas, API, serviços, repositórios,
  mappers, schemas, hooks, tipos, modelos, fábricas, testes, entradas do
  OpenAPI e documentação do editor antigo.
- Migração `20261114120000_remove_legacy_landing_pages`:
  1. `sites.legacy_landing_share_token` (único, nulo) recebe o `share_token`
     de cada landing page migrada. `/l/<token>` continua resolvendo, sem a
     tabela de landing pages: redireciona para o site publicado que carrega o
     token, ou mostra "Página indisponível".
  2. Campanhas com destino `LANDING_PAGE` passam a apontar para a página
     inicial do site migrado (`SITE_PAGE`); sem site migrado, ficam sem
     destino (`NULL`). O valor `LANDING_PAGE` sai do enum
     `CrmCampaignDestinationType` (o enum é recriado). `LANDING_VIEW` fica em
     `CrmCampaignConversionKind` porque existem linhas antigas, mas nada mais
     o produz.
  3. Remove `crm_campaigns.landing_page_id`, `sites.source_landing_page_id`,
     as três tabelas e os enums `CrmLandingPageStatus` e
     `CrmLandingPageSectionType`. Widgets de painel que liam a fonte
     `landing-pages` são apagados.
- Mantidos de propósito, porque os sites dependem deles: o diretório
  `public/landing-page-templates/` (imagens dos modelos do Sites, citadas
  por URL no conteúdo salvo), os buckets `crm-landing-page-images` e
  `crm-landing-page-videos` (mídias já usadas por sites migrados; seguem na
  biblioteca de mídia, somente leitura) e o recurso de permissão
  `landing-pages`, que passou a significar "Sites" (renomear quebraria os
  perfis salvos). `/:workspace/crm/landing-pages/*` redireciona para
  `/:workspace/crm/sites`.

## Consequências

- Uma árvore de código, um modelo de dados e um editor para páginas do CRM.
- Landing pages não migradas e suas visualizações deixam de existir; não há
  como restaurar fora de um backup anterior à migração.
- A IA de sites perde os depoimentos que vinham das seções de landing page
  (não há outra fonte hoje); o gerador segue funcionando sem eles.
- Campanhas antigas com destino em landing page não migrada ficam sem link
  até o usuário escolher um destino (rascunhos) — campanhas já enviadas
  mantêm os links, que continuam abrindo pelo redirecionamento de `/l/`.
- Revisitar o nome do recurso de permissão `landing-pages` quando houver uma
  migração de perfis planejada.
