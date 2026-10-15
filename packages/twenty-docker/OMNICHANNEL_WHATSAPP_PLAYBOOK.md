# Omnichannel WhatsApp Playbook (Unified Chat)

This playbook defines a practical path to get WhatsApp and other messenger chats into one shared CRM conversation stream.

## Goal

- One operator UI flow for inbound/outbound chats.
- WhatsApp first, with extensibility for Telegram/Instagram/Facebook Messenger.
- Unified contact matching and conversation history in Twenty.

## Target architecture

1. **Channel providers** (WhatsApp/TG/IG/Messenger) send webhooks.
2. **Integration bridge** (n8n, Make, or custom Node service) normalizes payloads.
3. Bridge calls **Twenty webhook trigger** endpoint.
4. **Workflows in Twenty**:
   - upsert Person/Company;
   - create/update unified conversation record;
   - create message record;
   - route owner/queue and SLA timers;
   - trigger notifications/escalations.
5. Outbound replies run through bridge back to provider API.

## Recommended data model (custom objects)

Create these custom objects:

- `conversation`
  - `externalThreadId` (text, unique)
  - `channelType` (select: whatsapp, telegram, instagram, messenger)
  - `contactPhone` (phone)
  - `contactDisplayName` (text)
  - `status` (select: open, pending, closed)
  - `owner` (relation to workspace member)
  - `lastMessageAt` (date-time)
- `conversationMessage`
  - `conversation` (relation to conversation)
  - `direction` (select: inbound, outbound)
  - `channelType` (select)
  - `externalMessageId` (text, unique)
  - `messageText` (long text)
  - `attachmentsJson` (raw json)
  - `receivedAt` (date-time)
  - `deliveryStatus` (select)

## Inbound flow

1. Verify provider signature in bridge.
2. Normalize payload to one schema:
   - `channelType`
   - `externalThreadId`
   - `externalMessageId`
   - `contactPhone`
   - `contactDisplayName`
   - `messageText`
   - `attachments`
   - `timestamp`
3. POST normalized payload to Twenty webhook trigger.
4. Workflow:
   - Upsert Person by phone/email.
   - Upsert `conversation` by `externalThreadId`.
   - Insert `conversationMessage`.
   - Update `conversation.lastMessageAt`, status, owner queue.
   - Run SLA timers and assignments.

## Outbound flow

1. Operator sends reply from CRM-side action.
2. Workflow calls bridge endpoint with:
   - `channelType`
   - `externalThreadId`
   - `messageText`
   - optional attachments/template id.
3. Bridge sends message via provider API.
4. Bridge posts delivery status webhook back to Twenty.

## Routing and SLA

- Rule examples:
  - New WhatsApp lead -> Queue A.
  - VIP tag -> Senior queue.
  - No first reply within 5 min -> escalation.
  - No customer response in 24h -> pending close task.

## Security baseline

- Keep provider tokens only in secret manager.
- Require `OMNICHANNEL_INGEST_WEBHOOK_SECRET`.
- Validate webhook signatures before processing.
- Limit bridge endpoint by IP/rate.
- Store only required PII.

## UAT checklist

- [ ] New chat creates Person + Conversation + Message.
- [ ] Existing contact is matched without duplication.
- [ ] Media attachments map correctly.
- [ ] Outbound reply reaches provider and updates status.
- [ ] SLA escalation fires correctly.
- [ ] Re-delivery/idempotency works (no duplicate messages).

## Notes

- Twenty currently provides strong API/webhook/workflow primitives; omnichannel unification is implemented through this integration pattern.
- For production, deploy bridge service separately and monitor retries/dead-letter queues.
