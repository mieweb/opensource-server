const { redirectUriProblem, isManagerResource, checkRegistration } = require('../service/policy');

describe('redirectUriProblem', () => {
  test.each([
    'https://chat.example.com/cb',
    'http://127.0.0.1:33418/callback',
    'http://localhost/cb',
    'http://[::1]:8080/cb',
    'vscode://vscode.github-authentication/did-authenticate',
    'cursor://anysphere.cursor-retrieval/oauth/callback',
    'com.example.app:/oauth2redirect',
  ])('accepts %s', (uri) => {
    expect(redirectUriProblem(uri)).toBeNull();
  });

  test.each([
    'http://example.com/cb',
    'http://127.0.0.1.evil.com/cb',
    'javascript:alert(1)',
    'data:text/html,hi',
    'file:///etc/passwd',
    'https://a.example/cb#x',
    'https://user:pw@a.example/cb',
    '/relative',
    '',
  ])('rejects %s', (uri) => {
    expect(redirectUriProblem(uri)).not.toBeNull();
  });
});

describe('isManagerResource', () => {
  const origin = 'https://m.example';
  test.each([
    ['https://m.example', true],
    ['https://m.example/mcp', true],
    ['https://M.EXAMPLE/mcp', true],
    ['https://other.example/mcp', false],
    ['https://m.example/mcp#x', false],
    ['not a url', false],
  ])('%s -> %s', (resource, expected) => {
    expect(isManagerResource(resource, origin)).toBe(expected);
  });
});

describe('checkRegistration', () => {
  const ok = { redirect_uris: ['http://127.0.0.1/cb'] };

  test('accepts interactive public and confidential clients', () => {
    expect(() => checkRegistration(ok)).not.toThrow();
    expect(() => checkRegistration({ ...ok, grant_types: ['authorization_code', 'refresh_token'], token_endpoint_auth_method: 'client_secret_post' })).not.toThrow();
  });

  test.each([
    [{ redirect_uris: [] }, 'invalid_redirect_uri'],
    [{ redirect_uris: ['http://evil.example/cb'] }, 'invalid_redirect_uri'],
    [{ ...ok, grant_types: ['client_credentials'] }, 'invalid_client_metadata'],
    [{ ...ok, grant_types: ['implicit'] }, 'invalid_client_metadata'],
    [{ ...ok, response_types: ['token'] }, 'invalid_client_metadata'],
    [{ ...ok, token_endpoint_auth_method: 'private_key_jwt' }, 'invalid_client_metadata'],
  ])('rejects %j with %s', (meta, code) => {
    expect(() => checkRegistration(meta)).toThrow(expect.objectContaining({ code }));
  });
});
