# 0072 — Geração de sites fiel às referências: captura, blueprints e refino por renderização

- **Status:** Aceita
- **Data:** 2026-11-19
- **Decisores:** Gustavo Castro (dono do produto)

## Contexto

Na geração de sites por IA (ADR 0071) o modelo escolhia entre 13 seções
prontas e só reescrevia o texto; o link de inspiração virava um resumo de
texto. O resultado nunca chegava perto do visual da referência. Pedido de
18/11/2026: ficar o mais próximo possível das referências, mesmo gastando
muitos tokens e vários minutos. O contrato das três frentes está em
`docs/site-ai-fidelity.md`.

## Decisão

Quando há link ou imagem de inspiração, a geração segue um pipeline em
quatro etapas, todas atrás do mesmo stream SSE e do mesmo medidor de uso:

1. **Captura** (worker, Chromium): cada link é aberto em 1440 px e 390 px,
   rolado até o fim, fotografado em faixas e lido do DOM (blocos com estilos
   computados) — `ReferenceCapture`. O app nunca abre o navegador: enfileira
   o job `site-reference-capture` e lê o resultado no Redis (15 min, nunca em
   disco nem no S3).
2. **Análise e blueprints**: um modelo com visão devolve uma `DesignSpec` por
   referência; o plano aponta, para cada seção do site, a seção da referência
   que ela imita; cada seção vira um `SectionBlueprint` (árvore restrita),
   compilado e validado pelo catálogo `site`. Se uma seção falha, entra a
   seção pronta equivalente. Textos, logos e fotos da referência nunca são
   copiados.
3. **Refino por renderização** (esta decisão): o rascunho pronto é
   renderizado, comparado com a referência e as seções divergentes são
   redesenhadas, em até `FIDELITY_MAX_ROUNDS` rodadas (padrão 3).
4. Sem referência, segue o caminho antigo das seções prontas.

### Refino

- **Renderização.** O app guarda o rascunho (páginas, cabeçalho, rodapé,
  tema) no Redis por até 20 min e pede ao worker que capture a rota interna
  `/site-preview/<token>?p=<página>`. É a mesma captura da etapa 1
  (`ReferenceCapture`, faixas desktop e mobile), sem JavaScript na página.
- **Comparação.** Por seção, o modelo com visão recebe as faixas da
  referência e as do rascunho e devolve uma nota de 0 a 100 e a lista de
  diferenças (cores, espaçamento, alinhamento, tamanhos, colunas, ordem,
  ausência/excesso, tipografia) com gravidade e a correção. A posição de cada
  seção do rascunho vem do DOM capturado (filhos do `<main>`); se a conta não
  bate com o plano, a página não é refinada.
- **Correção.** Cada seção abaixo da nota-alvo (`FIDELITY_TARGET_SCORE`, 85) é
  redesenhada pelo mesmo `generateSectionBlueprint`, agora com o blueprint
  anterior, as diferenças e uma imagem do resultado atual. A nova seção
  substitui só a antiga, é validada e renderizada de novo; a troca só fica se
  a nota subir pelo menos 2 pontos, senão é desfeita.
- **Parada.** Todas as notas na meta, nota que deixou de melhorar, rodadas
  esgotadas, tempo (`FIDELITY_REFINE_BUDGET_MINUTES`, 25 min, além dos 20 min
  do desenho) ou cota mensal de IA. Mudanças ainda não conferidas são
  desfeitas ao parar.
- **Falha segura.** Se a renderização ou a comparação falham, o rascunho
  segue sem refino e o usuário recebe um aviso; nada derruba a geração. As
  notas finais vão para o log (`site_ai.refined`) e para a auditoria (só
  números).

### Segurança de rede

Toda requisição do navegador de captura passa pela política do `safe-fetch`
(esquema, host, DNS, portas, redirecionamentos, endereço realmente conectado).
A única exceção é o próprio app: o worker só a aplica a uma URL de prévia cujo
**host é o do app** (`BETTER_AUTH_URL`), cujo caminho é `/site-preview/` e cujo
token é assinado (HMAC com o segredo do app), com validade de 20 min. Nesse caso
o worker abre o app pelo endereço interno (`STATUS_APP_PROBE_URL`) e libera, e
só para essa origem, tudo fora de `/api/`. Qualquer outra URL, inclusive um link
de inspiração digitado pelo usuário, segue a política estrita. A rota de prévia
é pública no proxy porque o token é o acesso, mostra `noindex` e usa a CSP dos
sites.

### Custo

Cada seção comparada custa uma chamada com visão (4 imagens no máximo) e cada
redesenho outra chamada com até 4 imagens, por rodada; um site de 8 seções com
3 rodadas pode passar de 50 chamadas. Todo uso passa pelo medidor existente
(registro por chamada, cota mensal do workspace), e o refino para quando a cota
acaba. `FIDELITY_MAX_ROUNDS=0` desliga o refino.

## Consequências

- O resultado fica bem mais próximo das referências, ao custo de minutos a mais
  e de muitos tokens por geração; o limite de tempo do refino é configurável.
- O app depende do worker (Chromium) também para o refino; sem ele a geração
  termina sem o ajuste fino e com aviso.
- A comparação cobre o desktop; o mobile do rascunho é capturado, mas ainda não
  comparado (a referência não tem posições por seção no mobile).
- Seções com dados do CRM (produtos, depoimentos, contagem) e referências sem
  posição conhecida não são refinadas.
- Revisitar se o tempo total do stream passar do limite do proxy ou se a nota do
  modelo se mostrar instável entre rodadas.
