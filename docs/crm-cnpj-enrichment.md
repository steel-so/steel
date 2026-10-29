# Enriquecimento por CNPJ (CRM)

Preenche e guarda o perfil da Receita Federal de cada `CrmCompany`.

## Como funciona

- **Fonte**: interface `CnpjProvider` (`src/lib/cnpj/provider.ts`). O padrão é a BrasilAPI (base pública da Receita, sem chave, limitada por IP). Trocar por um provedor pago é implementar a interface e alterar `getCnpjProvider()`.
- **Dados**: tabela `crm_company_enrichments` (1:1 com a empresa, atualizada no lugar): razão social, fantasia, CNAE principal e secundários, porte (ME/EPP/DEMAIS), natureza jurídica, situação, abertura, capital e sócios (nome, qualificação, entrada; nenhum CPF). Nome e endereço da própria empresa só são preenchidos quando vazios (ou com `overwrite`); o nome provisório `Empresa 00.000.000/0000-00` conta como vazio.
- **Uma empresa**: `POST /api/workspaces/{id}/crm/companies/{companyId}/enrichment` (permissão `companies` x `EDIT`). Prévia sem gravar: `POST .../companies/cnpj-lookup`.
- **Base inteira**: `POST .../companies/enrichment-runs` (OWNER/ADMIN) cria uma linha em `crm_cnpj_enrichment_runs` e enfileira `crm-cnpj-enrichment` (`attempts: 1`). O worker (`CrmCnpjEnrichmentRunner`) percorre as empresas com CNPJ em páginas de 25, uma chamada a cada 400 ms, recua 30 s x tentativa em 429 (até 3 vezes) e grava os contadores a cada página. Uma execução ativa por workspace.
- **Auditoria**: entidade `crm_cnpj_enrichment` (por empresa e por execução).

## Operação

- Fila `crm-cnpj-enrichment` aparece no Workbench (`/jobs`).
- Execução travada em `RUNNING` após queda do worker: iniciar outra só é possível depois que a anterior terminar; marcar a linha como `FAILED` no banco libera.
- O limite de consultas da BrasilAPI é por IP do servidor; muitas consultas manuais durante uma execução podem causar 429 (o runner espera e tenta de novo).
