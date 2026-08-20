# FaithOn — Status Atual do Projeto

> Documento vivo: atualizar ao final de cada sessão de trabalho.
> Última atualização: 2026-08-20 (sessão de observabilidade / trace)

## Estado atual (2026-08-19)

**Produção (Vercel) está 100% funcional** para o fluxo SMS:

- Deploy atual com todas as env vars válidas (redeploy feito em 19/08 ~14:25 UTC)
- Teste simulado ponta a ponta em produção passou: `POST https://www.faithon.ai/api/sms/incoming`
  retornou 204 em ~21s, DeepSeek gerou resposta, cloud SMSGate aceitou o envio
- Observabilidade/trace implementada: toda mensagem gera eventos em
  `message_events` com `correlation_id`, stages, `duration_ms` e erros.
- Webhooks na conta cloud SMSGate — todos corretos (verificado em 19/08):
  - `sms:received` → `https://www.faithon.ai/api/sms/incoming`
  - `mms:received` → `https://www.faithon.ai/api/sms/incoming` (adicionado em 19/08)
  - `sms:sent` / `sms:delivered` / `sms:failed` → `https://www.faithon.ai/api/sms/status`
- Credenciais cloud SMSGate na Vercel: válidas (não mexer)

**Único ponto de falha restante: o aparelho Android atual.**

O app SMSGate recebe as mensagens localmente (aparecem na aba INCOMING do app),
mas **não repassa os eventos de entrada para a cloud** — portanto nenhum webhook
`sms:received`/`mms:received` dispara na Vercel. Isso ocorre mesmo com o app aberto
e sem otimização de bateria. Mensagens enviadas *pelo* FaithOn (outbound) funcionam
quando o aparelho consegue se conectar, mas a conexão é instável.

Em qualquer aparelho novo: desativar totalmente a otimização de bateria para o app
SMSGate (Configurações → Apps → SMSGate → Bateria → Sem restrições) e preferir
aparelhos com Android puro ou sem agressiva gestão de background (Xiaomi/Samsung
são particularmente problemáticos).

## Pendências

1. Teste real ponta a ponta com **aparelho novo**: usuário envia "PRAY" para o
   número FaithOn → validar inbound no Supabase + resposta recebida no celular.
2. Mensagem de teste `40xtqerIjU-XgzUxNYKpr` ficou `Pending` na cloud (número fake
   +5511990001234) — vai falhar quando o aparelho reconectar; ignorar.
3. Limpar dados de teste no Supabase: usuário/mensagens de `+5511990001234` e
   eventos `sms_webhook_events` com id `test-*`.
4. Quando o aparelho novo chegar: instalar SMSGate, logar na mesma conta cloud,
   desativar otimização de bateria. Não precisa mudar nada no backend (device ID
   pode mudar — se mudar, atualizar `SMSGATE_DEVICE_ID` na Vercel e no `.env` local).

## Mudanças de código

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
