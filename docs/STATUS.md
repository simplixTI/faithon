# FaithOn — Status Atual do Projeto

> Documento vivo: atualizar ao final de cada sessão de trabalho.
> Última atualização: 2026-08-22 (sessão: melhorias no admin — colunas Nome e Opt-out na listagem de Customers)

## Estado atual (2026-08-21)

**Produção (Vercel) está 100% funcional** para o fluxo SMS:

- Aparelho novo **Samsung Galaxy A55 5G** configurado com SMSGate em cloud mode.
- Conta cloud SMSGate migrada para as credenciais do A55 5G:
  - User: `C0WFDB`
  - Device ID: `tg7yUrrPW45jO5iBRvPPk`
- `.env` local e env vars da Vercel atualizadas com as novas credenciais e device ID.
- Webhooks re-registrados na nova conta cloud (21/08):
  - `sms:received` → `https://www.faithon.ai/api/sms/incoming`
  - `mms:downloaded` → `https://www.faithon.ai/api/sms/incoming` (corrigido: `mms:received` não tem `body`)
  - `sms:sent` / `sms:delivered` / `sms:failed` → `https://www.faithon.ai/api/sms/status`
- Redeploy produtivo feito em 21/08 ~23:22 UTC; `https://www.faithon.ai` ativo.
- Observabilidade/trace implementada: toda mensagem gera eventos em
  `message_events` com `correlation_id`, stages, `duration_ms` e erros.

**Fluxo real ponta a ponta validado em 21/08 ~22:05 BRT.**

O usuário enviou "PRAY" de `+5521951014062` e:
1. O webhook `mms:downloaded` chegou na Vercel (a mensagem caiu como MMS no A55).
2. A mensagem inbound e a resposta foram registradas no Supabase.
3. A resposta da IA chegou no celular remetente.

Resta monitorar: a primeira mensagem real gerou duas respostas idênticas porque a
primeira requisição demorou ~25s e a cloud reenviou o webhook. A idempotência foi
reforçada no deploy de 21/08 ~23:35 UTC.

Lembretes para o aparelho novo:
- Desativar totalmente a otimização de bateria para o app SMSGate
  (Configurações → Apps → SMSGate → Bateria → Sem restrições).
- Manter o app com permissões de SMS/telefone/contatos.

## Pendências

1. ~~Teste real ponta a ponta com aparelho novo A55 5G.~~ ✅ Feito em 21/08.
2. Limpar dados de teste do número fake `+5511990001234` no Supabase.
3. Investigar/corrigir quota excedida do OpenAI usado no Bible RAG (erro 429).
4. Monitorar se a correção de idempotência evita duplicatas em mensagens futuras.

## Mudanças de código

### 2026-08-22 — Melhorias no admin / Customers + deep-link /pray

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
  - `vercel.json`: cron agendado para 12:00 UTC (8:00 EDT / horário de verão de Miami).
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
