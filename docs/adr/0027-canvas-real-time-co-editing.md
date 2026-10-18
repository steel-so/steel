# 0027 — Coedição em tempo real do Steel Canvas sobre o servidor realtime da Wiki

- **Status:** Aceita
- **Data:** 2026-10-15
- **Decisores:** fatia s4-coedit (onda Sites S4), com autonomia dada pelo product owner

## Contexto

O editor de sites e o editor de e-mail (Steel Canvas, ADR 0026) salvavam só
por REST (autosave de 1,5 s). Duas pessoas no mesmo documento se
sobrescreviam. A Wiki já edita em tempo real com Yjs num processo próprio
(`realtime/index.ts`, Hocuspocus + Redis), atrás de `/realtime` no nginx e
no Apache de borda da homologação (que precisa de `upgrade=websocket` para
cada caminho novo de WebSocket).

O documento do canvas é normalizado (mapa plano de nós + `children` por id)
e toda mudança passa por uma `CanvasOp` validada pelo catálogo; o store tem
histórico de desfazer próprio, baseado em operações inversas.

## Decisão

Coeditar os documentos do canvas no **mesmo servidor realtime e no mesmo
caminho `/realtime`**, com salas `canvas.<tipo>.<id>` (`site-page`,
`site-global`, `email-template`). Nada muda nos proxies.

- **Modelo Yjs:** `canvas.header` (catálogo, versão, raiz) e `canvas.nodes`
  (id → `Y.Map` com `type`, `props`, `children: Y.Array<id>`, `meta`). As
  props são um mapa **plano por caminho de folha** (`style␟padding␟top`),
  não mapas aninhados: duas pessoas criando caminhos diferentes num objeto
  que ainda não existia mantêm as duas mudanças (mapas aninhados criados ao
  mesmo tempo se substituiriam). Arrays e textos são folhas (o último
  vence).
- **Ida (local → Yjs):** cada mudança do store (op, desfazer/refazer, reset)
  vira uma transação que toca só os nós da op e, dentro deles, só os
  caminhos que mudaram (comparação por identidade, graças ao
  compartilhamento estrutural).
- **Volta (Yjs → local):** a atualização remota é **projetada** num
  documento válido — caminhada determinística da raiz que descarta ids
  pendurados, duplicados (nó movido para dois pais ao mesmo tempo), filhos
  que o pai não aceita ou acima do `maxChildren`, e nós de tipo
  desconhecido ou props inválidas (ficam na última versão boa). O store
  recebe por `applyRemote`, que **não entra no histórico**.
- **Desfazer por usuário:** mantivemos o histórico de ops inversas do store
  em vez do `Y.UndoManager`: ele só contém as ops do próprio usuário e é
  revalidado pelo catálogo ao desfazer. Um passo que não se aplica mais (o
  nó foi removido por outra pessoa) é descartado.
- **Persistência:** o servidor realtime grava pelo **service dono** de cada
  documento (`SitePageService.update`, `SiteGlobalService.update`,
  `CrmEmailTemplateService.update`) — mesma validação, permissão e
  auditoria do REST —, com o debounce do Hocuspocus e sob demanda
  (mensagem `canvas.flush` antes de publicar, versionar ou enviar teste). O
  estado Yjs fica em `canvas_collab_states` com o hash do JSON gravado;
  mudança feita fora da sala (autosave REST de quem estava sem realtime,
  restauração de versão, gerador de IA) é mesclada em três vias ao carregar
  a sala ou quando alguém entra. Documento recusado pelo service é
  revertido na sala para o último gravado.
- **Permissões:** as mesmas dos endpoints REST (membro + módulo CRM +
  `landing-pages`/`email`); quem só tem VIEW entra somente leitura.
- **Fallback:** sem sincronizar em 5 s (ou ao cair), o editor mostra "Sem
  colaboração em tempo real" e volta ao autosave REST; ao reconectar, o Yjs
  mescla o que foi editado.

## Consequências

- Duas pessoas editam o mesmo site ou e-mail sem se sobrescrever; presença
  (avatares, contorno colorido da seleção, trava do texto em edição) vem
  da awareness do Yjs.
- O realtime passa a empacotar os services de sites e de e-mail (inclui a
  renderização do e-mail): o bundle cresce.
- Regras do catálogo que a projeção não cobre (`unique`, `required`,
  `minChildren`) só são verificadas ao gravar: um conflito raro desses
  reverte as mudanças da janela de debounce (~2 s).
- O hash usa JSON com chaves ordenadas: qualquer gravação fora da sala
  (mesmo de conteúdo igual) conta como mudança externa e é mesclada.

## Atualização (2026-10-18)

Duas correções encontradas ao revisar a ADR contra o código; a decisão acima
continua valendo.

- **Desfazer com comparar-e-gravar.** O texto acima diz que o histórico "só
  contém as ops do próprio usuário", mas não bastava: desfazer reaplicava o
  valor anterior de uma prop mesmo quando outra pessoa tinha mudado o mesmo
  campo depois, e apagava a mudança dela. Agora cada passo guarda, por nó e
  por campo (caminho de prop ou chave de meta), o valor que ele deixou no
  documento (`src/lib/canvas/history-guard.ts`). Ao desfazer ou refazer, só
  são regravados os campos que ainda têm esse valor (comparação
  estrutural); os outros ficam como estão, o resto do passo se aplica e o
  editor avisa ("Parte do desfazer foi ignorada porque outra pessoa alterou
  o mesmo campo."). Um passo sem nada a aplicar sai do histórico. Ops
  estruturais (inserir, remover, mover) seguem a regra anterior: valem as
  regras do catálogo no replay e o passo que não se aplica é descartado.
- **Hash.** A última consequência acima está errada. O hash
  (`documentHash` em `src/services/canvas-collab.service.ts`) é SHA-256 do
  JSON com **chaves ordenadas** (e chaves `undefined` omitidas) justamente
  para que uma gravação fora da sala com o **mesmo conteúdo** dê o mesmo
  hash e **não** conte como mudança externa — o `jsonb` do Postgres
  reordena as chaves, e sem a ordenação toda leitura pareceria diferente.
  Só conteúdo diferente dispara a mesclagem em três vias. O código está
  certo e foi mantido. Exceção: um template de e-mail ainda em v1,
  convertido ao abrir a sala, fica com hash vazio, para que a primeira
  gravação sempre o salve como v2 (a conversão é determinística — ids
  derivados das seções da v1 —, então converter de novo daria os mesmos
  ids).
