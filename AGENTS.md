# FaithOn — Guia do Agente

## Antes de qualquer coisa

Leia `docs/STATUS.md` — é o documento vivo com o estado atual do projeto, pendências
e armadilhas conhecidas. Atualize-o ao final de cada sessão que mudar esse estado.

## Projeto

Backend Node/Express (serverless na Vercel via `api/index.js`, local via `server.js`)
para companheiro espiritual por SMS. SMS via SMSGate (Android SMS Gateway) em
**cloud mode**; IA via DeepSeek (fallback OpenAI); dados no Supabase; pagamentos Stripe;
admin em `admin/` (Next.js). Docs operacionais em `docs/`.

## Regras da casa

- O `.env` da raiz é a fonte da verdade para segredos (gitignored). Não commitar segredos.
- Não confiar em `vercel env pull` para ler valores (o ambiente mascara como `[SENSITIVE]`).
  Validar produção por efeitos observáveis. Detalhes em `docs/STATUS.md`.
- Produção: qualquer mudança de env var na Vercel exige redeploy (`vercel deploy --prod`).
- Testes de SMS simulados gravam dados reais no Supabase de produção — usar o número
  fake `+5511990001234` e limpar depois.
