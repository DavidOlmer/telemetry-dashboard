const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3200;
const PAPERCLIP_API_URL = process.env.PAPERCLIP_API_URL || 'http://localhost:3100';
const PAPERCLIP_API_KEY = process.env.PAPERCLIP_API_KEY || '';
const PAPERCLIP_COMPANY_ID = process.env.PAPERCLIP_COMPANY_ID || '';

// ============================================
// PAPERCLIP API PROXY LAYER
// ============================================
function paperclipGet(apiPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(apiPath, PAPERCLIP_API_URL);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Authorization': `Bearer ${PAPERCLIP_API_KEY}` }
    };
    http.get(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse response from ${apiPath}: ${data.substring(0, 200)}`));
        }
      });
    }).on('error', reject);
  });
}

// Cache with TTL to avoid hammering Paperclip API
const cache = {};
function cachedGet(key, apiPath, ttlMs) {
  const now = Date.now();
  if (cache[key] && (now - cache[key].ts) < ttlMs) {
    return Promise.resolve(cache[key].data);
  }
  return paperclipGet(apiPath).then(data => {
    cache[key] = { data, ts: now };
    return data;
  });
}

// ============================================
// API HANDLERS
// ============================================
const apiHandlers = {
  '/api/agents': async () => {
    const agents = await cachedGet('agents', `/api/companies/${PAPERCLIP_COMPANY_ID}/agents`, 5000);
    const mapped = agents.map(a => ({
      id: a.urlKey || a.id,
      name: a.name,
      role: a.title || a.role || 'Agent',
      status: a.status || 'idle',
      lastSeen: a.lastHeartbeatAt || a.updatedAt,
      tokensUsed: a.spentMonthlyCents || 0,
      tasksCompleted: 0,
      tasksFailed: 0,
      pauseReason: a.pauseReason,
    }));
    return { agents: mapped, timestamp: new Date() };
  },

  '/api/stats': async () => {
    const [agents, dashboard] = await Promise.all([
      cachedGet('agents', `/api/companies/${PAPERCLIP_COMPANY_ID}/agents`, 5000),
      cachedGet('dashboard', `/api/companies/${PAPERCLIP_COMPANY_ID}/dashboard`, 10000),
    ]);

    const totalAgents = agents.length;
    const activeAgents = agents.filter(a => a.status === 'running').length;
    const errorAgents = agents.filter(a => a.status === 'error').length;

    const taskStats = dashboard.tasks || {};
    const totalTasks = (taskStats.total || 0);
    const completedTasks = (taskStats.done || 0);
    const completionRate = totalTasks > 0 ? ((completedTasks / totalTasks) * 100).toFixed(1) : '0.0';

    const costInfo = dashboard.costs || {};
    const totalCostCents = costInfo.totalMonthlyCents || agents.reduce((s, a) => s + (a.spentMonthlyCents || 0), 0);

    const tokensByAgent = agents.map(a => ({
      agent: a.name,
      tokens: a.spentMonthlyCents || 0,
    }));

    // Generate hourly activity from available data (placeholder until run-level data is available)
    const hourlyTokens = Array.from({ length: 24 }, (_, i) => ({
      hour: new Date(Date.now() - (23 - i) * 3600000).toISOString(),
      tokens: 0,
    }));

    return {
      summary: {
        totalAgents,
        activeAgents,
        errorAgents,
        totalTasks,
        completedTasks,
        completionRate,
        totalCostCents,
      },
      hourlyTokens,
      tokensByAgent,
      timestamp: new Date(),
    };
  },

  '/api/runs': async (url) => {
    const params = new URL(url, 'http://localhost').searchParams;
    const limit = parseInt(params.get('limit')) || 20;

    // Fetch issues with recent activity as a proxy for runs
    const issues = await cachedGet('recent-issues',
      `/api/companies/${PAPERCLIP_COMPANY_ID}/issues?status=done,in_progress&limit=${limit}`, 15000);

    const runs = (Array.isArray(issues) ? issues : []).slice(0, limit).map(i => ({
      id: i.identifier || i.id,
      agentId: i.executionAgentNameKey || i.assigneeAgentId || 'unknown',
      startedAt: i.startedAt || i.createdAt,
      duration: i.completedAt && i.startedAt
        ? Math.round((new Date(i.completedAt) - new Date(i.startedAt)) / 1000)
        : 0,
      status: i.status === 'done' ? 'completed' : i.status,
      tokensUsed: 0,
      title: i.title,
    }));

    return { runs, total: runs.length, timestamp: new Date() };
  },

  '/api/health': () => ({ status: 'ok', uptime: process.uptime(), paperclipUrl: PAPERCLIP_API_URL }),
};

// ============================================
// HTTP SERVER
// ============================================
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const urlPath = req.url.split('?')[0];

  // API routes
  if (urlPath.startsWith('/api/')) {
    const handler = apiHandlers[urlPath] || apiHandlers[urlPath.replace(/\?.*/, '')];
    if (handler) {
      try {
        const result = await handler(req.url);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        console.error(`API error on ${urlPath}:`, err.message);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Upstream API error', detail: err.message }));
      }
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  // Static files
  let filePath = path.join(__dirname, '../frontend', urlPath === '/' ? 'index.html' : urlPath);
  const ext = path.extname(filePath);
  const contentType = mimeTypes[ext] || 'text/plain';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        fs.readFile(path.join(__dirname, '../frontend/index.html'), (e, c) => {
          if (e) {
            res.writeHead(500);
            res.end('Server error');
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(c);
          }
        });
      } else {
        res.writeHead(500);
        res.end('Server error');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Telemetry Dashboard running on http://localhost:${PORT}`);
  console.log(`Paperclip API: ${PAPERCLIP_API_URL} | Company: ${PAPERCLIP_COMPANY_ID}`);
});
