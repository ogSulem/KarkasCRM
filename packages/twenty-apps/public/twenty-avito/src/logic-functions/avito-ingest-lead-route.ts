import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';

import { AVITO_INGEST_LEAD_ROUTE_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

const handler = async (event: RoutePayload) => {
  const signature = event.headers?.['x-avito-signature'];
  const body = (event.body ?? {}) as Record<string, unknown>;

  return {
    source: 'avito',
    signatureReceived: typeof signature === 'string' && signature.length > 0,
    normalizedLead: {
      externalId: (body.leadId as string | undefined) ?? null,
      title: (body.title as string | undefined) ?? 'Avito lead',
      contactName: (body.contactName as string | undefined) ?? null,
      contactPhone: (body.contactPhone as string | undefined) ?? null,
      contactEmail: (body.contactEmail as string | undefined) ?? null,
      payload: body,
    },
    status: 'received',
    nextStep: 'Map normalized lead into Lead object with deduplication rules.',
  };
};

export default defineLogicFunction({
  universalIdentifier: AVITO_INGEST_LEAD_ROUTE_UNIVERSAL_IDENTIFIER,
  name: 'avito-ingest-lead-route',
  timeoutSeconds: 30,
  handler,
  httpRouteTriggerSettings: {
    path: '/integrations/avito/leads',
    httpMethod: 'POST',
    isAuthRequired: false,
  },
});
