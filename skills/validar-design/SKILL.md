---
name: validar-design
description: Validar visualmente telas e navegação do miupy-notes quando houver UI renderizável e navegador MCP disponível.
---

# Validar design

Abra o app no navegador pelo Playwright MCP configurado em `.mcp.json`. Verifique uma largura desktop e uma móvel, página inicial e 404, foco por teclado, contraste perceptível, overflow e `prefers-reduced-motion`. Compare com `styles/tokens.json` e `styles/referencias.json`. Registre achados com URL, largura, ação e efeito observado; anexe captura apenas se a ferramenta permitir. Se o MCP não iniciar, declare a validação não executada e a causa. Não simule resultado visual por leitura de CSS.
