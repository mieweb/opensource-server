require('dotenv').config();

const express = require('express');
const session = require('express-session');
const { spawn, exec } = require('child_process');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const RateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer'); // <-- added
const axios = require('axios');
const qs = require('querystring');
const https = require('https');
const { Container, Service } = require('./models');
const serviceMap = require('./data/services.json');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Parse form data

// setup views
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.set('trust proxy', 1);

const jobs = {};

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: { secure: true }
}));

app.use(express.static('public'));

// setup rate limiter, maximum of 100 requests per 15 minutes
app.use(RateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
}));

// --- Authentication middleware (single) ---
// Detect API requests and browser requests. API requests return 401 JSON, browser requests redirect to /login.
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();

  // Heuristics to detect API requests:
  // - X-Requested-With: XMLHttpRequest (old-style AJAX)
  // - Accept header prefers JSON (application/json)
  // - URL path starts with /api/
  const acceptsJSON = req.get('Accept') && req.get('Accept').includes('application/json');
  const isAjax = req.get('X-Requested-With') === 'XMLHttpRequest';
  const isApiPath = req.path && req.path.startsWith('/api/');

  if (acceptsJSON || isAjax || isApiPath) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Otherwise treat as a browser route: include the original URL as a redirect parameter
  const original = req.originalUrl || req.url || '/';
  const redirectTo = '/login?redirect=' + encodeURIComponent(original);
  return res.redirect(redirectTo);
}

// Serve login page from views (moved from public)
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

// Redirect root to the main form. The form route will enforce authentication
app.get('/', (req, res) => res.redirect('/containers'));

// --- Nodemailer Setup ---
const transporter = nodemailer.createTransport({
  host: "opensource.mieweb.org",
  port: 25,
  secure: false, // use STARTTLS if supported
  tls: {
    rejectUnauthorized: false, // allow self-signed certs
  },
});

// --- Routes ---
const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

// Serves the main container creation form
app.get('/containers/new', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'form.html'));
});

// Handles login
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  const response = await axios.request({
    method: 'post',
    url: 'https://10.15.0.4:8006/api2/json/access/ticket',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    httpsAgent: new https.Agent({
      rejectUnauthorized: true, // Enable validation
      servername: 'opensource.mieweb.org' // Expected hostname in the certificate
    }),
    data: qs.stringify({ username: username + '@pve', password: password })
  });

  if (response.status !== 200) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  req.session.user = username;
  req.session.proxmoxUsername = username;
  req.session.proxmoxPassword = password;

  return res.json({ success: true, redirect: req?.query?.redirect || '/' });
});

// Fetch user's containers
app.get('/containers', requireAuth, async (req, res) => {
  const username = req.session.user.split('@')[0];
  // eager-load related services
  const containers = await Container.findAll({ where: { username }, include: [{ association: 'services' }] });

  // Map containers to view models
  const rows = containers.map(c => {
    const services = c.services || [];
    // sshPort: externalPort of service with type tcp and internalPort 22
    const ssh = services.find(s => s.type === 'tcp' && Number(s.internalPort) === 22);
    const sshPort = ssh ? ssh.externalPort : null;
    // httpPort: internalPort of first service type http
    const http = services.find(s => s.type === 'http');
    const httpPort = http ? http.internalPort : null;
    return {
      hostname: c.hostname,
      ipv4Address: c.ipv4Address,
      osRelease: c.osRelease,
      sshPort,
      httpPort
    };
  });

  return res.render('containers', { rows });
});

// Create container
app.post('/containers', async (req, res) => {
  const isInit = req.body.init === 'true' || req.body.init === true;
  
  // Only require auth for init=true (user-initiated container creation)
  if (isInit) {
    return requireAuth(req, res, () => {
      // User-initiated container creation via web form
      const jobId = crypto.randomUUID();
      
      // Map standard form field names to the environment variable names expected by the script
      const commandEnv = {
        ...process.env,
        CONTAINER_NAME: req.body.hostname,
        LINUX_DISTRIBUTION: req.body.osRelease,
        HTTP_PORT: req.body.httpPort,
        AI_CONTAINER: req.body.aiContainer || 'N',
        PROXMOX_USERNAME: req.session.proxmoxUsername,
        PROXMOX_PASSWORD: req.session.proxmoxPassword
      };
      const scriptPath = '/opt/container-creator/create-container-wrapper.sh';
      
      jobs[jobId] = { status: 'running', output: '' };

      const command = `${scriptPath} 2>&1`;
      const child = spawn('bash', ['-c', command], { env: commandEnv });

      child.stdout.on('data', (data) => {
        const message = data.toString();
        console.log(`[${jobId}]: ${message.trim()}`);
        jobs[jobId].output += message;
      });

      child.on('close', (code) => {
        console.log(`[${jobId}] process exited with code ${code}`);
        jobs[jobId].status = (code === 0) ? 'completed' : 'failed';
      });

      return res.redirect(`/status/${jobId}`);
    });
  }
  
  // handle non-init container creation (e.g., admin API)
  const container = await Container.create(req.body);
  const httpService = await Service.create({
    containerId: container.id,
    type: 'http',
    internalPort: req.body.httpPort,
    externalPort: null,
    tls: null,
    externalHostname: container.hostname
  });
  const sshService = await Service.create({
    containerId: container.id,
    type: 'tcp',
    internalPort: 22,
    externalPort: req.body.sshPort,
    tls: false,
    externalHostname: null
  });
  if (req.body.additionalPorts && req.body.additionalProtocols) {
    const additionalPorts = req.body.additionalPorts.split(',').map(p => p.trim());
    const additionalProtocols = req.body.additionalProtocols.split(',').map(p => p.trim().toLowerCase()); 
    for (let i = 0; i < additionalPorts.length; i++) {
      const port = parseInt(additionalPorts[i], 10);
      const protocol = additionalProtocols[i].toLowerCase();
      const defaultPort = serviceMap[protocol].port;
      const underlyingProtocol = serviceMap[protocol].protocol;
      const additionalService = await Service.create({
        containerId: container.id,
        type: underlyingProtocol,
        internalPort: defaultPort,
        externalPort: port,
        tls: false,
        externalHostname: null
      });
    }
  }
  return res.json({ success: true });
});

// Job status page
app.get('/status/:jobId', requireAuth, (req, res) => {
  if (!jobs[req.params.jobId]) {
    return res.status(404).send("Job not found.");
  }
  res.sendFile(path.join(__dirname, 'views', 'status.html'));
});

// Log streaming
app.get('/api/stream/:jobId', (req, res) => {
  const { jobId } = req.params;
  if (!jobs[jobId]) {
    return res.status(404).end();
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  res.write(`data: ${JSON.stringify(jobs[jobId].output)}\n\n`);

  let lastSentLength = jobs[jobId].output.length;
  const intervalId = setInterval(() => {
    const currentOutput = jobs[jobId].output;
    if (currentOutput.length > lastSentLength) {
      const newData = currentOutput.substring(lastSentLength);
      res.write(`data: ${JSON.stringify(newData)}\n\n`);
      lastSentLength = currentOutput.length;
    }

    if (jobs[jobId].status !== 'running') {
      res.write(`event: close\ndata: Process finished with status: ${jobs[jobId].status}\n\n`);
      clearInterval(intervalId);
      res.end();
    }
  }, 500);

  req.on('close', () => {
    clearInterval(intervalId);
    res.end();
  });
});

// Serve the account request form
app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'request-account.html'));
});

app.post('/register', (req, res) => {
  const { firstName, lastName, email, conclusionDate, reason } = req.body;

  const details = `
New intern account request received for ${firstName} ${lastName}:

Name: ${firstName} ${lastName}
Email: ${email}
Anticipated Intern Conclusion Date: ${conclusionDate}
Reason: ${reason}
`;

  const mailCmd = `echo "${details}" | mail -r accounts@opensource.mieweb.org -s "New Intern Account Request" devopsalerts@mieweb.com`;

  exec(mailCmd, (err, stdout, stderr) => {
    if (err) {
      console.error('Error sending email:', err);
      console.error('stderr:', stderr);
      return res.status(500).json({ error: 'Failed to send email notification to DevOps.' });
    } else {
      console.log('DevOps notification sent successfully');
      console.log('stdout:', stdout);
      return res.json({ success: true, message: 'Account request submitted successfully.' });
    }
  });
});


// --- Email Test Endpoint ---
app.get('/send-test-email', async (req, res) => {
  try {
    const info = await transporter.sendMail({
      from: "accounts@opensource.mieweb.org",
      to: "devopsalerts@mieweb.com",
      subject: "Test email from opensource.mieweb.org",
      text: "testing emails from opensource.mieweb.org"
    });

    console.log("Email sent:", info.response);
    res.send(`✅ Email sent successfully: ${info.response}`);
  } catch (err) {
    console.error("Email send error:", err);
    res.status(500).send(`❌ Email failed: ${err.message}`);
  }
});

// Handles logout
app.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
      return res.status(500).json({ error: 'Failed to log out.' });
    }
    res.clearCookie('connect.sid'); // Clear the session cookie
    return res.redirect('/');
  });
});