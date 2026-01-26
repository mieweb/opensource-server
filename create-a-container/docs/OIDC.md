# OIDC Provider Implementation

This application now functions as an OpenID Connect (OIDC) provider, allowing users to create OAuth/OIDC applications and authenticate third-party services.

## Features

- **Full OIDC Provider**: Standards-compliant OpenID Connect provider
- **User Management**: Users from the existing Users model can authenticate
- **Groups Claim**: Group memberships are exposed via the `groups` scope
- **OAuth Application Management**: Users can create and manage their own OAuth clients
- **Database-backed Storage**: All tokens, codes, and sessions stored in SQLite/PostgreSQL

## OIDC Endpoints

The OIDC provider exposes the following endpoints:

- **Discovery**: `/.well-known/openid-configuration`
- **Authorization**: `/oidc/auth`
- **Token**: `/oidc/token`
- **UserInfo**: `/oidc/me`
- **JWKS**: `/oidc/jwks`
- **Revocation**: `/oidc/token/revocation`
- **Introspection**: `/oidc/token/introspection`

## OAuth Client Management

### Creating an OAuth Application

1. Navigate to "OAuth Apps" in the sidebar
2. Click "Create New Application"
3. Fill in the application details:
   - **Application Name**: A friendly name for your app
   - **Redirect URIs**: One or more callback URLs (one per line)
   - **Grant Types**: Select the OAuth flows your app will use
   - **Scopes**: Choose which user data your app can access

4. Click "Create Application"
5. **Important**: Copy the Client ID and Client Secret immediately - the secret won't be shown again

### Managing OAuth Applications

- **View Details**: See configuration, credentials, and OIDC endpoints
- **Edit**: Modify redirect URIs, grant types, and scopes
- **Regenerate Secret**: Generate a new client secret if needed
- **Delete**: Remove an application permanently

### Application Ownership

- Each OAuth application is owned by the user who created it
- Only the owner can view, edit, or delete their applications
- All authenticated users can create OAuth applications

## Available Scopes

- `openid` (required): Basic OpenID Connect authentication
- `profile`: User profile information (name, username)
- `email`: User email address
- `groups`: Group memberships and admin status

## Claims Provided

When an application requests user information, the following claims are available:

### OpenID Scope
- `sub`: User ID (uidNumber)

### Profile Scope
- `name`: Full name (cn)
- `given_name`: First name
- `family_name`: Last name
- `preferred_username`: Username (uid)

### Email Scope
- `email`: Email address
- `email_verified`: Whether the account is active

### Groups Scope
- `groups`: Array of group names the user belongs to
- `is_admin`: Boolean indicating if the user is in an admin group

## Integration Example

### Node.js with Passport

```javascript
const passport = require('passport');
const OIDCStrategy = require('passport-openidconnect').Strategy;

passport.use('oidc', new OIDCStrategy({
  issuer: 'http://localhost:3000',
  authorizationURL: 'http://localhost:3000/oidc/auth',
  tokenURL: 'http://localhost:3000/oidc/token',
  userInfoURL: 'http://localhost:3000/oidc/me',
  clientID: 'your-client-id',
  clientSecret: 'your-client-secret',
  callbackURL: 'http://your-app/callback',
  scope: 'openid profile email groups'
}, (issuer, profile, done) => {
  // profile contains user info with groups claim
  return done(null, profile);
}));
```

### Python with authlib

```python
from authlib.integrations.flask_client import OAuth

oauth = OAuth(app)
oauth.register(
    name='myapp',
    client_id='your-client-id',
    client_secret='your-client-secret',
    server_metadata_url='http://localhost:3000/.well-known/openid-configuration',
    client_kwargs={'scope': 'openid profile email groups'}
)
```

## Configuration

### Environment Variables

- `ISSUER_URL`: The base URL of your OIDC provider (default: `http://localhost:3000`)
- `OIDC_COOKIE_SECRET`: Secret for signing OIDC cookies (auto-generated if not set)

### Token TTLs

Default token lifetimes:

- Access Token: 1 hour
- ID Token: 1 hour
- Refresh Token: 7 days
- Authorization Code: 10 minutes
- Session: 14 days

These can be adjusted in `config/oidc-config.js`.

## Database Schema

### OAuthClients Table

Stores OAuth client applications:

- `clientId` (PK): Unique client identifier
- `clientSecret`: Client secret for authentication
- `clientName`: Application name
- `redirectUris`: JSON array of allowed redirect URLs
- `grantTypes`: JSON array of allowed grant types
- `responseTypes`: JSON array of allowed response types
- `scopes`: JSON array of allowed scopes
- `ownerUidNumber` (FK): User who created the application

### OIDC Storage Tables

- `OIDCSessions`: Active user sessions
- `OIDCAccessTokens`: Issued access tokens
- `OIDCAuthorizationCodes`: Authorization codes
- `OIDCRefreshTokens`: Refresh tokens
- `OIDCInteractions`: Interaction sessions (login/consent)

## Security Considerations

1. **Client Secrets**: Treat client secrets like passwords - never expose them publicly
2. **HTTPS**: Always use HTTPS in production to protect tokens in transit
3. **Redirect URIs**: Carefully validate redirect URIs to prevent authorization code theft
4. **Scope Limitation**: Only request/grant the minimum necessary scopes
5. **Token Storage**: Store tokens securely on the client side (encrypted, secure storage)

## User Experience Flow

### Authorization Flow

1. User clicks "Login" on third-party application
2. Application redirects to `/oidc/auth` with client ID and requested scopes
3. User logs in to the OIDC provider (if not already authenticated)
4. User sees consent screen showing what data the application wants to access
5. User clicks "Authorize" or "Deny"
6. If authorized, user is redirected back to the application with an authorization code
7. Application exchanges the code for tokens
8. Application can now access user info via the access token

## Testing

To test your OIDC provider:

1. Create a test OAuth application in the UI
2. Use a tool like [oidc-client-ts playground](https://authts.github.io/oidc-client-ts/)
3. Configure with your client ID, secret, and OIDC endpoints
4. Test the authorization flow

## Troubleshooting

### "Invalid redirect_uri"
- Ensure the redirect URI in your application matches exactly what's configured
- Check for trailing slashes, HTTP vs HTTPS, etc.

### "Invalid client"
- Verify client ID and secret are correct
- Check that the client hasn't been deleted

### "Consent required"
- Normal behavior on first authorization
- Users must explicitly grant access to applications

### "Session expired"
- Sessions expire after 14 days by default
- User needs to log in again

## Development Notes

- The OIDC adapter automatically handles token cleanup (expired tokens deleted hourly)
- All OIDC data is stored in the database for persistence across restarts
- The implementation uses `oidc-provider` v8.x which is a certified OpenID Connect provider
