import { defineApplication } from 'twenty-sdk/define';

import { APPLICATION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

export default defineApplication({
  universalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
  displayName: 'Karkas MAX',
  description:
    'MAX leads ingestion app for KarkasLMS. Supports OAuth connection and webhook ingestion into the lead intake pipeline.',
  logoUrl: 'public/twenty-max.svg',
  author: 'KarkasLMS',
  category: 'Sales',
  emailSupport: 'support@karkaslms.ru',
  websiteUrl: 'https://karkaslms.ru',
  serverVariables: {
    MAX_CLIENT_ID: {
      description: 'OAuth client ID for MAX integration.',
      isSecret: false,
      isRequired: true,
    },
    MAX_CLIENT_SECRET: {
      description: 'OAuth client secret for MAX integration.',
      isSecret: true,
      isRequired: true,
    },
    MAX_WEBHOOK_SECRET: {
      description: 'Shared secret used to validate MAX webhook payloads.',
      isSecret: true,
      isRequired: true,
    },
  },
});
