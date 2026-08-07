# Twilio setup

Twilio wiring is **deferred** for the initial MVP push — schema and
endpoints exist; the account provisioning happens when the founder is
ready. Steps:

## 1. Buy a US 10DLC-eligible number

Twilio Console → Phone Numbers → Buy a Number. Filter by SMS +
capabilities.

## 2. A2P 10DLC registration (mandatory for US SMS)

Without a registered A2P 10DLC campaign, most carriers will filter or
drop messages. Twilio Console → Messaging → Regulatory → **Register a
Brand** and **Register a Campaign** ("customer care" or
"conversational" fits FaithOn). This can take days to approve — start
early.

## 3. Environment variables

Add to root `.env` (and Vercel project env):

```bash
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+15551234567
TWILIO_WEBHOOK_AUTH_TOKEN=xxxxxxxx  # optional secondary signing secret
TWILIO_STATUS_CALLBACK_URL=https://www.faithon.ai/api/twilio/status
```

## 4. Point the number at our webhooks

In Twilio Console → Phone Numbers → the number → Messaging config:

- **A MESSAGE COMES IN**: `POST` → `https://www.faithon.ai/api/twilio/inbound`
- **STATUS CALLBACK URL**: `POST` → `https://www.faithon.ai/api/twilio/status`

Our handler validates the `X-Twilio-Signature` header when
`TWILIO_AUTH_TOKEN` is set.

## 5. Compliance-required keywords

Twilio handles carrier-level `STOP`/`HELP` acknowledgements even if
your webhook stays silent. Our webhook additionally records the
consent state in `user_consents` and updates `users.access_status` so
the AI pipeline can suppress future outbound messages.

Recognized commands (case-insensitive, whole-message):

| Command   | Effect                                                          |
| --------- | --------------------------------------------------------------- |
| `PRAY`    | First-touch = starts 3-day Plus trial. Deferred to n8n workflow.|
| `HELP`    | Server replies with `app_settings.text_help` immediately.       |
| `STOP`    | Sets consent.opt_out; user.access_status = 'opted_out'.         |
| `START`   | Clears opt_out; sends `text_start_ack`.                          |
| `UNSTOP`  | Alias for START.                                                 |

## 6. Testing the inbound webhook locally

```bash
# Terminal 1: run the server
npm start

# Terminal 2: expose it with ngrok / cloudflared
ngrok http 5500

# Point the Twilio webhook at https://<ngrok>.ngrok-free.app/api/twilio/inbound
```

Simulate a message:
```bash
curl -X POST http://localhost:5500/api/twilio/inbound \
  -d "MessageSid=SMtest123&From=%2B15551234567&To=%2B19547950686&Body=PRAY&NumSegments=1"
```
Expect `<Response></Response>` (empty TwiML) and a row in `sms_messages`.
