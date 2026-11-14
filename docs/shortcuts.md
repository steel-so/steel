# Atalhos de teclado

O Steel tem um registro único de atalhos. Tudo que o usuário vê no cheat
sheet (`?` ou `Ctrl+/`, também em **Ajuda → Atalhos do teclado**), nas dicas
de tooltip/menu e na paleta `Ctrl+K` sai do mesmo lugar.

## Peças

| Arquivo | O que faz |
| ------- | --------- |
| `src/lib/shortcuts/registry.ts` | Lista de atalhos (`SHORTCUTS`): `id`, teclas, escopo, grupo do cheat sheet, rótulo pt-BR e flags. Também os escopos (`SHORTCUT_SCOPES`) e quem pode estar montado junto. |
| `src/lib/shortcuts/keys.ts` | Notação (`mod+k`, `g c`, `alt+shift+arrowdown`), leitura do `KeyboardEvent` (Alt pelo `code`, Shift implícito em `?`/`#`, IME/teclas mortas ignoradas) e exibição (`Ctrl` × `⌘`). |
| `src/lib/shortcuts/matcher.ts` | Casamento puro: sequências (1 s), prioridade de escopo, guarda de digitação, diálogo aberto, editor rico e a preferência "Atalhos de uma tecla". |
| `src/lib/shortcuts/conflicts.ts` | Checagens estáticas que rodam no teste unitário. |
| `src/lib/shortcuts/quick-send.ts` | Preferência "Envio rápido" (Enter × Ctrl+Enter) dos composers. |
| `app/_components/shortcuts/shortcuts-provider.tsx` | Provider (um único `keydown` na `window`) e o hook `useShortcut(id, handler, { enabled, ref })`. |
| `app/_components/shortcuts/workspace-shortcuts.tsx` | Montado no layout do workspace: provider com as preferências do usuário, navegação `G → …`, criação `C → …`, `Ctrl+I`, `Ctrl+Enter`, `Ctrl+S`, `Esc`, `Shift+L` e o cheat sheet. |
| `app/_components/shortcuts/use-list-shortcuts.ts` | Comportamento comum de listas, tabelas e kanban (`J`/`K`, `Enter`/`O`, `X`, `Shift+J/K`, `Ctrl+A`, `Esc`, `/`, `F`, `N`, `E`, `#`, `V`, `←`/`→`, `Shift+←/→`). |
| `app/_components/shortcuts/route-shortcuts.tsx` | Sequências `G → …` de cada módulo, passadas como dados pelo layout. |
| `app/_components/shortcuts/shortcut-kbd.tsx` | `<ShortcutKbd id>` e `<ShortcutHint id>` para botões, menus e tooltips. |

## Regras

- Teclas simples (sem Ctrl/Alt/⌘) nunca disparam com o foco num campo
  (`input`, `textarea`, `select`, `contenteditable`) nem durante composição
  de acento/IME. `Esc` num campo tira o foco e devolve as teclas simples.
- Com um diálogo ou menu aberto, só disparam os atalhos do próprio diálogo
  (passe `ref` de um elemento dentro dele para `useShortcut`) e os marcados
  com `allowInDialog`.
- Dentro do editor rico (Plate), `Ctrl+K` é link e `Ctrl+I` é itálico; fora
  dele, busca global e "Perguntar ao Steel AI".
- O escopo mais interno vence; no mesmo escopo, o último montado. Um handler
  que devolve `false` passa a tecla adiante (e o navegador mantém o padrão).
- A preferência **Atalhos de uma tecla** (`user_preferences.single_key_shortcuts`)
  desliga teclas simples e sequências (WCAG 2.1.4); os com modificador seguem.
- Nenhum atalho é o único caminho para uma ação.

## Como adicionar um atalho

1. Acrescente a entrada em `SHORTCUTS` (`registry.ts`): `id` único
   (`modulo.tela.acao`), teclas, escopo, grupo e rótulo em pt-BR. Use
   `allowInInput` só para combinações com Ctrl/Alt/⌘ ou `Esc`.
2. Rode `pnpm vitest --project unit src/lib/__tests__/shortcuts-registry.test.ts`.
   O teste reprova teclas repetidas em escopos que podem estar na mesma tela
   (use `shadows` quando a sobreposição for intencional), prefixo de sequência
   que também é tecla simples, combinações reservadas do navegador/SO
   (`Ctrl+W/T/N/…`, `Ctrl+1–9`, `Alt+←/→`, `⌘Q`…) e qualquer `Ctrl+Alt`
   (é o AltGr do ABNT2).
3. No componente dono da ação: `useShortcut('id', handler, { enabled })`.
   Para listas, prefira `useListShortcuts` e marque as linhas com
   `data-shortcut-row` (e `data-shortcut-href`/`data-shortcut-column` quando
   couber).
4. Mostre a tecla onde a ação aparece: `<ShortcutKbd id='…' />` no botão ou
   item de menu, `<ShortcutHint id='…' />` no tooltip.
5. Atalhos que um componente trata sozinho (editor, composer) entram no
   escopo `editor`: aparecem no cheat sheet e nunca são despachados.
   Os editores visuais (Steel Canvas: Sites, e-mail e Documentos) usam o
   escopo `editor.canvas` (`canvas.save`, `canvas.undo`, `canvas.redo`,
   `canvas.copy/cut/paste/duplicate/delete`, `canvas.select-*`, `canvas.move`,
   `canvas.edit-text` e `canvas.zoom-*`). Também são só documentação: quem
   trata as teclas é `app/_components/canvas/use-shortcuts.ts`
   (`handleEditorKey`), que escuta a janela e o iframe do canvas. As dicas da
   barra de cima (`Desfazer (Ctrl+Z)`, `Ajustar à tela`) saem do registro por
   `app/_components/canvas/lib/shortcut-hint.ts`. Ficam fora do registro:
   `Ctrl+A` (selecionar o mesmo nível), as setas que movem 1 px (10 px com
   Shift) um elemento de posição livre e os modificadores do redimensionamento
   (`Shift` mantém a proporção, `Alt` desliga o alinhamento).

Fora do escopo desta entrega (backlog P3 e remapeamento por usuário): veja a
proposta da fatia `keyboard-shortcuts`.
