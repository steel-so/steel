# 0029 — Campanhas apontam para páginas de site; a atribuição acontece no site

- **Status:** Aceita
- **Data:** 2026-10-15
- **Decisores:** fatia campaign-update da leva Sites (autonomia dada pelo product owner)

## Contexto

A campanha multicanal (ADR 0025) levava o contato a uma landing page ou a
um formulário do CRM. Com o construtor de **Sites** (ADR 0026), as landing
pages migram para sites de várias páginas, os formulários do CRM entram nas
páginas pelo elemento `site.form`, os templates de e-mail ganham o editor
novo (v2, com "Mostrar se" e checklist) e os templates da Meta ganham
qualidade e botões com ações. O assistente da campanha precisava refletir
tudo isso sem refazer a execução.

## Decisão

- **Destino `SITE_PAGE`.** A campanha guarda `siteId` + `sitePageId`. Só a
  versão **publicada** conta: o link nunca aponta para uma página que o
  visitante não abre. O endereço sai de `publicSiteUrl` (subdomínio com
  `SITES_ROOT_DOMAIN`, senão `/s/<slug>`) — domínio próprio, quando vier, só
  muda esse helper. Landing pages antigas continuam como destino enquanto
  não forem migradas ("Landing page antiga").
- **Atribuição no site.** O redirecionador assinado continua igual e anexa
  `utm_*` + `stc`. O runtime público manda o `stc` junto com a visita (que
  já respeita o aviso de cookies); a visita vira `SITE_VIEW`, **uma por
  visitante, página e dia** (chave = hash diário do visitante + página). O
  `site.form` manda o `stc` **só quando o site não pede consentimento ou o
  visitante aceitou**; `utm_campaign` vai sempre (dado agregado), junto com
  o slug do site e a página — o envio vira `SITE_FORM_SUBMISSION`, com o id
  do envio como chave de idempotência.
- **Quem casa com quem.** Visita de qualquer página do site da campanha
  conta (o visitante pode chegar por um link do menu); converte o
  destinatário a visita da página escolhida ou um formulário enviado. Um
  formulário do CRM enviado de uma página de site também conta para a
  campanha cujo destino é esse formulário.
- **Conteúdo.** Erros do checklist do e-mail (`emailChecklist`) bloqueiam o
  envio; avisos aparecem no "Revisar e enviar". Cada destinatário é
  renderizado com o perfil da pessoa do CRM (variáveis e "Mostrar se").
  Templates da Meta pausados, desativados ou com qualidade vermelha ficam
  bloqueados; no Z-API, uma resposta rápida pode ser o conteúdo — os botões
  de resposta mantêm as ações, e `{link}` na URL de um botão vira o link da
  campanha.
- **Métricas.** O resultado da campanha separa as conversões por destino
  (visita no site, formulário no site, formulário do CRM, landing page
  antiga) e as métricas do site mostram o tráfego por campanha.

## Consequências

- A campanha mede o funil até a página certa do site, sem o usuário montar
  UTMs à mão, e o site mostra de que campanha veio cada visita.
- Uma visita vinda de um link repassado (sem `stc`) ainda conta pela
  `utm_campaign`, sem destinatário.
- Sem consentimento num site com aviso de cookies, nem a visita nem o
  vínculo com o destinatário são registrados — só o envio do formulário,
  ligado à campanha pela `utm_campaign`.
- O botão de URL dinâmico da Meta precisa ter como base
  `…/api/crm/campaigns/c/{{1}}` para cair no destino rastreado; o
  assistente explica isso e já mapeia o código do link.
