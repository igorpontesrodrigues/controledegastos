# 💰 Igor Financeiro

> Controle de finanças pessoais com foco em cartão de crédito e parcelamentos.

![Firebase](https://img.shields.io/badge/Firebase-Firestore-orange?logo=firebase)
![GitHub Pages](https://img.shields.io/badge/GitHub-Pages-black?logo=github)
![Auth](https://img.shields.io/badge/Auth-Email%2FSenha-blue?logo=firebase)

---

## Funcionalidades

- Login por e-mail e senha (Firebase Auth)
- Múltiplos cartões com cor e bandeira personalizáveis
- Lançamentos de despesas e receitas
- Parcelamento inteligente — informe o total de parcelas e a parcela inicial, e o sistema cria automaticamente um registro por mês
- 12 categorias com ícones (Alimentação, Transporte, Lazer, etc.)
- Dashboard com totais do mês, gráfico por categoria e resumo por cartão
- Extrato filtrado por mês, tipo, cartão e categoria
- Exclusão inteligente — apague uma parcela ou todo o grupo de parcelas
- Responsivo — funciona em celular e desktop

---

## Estrutura de Arquivos

```
Igor Financeiro/
├── index.html          # Login / Cadastro
├── dashboard.html      # Painel principal
├── lancamentos.html    # Novo lançamento
├── extrato.html        # Extrato filtrado
├── cartoes.html        # Gestão de cartões
├── css/
│   ├── global.css
│   ├── auth.css
│   └── app.css
└── js/
    ├── firebase-config.js
    ├── auth.js
    ├── db.js
    ├── dashboard.js
    ├── lancamentos.js
    ├── cartoes.js
    └── extrato.js
```

---

## Como publicar no GitHub Pages

1. Faça upload desta pasta para um repositório GitHub
2. Vá em Settings - Pages
3. Em Source, selecione a branch main e pasta /root
4. Acesse o link gerado pelo GitHub

Adicione o domínio do GitHub Pages em Firebase Console - Authentication - Authorized Domains para produção.

---

## Segurança (Firestore Rules)

Configure as regras no Firebase Console - Firestore - Rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```
