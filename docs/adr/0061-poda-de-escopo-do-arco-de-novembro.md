# 0061 — Poda de escopo do arco de novembro (Q1)

- **Status:** Aceita
- **Data:** 2026-10-31
- **Decisores:** dono do produto

## Contexto

O roadmap de novembro previa 48 funcionalidades. Ao fechá-lo, o dono do produto
revisou o que "não tem sentido no produto hoje" e decidiu remover o que não
seria oferecido, em vez de manter código sem uso e sem manual.

## Decisão

Removidos por completo (código, rotas, telas, testes, docs e, quando havia
dados, tabelas por migração):

| Item | Migração / PR |
| --- | --- |
| Push/PWA (VAPID) — E4 | #254 |
| Prospecção com Brave — T5 | #253 |
| Instagram Direct e Messenger no zap — Z5 (ADR 0060) | #259 |
| Catálogo/carrinho e e-commerce (Tray, Nuvemshop, VTEX) — Z8, Z9 | #257 |
| Agendamento público de reuniões e calendário — C5 | #258 |
| RustDesk/AnyDesk e agente de inventário (Windows e Linux) — S4 | #255 |
| Extensão do Chrome — E2 e nó do n8n — E3 | #256 |
| X e LinkedIn no CRM Social | #260 |

Mantidos: cliente MCP (A8) e servidor MCP do Steel, T3, C3, C6, S3, Z10 e o
motor `src/lib/scheduling` (ADR 0059), Z11 (Marketing Messages Lite), Z6
(Coexistência), Pix e boleto via AbacatePay (#261), cobrança de assinatura,
Instagram/Facebook/TikTok/YouTube/Google Ads/Analytics no CRM Social,
sincronização Gmail/Outlook, Apollo, login Google/GitHub, integrações
GitLab/GitHub/Slack e varredura SNMP/CMDB (o valor `AGENT` do enum de origem
permanece por compatibilidade).

## Consequências

- Menos superfície de manutenção e de segurança; o manual do usuário e o
  OpenAPI refletem só o que existe.
- Variáveis `TWITTER_*`/`LINKEDIN_*` podem continuar em `secrets/*.enc.env`
  sem efeito; remova quando convier.
- Pix e boleto (AbacatePay v2) estão prontos e **desligados** até a chave de
  produção; ver `docs/abacatepay-ativacao.md`.
