const { authenticateUser } = require('./authenticateUser');
const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');
const qs = require('qs');

describe('authenticateUser', () => {
  let mock;

  beforeEach(() => {
    mock = new MockAdapter(axios);
  });

  afterEach(() => {
    mock.restore();
  });

  describe('successful authentication', () => {
    test('should return true for valid credentials', async () => {
      const expectedURL = ' https://10.15.0.4:8006/api2/json/access/ticket';
      mock.onPost(expectedURL).reply(200, {
        data: {
          ticket: 'PVE:username@pve:ticket',
          CSRFPreventionToken: 'token'
        }
      });

      const result = await authenticateUser('testuser', 'testpass');
      expect(result).toBe(true);
    });

    test('should send correct request format', async () => {
      const expectedURL = ' https://10.15.0.4:8006/api2/json/access/ticket';
      mock.onPost(expectedURL).reply(200);

      await authenticateUser('testuser', 'testpass');

      expect(mock.history.post).toHaveLength(1);
      expect(mock.history.post[0].url).toBe(expectedURL);
      expect(mock.history.post[0].headers['Content-Type']).toBe('application/x-www-form-urlencoded');
      
      const requestData = qs.parse(mock.history.post[0].data);
      expect(requestData.username).toBe('testuser@pve');
      expect(requestData.password).toBe('testpass');
    });

    test('should append @pve realm to username', async () => {
      const expectedURL = ' https://10.15.0.4:8006/api2/json/access/ticket';
      mock.onPost(expectedURL).reply(200);

      await authenticateUser('admin', 'password123');

      const requestData = qs.parse(mock.history.post[0].data);
      expect(requestData.username).toBe('admin@pve');
    });
  });

  describe('failed authentication', () => {
    test('should return false for HTTP 401 unauthorized', async () => {
      const expectedURL = ' https://10.15.0.4:8006/api2/json/access/ticket';
      mock.onPost(expectedURL).reply(401, {
        errors: {
          password: 'invalid credentials'
        }
      });

      const result = await authenticateUser('wronguser', 'wrongpass');
      expect(result).toBe(false);
    });

    test('should return false for HTTP 403 forbidden', async () => {
      const expectedURL = ' https://10.15.0.4:8006/api2/json/access/ticket';
      mock.onPost(expectedURL).reply(403);

      const result = await authenticateUser('blockeduser', 'password');
      expect(result).toBe(false);
    });

    test('should return false for HTTP 500 server error', async () => {
      const expectedURL = ' https://10.15.0.4:8006/api2/json/access/ticket';
      mock.onPost(expectedURL).reply(500);

      const result = await authenticateUser('testuser', 'testpass');
      expect(result).toBe(false);
    });

    test('should return false for network errors', async () => {
      const expectedURL = ' https://10.15.0.4:8006/api2/json/access/ticket';
      mock.onPost(expectedURL).networkError();

      const result = await authenticateUser('testuser', 'testpass');
      expect(result).toBe(false);
    });

    test('should return false for timeout errors', async () => {
      const expectedURL = ' https://10.15.0.4:8006/api2/json/access/ticket';
      mock.onPost(expectedURL).timeout();

      const result = await authenticateUser('testuser', 'testpass');
      expect(result).toBe(false);
    });
  });

  describe('edge cases', () => {
    test('should handle empty username', async () => {
      const expectedURL = ' https://10.15.0.4:8006/api2/json/access/ticket';
      mock.onPost(expectedURL).reply(400);

      const result = await authenticateUser('', 'password');
      expect(result).toBe(false);
      
      const requestData = qs.parse(mock.history.post[0].data);
      expect(requestData.username).toBe('@pve');
    });

    test('should handle empty password', async () => {
      const expectedURL = ' https://10.15.0.4:8006/api2/json/access/ticket';
      mock.onPost(expectedURL).reply(401);

      const result = await authenticateUser('testuser', '');
      expect(result).toBe(false);
      
      const requestData = qs.parse(mock.history.post[0].data);
      expect(requestData.password).toBe('');
    });

    test('should handle special characters in username', async () => {
      const expectedURL = ' https://10.15.0.4:8006/api2/json/access/ticket';
      mock.onPost(expectedURL).reply(200);

      const result = await authenticateUser('test.user-123', 'password');
      expect(result).toBe(true);
      
      const requestData = qs.parse(mock.history.post[0].data);
      expect(requestData.username).toBe('test.user-123@pve');
    });

    test('should handle special characters in password', async () => {
      const expectedURL = ' https://10.15.0.4:8006/api2/json/access/ticket';
      mock.onPost(expectedURL).reply(200);

      const specialPassword = 'p@ssw0rd!#$%^&*()';
      const result = await authenticateUser('testuser', specialPassword);
      expect(result).toBe(true);
      
      const requestData = qs.parse(mock.history.post[0].data);
      expect(requestData.password).toBe(specialPassword);
    });

    test('should handle very long credentials', async () => {
      const expectedURL = ' https://10.15.0.4:8006/api2/json/access/ticket';
      mock.onPost(expectedURL).reply(200);

      const longUsername = 'a'.repeat(100);
      const longPassword = 'b'.repeat(200);
      
      const result = await authenticateUser(longUsername, longPassword);
      expect(result).toBe(true);
      
      const requestData = qs.parse(mock.history.post[0].data);
      expect(requestData.username).toBe(longUsername + '@pve');
      expect(requestData.password).toBe(longPassword);
    });
  });

  describe('HTTPS configuration', () => {
    test('should use correct HTTPS agent configuration', async () => {
      const expectedURL = ' https://10.15.0.4:8006/api2/json/access/ticket';
      mock.onPost(expectedURL).reply(200);

      await authenticateUser('testuser', 'testpass');

      // Verify the request was made with HTTPS agent that ignores SSL verification
      expect(mock.history.post[0].httpsAgent).toBeDefined();
      expect(mock.history.post[0].httpsAgent.options.rejectUnauthorized).toBe(false);
    });
  });

  describe('integration scenarios', () => {
    test('should handle typical Proxmox user authentication flow', async () => {
      const expectedURL = ' https://10.15.0.4:8006/api2/json/access/ticket';
      
      // Mock successful Proxmox API response
      mock.onPost(expectedURL).reply(200, {
        data: {
          ticket: 'PVE:root@pve:65F2E7FC::H+xGkJKV4gXOc2J2nqJGGFEGhOTMn9/8g+YQ4XLCFB6j',
          CSRFPreventionToken: '65F2E7FC:Y5JftTJG3Q+zGUP2xGGFEGhOTMn9'
        }
      });

      const result = await authenticateUser('root', 'complex_password_123');
      expect(result).toBe(true);
    });

    test('should handle invalid credentials correctly', async () => {
      const expectedURL = ' https://10.15.0.4:8006/api2/json/access/ticket';
      
      // Mock Proxmox API error response for invalid credentials
      mock.onPost(expectedURL).reply(401, {
        errors: {
          password: 'invalid user credentials'
        }
      });

      const result = await authenticateUser('invaliduser', 'wrongpassword');
      expect(result).toBe(false);
    });
  });
});