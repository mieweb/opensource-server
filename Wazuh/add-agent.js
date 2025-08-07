// Script to add a Wazuh Agent to the Wazuh Manager
// Last Modified on August 6th, 2025 by Maxwell Klema
// -------------------------------------------------

const axios = require('axios');
const env = require('dotenv').config({ path: '/var/lib/vz/snippets/Wazuh/.env' });

let config = {
    method: 'post',
    url: 'https://wazuh-server.opensource.mieweb.org/security/user/authenticate',
    maxBodyLength: Infinity,
    headers: {
        'Authorization': `Basic ${Buffer.from(`${process.env.API_USERNAME}:${process.env.API_PASSWORD}`).toString('base64')}`,
    }
}

function addAgent(containerName, containerIP) {
    axios.request(config).then((response) => {
        if (response.status != 200) {
            console.log('fail');
            return;
        }

        const JWT = response.data.data.token;

        // Add the Agent to the Manager
        let agentConfig = {
            method: 'post',
            url: 'https://wazuh-server.opensource.mieweb.org/agents?pretty=true',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${JWT}`
            },
            data: {
                'name': containerName,
                'ip': containerIP
            }
        };

        return axios.request(agentConfig).then((response) => {
            if (response.status !== 200) {
                console.log('fail');
            }
            agentKey = response.data.data.key;
            console.log(agentKey);
        })
    });
}

module.exports = { addAgent };