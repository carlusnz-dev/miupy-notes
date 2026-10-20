---
name: graphify
description: Use o Graphify local para navegar relações entre símbolos em apps/web/src e apps/api/src, com extração determinística code-only.
---

# Graphify local no miupy-notes

Use Graphify como complemento a buscas direcionadas com `rg` quando uma pergunta depender de relações entre símbolos. Este repositório contém notas e dados pessoais: não varra o diretório raiz e não processe documentos, notas, arquivos `.env*`, credenciais, PDFs, imagens ou vídeos. Não use Graphify Cloud nem qualquer extração semântica por LLM.

## Construir ou atualizar o grafo

Indexe somente os diretórios de código e mantenha os artefatos fora do checkout. `--code-only` seleciona extração AST local; `--no-cluster` evita a etapa de rotulagem.

```sh
graphify extract apps/web/src --code-only --no-cluster --out "$HOME/.cache/miupy-notes/graphify/web"
graphify extract apps/api/src --code-only --no-cluster --out "$HOME/.cache/miupy-notes/graphify/api"
```

Os grafos ficam em `graphify-out/graph.json` dentro de cada pasta de saída. Neste checkout, os caches locais atuais estão em `$HOME/.cache/miupy-notes/graphify/web/graphify-out/graph.json` e `$HOME/.cache/miupy-notes/graphify/api/graphify-out/graph.json`, fora do repositório. Refaça a extração quando o código relevante mudar. Não rode a extração para responder uma pergunta se o grafo existente for suficiente.

## Consultar

Use uma consulta específica e desative o log local de consultas, que pode guardar o texto da pergunta.

```sh
GRAPHIFY_QUERY_LOG_DISABLE=1 graphify query "quais funções chamam authenticate?" --graph "$HOME/.cache/miupy-notes/graphify/api/graphify-out/graph.json" --budget 1000
GRAPHIFY_QUERY_LOG_DISABLE=1 graphify explain "NotesService" --graph "$HOME/.cache/miupy-notes/graphify/api/graphify-out/graph.json"
GRAPHIFY_QUERY_LOG_DISABLE=1 graphify path "NotesController" "DynamoNotesRepository" --graph "$HOME/.cache/miupy-notes/graphify/api/graphify-out/graph.json"
```

Se não houver grafo, ou a resposta indicar falta de relação, leia os arquivos citados e complemente com `rg` direcionado. O grafo é navegação auxiliar e pode não cobrir arquivos sem suporte AST; confirme conclusões importantes na fonte.
