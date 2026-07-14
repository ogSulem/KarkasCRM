import { defineConnectionProvider } from 'twenty-sdk/define';

import { AVITO_CONNECTION_PROVIDER_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

export default defineConnectionProvider({
  universalIdentifier: AVITO_CONNECTION_PROVIDER_UNIVERSAL_IDENTIFIER,
  name: 'avito',
  displayName: 'Avito',
  type: 'oauth',
  oauth: {
    authorizationEndpoint: 'https://avito.ru/oauth',
    tokenEndpoint: 'https://api.avito.ru/token',
    revokeEndpoint: 'https://api.avito.ru/token/revoke',
    scopes: ['read'],
    clientIdVariable: 'AVITO_CLIENT_ID',
    clientSecretVariable: 'AVITO_CLIENT_SECRET',
    tokenRequestContentType: 'form-urlencoded',
    usePkce: true,
  },
});
