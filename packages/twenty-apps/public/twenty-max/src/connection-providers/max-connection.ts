import { defineConnectionProvider } from 'twenty-sdk/define';

import { MAX_CONNECTION_PROVIDER_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

export default defineConnectionProvider({
  universalIdentifier: MAX_CONNECTION_PROVIDER_UNIVERSAL_IDENTIFIER,
  name: 'max',
  displayName: 'MAX',
  type: 'oauth',
  oauth: {
    authorizationEndpoint: 'https://max.ru/oauth/authorize',
    tokenEndpoint: 'https://api.max.ru/oauth/token',
    revokeEndpoint: 'https://api.max.ru/oauth/revoke',
    scopes: ['read'],
    clientIdVariable: 'MAX_CLIENT_ID',
    clientSecretVariable: 'MAX_CLIENT_SECRET',
    tokenRequestContentType: 'form-urlencoded',
    usePkce: true,
  },
});
