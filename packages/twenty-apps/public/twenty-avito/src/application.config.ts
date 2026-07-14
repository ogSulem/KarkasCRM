import { defineApplication } from 'twenty-sdk/define';

import { APPLICATION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

export default defineApplication({
  universalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
  displayName: 'Karkas Avito',
  description:
    'Avito leads ingestion app for KarkasLMS. Supports OAuth account connection and webhook ingestion for unified lead intake.',
  logoUrl: 'public/twenty-avito.svg',
  author: 'KarkasLMS',
  category: 'Sales',
  emailSupport: 'support@karkaslms.ru',
  websiteUrl: 'https://karkaslms.ru',
  serverVariables: {
    AVITO_CLIENT_ID: {
      description: 'OAuth client ID for Avito integration.',
      isSecret: false,
      isRequired: true,
    },
    AVITO_CLIENT_SECRET: {
      description: 'OAuth client secret for Avito integration.',
      isSecret: true,
      isRequired: true,
    },
    AVITO_WEBHOOK_SECRET: {
      description:
        'Shared secret used to validate Avito webhook payload signatures.',
      isSecret: true,
      isRequired: true,
    },
  },
});
