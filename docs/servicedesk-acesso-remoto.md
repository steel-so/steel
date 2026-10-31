# ServiceDesk — acesso remoto integrado (S4)

Botão **Conectar** no chamado e no ativo da CMDB que abre o RustDesk ou o
AnyDesk, com a sessão registrada no histórico do chamado e na auditoria.

## Modelo

- `SdRemoteSettings` (uma linha por workspace): `enabled` (padrão **desligado**),
  `provider` (`RUSTDESK` | `ANYDESK`) e `linkTemplate` opcional.
- `SdRemoteEndpoint`: o **ID público** da máquina por ativo e provedor
  (`@@unique([configItemId, provider])`). `source` = `MANUAL` ou `INVENTORY`.
- `SdRemoteSession`: cada clique em "Conectar" (usuário, ativo, chamado,
  provedor, ID).

**Nenhuma credencial é guardada.** O link carrega apenas o ID; a autenticação é
feita no cliente RustDesk/AnyDesk do técnico.

## Fluxo

`POST /api/workspaces/{id}/servicedesk/remote/connect` (`configItemId`,
`ticketId?`) exige agente, recurso ligado e um ID para o provedor do workspace.
Grava a sessão, a auditoria (`sd_remote_session` / `connect`) e, quando há
chamado, o evento `remote.session_started` (aparece no histórico). Devolve o
`link` que o navegador abre.

Links: padrão `rustdesk://connection/new/{id}` e `anydesk:{id}`. Um modelo
próprio só pode usar os esquemas `rustdesk`, `anydesk` ou `https` e precisa de
`{id}`; qualquer outro é recusado na validação e ignorado na montagem.

## Inventário (S1)

O relatório do agente aceita `remote: { rustdesk?, anydesk? }`. Os IDs viram
`SdRemoteEndpoint` com origem `INVENTORY` no item de CMDB do equipamento e
**nunca** sobrescrevem um ID digitado à mão. O agente em Go ainda não lê esses
IDs da máquina (ver pendências no PR): hoje o campo é aceito pela API.

## Rotas

`remote/settings` (GET agente, PATCH admin), `remote/endpoints` (GET, PUT),
`remote/endpoints/{endpointId}` (DELETE), `remote/connect` (POST),
`remote/sessions` (GET).

## UI

`app/_components/servicedesk/remote/`: `SdRemoteConnectButton` (barra lateral
do chamado) e `SdRemotePanel` (aba Dados do ativo); aba
**Configurações › Acesso remoto**.
