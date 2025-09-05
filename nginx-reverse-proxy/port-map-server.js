// etc/nginx/port-map-server.js
// JSON-server that returns all (filtered) hosts to the https://opensource.mieweb.org
// Last modified on Aug 22, 2025 by Maxwell Klema

const jsonServer = require('json-server');
const path = require('path');
const fs = require('fs');
const filePath = "/etc/nginx/port_map.json";

const server = jsonServer.create();
const router = jsonServer.router(path.join(__dirname, 'port_map.json'));
const middlewares = jsonServer.defaults();
server.use(middlewares);

server.get('/keys', (req, res) => {
  const db = router.db;
  const keys = Object.keys(db.getState()).filter(key => !['container-creation', 'intern-dnsmasq', 'wazuh-server', 'wazuh-indexer', 'wazuh-dashboard', 'intern-nginx', 'mie-ldap-server', 'create-a-container', 'landing-page'].includes(key));
  
  // Filter out keys that are branches of a main/master for a repository

  let content = fs.readFileSync(filePath);
  let cachedMapping = JSON.parse(content);

  all_hosts = [];
  proxmox_launchpad_lxcs = [];
  exclude = [];
  for (const key of Object.keys(cachedMapping)) {
      all_hosts.push(key);
      if (key.endsWith("-main") || key.endsWith("master")) {
          proxmox_launchpad_lxcs.push(key.substring(0, key.lastIndexOf("-")));
      }
  }

  for (const entry of proxmox_launchpad_lxcs) {
      hosts_to_filter = all_hosts.filter(key => {
          return key.startsWith(entry) && (!key.endsWith("-main") || !key.startsWith(entry));
      });
      hosts_to_filter.forEach(host => exclude.push(host));
  }
  
  const filteredKeys = keys.filter(key => !exclude.includes(key));
  res.json(filteredKeys);
})

server.get('/:key', (req, res) => {
  const key = req.params.key;
  const db = router.db;
  const value = db.getState()[key];

  const response = {
    name: key,
    owner: value.user,
    description: value.description || "",
    github_url: value.github_url || "",
  };

  if (value) {
      res.json(response);
  } else {
      res.status(404).json({ error: 'Not found' });
  }
});

server.use(router);
server.listen(3001, () => {
   console.log("JSON Server Running on http://localhost:3001");
})
