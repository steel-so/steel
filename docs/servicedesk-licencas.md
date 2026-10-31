# ServiceDesk — gestão de licenças de software (S7)

Pool de licenças comparado com o software instalado do inventário (S1),
conformidade, e avisos de vencimento ligados à CMDB.

## Modelo

- `SdSoftwareLicense`: nome, fornecedor, `matchPattern`, `seats`, custo unitário
  (centavos), compra, `expiresAt` (data de calendário), `renewalNoticeDays`,
  `lastNoticeKind`/`lastNoticeAt` (dedupe dos avisos) e `archivedAt`.
  **Nenhuma chave de licença é guardada.**
- `SdSoftwareLicenseAsset`: ativo da CMDB coberto pela licença
  (`@@unique([licenseId, configItemId])`).

## Conformidade

`src/lib/servicedesk/license.ts` (puro). **Instalados** = equipamentos do
inventário (geridos, não ignorados, não mesclados) com algum software cujo nome
contém `matchPattern` (sem diferenciar maiúsculas), contados uma vez por máquina.

- `fit`: `UNDER_LICENSED` (instalados > licenças), `OVER_LICENSED` (sobrando) ou
  `COMPLIANT`.
- `expiryState`: `NONE`, `OK`, `EXPIRING` (dentro de `renewalNoticeDays`) ou
  `EXPIRED`. O "hoje" é o dia de calendário em `America/Sao_Paulo`.
- `status` único: `EXPIRED` > `UNDER_LICENSED` > `EXPIRING` > `OVER_LICENSED` >
  `COMPLIANT`.
- A atribuição de ativos **não altera** a conformidade; ela marca quais
  equipamentos instalados ainda estão sem licença atribuída.

## API

`app/api/workspaces/[id]/servicedesk/licenses` (GET lista + resumo, POST),
`/{licenseId}` (GET detalhe, PATCH, DELETE arquiva), `/{licenseId}/restore`,
`/{licenseId}/assets` (PUT substitui o conjunto) e
`config-items/{itemId}/licenses`. Leitura: agentes; escrita: admins do módulo
(`sd-settings` × `EDIT`).

## Aviso de vencimento

Job `license-expiry` na fila `servicedesk-inventory`, diário às 07:00
(`ServicedeskLicenseExpiryCron`). `SdLicenseService.runExpiryTick` reserva o
aviso com um `updateMany` condicional em `lastNoticeKind` (`NOTICE` ao entrar na
janela, `EXPIRED` ao vencer; vencidas há mais de 30 dias não avisam) e só então
notifica donos e admins pelo evento `license.expiring` (`SD_LICENSE_EXPIRING`,
canal in-app). Editar `expiresAt` ou `renewalNoticeDays` zera o carimbo.

## Fora do escopo

Licenças por usuário/assinatura em nuvem (só por máquina), importação do
contrato, custo total de propriedade e vínculo a contratos do módulo.
