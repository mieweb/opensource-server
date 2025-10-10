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
app.get('/form.html', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'views', 'form.html'));
});

// Handles login
app.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  const runner = spawn('node', ['/root/bin/js/runner.js', 'authenticateUser', username, password]);
  let stdoutData = '';
  let stderrData = '';

  runner.stdout.on('data', (data) => {
    stdoutData += data.toString();
  });

  runner.stderr.on('data', (data) => {
    stderrData += data.toString();
  });

  runner.on('close', (code) => {
    if (code !== 0) {
      console.error("Login script execution error:", stderrData);
      return res.status(500).json({ error: "Server error during authentication." });
    }

    if (stdoutData.trim() === 'true') {
      req.session.user = username;
      req.session.proxmoxUsername = username;
      req.session.proxmoxPassword = password;
      return res.json({ success: true, redirect: '/form.html' });
    } else {
      return res.status(401).json({ error: "Invalid credentials" });
    }
  });
});

// Fetch user's containers
app.get('/api/my-containers', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
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
app.post('/create-container', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

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
app.get('/status/:jobId', (req, res) => {
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
app.get('/request-account.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'request-account.html'));
  });

app.post('/request-account', (req, res) => {
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