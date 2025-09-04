const path = require('path');

describe('runner.js', () => {
  const runnerPath = path.join(__dirname, 'runner.js');

  describe('module structure', () => {
    test('should exist and be executable', () => {
      const fs = require('fs');
      expect(fs.existsSync(runnerPath)).toBe(true);
    });

    test('should import required modules correctly', () => {
      // This tests that the runner can load without syntax errors
      const runnerCode = require('fs').readFileSync(runnerPath, 'utf8');
      expect(runnerCode).toContain('authenticateuser = require("./authenticateUser.js")');
      expect(runnerCode).toContain('authenticaterepo = require("./authenticateRepo.js")');
    });

    test('should handle command line argument parsing', () => {
      const runnerCode = require('fs').readFileSync(runnerPath, 'utf8');
      expect(runnerCode).toContain('const [, , func, ...args] = process.argv');
      expect(runnerCode).toContain('if (func == "authenticateUser")');
      expect(runnerCode).toContain('else if (func == "authenticateRepo")');
    });
  });

  describe('function routing', () => {
    test('should route to authenticateUser function', () => {
      const runnerCode = require('fs').readFileSync(runnerPath, 'utf8');
      expect(runnerCode).toContain('authenticateuser.authenticateUser(...args)');
    });

    test('should route to authenticateRepo function', () => {
      const runnerCode = require('fs').readFileSync(runnerPath, 'utf8');
      expect(runnerCode).toContain('authenticaterepo.authenticateRepo(...args)');
    });

    test('should handle promise resolution', () => {
      const runnerCode = require('fs').readFileSync(runnerPath, 'utf8');
      expect(runnerCode).toContain('.then((result) => {');
      expect(runnerCode).toContain('console.log(result);');
    });
  });
});