/**
 * 1Money Shared Database & Real-Time Sync Server
 * Serves all 3 copies (Desktop, iPhone, iPad) from a single persistent,
 * zero-loss database with:
 * - 3 Live Balance Counters: Total Balance, Card Only Balance, Cash Only Balance
 * - Full Income Tracker (requires Card or Cash + Source/From Where)
 * - Full Payment Tracker (requires Card or Cash + For What + Where)
 * - Automatic 1st-of-the-month spending limit reset (with monthly archive)
 * - 1-Hour "Was it worth it?" notification scheduler & Windows Toast notifier
 * - Offline-first bi-directional sync across iPhone, iPad, and Desktop
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { exec } = require('child_process');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3456;
const ROOT_DIR = path.resolve(__dirname, '..');
const DB_DIR = path.join(ROOT_DIR, 'database');
const BACKUP_DIR = path.join(DB_DIR, 'backups');
const DB_FILE = path.join(DB_DIR, '1money-db.json');
const AUDIT_FILE = path.join(DB_DIR, '1money-audit.jsonl');

// Ensure database directories exist
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

function getCurrentMonthKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function formatMonthLabel(monthKey) {
  const [y, m] = String(monthKey || '').split('-').map(Number);
  const d = new Date(y || new Date().getFullYear(), (m || 1) - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function getNextResetInfo(now = new Date()) {
  const nextMonthFirst = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
  const diffMs = nextMonthFirst.getTime() - now.getTime();
  const daysLeft = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  return {
    nextResetTimestamp: nextMonthFirst.getTime(),
    nextResetDateFormatted: nextMonthFirst.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }),
    daysUntilReset: daysLeft
  };
}

function roundCurrency(val) {
  return Math.round((Number(val) + Number.EPSILON) * 100) / 100;
}

function createInitialDatabase() {
  const now = Date.now();
  return {
    version: 2,
    currency: '$',
    cardBalance: 0,
    cashBalance: 0,
    savingsBalance: 0, // Total Balance = cardBalance + cashBalance
    monthlyLimit: 1000,
    settingsUpdatedAt: now,
    currentMonthKey: getCurrentMonthKey(),
    updatedAt: now,
    payments: [],
    incomes: [],
    savingsLogs: [],
    monthlyArchives: {}
  };
}

function appendAuditLog(event, payload) {
  try {
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      epoch: Date.now(),
      event,
      payload
    });
    fs.appendFileSync(AUDIT_FILE, entry + '\n', 'utf8');
  } catch (err) {
    console.error('[AuditLog Error]', err.message);
  }
}

function loadDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      return normalizeAndCheckMonthRollover(parsed);
    }
  } catch (err) {
    console.error('[DB Load Error, checking backups]', err.message);
    try {
      const backups = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse();
      if (backups.length > 0) {
        const latestBackup = path.join(BACKUP_DIR, backups[0]);
        const recovered = JSON.parse(fs.readFileSync(latestBackup, 'utf8'));
        return normalizeAndCheckMonthRollover(recovered);
      }
    } catch (backupErr) {
      console.error('[Backup Recovery Error]', backupErr.message);
    }
  }
  const initial = createInitialDatabase();
  saveDatabase(initial, 'INIT_DB');
  return initial;
}

let lastSnapshotTime = 0;
function saveDatabase(db, reason = 'UPDATE') {
  db.cardBalance = roundCurrency(db.cardBalance || 0);
  db.cashBalance = roundCurrency(db.cashBalance || 0);
  db.savingsBalance = roundCurrency(db.cardBalance + db.cashBalance);
  db.updatedAt = Date.now();

  const serialized = JSON.stringify(db, null, 2);
  const tempFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(tempFile, serialized, 'utf8');
  fs.renameSync(tempFile, DB_FILE);

  const now = Date.now();
  if (now - lastSnapshotTime > 5 * 60 * 1000 || reason === 'MONTH_ROLLOVER' || reason === 'INIT_DB') {
    lastSnapshotTime = now;
    const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(BACKUP_DIR, `1money-backup-${stamp}.json`);
    try {
      fs.writeFileSync(backupFile, serialized, 'utf8');
      const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('1money-backup-') && f.endsWith('.json'))
        .sort();
      while (files.length > 40) {
        const oldest = files.shift();
        fs.unlinkSync(path.join(BACKUP_DIR, oldest));
      }
    } catch (e) {}
  }
}

function normalizeAndCheckMonthRollover(db) {
  if (!db || typeof db !== 'object') db = createInitialDatabase();
  if (typeof db.currency !== 'string' || !db.currency) db.currency = '$';
  if (!Array.isArray(db.payments)) db.payments = [];
  if (!Array.isArray(db.incomes)) db.incomes = [];
  if (!Array.isArray(db.savingsLogs)) db.savingsLogs = [];
  if (!db.monthlyArchives || typeof db.monthlyArchives !== 'object') db.monthlyArchives = {};

  // Migrate legacy v1 savingsBalance if cardBalance/cashBalance were not yet split
  if (typeof db.cardBalance !== 'number' || Number.isNaN(db.cardBalance)) {
    db.cardBalance = typeof db.savingsBalance === 'number' && !Number.isNaN(db.savingsBalance) ? roundCurrency(db.savingsBalance) : 0;
  }
  if (typeof db.cashBalance !== 'number' || Number.isNaN(db.cashBalance)) {
    db.cashBalance = 0;
  }
  db.cardBalance = roundCurrency(db.cardBalance);
  db.cashBalance = roundCurrency(db.cashBalance);
  db.savingsBalance = roundCurrency(db.cardBalance + db.cashBalance);

  if (typeof db.monthlyLimit !== 'number' || Number.isNaN(db.monthlyLimit)) db.monthlyLimit = 1000;
  if (typeof db.settingsUpdatedAt !== 'number') db.settingsUpdatedAt = db.updatedAt || Date.now();

  const actualMonthKey = getCurrentMonthKey();
  if (!db.currentMonthKey) {
    db.currentMonthKey = actualMonthKey;
  } else if (db.currentMonthKey !== actualMonthKey) {
    const prevKey = db.currentMonthKey;
    const prevPayments = db.payments.filter(p => !p.deleted && p.monthKey === prevKey);
    const prevIncomes = db.incomes.filter(inc => !inc.deleted && inc.monthKey === prevKey);

    const totalSpent = roundCurrency(prevPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0));
    const cardSpent = roundCurrency(prevPayments.filter(p => p.method === 'card').reduce((sum, p) => sum + (Number(p.amount) || 0), 0));
    const cashSpent = roundCurrency(prevPayments.filter(p => p.method === 'cash').reduce((sum, p) => sum + (Number(p.amount) || 0), 0));

    const totalIncome = roundCurrency(prevIncomes.reduce((sum, i) => sum + (Number(i.amount) || 0), 0));
    const cardIncome = roundCurrency(prevIncomes.filter(i => i.method === 'card').reduce((sum, i) => sum + (Number(i.amount) || 0), 0));
    const cashIncome = roundCurrency(prevIncomes.filter(i => i.method === 'cash').reduce((sum, i) => sum + (Number(i.amount) || 0), 0));

    const worthItYes = prevPayments.filter(p => p.worthIt === 'yes').length;
    const worthItNo = prevPayments.filter(p => p.worthIt === 'no').length;

    db.monthlyArchives[prevKey] = {
      monthKey: prevKey,
      monthLabel: formatMonthLabel(prevKey),
      totalSpent,
      cardSpent,
      cashSpent,
      totalIncome,
      cardIncome,
      cashIncome,
      monthlyLimit: db.monthlyLimit,
      paymentCount: prevPayments.length,
      incomeCount: prevIncomes.length,
      worthItYes,
      worthItNo,
      archivedAt: Date.now()
    };

    db.currentMonthKey = actualMonthKey;
    appendAuditLog('MONTHLY_RESET_ON_1ST', {
      previousMonth: prevKey,
      newMonth: actualMonthKey,
      archivedSummary: db.monthlyArchives[prevKey]
    });
    saveDatabase(db, 'MONTH_ROLLOVER');
  }

  return db;
}

function computeEnrichedState(db) {
  normalizeAndCheckMonthRollover(db);
  const now = Date.now();
  const currentMonthKey = db.currentMonthKey;

  const activePayments = db.payments
    .filter(p => !p.deleted)
    .sort((a, b) => b.createdAt - a.createdAt);

  const activeIncomes = db.incomes
    .filter(inc => !inc.deleted)
    .sort((a, b) => b.createdAt - a.createdAt);

  const currentMonthPayments = activePayments.filter(p => p.monthKey === currentMonthKey);
  const currentMonthSpent = roundCurrency(
    currentMonthPayments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0)
  );
  const currentMonthCardSpent = roundCurrency(
    currentMonthPayments.filter(p => p.method === 'card').reduce((acc, p) => acc + (Number(p.amount) || 0), 0)
  );
  const currentMonthCashSpent = roundCurrency(
    currentMonthPayments.filter(p => p.method === 'cash').reduce((acc, p) => acc + (Number(p.amount) || 0), 0)
  );

  const currentMonthIncomes = activeIncomes.filter(inc => inc.monthKey === currentMonthKey);
  const currentMonthIncome = roundCurrency(
    currentMonthIncomes.reduce((acc, inc) => acc + (Number(inc.amount) || 0), 0)
  );
  const currentMonthCardIncome = roundCurrency(
    currentMonthIncomes.filter(inc => inc.method === 'card').reduce((acc, inc) => acc + (Number(inc.amount) || 0), 0)
  );
  const currentMonthCashIncome = roundCurrency(
    currentMonthIncomes.filter(inc => inc.method === 'cash').reduce((acc, inc) => acc + (Number(inc.amount) || 0), 0)
  );

  const allTimeSpent = roundCurrency(
    activePayments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0)
  );
  const allTimeCardSpent = roundCurrency(
    activePayments.filter(p => p.method === 'card').reduce((acc, p) => acc + (Number(p.amount) || 0), 0)
  );
  const allTimeCashSpent = roundCurrency(
    activePayments.filter(p => p.method === 'cash').reduce((acc, p) => acc + (Number(p.amount) || 0), 0)
  );

  const allTimeIncome = roundCurrency(
    activeIncomes.reduce((acc, inc) => acc + (Number(inc.amount) || 0), 0)
  );
  const allTimeCardIncome = roundCurrency(
    activeIncomes.filter(inc => inc.method === 'card').reduce((acc, inc) => acc + (Number(inc.amount) || 0), 0)
  );
  const allTimeCashIncome = roundCurrency(
    activeIncomes.filter(inc => inc.method === 'cash').reduce((acc, inc) => acc + (Number(inc.amount) || 0), 0)
  );

  const worthItYesPayments = activePayments.filter(p => p.worthIt === 'yes');
  const worthItNoPayments = activePayments.filter(p => p.worthIt === 'no');
  const worthItYesAmount = roundCurrency(worthItYesPayments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0));
  const worthItNoAmount = roundCurrency(worthItNoPayments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0));

  const dueWorthItPayments = activePayments.filter(
    p => p.worthIt === 'pending' && now >= p.notifyAt
  );
  const upcomingWorthItPayments = activePayments.filter(
    p => p.worthIt === 'pending' && now < p.notifyAt
  );

  const recentWhats = [...new Set(activePayments.map(p => p.what).filter(Boolean))].slice(0, 10);
  const recentWheres = [...new Set(activePayments.map(p => p.where).filter(Boolean))].slice(0, 10);
  const recentIncomeSources = [...new Set(activeIncomes.map(i => i.source).filter(Boolean))].slice(0, 10);

  const monthBuckets = { ...db.monthlyArchives };
  for (const p of activePayments) {
    const mk = p.monthKey || getCurrentMonthKey(new Date(p.createdAt));
    if (!monthBuckets[mk]) {
      monthBuckets[mk] = { monthKey: mk, monthLabel: formatMonthLabel(mk), monthlyLimit: db.monthlyLimit };
    }
  }
  for (const inc of activeIncomes) {
    const mk = inc.monthKey || getCurrentMonthKey(new Date(inc.createdAt));
    if (!monthBuckets[mk]) {
      monthBuckets[mk] = { monthKey: mk, monthLabel: formatMonthLabel(mk), monthlyLimit: db.monthlyLimit };
    }
  }
  if (!monthBuckets[currentMonthKey]) {
    monthBuckets[currentMonthKey] = {
      monthKey: currentMonthKey,
      monthLabel: formatMonthLabel(currentMonthKey),
      monthlyLimit: db.monthlyLimit
    };
  }

  for (const mk of Object.keys(monthBuckets)) {
    const mPayments = activePayments.filter(p => (p.monthKey || getCurrentMonthKey(new Date(p.createdAt))) === mk);
    const mIncomes = activeIncomes.filter(i => (i.monthKey || getCurrentMonthKey(new Date(i.createdAt))) === mk);
    monthBuckets[mk] = {
      ...monthBuckets[mk],
      monthKey: mk,
      monthLabel: formatMonthLabel(mk),
      totalSpent: roundCurrency(mPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0)),
      cardSpent: roundCurrency(mPayments.filter(p => p.method === 'card').reduce((s, p) => s + (Number(p.amount) || 0), 0)),
      cashSpent: roundCurrency(mPayments.filter(p => p.method === 'cash').reduce((s, p) => s + (Number(p.amount) || 0), 0)),
      totalIncome: roundCurrency(mIncomes.reduce((s, i) => s + (Number(i.amount) || 0), 0)),
      cardIncome: roundCurrency(mIncomes.filter(i => i.method === 'card').reduce((s, i) => s + (Number(i.amount) || 0), 0)),
      cashIncome: roundCurrency(mIncomes.filter(i => i.method === 'cash').reduce((s, i) => s + (Number(i.amount) || 0), 0)),
      paymentCount: mPayments.length,
      incomeCount: mIncomes.length,
      worthItYes: mPayments.filter(p => p.worthIt === 'yes').length,
      worthItNo: mPayments.filter(p => p.worthIt === 'no').length
    };
  }

  const limitRemaining = roundCurrency(db.monthlyLimit - currentMonthSpent);
  const limitPercent = db.monthlyLimit > 0
    ? Math.min(999, Math.round((currentMonthSpent / db.monthlyLimit) * 1000) / 10)
    : 0;

  return {
    ...db,
    cardBalance: roundCurrency(db.cardBalance),
    cashBalance: roundCurrency(db.cashBalance),
    savingsBalance: roundCurrency(db.cardBalance + db.cashBalance),
    payments: activePayments,
    incomes: activeIncomes,
    computed: {
      serverTime: now,
      currentMonthKey,
      currentMonthLabel: formatMonthLabel(currentMonthKey),
      currentMonthSpent,
      currentMonthCardSpent,
      currentMonthCashSpent,
      currentMonthCount: currentMonthPayments.length,
      currentMonthIncome,
      currentMonthCardIncome,
      currentMonthCashIncome,
      currentMonthIncomeCount: currentMonthIncomes.length,
      limitRemaining,
      limitPercent,
      isOverLimit: db.monthlyLimit > 0 && currentMonthSpent > db.monthlyLimit,
      isNearLimit: db.monthlyLimit > 0 && currentMonthSpent >= db.monthlyLimit * 0.8 && currentMonthSpent <= db.monthlyLimit,
      allTimeSpent,
      allTimeCardSpent,
      allTimeCashSpent,
      allTimeIncome,
      allTimeCardIncome,
      allTimeCashIncome,
      totalPaymentCount: activePayments.length,
      totalIncomeCount: activeIncomes.length,
      worthItYesCount: worthItYesPayments.length,
      worthItNoCount: worthItNoPayments.length,
      worthItYesAmount,
      worthItNoAmount,
      dueWorthItPayments,
      upcomingWorthItPayments,
      recentWhats,
      recentWheres,
      recentIncomeSources,
      monthlyHistory: Object.values(monthBuckets).sort((a, b) => b.monthKey.localeCompare(a.monthKey)),
      resetInfo: getNextResetInfo(new Date(now)),
      lanAddresses: getLanAddresses(),
      port: PORT
    }
  };
}

function getLanAddresses() {
  const nets = os.networkInterfaces();
  const results = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254.')) {
        results.push({
          interface: name,
          address: net.address,
          iphoneUrl: `http://${net.address}:${PORT}/iphone`,
          ipadUrl: `http://${net.address}:${PORT}/ipad`,
          desktopUrl: `http://${net.address}:${PORT}/desktop`
        });
      }
    }
  }
  results.sort((a, b) => {
    const aVirtual = /vmware|vbox|virtual|vethernet|wsl|hyper-v/i.test(a.interface) ? 1 : 0;
    const bVirtual = /vmware|vbox|virtual|vethernet|wsl|hyper-v/i.test(b.interface) ? 1 : 0;
    return aVirtual - bVirtual;
  });
  return results;
}

function triggerWindowsDesktopNotification(title, message) {
  if (process.platform !== 'win32') return;
  const safeTitle = String(title).replace(/'/g, "''").replace(/`/g, '');
  const safeMsg = String(message).replace(/'/g, "''").replace(/`/g, '');
  const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Information
$notify.Visible = $true
$notify.ShowBalloonTip(10000, '${safeTitle}', '${safeMsg}', [System.Windows.Forms.ToolTipIcon]::Info)
Start-Sleep -Seconds 6
$notify.Dispose()
`.trim();
  const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
  exec(`powershell -NoProfile -WindowStyle Hidden -EncodedCommand ${encoded}`, () => {});
}

let db = loadDatabase();
const sseClients = new Set();

function broadcastState(eventType = 'STATE_UPDATED', extra = {}) {
  const payload = JSON.stringify({
    type: eventType,
    extra,
    state: computeEnrichedState(db)
  });
  for (const res of sseClients) {
    try {
      res.write(`data: ${payload}\n\n`);
    } catch (err) {
      sseClients.delete(res);
    }
  }
}

setInterval(() => {
  const now = Date.now();
  let changed = false;

  const prevMonthKey = db.currentMonthKey;
  normalizeAndCheckMonthRollover(db);
  if (db.currentMonthKey !== prevMonthKey) {
    changed = true;
  }

  for (const payment of db.payments) {
    if (!payment.deleted && payment.worthIt === 'pending' && !payment.notificationSent && now >= payment.notifyAt) {
      payment.notificationSent = true;
      payment.updatedAt = now;
      changed = true;

      const formattedAmt = `${db.currency}${Number(payment.amount).toFixed(2)}`;
      const methodLabel = payment.method === 'cash' ? 'Cash' : 'Card';
      const title = 'Was it worth it? 💭';
      const body = `1 hour ago you spent ${formattedAmt} (${methodLabel}) on "${payment.what}" at "${payment.where}". Was it worth it?`;

      appendAuditLog('WORTH_IT_1HR_NOTIFICATION_FIRED', {
        paymentId: payment.id,
        amount: payment.amount,
        what: payment.what,
        where: payment.where
      });

      triggerWindowsDesktopNotification(title, body);
      saveDatabase(db, 'WORTH_IT_DUE');
      broadcastState('WORTH_IT_NOTIFICATION_DUE', {
        payment,
        title,
        body
      });
    }
  }

  if (changed) {
    saveDatabase(db, 'BACKGROUND_TICK');
    broadcastState('STATE_UPDATED');
  }
}, 5000).unref();

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 10 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Device-Edition',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ipa': 'application/octet-stream',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

function serveStaticFile(res, filePath) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache'
  });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Device-Edition'
    });
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  try {
    // 1. Real-Time SSE stream
    if (pathname === '/api/events' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });
      res.write(`data: ${JSON.stringify({ type: 'INITIAL_STATE', state: computeEnrichedState(db) })}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    // 2. Get full database state
    if (pathname === '/api/state' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, state: computeEnrichedState(db) });
    }

    // 3. Set / Adjust Balances (Supports setting Card & Cash directly, or depositing/setting by target: 'card' | 'cash' | 'both')
    if (pathname === '/api/savings' && req.method === 'POST') {
      const body = await parseBody(req);
      const now = body.createdAt || Date.now();

      // If setting both cardBalance and cashBalance explicitly
      if (body.cardBalance !== undefined && body.cashBalance !== undefined) {
        const nextCard = roundCurrency(Number(body.cardBalance));
        const nextCash = roundCurrency(Number(body.cashBalance));
        if (Number.isNaN(nextCard) || Number.isNaN(nextCash)) {
          return sendJson(res, 400, { ok: false, error: 'Please enter valid Card and Cash balances.' });
        }
        const prevTotal = roundCurrency(db.cardBalance + db.cashBalance);
        db.cardBalance = nextCard;
        db.cashBalance = nextCash;
        db.savingsBalance = roundCurrency(nextCard + nextCash);

        const logEntry = {
          id: body.id || `sav_${now}_${crypto.randomBytes(3).toString('hex')}`,
          type: 'set-balances',
          target: 'both',
          cardBalance: nextCard,
          cashBalance: nextCash,
          amount: db.savingsBalance,
          previousBalance: prevTotal,
          newBalance: db.savingsBalance,
          note: String(body.note || 'Updated Card & Cash balances').trim(),
          deviceOrigin: String(body.deviceOrigin || 'desktop'),
          createdAt: now
        };
        db.savingsLogs.unshift(logEntry);
        appendAuditLog('BALANCES_SET', logEntry);
        saveDatabase(db, 'BALANCES_SET');
        broadcastState('SAVINGS_UPDATED', { logEntry });
        return sendJson(res, 200, { ok: true, state: computeEnrichedState(db), logEntry });
      }

      // Single target ('card' or 'cash') set/deposit
      const mode = body.mode || 'set'; // 'set' | 'deposit' | 'withdraw'
      const target = String(body.target || body.method || 'card').toLowerCase() === 'cash' ? 'cash' : 'card';
      const amount = roundCurrency(Number(body.amount));
      if (Number.isNaN(amount) || amount < 0) {
        return sendJson(res, 400, { ok: false, error: 'Please enter a valid amount.' });
      }

      const prevTotal = roundCurrency(db.cardBalance + db.cashBalance);
      if (target === 'cash') {
        if (mode === 'set') db.cashBalance = amount;
        else if (mode === 'deposit') db.cashBalance = roundCurrency(db.cashBalance + amount);
        else if (mode === 'withdraw') db.cashBalance = roundCurrency(db.cashBalance - amount);
      } else {
        if (mode === 'set') db.cardBalance = amount;
        else if (mode === 'deposit') db.cardBalance = roundCurrency(db.cardBalance + amount);
        else if (mode === 'withdraw') db.cardBalance = roundCurrency(db.cardBalance - amount);
      }
      db.savingsBalance = roundCurrency(db.cardBalance + db.cashBalance);

      const logEntry = {
        id: body.id || `sav_${now}_${crypto.randomBytes(3).toString('hex')}`,
        type: mode,
        target,
        amount,
        cardBalance: db.cardBalance,
        cashBalance: db.cashBalance,
        previousBalance: prevTotal,
        newBalance: db.savingsBalance,
        note: String(body.note || `Updated ${target.toUpperCase()} balance`).trim(),
        deviceOrigin: String(body.deviceOrigin || 'desktop'),
        createdAt: now
      };

      db.savingsLogs.unshift(logEntry);
      appendAuditLog('SAVINGS_UPDATED', logEntry);
      saveDatabase(db, 'SAVINGS_UPDATED');
      broadcastState('SAVINGS_UPDATED', { logEntry });

      return sendJson(res, 200, { ok: true, state: computeEnrichedState(db), logEntry });
    }

    // 4. Add New Income (Requires amount, method: 'card' | 'cash', source)
    // Adds directly to Card Balance (if Card) or Cash Balance (if Cash), and increases Total Balance!
    if (pathname === '/api/incomes' && req.method === 'POST') {
      const body = await parseBody(req);
      const amount = roundCurrency(Number(body.amount));
      const method = String(body.method || '').toLowerCase();
      const source = String(body.source || body.what || '').trim();
      const note = String(body.note || '').trim();

      if (Number.isNaN(amount) || amount <= 0) {
        return sendJson(res, 400, { ok: false, error: 'Please enter a valid income amount greater than 0.' });
      }
      if (method !== 'card' && method !== 'cash') {
        return sendJson(res, 400, { ok: false, error: 'Please choose how you received this income: Card or Cash.' });
      }
      if (!source) {
        return sendJson(res, 400, { ok: false, error: 'Please enter where this income came from (e.g., Salary, Gift, Freelance).' });
      }

      normalizeAndCheckMonthRollover(db);
      const now = body.createdAt ? Number(body.createdAt) : Date.now();
      const incomeId = body.id || `inc_${now}_${crypto.randomBytes(3).toString('hex')}`;

      const existing = db.incomes.find(i => i.id === incomeId);
      if (existing) {
        return sendJson(res, 200, { ok: true, income: existing, state: computeEnrichedState(db) });
      }

      const income = {
        id: incomeId,
        amount,
        method, // 'card' | 'cash'
        source,
        note,
        createdAt: now,
        monthKey: getCurrentMonthKey(new Date(now)),
        deviceOrigin: String(body.deviceOrigin || 'desktop'),
        updatedAt: now,
        deleted: false
      };

      if (method === 'cash') {
        db.cashBalance = roundCurrency(db.cashBalance + amount);
      } else {
        db.cardBalance = roundCurrency(db.cardBalance + amount);
      }
      db.savingsBalance = roundCurrency(db.cardBalance + db.cashBalance);
      db.incomes.unshift(income);

      appendAuditLog('INCOME_ADDED', {
        income,
        cardBalance: db.cardBalance,
        cashBalance: db.cashBalance,
        totalBalance: db.savingsBalance
      });
      saveDatabase(db, 'INCOME_ADDED');
      broadcastState('INCOME_ADDED', { income });

      return sendJson(res, 201, { ok: true, income, state: computeEnrichedState(db) });
    }

    // 5. Delete an Income entry (subtracts back from Card or Cash balance)
    if (pathname.startsWith('/api/incomes/') && req.method === 'DELETE') {
      const parts = pathname.split('/');
      const incomeId = parts[3];
      const income = db.incomes.find(i => i.id === incomeId);
      if (!income || income.deleted) {
        return sendJson(res, 404, { ok: false, error: 'Income record not found.' });
      }

      income.deleted = true;
      income.updatedAt = Date.now();
      if (income.method === 'cash') {
        db.cashBalance = roundCurrency(db.cashBalance - Number(income.amount));
      } else {
        db.cardBalance = roundCurrency(db.cardBalance - Number(income.amount));
      }
      db.savingsBalance = roundCurrency(db.cardBalance + db.cashBalance);

      appendAuditLog('INCOME_DELETED', {
        incomeId,
        amount: income.amount,
        method: income.method,
        cardBalance: db.cardBalance,
        cashBalance: db.cashBalance,
        totalBalance: db.savingsBalance
      });
      saveDatabase(db, 'INCOME_DELETED');
      broadcastState('INCOME_DELETED', { incomeId });

      return sendJson(res, 200, { ok: true, state: computeEnrichedState(db) });
    }

    // 6. Set Monthly Spending Limit & Currency
    if (pathname === '/api/settings' && req.method === 'POST') {
      const body = await parseBody(req);
      if (body.monthlyLimit !== undefined) {
        const limit = roundCurrency(Number(body.monthlyLimit));
        if (Number.isNaN(limit) || limit < 0) {
          return sendJson(res, 400, { ok: false, error: 'Invalid monthly limit.' });
        }
        db.monthlyLimit = limit;
      }
      if (typeof body.currency === 'string' && body.currency.trim()) {
        db.currency = body.currency.trim().slice(0, 6);
      }
      db.settingsUpdatedAt = Date.now();
      appendAuditLog('SETTINGS_UPDATED', { monthlyLimit: db.monthlyLimit, currency: db.currency });
      saveDatabase(db, 'SETTINGS_UPDATED');
      broadcastState('SETTINGS_UPDATED');
      return sendJson(res, 200, { ok: true, state: computeEnrichedState(db) });
    }

    // 7. Add a New Payment (requires amount, method: card|cash, what, where)
    // Subtracts from Card Balance (if Card) or Cash Balance (if Cash), updates Total Balance, and schedules 1-hour notification
    if (pathname === '/api/payments' && req.method === 'POST') {
      const body = await parseBody(req);
      const amount = roundCurrency(Number(body.amount));
      const method = String(body.method || '').toLowerCase();
      const what = String(body.what || '').trim();
      const where = String(body.where || '').trim();

      if (Number.isNaN(amount) || amount <= 0) {
        return sendJson(res, 400, { ok: false, error: 'Please enter a valid payment amount greater than 0.' });
      }
      if (method !== 'card' && method !== 'cash') {
        return sendJson(res, 400, { ok: false, error: 'Please choose how you spent this money: Card or Cash.' });
      }
      if (!what) {
        return sendJson(res, 400, { ok: false, error: 'Please enter what you spent this money on ("For what?").' });
      }
      if (!where) {
        return sendJson(res, 400, { ok: false, error: 'Please enter where you spent this money ("Where?").' });
      }

      normalizeAndCheckMonthRollover(db);
      const now = body.createdAt ? Number(body.createdAt) : Date.now();
      const notifyDelayMs = body.notifyDelayMs ? Number(body.notifyDelayMs) : 60 * 60 * 1000;
      const paymentId = body.id || `pay_${now}_${crypto.randomBytes(3).toString('hex')}`;

      const existing = db.payments.find(p => p.id === paymentId);
      if (existing) {
        return sendJson(res, 200, { ok: true, payment: existing, state: computeEnrichedState(db) });
      }

      const payment = {
        id: paymentId,
        amount,
        method,
        what,
        where,
        createdAt: now,
        monthKey: getCurrentMonthKey(new Date(now)),
        notifyAt: now + notifyDelayMs,
        notificationSent: false,
        worthIt: 'pending',
        worthItNote: '',
        worthItAnsweredAt: null,
        deviceOrigin: String(body.deviceOrigin || 'desktop'),
        updatedAt: now,
        deleted: false
      };

      // Subtract from the matching balance counter (Card or Cash) AND Total Balance
      if (method === 'cash') {
        db.cashBalance = roundCurrency(db.cashBalance - amount);
      } else {
        db.cardBalance = roundCurrency(db.cardBalance - amount);
      }
      db.savingsBalance = roundCurrency(db.cardBalance + db.cashBalance);
      db.payments.unshift(payment);

      appendAuditLog('PAYMENT_ADDED', {
        payment,
        cardBalance: db.cardBalance,
        cashBalance: db.cashBalance,
        totalBalance: db.savingsBalance
      });
      saveDatabase(db, 'PAYMENT_ADDED');
      broadcastState('PAYMENT_ADDED', { payment });

      return sendJson(res, 201, { ok: true, payment, state: computeEnrichedState(db) });
    }

    // 8. Answer "Was it worth it?" for a payment
    if (pathname.startsWith('/api/payments/') && pathname.endsWith('/worth-it') && req.method === 'POST') {
      const parts = pathname.split('/');
      const paymentId = parts[3];
      const body = await parseBody(req);
      const answer = String(body.worthIt || '').toLowerCase();
      if (answer !== 'yes' && answer !== 'no' && answer !== 'pending') {
        return sendJson(res, 400, { ok: false, error: 'Answer must be "yes" or "no".' });
      }

      const payment = db.payments.find(p => p.id === paymentId);
      if (!payment) {
        return sendJson(res, 404, { ok: false, error: 'Payment not found.' });
      }

      payment.worthIt = answer;
      payment.worthItNote = String(body.worthItNote || payment.worthItNote || '').trim();
      payment.worthItAnsweredAt = Date.now();
      payment.notificationSent = true;
      payment.updatedAt = Date.now();

      appendAuditLog('WORTH_IT_ANSWERED', {
        paymentId,
        worthIt: payment.worthIt,
        worthItNote: payment.worthItNote
      });
      saveDatabase(db, 'WORTH_IT_ANSWERED');
      broadcastState('WORTH_IT_ANSWERED', { payment });

      return sendJson(res, 200, { ok: true, payment, state: computeEnrichedState(db) });
    }

    // 9. Trigger / Test the 1-Hour "Was it worth it?" Notification immediately
    if (pathname.startsWith('/api/payments/') && pathname.endsWith('/trigger-worth-it') && req.method === 'POST') {
      const parts = pathname.split('/');
      const paymentId = parts[3];
      const payment = db.payments.find(p => p.id === paymentId);
      if (!payment) {
        return sendJson(res, 404, { ok: false, error: 'Payment not found.' });
      }

      payment.notifyAt = Date.now() - 1000;
      payment.notificationSent = true;
      payment.worthIt = 'pending';
      payment.updatedAt = Date.now();

      const formattedAmt = `${db.currency}${Number(payment.amount).toFixed(2)}`;
      const methodLabel = payment.method === 'cash' ? 'Cash' : 'Card';
      const title = 'Was it worth it? 💭';
      const bodyText = `You spent ${formattedAmt} (${methodLabel}) on "${payment.what}" at "${payment.where}". Was it worth it?`;

      triggerWindowsDesktopNotification(title, bodyText);
      saveDatabase(db, 'WORTH_IT_TEST_TRIGGER');
      broadcastState('WORTH_IT_NOTIFICATION_DUE', {
        payment,
        title,
        body: bodyText
      });

      return sendJson(res, 200, { ok: true, payment, state: computeEnrichedState(db) });
    }

    // 10. Delete/Refund a mistaken payment (adds back to Card or Cash balance)
    if (pathname.startsWith('/api/payments/') && req.method === 'DELETE') {
      const parts = pathname.split('/');
      const paymentId = parts[3];
      const payment = db.payments.find(p => p.id === paymentId);
      if (!payment || payment.deleted) {
        return sendJson(res, 404, { ok: false, error: 'Payment not found.' });
      }

      payment.deleted = true;
      payment.updatedAt = Date.now();
      if (payment.method === 'cash') {
        db.cashBalance = roundCurrency(db.cashBalance + Number(payment.amount));
      } else {
        db.cardBalance = roundCurrency(db.cardBalance + Number(payment.amount));
      }
      db.savingsBalance = roundCurrency(db.cardBalance + db.cashBalance);

      appendAuditLog('PAYMENT_DELETED_REFUNDED', {
        paymentId,
        refundedAmount: payment.amount,
        method: payment.method,
        cardBalance: db.cardBalance,
        cashBalance: db.cashBalance,
        totalBalance: db.savingsBalance
      });
      saveDatabase(db, 'PAYMENT_DELETED');
      broadcastState('PAYMENT_DELETED', { paymentId });

      return sendJson(res, 200, { ok: true, state: computeEnrichedState(db) });
    }

    // 11. Bi-directional Offline-First Sync endpoint (/api/sync)
    if (pathname === '/api/sync' && req.method === 'POST') {
      const clientData = await parseBody(req);
      let modified = false;

      if (
        typeof clientData.settingsUpdatedAt === 'number' &&
        clientData.settingsUpdatedAt > (db.settingsUpdatedAt || 0)
      ) {
        if (typeof clientData.monthlyLimit === 'number' && clientData.monthlyLimit >= 0) {
          db.monthlyLimit = roundCurrency(clientData.monthlyLimit);
        }
        if (typeof clientData.currency === 'string' && clientData.currency.trim()) {
          db.currency = clientData.currency.trim();
        }
        db.settingsUpdatedAt = clientData.settingsUpdatedAt;
        modified = true;
      }

      // Merge savingsLogs not yet on server
      if (Array.isArray(clientData.savingsLogs)) {
        const existingLogIds = new Set(db.savingsLogs.map(l => l.id));
        const newLogs = clientData.savingsLogs
          .filter(l => l && l.id && !existingLogIds.has(l.id))
          .sort((a, b) => a.createdAt - b.createdAt);

        for (const log of newLogs) {
          if (log.type === 'set-balances') {
            db.cardBalance = roundCurrency(Number(log.cardBalance || 0));
            db.cashBalance = roundCurrency(Number(log.cashBalance || 0));
          } else {
            const tgt = log.target === 'cash' ? 'cash' : 'card';
            const amt = roundCurrency(Number(log.amount || 0));
            if (tgt === 'cash') {
              if (log.type === 'set') db.cashBalance = amt;
              else if (log.type === 'deposit') db.cashBalance = roundCurrency(db.cashBalance + amt);
              else if (log.type === 'withdraw') db.cashBalance = roundCurrency(db.cashBalance - amt);
            } else {
              if (log.type === 'set') db.cardBalance = amt;
              else if (log.type === 'deposit') db.cardBalance = roundCurrency(db.cardBalance + amt);
              else if (log.type === 'withdraw') db.cardBalance = roundCurrency(db.cardBalance - amt);
            }
          }
          db.savingsBalance = roundCurrency(db.cardBalance + db.cashBalance);
          db.savingsLogs.unshift(log);
          appendAuditLog('SYNC_SAVINGS_LOG_MERGED', log);
          modified = true;
        }
      }

      // Merge offline incomes
      if (Array.isArray(clientData.incomes)) {
        const serverIncMap = new Map(db.incomes.map(i => [i.id, i]));
        const incomingIncomes = [...clientData.incomes].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

        for (const inc of incomingIncomes) {
          if (!inc || !inc.id) continue;
          const existing = serverIncMap.get(inc.id);
          if (!existing) {
            const cleanIncome = {
              id: inc.id,
              amount: roundCurrency(Number(inc.amount) || 0),
              method: inc.method === 'cash' ? 'cash' : 'card',
              source: String(inc.source || 'Income').trim(),
              note: String(inc.note || '').trim(),
              createdAt: Number(inc.createdAt) || Date.now(),
              monthKey: inc.monthKey || getCurrentMonthKey(new Date(Number(inc.createdAt) || Date.now())),
              deviceOrigin: String(inc.deviceOrigin || 'mobile'),
              updatedAt: Number(inc.updatedAt) || Date.now(),
              deleted: Boolean(inc.deleted)
            };
            db.incomes.unshift(cleanIncome);
            serverIncMap.set(cleanIncome.id, cleanIncome);
            if (!cleanIncome.deleted) {
              if (cleanIncome.method === 'cash') {
                db.cashBalance = roundCurrency(db.cashBalance + cleanIncome.amount);
              } else {
                db.cardBalance = roundCurrency(db.cardBalance + cleanIncome.amount);
              }
              db.savingsBalance = roundCurrency(db.cardBalance + db.cashBalance);
            }
            appendAuditLog('SYNC_OFFLINE_INCOME_MERGED', cleanIncome);
            modified = true;
          } else {
            const incUpdated = Number(inc.updatedAt) || 0;
            const srvUpdated = Number(existing.updatedAt) || 0;
            if (incUpdated > srvUpdated && !existing.deleted && inc.deleted) {
              existing.deleted = true;
              existing.updatedAt = incUpdated;
              if (existing.method === 'cash') {
                db.cashBalance = roundCurrency(db.cashBalance - Number(existing.amount));
              } else {
                db.cardBalance = roundCurrency(db.cardBalance - Number(existing.amount));
              }
              db.savingsBalance = roundCurrency(db.cardBalance + db.cashBalance);
              modified = true;
            }
          }
        }
      }

      // Merge offline payments
      if (Array.isArray(clientData.payments)) {
        const serverMap = new Map(db.payments.map(p => [p.id, p]));
        const incomingSorted = [...clientData.payments].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

        for (const inc of incomingSorted) {
          if (!inc || !inc.id) continue;
          const existing = serverMap.get(inc.id);
          if (!existing) {
            const cleanPayment = {
              id: inc.id,
              amount: roundCurrency(Number(inc.amount) || 0),
              method: inc.method === 'cash' ? 'cash' : 'card',
              what: String(inc.what || 'Item').trim(),
              where: String(inc.where || 'Store').trim(),
              createdAt: Number(inc.createdAt) || Date.now(),
              monthKey: inc.monthKey || getCurrentMonthKey(new Date(Number(inc.createdAt) || Date.now())),
              notifyAt: Number(inc.notifyAt) || ((Number(inc.createdAt) || Date.now()) + 3600000),
              notificationSent: Boolean(inc.notificationSent),
              worthIt: ['yes', 'no', 'pending'].includes(inc.worthIt) ? inc.worthIt : 'pending',
              worthItNote: String(inc.worthItNote || ''),
              worthItAnsweredAt: inc.worthItAnsweredAt || null,
              deviceOrigin: String(inc.deviceOrigin || 'mobile'),
              updatedAt: Number(inc.updatedAt) || Date.now(),
              deleted: Boolean(inc.deleted)
            };
            db.payments.unshift(cleanPayment);
            serverMap.set(cleanPayment.id, cleanPayment);
            if (!cleanPayment.deleted) {
              if (cleanPayment.method === 'cash') {
                db.cashBalance = roundCurrency(db.cashBalance - cleanPayment.amount);
              } else {
                db.cardBalance = roundCurrency(db.cardBalance - cleanPayment.amount);
              }
              db.savingsBalance = roundCurrency(db.cardBalance + db.cashBalance);
            }
            appendAuditLog('SYNC_OFFLINE_PAYMENT_MERGED', cleanPayment);
            modified = true;
          } else {
            const incUpdated = Number(inc.updatedAt) || 0;
            const srvUpdated = Number(existing.updatedAt) || 0;
            if (incUpdated > srvUpdated) {
              if (!existing.deleted && inc.deleted) {
                existing.deleted = true;
                if (existing.method === 'cash') {
                  db.cashBalance = roundCurrency(db.cashBalance + Number(existing.amount));
                } else {
                  db.cardBalance = roundCurrency(db.cardBalance + Number(existing.amount));
                }
                db.savingsBalance = roundCurrency(db.cardBalance + db.cashBalance);
              }
              if (inc.worthIt && inc.worthIt !== existing.worthIt) {
                existing.worthIt = inc.worthIt;
                existing.worthItNote = String(inc.worthItNote || existing.worthItNote || '');
                existing.worthItAnsweredAt = inc.worthItAnsweredAt || Date.now();
                existing.notificationSent = true;
              }
              existing.updatedAt = incUpdated;
              modified = true;
            }
          }
        }
      }

      if (modified) {
        saveDatabase(db, 'CLIENT_SYNC');
        broadcastState('SYNC_COMPLETED');
      }

      return sendJson(res, 200, { ok: true, state: computeEnrichedState(db) });
    }

    // 12. Full Database Backup Export & Restore endpoints
    if (pathname === '/api/backup/export' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="1money-backup-${new Date().toISOString().slice(0, 10)}.json"`,
        'Access-Control-Allow-Origin': '*'
      });
      return res.end(JSON.stringify(db, null, 2));
    }

    if (pathname === '/api/backup/restore' && req.method === 'POST') {
      const body = await parseBody(req);
      if (!body || !Array.isArray(body.payments)) {
        return sendJson(res, 400, { ok: false, error: 'Invalid backup file format.' });
      }
      db = normalizeAndCheckMonthRollover(body);
      appendAuditLog('BACKUP_RESTORED', { paymentCount: db.payments.length });
      saveDatabase(db, 'BACKUP_RESTORE');
      broadcastState('BACKUP_RESTORED');
      return sendJson(res, 200, { ok: true, state: computeEnrichedState(db) });
    }

    // 13. Direct .ipa downloads for convenience
    if (pathname === '/download/3MK-F-X-G-iPhone.ipa' || pathname === '/download/1Money-iPhone.ipa') {
      return serveStaticFile(res, path.join(ROOT_DIR, '3MK-F-X-G-iPhone.ipa'));
    }
    if (pathname === '/download/3MK-F-X-G-iPad.ipa' || pathname === '/download/1Money-iPad.ipa') {
      return serveStaticFile(res, path.join(ROOT_DIR, '3MK-F-X-G-iPad.ipa'));
    }

    // 14. Serve the 3 Editions (/desktop, /iphone, /ipad)
    if (pathname === '/') {
      const ua = String(req.headers['user-agent'] || '').toLowerCase();
      if (ua.includes('ipad')) {
        res.writeHead(302, { Location: '/ipad' });
        return res.end();
      }
      if (ua.includes('iphone') || ua.includes('ipod')) {
        res.writeHead(302, { Location: '/iphone' });
        return res.end();
      }
      res.writeHead(302, { Location: '/desktop' });
      return res.end();
    }

    const editionRoutes = {
      '/desktop': path.join(ROOT_DIR, '1-Desktop-Copy', 'www'),
      '/iphone': path.join(ROOT_DIR, '2-iPhone-Copy', 'www'),
      '/ipad': path.join(ROOT_DIR, '3-iPad-Copy', 'www')
    };

    for (const [prefix, folderPath] of Object.entries(editionRoutes)) {
      if (pathname === prefix || pathname === `${prefix}/`) {
        return serveStaticFile(res, path.join(folderPath, 'index.html'));
      }
      if (pathname.startsWith(`${prefix}/`)) {
        const subPath = pathname.slice(prefix.length + 1);
        const safePath = path.normalize(path.join(folderPath, subPath));
        if (safePath.startsWith(folderPath)) {
          return serveStaticFile(res, safePath);
        }
      }
    }

    if (pathname.startsWith('/shared/')) {
      const subPath = pathname.slice('/shared/'.length);
      const sharedFolder = path.join(ROOT_DIR, 'shared');
      const safePath = path.normalize(path.join(sharedFolder, subPath));
      if (safePath.startsWith(sharedFolder)) {
        return serveStaticFile(res, safePath);
      }
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  } catch (err) {
    console.error('[Server Error]', err);
    sendJson(res, 500, { ok: false, error: err.message || 'Internal server error' });
  }
});

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    const lans = getLanAddresses();
    console.log('==================================================================');
    console.log('  1Money Shared Database & 3-Edition Server is RUNNING');
    console.log('==================================================================');
    console.log(`  Database File : ${DB_FILE}`);
    console.log(`  Audit Log     : ${AUDIT_FILE}`);
    console.log('------------------------------------------------------------------');
    console.log(`  [1] Desktop Copy (Local) : http://localhost:${PORT}/desktop`);
    console.log(`  [2] iPhone Copy  (Local) : http://localhost:${PORT}/iphone`);
    console.log(`  [3] iPad Copy    (Local) : http://localhost:${PORT}/ipad`);
    if (lans.length > 0) {
      console.log('------------------------------------------------------------------');
      console.log('  Wi-Fi Links for your iPhone & iPad (Shared Database):');
      for (const lan of lans) {
        console.log(`  • iPhone (${lan.interface}): ${lan.iphoneUrl}`);
        console.log(`  • iPad   (${lan.interface}): ${lan.ipadUrl}`);
      }
    }
    console.log('==================================================================');
  });
}

module.exports = { server, PORT, loadDatabase, computeEnrichedState };
