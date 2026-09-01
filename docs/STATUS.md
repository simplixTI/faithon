# FaithOn — Status Atual do Projeto

> Documento vivo: atualizar ao final de cada sessão de trabalho.
> Última atualização: 2026-09-01 (sessão: silêncio pós-hiccup do OpenRouter)

## Incidente 01/09 — 3 SMS de `+16195304777` sem resposta (~21:24 UTC)

Amigo em San Diego (PLUS) mandou `Hi`, `Where are u`, `I'm feeling alone` em ~30s.
Backend recebeu todos, tentou responder — usuário não recebeu nada.

**Raiz (dois bugs somados):**
1. OpenRouter retornou `content: ""` com `tokens: 0` nas 3 chamadas
   (`deepseek/deepseek-chat`, latency ~6.3s cada) — hiccup do provider,
   voltou ao normal minutos depois. Ambos os modelos do fallback vieram
   vazios na mesma janela.
2. `lib/ai-provider.js` `parseCompletion` retornava string vazia sem
   avisar → `conversation-service` mandava `""` pro SMSGate → SMSGate
   rejeitava com `failed to validate: Text required` → `lib/sms-provider.js`
   `SmsgateProvider.send` **ignorava a rejeição** (retornava
   `providerMessageId: null` sem lançar) → trace gravava
   `SMS_SEND_STARTED = success` mentindo.

**Fixes (commit `ce02804`, deploy Vercel auto):**
- `parseCompletion` agora lança `ai_empty_response` quando content é vazio
  → força o loop de fallback do OpenRouter a tentar o próximo modelo.
- `conversation-service.generateReply` cataliza a falha do AI e usa um
  fallback fixo (`"I'm here with you. Can you tell me a bit more?"` ou
  versão PT-BR para `+55`) em vez de deixar o usuário no silêncio.
- `SmsgateProvider.send` lança `smsgate_rejected` quando a resposta não
  tem `id` → o trace passa a mostrar `SMS_SEND_FAILED` real.

**Ação manual pós-fix:** enviado catch-up ao amigo em 01/09 23:46 UTC
(SMSGate id `FohMITBD1_zBreZHVUq7A`, `Pending`).

**Pendências levantadas hoje:**
- `BIBLE_RAG_ENABLED` está `true` em prod (embora STATUS anterior dissesse
  desligado) → toda mensagem faz um roundtrip OpenAI que retorna 429
  ("no credits remaining"). Custo: ~3s de latency, zero benefício.
  Ação sugerida: `BIBLE_RAG_ENABLED=false` na Vercel (redeploy).
- Não há alerta automático quando o Samsung A55 fica offline; falha só
  aparece no admin. Considerar hook no `sms/status` que dispare quando
  N mensagens seguidas falharem.

## Incidente 24/08 — WhatsApp não respondia (cliente `+5521992647272`, "Rafael Grossi")

Cliente mandou `PRAY` via click-to-chat do site às 16:37 UTC e ficou sem resposta.
Três bugs encontrados e corrigidos (deploy em 24/08 ~19h UTC):

1. **`lib/whatsapp-provider.js`**: `ExtendedTextMessage` (mensagem criada por link
   click-to-chat) traz `message.content` como **objeto** `{text, contextInfo}`, não
   string. `normalizeInbound` passava o objeto como body → IA falhava com
   `400 messages.2.content: Invalid input` → `FLOW_FAILED`, cliente sem resposta.
   Agora extrai `msg.text` (sempre string) com fallback para `content.text`.
2. **Envio duplo SMS+WhatsApp**: `generateReply` (`lib/conversation-service.js`)
   enviava a resposta via SMS internamente e `routes/whatsapp.js` enviava de novo
   via UazapiGO. Para números BR, a cópia SMS era bloqueada pela operadora e o
   bounce voltava como inbound, sendo respondido pela IA. `generateReply` agora
   aceita `channel` (default `'sms'`); a rota WhatsApp passa `channel: 'whatsapp'`
   e o envio SMS interno é pulado.
3. **Bounce da operadora respondido pela IA**: padrões `UNABLE TO SEND MESSAGE`,
   `MESSAGE BLOCKING IS ACTIVE` e `FREE MSG:` adicionados ao filtro
   `isSystemOrCarrierMessage` em `routes/sms.js`.

Obs: cliente `+14322147090` (final 7090) conversou por **SMS** no mesmo dia e fluiu
normal — nunca houve evento de WhatsApp desse número no backend.

**Sessão WhatsApp caiu (raiz do "não fluiu"):** a instância `FaithOn` na UazapiGO
está **desconectada desde 24/08 16:51 UTC** (logo após a resposta ao "Hello" do
Rafael, que ficou `Pending`). `lastDisconnectReason: 401` (sessão deslogada).
Teste E2E pós-deploy confirmou: PRAY processado e IA respondeu, mas o envio falhou
com `503 WhatsApp disconnected: session is not reconnectable`.
**Ação necessária (manual):** re-parear o WhatsApp do número FaithOn escaneando o
QR Code — `POST /instance/connect` na UazapiGO gera um novo (status foi para
`connecting`). QR gerado nesta sessão salvo em `uazapi-qr.png` (expira rápido;
se expirar, gerar outro pelo mesmo endpoint).
✅ Reconectado em 24/08 ~18:55 UTC (status `connected`).

**Restrição WhatsApp Business (smba):** envio para número que nunca nos mandou
mensagem é bloqueado — `reachout_timelock` / `new_chat_message_capping` (erro 500
no `/send/text`). Ou seja: só conseguimos responder dentro da janela de 24h aberta
por uma mensagem do cliente. Não usar número fake para teste E2E de WhatsApp —
pedir para uma pessoa real mandar mensagem primeiro.


## Incidente 24/08 (2) — Devocional diário nunca foi enviado

Usuário PLUS reportou não ter recebido devocional. Causas encontradas e corrigidas:

1. **Cron nunca disparou com sucesso:** `routes/cron.js` só aceitava `POST`, mas a
   Vercel Cron chama os paths com **GET** → 404 silencioso todos os dias desde
   23/08. `/api/cron/devotional` e `/api/cron/health-check` agora usam
   `router.all(...)`. O heartbeat `cron` de 23/08 00:15 era de teste manual via
   curl, não do agendador.
2. **Devocional só saía por SMS** → todos os `+55` seriam bloqueados pela
   operadora. Agora o envio é por canal: `+55` → WhatsApp (UazapiGO), demais → SMS.
3. **Guarda anti-loop:** o próprio número FaithOn (`+19547950686`, que era usuário
   plus/trial) é excluído do envio — caso contrário o SMS voltaria como inbound e
   a IA responderia a si mesma.
4. `CRON_SECRET` não existia no `.env` local (só na Vercel, ilegível). Gerado novo,
   gravado no `.env` e atualizado na Vercel + redeploy.

**Disparo manual de 24/08 ~19:20 UTC:** 7 enviados, 5 falhas.
- SMS entregues/encaminhados: `+14322147090`, `+14708435123`, `+17864182032`,
  `+16195304777`, `+14433731617`.
- WhatsApp aceitos: `+5521951014062`, `+5521992647272` (janela 24h aberta).
- Falhas: 5 números `+55` **sem janela de 24h aberta** no WhatsApp
  (`reachout_timelock`) — incluía o fake `+5511999999999` (removido). Os reais
  (`+5521972846068`, `+5521996358908`, `+5521996350207`, `+5543996254177`)
  entraram via SMS e nunca falaram no WhatsApp — para alcançá-los, precisam
  clicar no link wa.me e mandar a primeira mensagem (ou usar template
  aprovado no futuro).
- Soft-deletados os usuários de teste `+5511999999999` e `+14073649920`.

**Ajustes 24/08 ~19:40 UTC (deploy seguinte):**
- SMS do devocional agora só para `+1` e `+52`; todo o resto vai por WhatsApp.
- Texto passa a ter cabeçalho identificando: `☀️ Devocional do dia:` (PT) /
  `☀️ Today's devotional:` (EN).
- `generateDailyDevotional(locale)`: `+55` recebe em português, demais em inglês
  (um texto por idioma por execução, cacheado dentro do run).

## Estado atual (2026-08-23)


**Produção (Vercel) está funcional** para o fluxo SMS:

> **Incidente 22/08 investigado:** usuário reportou 12 mensagens que "não chegaram /
não foram respondidas". Análise do banco mostrou que o backend recebeu e respondeu
31 inbound em 22/08. A confusão veio da diferença entre 12 pessoas esperadas
(4 amigos + 8 do Instagram) e 10 mensagens iniciais visíveis no admin. Números
americanos (`+1...`) funcionam ponta a ponta (ex: `+14073649920` testado em
23/08 às 14:48 UTC, resposta entregue). Números brasileiros (`+55`) sofrem
bloqueio de operadora por SMS internacional para o número FaithOn americano
(`+19547950686`) — vimos 3 casos de `Message Blocking is active` em 22/08.

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
**Teste ponta a ponta com número americano revalidado em 23/08 às 14:48 UTC.**

## Pendências

1. ~~Teste real ponta a ponta com aparelho novo A55 5G.~~ ✅ Feito em 21/08.
2. ~~Aplicar migration `system_health_heartbeats`~~ ✅ Feito em 24/08 via CLI.
3. ~~Limpar dados de teste do número fake `+5511990001234` no Supabase.~~ ✅ Feito em 24/08.
4. Investigar/corrigir quota excedida do OpenAI usado no Bible RAG (erro 429).
5. Monitorar se a correção de idempotência evita duplicatas em mensagens futuras.
6. ~~Decidir estratégia para números brasileiros.~~ ✅ Decisão: manter número
   americano (`+19547950686`) para SMS. Usuários BR com bloqueio deverão usar
   WhatsApp quando disponível. Plano: integrar WhatsApp via Uazip e atualizar o
   site para oferecer SMS e WhatsApp.
7. ~~Investigar webhook recebido em 23/08 às 11:10 UTC com `deviceId`
   `ylQbhnUsPGBRFy1cLbchz` (diferente do A55 atual `tg7yUrrPW45jO5iBRvPPk`).~~
   ✅ Resolvido: app SMSGate removido do celular antigo em 23/08; conta cloud
   agora lista apenas o device do A55 5G (`tg7yUrrPW45jO5iBRvPPk`).

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

### 2026-08-23 — Investigação de incidente: mensagens não chegaram

- Usuário reportou 12 mensagens de 22/08 que não chegaram / não foram respondidas.
- Banco de produção mostrou 31 inbound e 35 outbound em 22/08; 11 das 12 mensagens
  entre 01:00–02:00 UTC foram respondidas e entregues. Uma falhou:
  resposta para `+19547950686` às 01:47 UTC retornou
  `RESULT_ERROR_GENERIC_FAILURE (Generic failure cause)`.
- Causa raiz identificada para números brasileiros: o FaithOn usa número americano
  (`+19547950686`), então SMS de `+55` é internacional e operadoras brasileiras
  bloqueiam. Em 22/08 houve 3 casos de `Free Msg: Unable to send message -
  Message Blocking is active` para `+5511990001234`, `+5521999999999` e
  `+5521951014062`.
- Teste com número americano `+14073649920` em 23/08 às 14:48 UTC funcionou
  ponta a ponta: inbound recebido, resposta gerada pela IA e entrega confirmada.
- Encontrado webhook em 23/08 às 11:10 UTC com `deviceId`
  `ylQbhnUsPGBRFy1cLbchz`, diferente do A55 atual (`tg7yUrrPW45jO5iBRvPPk`).
  A conta SMSGate lista apenas o device do A55; provavelmente é webhook em buffer
  de device antigo, mas ficou como pendência de verificação.

### 2026-08-23 — Integração WhatsApp via UazapiGO

- **Servidor privado UazapiGO:** `https://faithon.uazapi.com`
  (Admin Token no painel; instância `FaithOn` com token
  `fcc12436-4f43-4bc9-9869-84fa560035f0`).
- `lib/whatsapp-provider.js`: normaliza inbound da UazapiGO (formato
  `{ EventType, chat, message }`) e envia texto via `POST /send/text`
  com header `token`.
- `routes/whatsapp.js`: endpoint `POST /api/whatsapp/incoming` que processa
  mensagens de texto com as mesmas etapas do SMS (idempotência, usuário,
  entitlement, STOP/START/HELP/PLUS, resposta IA).
- **Detecção de idioma híbrida:** mensagem ambígua (ex: `PRAY`) usa DDI do
  usuário — `+55` → português, `+52/+34/+54/+57/+58` → inglês, outros → inglês.
- Webhook configurado na instância UazapiGO:
  `https://www.faithon.ai/api/whatsapp/incoming`, eventos `messages`,
  excluindo `wasSentByApi`, `fromMeYes`, `isGroupYes`.
- `.env.example` atualizado com `UAZAPI_BASE_URL`, `UAZAPI_INSTANCE_TOKEN`,
  `UAZAPI_ADMIN_TOKEN`.
- Deploy validado ponta a ponta: inbound de `+5521951014062` com `Pray`
  gerou resposta automática entregue em 23/08 às 23:54 UTC.

### 2026-08-23 — Stripe API key renovada + cliente PLUS corrigido

- A chave `STRIPE_SECRET_KEY` tinha expirado, causando falha nos webhooks do
  Stripe. Nova restricted key (`rk_live_...`) configurada no `.env` e na Vercel.
- Cliente `+16195304777` (subscription `sub_1U7lcII7Gc3K1vbWEhHmtSKl`) foi
  atualizado manualmente para `tier=plus`, `access_status=active` e
  `stripe_customer_id=cus_V81fivizT55Q76` porque o webhook não foi processado
  enquanto a chave estava inválida.

### 2026-08-23 — Bible RAG temporariamente desligado

- `lib/bible-rag.js`: `searchBibleVerses` agora só roda quando
  `BIBLE_RAG_ENABLED=true`. Isso evita chamadas OpenAI (embeddings) a cada
  mensagem e previne novos erros 429 enquanto o saldo estiver zerado.
- A IA continua respondendo normalmente, só sem citar versículos do RAG.
- Para reativar: adicione saldo na OpenAI e defina
  `BIBLE_RAG_ENABLED=true` na Vercel.

### 2026-08-23 — Admin com controle WhatsApp

- `admin/app/(dashboard)/messages/page.tsx`: adicionado filtro por canal
  (All / SMS / WhatsApp), coluna **Channel** e contadores SMS vs WhatsApp.
- `admin/app/(dashboard)/operations/page.tsx`: adicionada seção
  **Recent WhatsApp webhooks** (lê `whatsapp_webhook_events`; tolera ausência
  da tabela até a migration ser aplicada).

### 2026-08-23 — Site com SMS + WhatsApp

- `public/index.html`: adicionado botão **WhatsApp** ao lado do SMS nas CTAs
  principais (nav e hero), com link `https://wa.me/19547950686?text=PRAY`.
- `public/pray.html`: landing page agora oferece duas opções — **Open Messages**
  (SMS) e **Open WhatsApp**.
- Traduções i18n adicionadas para `cta.whatsappPrayStart` (EN/ES).

### 2026-08-23 — Suporte a espanhol no site institucional

- `public/index.html`:
  - Adicionado switcher de idioma (EN / ES) no topo da navegação, com estilo
    discreto na paleta cream/gold do site.
  - Implementado i18n client-side leve via `<script>` no final da página,
    usando atributos `data-i18n` e dicionário EN/ES.
  - Tradução cobre: `<title>`, meta description, `<html lang>`, navegação,
    hero, faixa de confiança, marquee de versículos, seções "Some Days Don't
    Wait", "Seasons of a Day", "How It Works", "Features", demonstrações de
    conversa, depoimentos, preços, "Why Text Messages", FAQ, CTA final, rodapé,
    modal de checkout e banners de status.
  - Preserva ícones e elementos filhos (checkmarks, numerais romanas, etc.)
    movendo a tradução para spans internos.
  - Persistência do idioma em `localStorage` e detecção do idioma do navegador
    (`es*` → espanhol) na primeira visita; troca de idioma sem recarregar.
  - Textos dinâmicos do checkout (mensal/anual, erro, redirecionamento e
    banners de sucesso/cancelamento) agora usam `i18n.t()`.
- Validação: scripts `scripts/validate-i18n.js` e
  `scripts/test-i18n-toggle.js` verificam sintaxe, presença de chaves e
  alternância EN ↔ ES.

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
