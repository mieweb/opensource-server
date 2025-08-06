// Wazuh Runner Script to call the addAgent function
// Last Modified on August 6th, 2025 by Maxwell Klema
// -------------------------------------------------

const addAgent = require('./add-agent.js');

const [, , func, ...args] = process.argv;
if (func === "addAgent") {
    if (args.length < 2) {
        console.error('Usage: node runner.js addAgent <containerName> <containerIP>');
        process.exit(1);
    }
    
    addAgent.addAgent(...args);
}

