import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';

import { MESSAGING_GATEWAY_INGEST_EVENT_ROUTE_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

type MessagingGatewayPayload = {
  channel?: string;
  externalConversationId?: string;
  externalMessageId?: string;
  direction?: 'inbound' | 'outbound';
  message?: string;
  contact?: {
    name?: string;
    phone?: string;
    email?: string;
  };
};

const handler = async (event: RoutePayload) => {
  const signature = event.headers?.['x-gateway-signature'];
  const body = (event.body ?? {}) as MessagingGatewayPayload;

  return {
    source: 'messaging-gateway',
    signatureReceived: typeof signature === 'string' && signature.length > 0,
    normalizedMessageEvent: {
      channel: body.channel ?? 'unknown',
      direction: body.direction ?? 'inbound',
      externalConversationId: body.externalConversationId ?? null,
      externalMessageId: body.externalMessageId ?? null,
      messageText: body.message ?? '',
      contactName: body.contact?.name ?? null,
      contactPhone: body.contact?.phone ?? null,
      contactEmail: body.contact?.email ?? null,
      payload: body,
    },
    status: 'received',
    nextStep:
      'Attach event to Person/Lead/Opportunity thread and enqueue deduplication + delivery-status sync.',
  };
};

export default defineLogicFunction({
  universalIdentifier: MESSAGING_GATEWAY_INGEST_EVENT_ROUTE_UNIVERSAL_IDENTIFIER,
  name: 'messaging-gateway-ingest-event-route',
  timeoutSeconds: 30,
  handler,
  httpRouteTriggerSettings: {
    path: '/integrations/messaging-gateway/events',
    httpMethod: 'POST',
    isAuthRequired: false,
  },
});
