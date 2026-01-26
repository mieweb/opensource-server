const SequelizeAdapter = require('./oidc-adapter');
const { User, Group, OAuthClient } = require('../models');

/**
 * Find account by ID (uidNumber)
 */
async function findAccount(ctx, id) {
  const user = await User.findByPk(id, {
    include: [{
      model: Group,
      as: 'groups',
      attributes: ['gidNumber', 'cn', 'isAdmin']
    }]
  });

  if (!user) {
    return undefined;
  }

  return {
    accountId: String(user.uidNumber),
    async claims(use, scope, claims, rejected) {
      const userClaims = {
        sub: String(user.uidNumber),
      };

      if (scope.includes('profile')) {
        userClaims.name = user.cn;
        userClaims.given_name = user.givenName;
        userClaims.family_name = user.sn;
        userClaims.preferred_username = user.uid;
      }

      if (scope.includes('email')) {
        userClaims.email = user.mail;
        userClaims.email_verified = user.status === 'active';
      }

      if (scope.includes('groups')) {
        userClaims.groups = user.groups.map(g => g.cn);
        userClaims.is_admin = user.groups.some(g => g.isAdmin);
      }

      return userClaims;
    }
  };
}

/**
 * Load client from database
 */
async function findClient(ctx, clientId) {
  const client = await OAuthClient.findByPk(clientId);
  
  if (!client) {
    return undefined;
  }

  return {
    client_id: client.clientId,
    client_secret: client.clientSecret,
    client_name: client.clientName,
    redirect_uris: client.redirectUris,
    grant_types: client.grantTypes,
    response_types: client.responseTypes,
    scope: client.scopes.join(' ')
  };
}

/**
 * Configure OIDC provider
 */
async function createOIDCProvider(issuer) {
  // Dynamic import for ESM module
  const { Provider } = await import('oidc-provider');
  
  const configuration = {
    adapter: SequelizeAdapter,
    clients: [],
    
    // Find client from database
    findAccount,
    
    // Load clients dynamically
    async findClient(ctx, clientId) {
      return findClient(ctx, clientId);
    },

    // Cookie configuration
    cookies: {
      keys: [process.env.OIDC_COOKIE_SECRET || 'some-secret-key-change-in-production'],
      long: { 
        signed: true, 
        maxAge: 24 * 60 * 60 * 1000 // 1 day
      },
      short: { 
        signed: true, 
        maxAge: 10 * 60 * 1000 // 10 minutes
      }
    },

    // Claims configuration
    claims: {
      openid: ['sub'],
      profile: ['name', 'given_name', 'family_name', 'preferred_username'],
      email: ['email', 'email_verified'],
      groups: ['groups', 'is_admin']
    },

    // Features configuration
    features: {
      devInteractions: { enabled: false },
      deviceFlow: { enabled: false },
      revocation: { enabled: true },
      introspection: { enabled: true }
    },

    // TTL configuration
    ttl: {
      AccessToken: 60 * 60, // 1 hour
      AuthorizationCode: 10 * 60, // 10 minutes
      ClientCredentials: 10 * 60, // 10 minutes
      IdToken: 60 * 60, // 1 hour
      RefreshToken: 7 * 24 * 60 * 60, // 7 days
      Interaction: 60 * 60, // 1 hour
      Session: 14 * 24 * 60 * 60, // 14 days
      Grant: 14 * 24 * 60 * 60 // 14 days
    },

    // Supported scopes
    scopes: ['openid', 'profile', 'email', 'groups'],

    // PKCE configuration (required for public clients)
    pkce: {
      required: () => false,
      methods: ['S256', 'plain']
    },

    // Interaction routes
    interactions: {
      url(ctx, interaction) {
        return `/oidc/interaction/${interaction.uid}`;
      }
    },

    // Allow client credentials to be sent in the body
    clientAuthMethods: [
      'client_secret_basic',
      'client_secret_post',
      'client_secret_jwt',
      'private_key_jwt',
      'none'
    ]
  };

  const provider = new Provider(issuer, configuration);

  // Initialize the adapter
  SequelizeAdapter.connect();

  return provider;
}

module.exports = createOIDCProvider;
