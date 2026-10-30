# Enriquecimento por CNPJ (CRM)

Preenche e guarda o perfil da Receita Federal de cada `CrmCompany`.

## Como funciona

- **Fonte**: interface `CnpjProvider` (`src/lib/cnpj/provider.ts`). O padrão é a BrasilAPI (base pública da Receita, sem chave, limitada por IP). Trocar por um provedor pago é implementar a interface e alterar `getCnpjProvider()`.
- **Dados**: tabela `crm_company_enrichments` (1:1 com a empresa, atualizada no lugar): razão social, fantasia, CNAE principal e secundários, porte (ME/EPP/DEMAIS), natureza jurídica, situação, abertura, capital e sócios (nome, qualificação, entrada; nenhum CPF). Nome e endereço da própria empresa só são preenchidos quando vazios (ou com `overwrite`); o nome provisório `Empresa 00.000.000/0000-00` conta como vazio.
- **Uma empresa**: `POST /api/workspaces/{id}/crm/companies/{companyId}/enrichment` (permissão `companies` x `EDIT`). Prévia sem gravar: `POST .../companies/cnpj-lookup`.
- **Base inteira**: `POST .../companies/enrichment-runs` (OWNER/ADMIN) cria uma linha em `crm_cnpj_enrichment_runs` e enfileira `crm-cnpj-enrichment` (`attempts: 1`). O worker (`CrmCnpjEnrichmentRunner`) percorre as empresas com CNPJ em páginas de 25, uma chamada a cada 400 ms, recua 30 s x tentativa em 429 (até 3 vezes) e grava os contadores a cada página. Uma execução ativa por workspace.
- **Cancelar** (`nov_ai_crm_followups`): `POST .../companies/enrichment-runs/{runId}/cancel` (OWNER/ADMIN). Cancelamento **cooperativo**: uma execução `QUEUED` vira `CANCELED` na hora; uma `RUNNING` só recebe `cancel_requested_at` (a API expõe `cancelRequested`) e o runner lê o flag **entre duas empresas** (`isCancelRequested`), termina a que está em curso, grava os contadores e fecha como `CANCELED`. Uma execução já terminada responde `CRM_CNPJ_RUN_NOT_CANCELABLE` (409). O que foi enriquecido antes do cancelamento fica guardado. A tela tem o botão **Cancelar** na linha da execução ativa.
- **Aviso no fim**: `CRM_CNPJ_ENRICHMENT_FINISHED` (`src/services/crm-cnpj-notifications.ts`) para quem iniciou a execução, ao concluir, cancelar ou falhar (resumo com consultadas, atualizadas, sem registro e falhas; link `/<slug>/crm/companies`; `dedupeKey crm-cnpj-run:<id>`).
- **Busca em linguagem natural**: a pergunta "empresas de alimentos…" usa `enriched` e `activityContains` (CNAE da Receita) — ver `docs/crm-busca-natural-e-conectar-ia.md`.
- **Auditoria**: entidade `crm_cnpj_enrichment` (por empresa e por execução; `cancel` ao cancelar).

## Operação

- Fila `crm-cnpj-enrichment` aparece no Workbench (`/jobs`).
- Execução travada em `RUNNING` após queda do worker: iniciar outra só é possível depois que a anterior terminar; marcar a linha como `FAILED` (ou pedir o cancelamento na tela, se o worker voltar) libera.
- O limite de consultas da BrasilAPI é por IP do servidor; muitas consultas manuais durante uma execução podem causar 429 (o runner espera e tenta de novo).
