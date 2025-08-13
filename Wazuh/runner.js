// Wazuh Runner Script to call the addAgent function
// Last Modified on August 7th, 2025 by Maxwell Klema
// -------------------------------------------------

const manageAgents = require('./manage-agents.js');

process.env.DOTENV_CONFIG_SILENT = 'true';

const [, , func, ...args] = process.argv;
if (func === "addAgent") {
    manageAgents.addAgent(...args);
} else if (func === "getAgents") {
    manageAgents.getAgents(...args);
} else if (func == "deleteAgent") {
    manageAgents.deleteAgent(...args);
}
