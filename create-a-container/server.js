require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const { spawn, exec } = require('child_process');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer'); // <-- added
const axios = require('axios');
const qs = require('querystring');
const https = require('https');

const app = express();
app.use(express.json());

app.set('trust proxy', 1);

const jobs = {};

// --- Middleware Setup ---
if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET is not set in environment!");
}

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: { secure: true }
}));

app.use(express.static('public'));

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
app.get('/', (req, res) => res.redirect('/containers/new'));

// --- Rate Limiter for Login ---
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: { error: "Too many login attempts. Please try again later." }
});

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
app.post('/login', loginLimiter, async (req, res) => {
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
app.get('/api/my-containers', requireAuth, (req, res) => {
  const username = req.session.user.split('@')[0];
  const command = "ssh root@10.15.20.69 'cat /etc/nginx/port_map.json'";

  exec(command, (err, stdout, stderr) => {
    if (err) {
      console.error("Error fetching port_map.json:", stderr);
      return res.status(500).json({ error: "Could not fetch container list." });
    }
    try {
      const portMap = JSON.parse(stdout);
      const userContainers = Object.entries(portMap)
        .filter(([_, details]) => details && details.user === username)
        .map(([name, details]) => ({ name, ...details }));
      res.json(userContainers);
    } catch (parseError) {
      console.error("Error parsing port_map.json:", parseError);
      res.status(500).json({ error: "Could not parse container list." });
    }
  });
});

// Create container
app.post('/containers', requireAuth, (req, res) => {
  const jobId = crypto.randomUUID();
  const commandEnv = {
    ...process.env,
    ...req.body,
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

  res.json({ success: true, redirect: `/status/${jobId}` });
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

// Apply a rate limiter to protect the request-account form
const requestAccountLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: 10, // limit each IP to 10 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});

app.get('/register', requestAccountLimiter, (req, res) => {
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