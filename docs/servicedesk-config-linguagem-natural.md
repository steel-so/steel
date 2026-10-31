# ServiceDesk — configuração em linguagem natural (S8)

O admin descreve uma política de SLA, uma regra de automação ou de escalonamento
e a IA monta a configuração. A prévia nunca grava.

## Fluxo

1. `POST /api/workspaces/{id}/servicedesk/nl-config/preview` `{ kind, text, targetId? }`.
   `SdNlConfigService.preview` exige admin do módulo e `SdSettings.aiEnabled`,
   carrega os nomes/ids de referência (prioridades, calendários, departamentos,
   categorias, fases, usuários) e chama o modelo via `AiUsageService.prepare`
   (feature `SERVICEDESK_COPILOT`, cota mensal do ADR 0007).
2. O modelo devolve um envelope estrito `{ understood, summary, warnings, configJson }`.
   O `configJson` é validado com o schema de **criação** do tipo
   (`CreateSdSlaPolicySchema`, `CreateSdAutomationRuleSchema`,
   `CreateSdEscalationRuleSchema`) e as referências são conferidas com
   `assertSdRefs`. Ids inventados recusam a prévia (`SD_NL_CONFIG_INVALID`).
3. A resposta traz a descrição legível, os avisos e, com `targetId`, o diff campo a campo.
4. `POST .../nl-config/apply` `{ kind, targetId?, config }` revalida o corpo no
   schema de criação e chama o `create`/`update` do service do tipo (autorização
   e auditoria dele), mais a auditoria `sd_nl_config`.

## Decisões

- Sem tabela nova: a prévia é sem estado; o cliente devolve o `config` no `apply`.
- A configuração viaja como texto JSON dentro do envelope porque o modo estrito
  do provedor não aceita a união discriminada das ações.
- Privacidade: o modelo recebe só o texto e nomes de referência, nunca dados de chamados.
- Ajuste de política padrão não envia `isDefault=false`.

## Fora do escopo

Regras de outros tipos (campos customizados, modelos de chamado, fluxos), desfazer
depois de aplicar e histórico dos pedidos.
