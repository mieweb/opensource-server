// Script to manage Wazuh Agents on the Wazuh Manager
// Last Modified on August 7th, 2025 by Maxwell Klema
// -------------------------------------------------

const axios = require('axios');
const env = require('dotenv').config({ path: '/var/lib/vz/snippets/Wazuh/.env', quiet: true});

const authConfig = {
    method: 'post',
    url: 'https://wazuh-server.opensource.mieweb.org/security/user/authenticate',
    maxBodyLength: Infinity,
    headers: {
        'Authorization': `Basic ${Buffer.from(`${process.env.API_USERNAME}:${process.env.API_PASSWORD}`).toString('base64')}`,
    }
};

async function getJWTToken() {
    const response = await axios.request(authConfig);
    if (response.status !== 200) {
        return null;
    }
    return response.data.data.token;
}

async function getAgents() {

    const JWT = await getJWTToken();
    if (!JWT) {
        console.log('fail');
        return;
    }

    let config = {
        method: 'get',
        url: 'https://wazuh-server.opensource.mieweb.org/agents?',
        maxBodyLength: Infinity,
        headers: {
            'content-type': 'application/json',
            'Authorization': `Bearer ${JWT}`,
        }
    }

    axios.request(config).then((response) => {
        const agents = response.data.data.affected_items;
        if (!agents || agents.length === 0) {
            console.log('fail');
            return;
        }

        agents.forEach(agent => {
            console.log(agent.name);
        });
    });
}

async function addAgent(containerName, containerIP) {

    const JWT = await getJWTToken();
    if (!JWT) {
        console.log('fail');
        return;
    }

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

    const response = await axios.request(agentConfig);
    if (response.status !== 200) {
        console.log('fail');
    }
    const agentKey = response.data.data.key;
    console.log(agentKey);   
}

async function deleteAgent(agentName) {

    const JWT = await getJWTToken();

    if (!JWT) {
        console.log('fail');
        return;
    }

    const agent_id = await getAgentIDByName(agentName, JWT);
    
    if (!agent_id) {
        console.log('fail');
        return;
    }

    let config = {
        method: 'delete',
        url: `https://wazuh-server.opensource.mieweb.org/agents/?agents_list=${agent_id}&status=all&older_than=0s`,
        maxBodyLength: Infinity,
        headers: {
            'content-type': 'application/json',
            'Authorization': `Bearer ${JWT}`,
        }
    };

    axios.request(config).then((response) => {
        if (response.status !== 200) {
            console.log('fail');
            return;
        }
        console.log('success');
    }).catch((error) => {
        console.log('fail');
    });
}

async function getAgentIDByName(agentName, JWT) {
    let config = {
        method: 'get',
        url: 'https://wazuh-server.opensource.mieweb.org/agents/?name=' + agentName,
        maxBodyLength: Infinity,
        headers: {
            'Authorization': `Bearer ${JWT}`
        }               
    };

    const response = await axios.request(config);
    if (response.status !== 200) {
        return null;
    }
    return response.data.data.affected_items[0].id;
}

module.exports = { getAgents, addAgent, deleteAgent };