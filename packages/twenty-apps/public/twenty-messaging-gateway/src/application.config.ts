import { defineApplication } from 'twenty-sdk/define';

import { APPLICATION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

export default defineApplication({
  universalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
  displayName: 'Karkas Messaging Gateway',
  description:
    'Unified omnichannel inbox ingestion for KarkasLMS (WhatsApp, Telegram and other messaging channels via gateway webhooks).',
  logoUrl: 'public/twenty-messaging-gateway.svg',
  author: 'KarkasLMS',
  category: 'Communication',
  emailSupport: 'support@karkaslms.ru',
  websiteUrl: 'https://karkaslms.ru',
  serverVariables: {
    MESSAGING_GATEWAY_WEBHOOK_SECRET: {
      description: 'Shared secret used to validate messaging gateway webhook payloads.',
      isSecret: true,
      isRequired: true,
    },
  },
});
