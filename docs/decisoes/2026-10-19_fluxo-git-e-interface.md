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

## Ajustes durante o teste do proprietário

- Títulos de página e de nota devem usar a serif principal com escala consistente; corpo/labels permanecem sans. Corrigir select sem texto legível na janela Tauri com componente reutilizável. Confirmação de exclusão da nota deve ser modal, com fade-in e deslocamento Y por GSAP.
- A referência escrita “Vogue” identifica Lenora na imagem. O proprietário informou não possuir licença e pediu Silvex pessoal e uma alternativa semelhante à Lenora. Silvex demo fica local e ignorada no Git; WOFF2 somente se os termos permitirem conversão. Alternativa em avaliação: Bodoni Moda (OFL 1.1), com acentos pt-BR e assets locais. Não baixar fontes comerciais de CSS de terceiros.
- Fontes consultadas: [Silvex](https://www.dafontfree.io/silvex-editorial-font-family/), [Lenora](https://superiortype.com/fonts/lenora), [EULA webfont Lenora](https://superiortype.com/licensing/webfont-eula), [Bodoni Moda OFL](https://github.com/google/fonts/blob/main/ofl/bodonimoda/OFL.txt). Esses registros são decisões/preferências; não comprovam incorporação das fontes antes do código e da validação.
