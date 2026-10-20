---
name: codigo-enxuto
description: Implementar ou revisar mudanças no miupy-notes com escopo pequeno e código legível.
---

# Código enxuto

1. Leia o requisito e o contrato aplicáveis. Procure comportamento já existente com `rg` antes de criar módulo ou dependência.
2. Leia os trechos necessários e siga o estilo dos arquivos vizinhos. Abstraia apenas quando houver repetição ou fronteira real.
3. Mantenha domínio no backend e estado visual no React. Reutilize o cliente HTTP central quando ele existir.
4. Comentários devem explicar decisão ou limite não óbvio. Evite código morto, logs de dados pessoais e dependência sem justificativa.
5. Teste comportamento relevante, não a implementação linha a linha. Registre o comando e o resultado real.
6. Revise o diff final e atualize documentação/JSON quando o estado ou contrato mudar.
