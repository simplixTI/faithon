# FaithOn — Status Atual do Projeto

> Documento vivo: atualizar ao final de cada sessão de trabalho.
> Última atualização: 2026-08-23 (sessão: cron fix, reengajamento e system health)

## Estado atual (2026-08-23)

**Produção (Vercel) está funcional** para o fluxo SMS:

- Aparelho **Samsung Galaxy A55 5G** configurado com SMSGate em cloud mode.
- Conta cloud SMSGate migrada para as credenciais do A55 5G:
  - User: `C0WFDB`
  - Device ID: `tg7yUrrPW45jO5iBRvPPk`
- `.env` local e env vars da Vercel atualizadas com as novas credenciais e device ID.
- Webhooks re-registrados na nova conta cloud (21/08):
  - `sms:received` → `https://www.faithon.ai/api/sms/incoming`
  - `mms:downloaded` → `https://www.faithon.ai/api/sms/incoming`
  - `sms:sent` / `sms:delivered` / `sms:failed` → `https://www.faithon.ai/api/sms/status`
- Deep-link `/pray` ativo e servindo landing page em `public/pray.html`.
- Admin Next.js com colunas **Nome** e **Opt-out** na listagem de Customers.
- Vercel Cron configurado com `CRON_SECRET` para:
  - Devocional diário às 12:00 UTC.
  - Health-check diário às 13:00 UTC (plano Hobby limita crons a 1x ao dia).
- Deploy produtivo realizado em 23/08 ~00:12 UTC.

**Último fluxo real ponta a ponta validado em 21/08.**

## Pendências

1. ~~Teste real ponta a ponta com aparelho novo A55 5G.~~ ✅ Feito em 21/08.
2. Aplicar migration `supabase/migrations/20260822000000_system_health_heartbeats.sql`
   no Supabase SQL Editor (adiciona componente `smsgate` ao enum).
3. Limpar dados de teste do número fake `+5511990001234` no Supabase.
4. Investigar/corrigir quota excedida do OpenAI usado no Bible RAG (erro 429).
5. Monitorar se a correção de idempotência evita duplicatas em mensagens futuras.

## Mudanças de código

### 2026-08-22/23 — Admin, /pray, reengajamento, system health e cron fix

- `admin/app/(dashboard)/customers/page.tsx`:
  - Adicionada coluna **Nome** (`users.first_name`) na listagem.
  - Adicionada coluna **Opt-out** com badge e data do opt-out, usando join com
    `user_consents(opt_out, opt_out_at)`.
- `admin/app/(dashboard)/customers/export/route.ts`: export CSV atualizado com
  `first_name`, `opt_out` e `opt_out_at`.
- Build e typecheck do admin validados (`npm run typecheck` e `npm run build`).
- `server.js`: rota `GET /pray` agora serve `public/pray.html`.
- `public/pray.html`: landing page com auto-redirecionamento para
  `sms:+19547950686?body=PRAY` e botão fallback "Open Messages".
- `vercel.json`: rewrite `/pray` → `/pray.html` para servir a página no path
  `/pray` sem expor o arquivo.
- `.env.example`: adicionada `FAITHON_SMS_NUMBER` (fallback ainda é
  `+19547950686`).
- `scripts/re-engage.js`: script de reengajamento SMS (com dry-run, force e
  skip automático de opted-out). Mensagem gerada pelo DeepSeek:
  `FaithOn is back! Need prayer or guidance? Just text PRAY and we're here for you. Reply STOP to opt out.`
  Enviada em 2026-08-22 para os 4 números da foto (+18165894867,
  +13104389963, +18505576241, +16104923473) e em 2026-08-23 para
  +16195304777 (amigo em San Diego), todos com sucesso.
- System health configurado:
  - `lib/system-health.js`: helper de heartbeat.
  - `supabase/migrations/20260822000000_system_health_heartbeats.sql`:
    adiciona componente `smsgate`.
  - `routes/config.js`, `routes/sms.js`, `routes/stripe-webhook.js`,
    `lib/ai-provider.js`, `routes/cron.js`: escrevem heartbeat de
    `api`/`database`, `smsgate`, `stripe`, `openai` e `cron`.
  - `routes/cron.js`: endpoint `/api/cron/health-check` atualiza os heartbeats
    de `api`/`database` e marca componentes como `degraded` apenas quando já
    tiveram heartbeat e ficaram velhos. Componentes sem nenhum heartbeat
    permanecem `unknown` (não são marcados como `down`).
- Vercel Cron corrigido:
  - `CRON_SECRET` gerado e adicionado às env vars da Vercel (production).
  - `routes/cron.js` agora aceita o header `Authorization: Bearer <CRON_SECRET>`
    que a Vercel envia automaticamente, além de `x-cron-secret` e `?secret=`.
  - `vercel.json`: crons `/api/cron/devotional` e `/api/cron/health-check`
    sem secret na URL.
  - Devocional diário agora inclui usuários Plus em trial (`active` ou `trial`).
- Deploy produtivo realizado em 2026-08-23.

### 2026-08-21 — Migração para aparelho novo A55 5G

- Atualizadas credenciais SMSGate no `.env` local e na Vercel (production):
  - `SMSGATE_USER=C0WFDB`
  - `SMSGATE_PASS=durlg7m9vk532j`
  - `SMSGATE_DEVICE_ID=tg7yUrrPW45jO5iBRvPPk`
- Re-registrados webhooks na nova conta cloud SMSGate.
- Corrigido `scripts/register-smsgate-webhook.js`: evento MMS agora é `mms:downloaded`
  (que inclui o campo `body`) e aponta para `/api/sms/incoming`.
- Corrigida idempotência em `routes/sms.js`: webhook é marcado como processado no início
  do fluxo, evitando duplicatas quando a cloud SMSGate reenvia por timeout.
- Ajustado `lib/faithon-prompt.js` e `lib/devotional.js`: IA agora fala como Jesus,
  diretamente com o usuário, em primeira pessoa, sem intermediário ou terceiro.
- Humanização adicional: prompt reescrito para evitar frases genéricas de IA,
  variar estrutura, não terminar sempre com pergunta, e usar linguagem mais
  cotidiana. Temperature da IA aumentada para 0.85.
- Integração com OpenRouter (`lib/ai-provider.js`): fallback automático entre
  modelos. Configurado `AI_PROVIDER=openrouter` e
  `OPENROUTER_MODELS=deepseek/deepseek-chat,openai/gpt-4o-mini` no `.env` e na
  Vercel.
- Adicionado devocional diário para usuários PLUS:
  - `lib/devotional.js`: gera devocional via IA.
  - `routes/cron.js`: endpoint `/api/cron/devotional` envia SMS para PLUS ativos.
  - `vercel.json`: cron agendado para 12:00 UTC.
- Redeploy produtivo na Vercel (`vercel deploy --prod`).

### 2026-08-20 — Observabilidade / message trace

- `lib/entitlement.js` criado: lógica de entitlement reutilizável entre
  `routes/entitlement.js` e o fluxo SMS.
- `routes/entitlement.js`: refatorado para usar `lib/entitlement.js`.
- `routes/sms.js`:
  - Adicionado entitlement check no fluxo inbound (`ENTITLEMENT_CHECK_STARTED`,
    `ENTITLEMENT_ALLOWED`, `ENTITLEMENT_BLOCKED`).
  - Propagação do `message_id` real (UUID da tabela `sms_messages`) para todos os
    eventos de trace.
  - Trace de `SMS_SEND_STARTED` / `COMPLETED` nas respostas de sistema
    (STOP/START/HELP/PLUS e limite diário).
  - `routes/sms/status` agora registra `DELIVERY_CONFIRMED` / `DELIVERY_FAILED`
    na tabela `message_events`.
- `lib/conversation-service.js`:
  - Registra `AI_REQUEST_FAILED` e `SMS_SEND_FAILED` de forma granular.
  - Propaga `message_id` nos eventos de trace.
  - Retorna `outboundMessageId` para facilitar rastreamento.

### 2026-08-20 — MMS tratado como texto

- `routes/sms.js`: endpoint `/api/sms/incoming` agora aceita também `mms:downloaded`
  (Android frequentemente entrega mensagens de texto como MMS).
- `lib/sms-provider.js`: `normalizeInbound()` extrai o corpo de MMS do campo
  `payload.body` (além de `message`, `text` e `parts`).
- Log do payload completo quando o sender está ausente, para diagnóstico.

### 2026-08-19 — Diagnóstico SMS/cloud + MMS

- `routes/sms.js`: endpoint `/api/sms/incoming` agora aceita `mms:received` além de
  `sms:received`, e loga o tipo do evento.
- `lib/sms-provider.js`: `SmsgateProvider.normalizeInbound()` extrai o corpo de MMS
  de `payload.message`, `payload.text` ou `payload.parts[].text`.
- `scripts/register-smsgate-webhook.js`: inclui `mms:received` na lista de eventos.

## Armadilhas conhecidas (não perder tempo de novo)

- **`vercel env pull` NÃO é confiável neste ambiente**: todo valor baixado aparece
  como o texto literal `[SENSITIVE]` (máscara do ambiente, não o valor real).
  Em 19/08 isso foi erroneamente diagnosticado como "variáveis corrompidas".
  Para validar config de produção, testar efeitos observáveis (HTTP, Supabase,
  API da cloud), nunca ler o pull.
- **O `.env` local (raiz) é a fonte da verdade** para chaves: DeepSeek, OpenAI,
  Supabase, Stripe e SMSGate cloud estão lá (gitignored). Se faltar alguma, pedir ao usuário.
- **Servidor local não é mais necessário** para o fluxo SMS — produção na Vercel
  cobre tudo via cloud mode. Rodar local só para desenvolvimento.
- `lib/smsgate.js` tem defaults de modo LOCAL (IP 192.168.15.2 + user/senha antigos)
  que só se aplicam quando as env vars não existem. Em produção/cloud, sempre usar
  `SMSGATE_URL=https://api.sms-gate.app/3rdparty/v1`.
- O notebook mudou de rede: era `192.168.15.x`, agora `192.168.68.x` — qualquer
  config de modo local com IP fixo está obsoleta.
- Plano Hobby da Vercel limita Cron Jobs a **1 execução por dia**. Crons mais
  frequentes exigem upgrade para Pro ou uso de serviço externo (n8n, cron-job.org).

## Como verificar a saúde do sistema (rápido)

```bash
# 1. Produção processa inbound? (simulado — grava dados de teste no Supabase)
curl -X POST https://www.faithon.ai/api/sms/incoming \
  -H "Content-Type: application/json" \
  -d '{"id":"test-<ts>","event":"sms:received","payload":{"messageId":"m-<ts>","sender":"+5511990001234","recipient":"+5511999990000","message":"PRAY"}}'
# esperado: HTTP 204 em ~20s

# 2. Aparelho online na cloud? (consultar estado de uma mensagem enviada)
# GET https://api.sms-gate.app/3rdparty/v1/messages/<id> com Basic auth do .env
# Pending por >2-3 min = aparelho offline

# 3. Webhooks registrados na cloud?
# GET https://api.sms-gate.app/3rdparty/v1/webhooks (mesma auth)

# 4. Últimos eventos recebidos (Supabase, via lib local):
# tabela sms_webhook_events ordenada por received_at desc

# 5. Trace de uma mensagem específica:
# select * from message_events where correlation_id = '<id>' order by created_at
```

## Arquitetura em uma frase

Celular (app SMSGate, cloud mode) ↔ cloud sms-gate.app ↔ Vercel (`api/index.js`,
rotas em `routes/sms.js`) ↔ Supabase (dados) + DeepSeek (IA) + Stripe (pagamentos).
