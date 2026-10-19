# Fluxo Git e preferências de interface

Decisões do proprietário em 2026-10-19:

- `main` e `develop` recebem mudanças por PR de branches de trabalho; `develop` nasce de `main`. Sem push direto.
- Revisar PRs com `skills/revisar-pr/SKILL.md` e validar telas por Playwright MCP antes de merge. Falta de ferramenta não equivale a validação aprovada.
- Usar GSAP nas animações de interação, com movimento reduzido respeitado. Grupo de botões com indicador deslizante tipo spring; troca de períodos ease-in-out.
- Menu desktop recolhível e redimensionável até 380 px; perfil e configurações no rodapé.
- Notas em árvore de pastas, mantendo persistência pela API. Aparência local não significa acesso direto ao filesystem ou ao DynamoDB pelo React.
- Edição renderizada como padrão; Markdown fonte acessível por ícone. Toolbar flutuante com blur, borda fina e cantos arredondados. Criar nota abre editor e foca título.
- Tags confirmadas por espaço/Enter; blur descarta rascunho; badge com botão de remoção.

Referência pesquisada: [modos do editor do Obsidian](https://obsidian.md/help/edit-and-read), que distingue Live Preview e fonte. As imagens mencionadas pelo proprietário não estavam disponíveis nesta conversa; a implementação parte das descrições textuais.

CI entrega build web como artifact de revisão, sem publicar aplicação ou infraestrutura. Deploy AWS e empacotamento/release Tauri dependem de configuração própria e não são comprovados por esse build.
