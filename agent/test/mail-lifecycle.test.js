const test = require('node:test');
const assert = require('node:assert');

const system = require('../dist/system.js');
const apply = require('../dist/apply.js');
const { syncMailUnits } = require('../dist/mail.js');

test('postsrsd startup failure disables SRS and still starts the remaining mail units', async () => {
  const originalStart = system.enableAndStartServices;
  const originalApply = apply.applyService;
  const started = [];
  let postfixOptions;

  system.enableAndStartServices = async (units) => {
    started.push(...units);
    if (units.includes('postsrsd')) throw new Error('startup failed');
  };
  apply.applyService = async (service, config, agent, options) => {
    assert.strictEqual(service.unit, 'postfix');
    postfixOptions = options;
    return 'success';
  };

  try {
    const result = await syncMailUnits(
      { mail: { hostname: 'mail.example.com' } },
      false,
      { stateDir: '/var/lib/opensource-agent' },
    );
    assert.deepStrictEqual(started, ['opendkim', 'dovecot', 'postsrsd', 'postfix', 'opensource-mail-helper']);
    assert.deepStrictEqual(postfixOptions, { disableSrs: true });
    assert.deepStrictEqual(result, { mailManaged: true, postsrsdAvailable: false, success: false });
  } finally {
    system.enableAndStartServices = originalStart;
    apply.applyService = originalApply;
  }
});
