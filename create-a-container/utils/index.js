const { spawn } = require('child_process');
const ProxmoxApi = require('./proxmox-api');

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, opts);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', data => {
      stdout += data.toString();
    });

    child.stderr.on('data', data => {
      stderr += data.toString();
    });

    child.on('close', code => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const error = new Error(`Command failed: ${cmd} ${args.join(' ')}\nExit code: ${code}\nStderr: ${stderr}`);
        reject(error);
      }
    });
  });
}

module.exports = {
  ProxmoxApi,
  run
};
