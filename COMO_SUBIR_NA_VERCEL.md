# 🚀 Como Subir o Sistema na Vercel

O projeto já foi totalmente adaptado para rodar na **Vercel** como aplicação Serverless de alta performance.

---

### ⚡ Opção 1: Direto pelo Terminal (Vercel CLI já instalado)

Abra o terminal nesta pasta e digite:

```bash
vercel
```

1. Pressione `Enter` para confirmar as opções padrão:
   - **Set up and deploy?** -> `Y`
   - **Which scope?** -> Seu usuário/time
   - **Link to existing project?** -> `N`
   - **Project name?** -> `newshop-estoque` (ou o nome que desejar)
   - **In which directory is your code located?** -> `./`
2. Quando perguntar sobre modificar configurações de build, basta responder `N` (o arquivo `vercel.json` já cuida de tudo automaticamente).

Para publicar em **Produção** definitiva:
```bash
vercel --prod
```

---

### 🐙 Opção 2: Pelo GitHub (Recomendado para deploy automático)

1. Crie um repositório no seu GitHub (ex: `newshop-estoque`).
2. Suba o código para o GitHub:
   ```bash
   git init
   git add .
   git commit -m "Deploy Vercel Newshop"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/newshop-estoque.git
   git push -u origin main
   ```
3. Acesse [vercel.com](https://vercel.com), clique em **"Add New Project"** e importe o repositório do GitHub.
4. Clique em **"Deploy"**.

---

### 🛠️ O que foi preparado:
- [x] **`vercel.json`**: Configuração de rotas de API, limite de memória (1024MB) e empacotamento automático dos arquivos CSV e JSON de estoque.
- [x] **`api/index.js`**: Função Serverless otimizada para responder a todos os endpoints do painel.
- [x] **`server.js`**: Compatibilidade híbrida (funciona tanto local `node server.js` quanto na nuvem da Vercel).
- [x] **`public/`**: Frontend servido diretamente pela CDN global da Vercel com carregamento ultra rápido.
- [x] **`.vercelignore` e `.gitignore`**: Otimização do tamanho do upload descartando arquivos desnecessários.
