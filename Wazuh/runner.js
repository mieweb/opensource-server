// Wazuh Runner Script to call the addAgent function
// Last Modified on August 6th, 2025 by Maxwell Klema
// -------------------------------------------------

const addAgent = require('./add-agent.js');
process.env.DOTENV_CONFIG_SILENT = 'true';

const [, , func, ...args] = process.argv;
if (func === "addAgent") {
    addAgent.addAgent(...args);
}

