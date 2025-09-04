const { authenticateRepo } = require('./authenticateRepo');
const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');

describe('authenticateRepo', () => {
  let mock;

  beforeEach(() => {
    mock = new MockAdapter(axios);
  });

  afterEach(() => {
    mock.restore();
  });

  describe('path validation', () => {
    test('should return false for paths pointing to specific files', async () => {
      const result = await authenticateRepo(
        'https://github.com/user/repo',
        'main',
        'src/file.js'
      );
      expect(result).toBe(false);
    });

    test('should return false for paths with file extensions', async () => {
      const result = await authenticateRepo(
        'https://github.com/user/repo',
        'main',
        'README.md'
      );
      expect(result).toBe(false);
    });

    test('should process directory paths without dots', async () => {
      const expectedURL = 'https://github.com/user/repo/tree/main/src';
      mock.onGet(expectedURL).reply(200);

      const result = await authenticateRepo(
        'https://github.com/user/repo',
        'main',
        'src'
      );
      expect(result).toBe(true);
    });
  });

  describe('URL formatting', () => {
    test('should remove .git extension from repository URL', async () => {
      const expectedURL = 'https://github.com/user/repo/tree/main/src';
      mock.onGet(expectedURL).reply(200);

      const result = await authenticateRepo(
        'https://github.com/user/repo.git',
        'main',
        'src'
      );
      expect(result).toBe(true);
      expect(mock.history.get[0].url).toBe(expectedURL);
    });

    test('should handle repository URLs without .git extension', async () => {
      const expectedURL = 'https://github.com/user/repo/tree/main/src';
      mock.onGet(expectedURL).reply(200);

      const result = await authenticateRepo(
        'https://github.com/user/repo',
        'main',
        'src'
      );
      expect(result).toBe(true);
      expect(mock.history.get[0].url).toBe(expectedURL);
    });

    test('should remove leading slash from folder path', async () => {
      const expectedURL = 'https://github.com/user/repo/tree/main/src/components';
      mock.onGet(expectedURL).reply(200);

      const result = await authenticateRepo(
        'https://github.com/user/repo',
        'main',
        '/src/components'
      );
      expect(result).toBe(true);
      expect(mock.history.get[0].url).toBe(expectedURL);
    });

    test('should handle folder paths without leading slash', async () => {
      const expectedURL = 'https://github.com/user/repo/tree/main/src/components';
      mock.onGet(expectedURL).reply(200);

      const result = await authenticateRepo(
        'https://github.com/user/repo',
        'main',
        'src/components'
      );
      expect(result).toBe(true);
      expect(mock.history.get[0].url).toBe(expectedURL);
    });
  });

  describe('HTTP response handling', () => {
    test('should return true for successful HTTP 200 response', async () => {
      const expectedURL = 'https://github.com/user/repo/tree/main/src';
      mock.onGet(expectedURL).reply(200);

      const result = await authenticateRepo(
        'https://github.com/user/repo',
        'main',
        'src'
      );
      expect(result).toBe(true);
    });

    test('should return false for HTTP 404 response', async () => {
      const expectedURL = 'https://github.com/user/repo/tree/main/nonexistent';
      mock.onGet(expectedURL).reply(404);

      const result = await authenticateRepo(
        'https://github.com/user/repo',
        'main',
        'nonexistent'
      );
      expect(result).toBe(false);
    });

    test('should return false for HTTP 403 response', async () => {
      const expectedURL = 'https://github.com/user/private-repo/tree/main/src';
      mock.onGet(expectedURL).reply(403);

      const result = await authenticateRepo(
        'https://github.com/user/private-repo',
        'main',
        'src'
      );
      expect(result).toBe(false);
    });

    test('should return false for network errors', async () => {
      const expectedURL = 'https://github.com/user/repo/tree/main/src';
      mock.onGet(expectedURL).networkError();

      const result = await authenticateRepo(
        'https://github.com/user/repo',
        'main',
        'src'
      );
      expect(result).toBe(false);
    });

    test('should return false for timeout errors', async () => {
      const expectedURL = 'https://github.com/user/repo/tree/main/src';
      mock.onGet(expectedURL).timeout();

      const result = await authenticateRepo(
        'https://github.com/user/repo',
        'main',
        'src'
      );
      expect(result).toBe(false);
    });
  });

  describe('edge cases', () => {
    test('should handle empty folder path', async () => {
      const expectedURL = 'https://github.com/user/repo/tree/main/';
      mock.onGet(expectedURL).reply(200);

      const result = await authenticateRepo(
        'https://github.com/user/repo',
        'main',
        ''
      );
      expect(result).toBe(true);
    });

    test('should handle root path', async () => {
      const expectedURL = 'https://github.com/user/repo/tree/main/';
      mock.onGet(expectedURL).reply(200);

      const result = await authenticateRepo(
        'https://github.com/user/repo',
        'main',
        '/'
      );
      expect(result).toBe(true);
    });

    test('should handle different branch names', async () => {
      const expectedURL = 'https://github.com/user/repo/tree/develop/src';
      mock.onGet(expectedURL).reply(200);

      const result = await authenticateRepo(
        'https://github.com/user/repo',
        'develop',
        'src'
      );
      expect(result).toBe(true);
    });

    test('should handle special characters in paths', async () => {
      const folderPath = 'src/special-folder_name';
      const expectedURL = `https://github.com/user/repo/tree/main/${folderPath}`;
      mock.onGet(expectedURL).reply(200);

      const result = await authenticateRepo(
        'https://github.com/user/repo',
        'main',
        folderPath
      );
      expect(result).toBe(true);
    });
  });

  describe('real-world scenarios', () => {
    test('should validate existing GitHub repository path', async () => {
      // Test with a known public repository
      const expectedURL = 'https://github.com/mieweb/opensource-server/tree/main/container-creation';
      mock.onGet(expectedURL).reply(200);

      const result = await authenticateRepo(
        'https://github.com/mieweb/opensource-server',
        'main',
        'container-creation'
      );
      expect(result).toBe(true);
    });

    test('should handle invalid repository', async () => {
      const expectedURL = 'https://github.com/nonexistent/repo/tree/main/src';
      mock.onGet(expectedURL).reply(404);

      const result = await authenticateRepo(
        'https://github.com/nonexistent/repo',
        'main',
        'src'
      );
      expect(result).toBe(false);
    });
  });
});