# Decisões pendentes

Estas respostas são necessárias antes de implementar ou implantar os respectivos fluxos. O trabalho de estruturação não depende delas.

1. **Identidade:** app estritamente pessoal com um usuário ou possibilidade de vários usuários? Qual provedor de login para a API e o fluxo OAuth do desktop?
2. **AWS:** conta, região, orçamento mensal, ambiente de desenvolvimento e destino dos alertas. Não armazenar esses valores com segredos em Git.
3. **Google:** conta pessoal ou Google Workspace? Quais dados de Calendar e Gmail devem ser persistidos, por quanto tempo e com que escopos? Keep depende da elegibilidade da conta.
4. **Dados locais:** é preciso consultar/editar offline ou toda alteração pode depender da API? Isso define cache, conflito e criptografia local.
5. **Backup:** retenção, destino adicional, formato de anexos, frequência e procedimento de restauração.
6. **Produto:** nome definitivo, plataformas alvo iniciais e identidade visual. Os tokens em `styles/` são provisórios.

Até decidir, construir primeiro uma nota com API autenticada, sem integração Google ou dados financeiros reais.
