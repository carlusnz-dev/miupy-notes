---
name: revisar-pr
description: Revisar PR ou diff do miupy-notes antes de merge, com foco em comportamento e risco real.
---

# Revisar PR

Leia o diff e o requisito/contrato afetados. Priorize falhas reproduzíveis, segurança de dados pessoais, incompatibilidade HTTP, fronteiras entre módulos e ausência de validação relevante. Para cada achado, informe severidade, arquivo/linha, cenário e correção sugerida. Separe fatos de hipóteses. Se não houver achados, informe o escopo revisado e lacunas de teste. Não trate preferência de estilo como bug.
