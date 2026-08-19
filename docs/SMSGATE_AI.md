# FaithOn — SMS via SMSGate + AI (MVP Brasil)

## Fluxo atual validado

```text
Usuário (celular) → SMS PRAY → operadora → Android SMSGate → webhook → FaithOn backend → Supabase → DeepSeek AI → resposta → SMSGate → Android → operadora → Usuário
```

## Arquitetura implementada

### Providers abstratos

- `lib/sms-provider.js` — interface `SmsProvider` com implementação `SmsgateProvider`
- `lib/ai-provider.js` — interface `AIProvider` com implementações `DeepSeekProvider` e `OpenAIProvider`
- `lib/conversation-service.js` — orquestra conversa, contexto, AI e envio SMS

### Endpoints

| Endpoint | Descrição |
|----------|-----------|
| `POST /api/sms/incoming` | Recebe webhook `sms:received` do SMSGate |
| `POST /api/sms/status` | Recebe webhooks `sms:sent`, `sms:delivered`, `sms:failed` |

### Fluxo de mensagem

1. SMSGate recebe SMS no Android e dispara webhook para `/api/sms/incoming`
2. Backend normaliza payload, valida idempotência (`sms_webhook_events`)
3. Ignora mensagens de operadora/sistema (VIVO, TIM, entrega, etc.)
4. `ensureUserWithTrial` cria usuário se não existir + trial de 3 dias
5. Grava mensagem inbound em `sms_messages`
6. Se comando STOP/START/HELP, responde fixo
7. Se PRAY/outros, chama `generateReply` que:
   - busca/cria conversa
   - pega últimas 6 mensagens como contexto
   - chama DeepSeek com system prompt FaithOn
   - grava resposta em `messages` e `sms_messages`
   - registra tokens/custo em `ai_usage_events` e `usage_daily`
   - envia SMS via SMSGate

## Variáveis de ambiente novas

```env
# SMS Provider
SMS_PROVIDER=smsgate
SMSGATE_URL=http://192.168.15.2:8080
SMSGATE_USER=sms
SMSGATE_PASS=Gab@2020

# AI Provider
AI_PROVIDER=deepseek
AI_MODEL=deepseek-chat
AI_MAX_TOKENS=160
AI_TEMPERATURE=0.7
AI_TIMEOUT_MS=15000
DEEPSEEK_API_KEY=sk-...
```

## Configuração do SMSGate no Android

1. Instala o app SMSGate (capcom6/android-sms-gateway)
2. Concede permissão `SEND_SMS`
3. Define como **app padrão de SMS** (obrigatório para envio via API)
4. Abre o app e mantém em foreground
5. Liga o celular no PC via USB com debug ativo
6. No PC, roda:
   ```bash
   adb reverse tcp:5500 tcp:5500
   ```
7. Registra webhooks:
   ```bash
   APP_URL=http://127.0.0.1:5500 node scripts/register-smsgate-webhook.js
   ```

## Scripts úteis

- `node scripts/test-smsgate-send.js <numero> <texto>` — testa envio via SMSGate
- `node scripts/test-deepseek.js` — testa integração DeepSeek sem SMS
- `node scripts/register-smsgate-webhook.js` — registra webhooks no SMSGate

## Limitações do MVP atual

- Roda localmente via `adb reverse` (não público)
- SMSGate precisa ser app padrão de SMS (alguns Androids não permitem)
- Contexto limitado às últimas 6 mensagens
- Sem RAG bíblico ainda (vai ser adicionado)
