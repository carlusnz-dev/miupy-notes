# Web / Tauri

Frontend React em `src/`, servido pelo Vite. Rotas com `HashRouter` para funcionar dentro do protocolo da janela Tauri; `/` mostra a visão inicial, quatro áreas mostram estado de preparação e qualquer outro caminho cai em 404. Nenhum dado pessoal é carregado nesta etapa.

O tema vem de `styles/tokens.json` e das fontes WOFF2 locais em `src/assets/fonts/` (licenças OFL junto aos arquivos). `App.css` contém o layout e o mesh monocromático; movimento reduzido desativa a animação. Tailwind, GSAP e Zod foram declarados para uso futuro, mas a instalação de pacotes ainda precisa ser concluída neste ambiente.

Da raiz: `npm run dev:web`, `npm run build:web` e `npm run tauri dev`.
