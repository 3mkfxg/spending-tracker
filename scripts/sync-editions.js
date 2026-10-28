/**
 * Syncs the shared 3MK F X G engine/UI/styles/icons into the 3 distinct device copies:
 * 1. 1-Desktop-Copy/www (Wide 3-Column Desktop Command Center)
 * 2. 2-iPhone-Copy/www  (Dedicated Pages + iOS Bottom Tab Bar + Keyboard-Safe Layout)
 * 3. 3-iPad-Copy/www    (Dedicated Single-Topic Pages — Every Thing Has Its Own Page!)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHARED_DIR = path.join(ROOT, 'shared');

const EDITIONS = [
  {
    id: 'desktop',
    folder: path.join(ROOT, '1-Desktop-Copy', 'www'),
    title: '3MK F X G — Desktop Copy',
    shortName: '3MK F X G',
    htmlBuilder: buildDesktopHtml
  },
  {
    id: 'iphone',
    folder: path.join(ROOT, '2-iPhone-Copy', 'www'),
    title: '3MK F X G — iPhone Copy',
    shortName: '3MK F X G',
    htmlBuilder: buildIPhoneHtml
  },
  {
    id: 'ipad',
    folder: path.join(ROOT, '3-iPad-Copy', 'www'),
    title: '3MK F X G — iPad Copy',
    shortName: '3MK F X G',
    htmlBuilder: buildIPadHtml
  }
];

function buildManifest(edition) {
  return JSON.stringify(
    {
      name: edition.title,
      short_name: edition.shortName,
      description: '3MK F X G — 3 Balance Counters (Card, Cash, Total), Income & Payment Tracker, Monthly Analysis, and 1-Hour Worth-It Notifications.',
      start_url: `./index.html`,
      display: 'standalone',
      background_color: '#090d16',
      theme_color: '#090d16',
      orientation: edition.id === 'iphone' ? 'portrait' : 'any',
      icons: [
        {
          src: './icon.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any maskable'
        },
        {
          src: './apple-touch-icon.png',
          sizes: '180x180',
          type: 'image/png'
        }
      ]
    },
    null,
    2
  );
}

function buildServiceWorker() {
  return `const CACHE_NAME = '3mk-fxg-cache-v4';
const ASSETS = [
  './',
  './index.html',
  './1money-styles.css',
  './1money-core.js',
  './1money-ui.js',
  './icon.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.url.includes('/api/')) return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
`;
}

function renderModalsHtml() {
  return `
  <!-- Toast Container -->
  <div id="toast-container"></div>

  <!-- Floating Keyboard Dismiss Pill (Appears automatically whenever keyboard is open on iPhone/iPad) -->
  <button type="button" id="floating-hide-keyboard-btn" class="floating-keyboard-dismiss" aria-label="Hide Keyboard">
    ⌨️⬇️ Done / Hide Keyboard
  </button>

  <!-- 1-Hour "Was it worth it?" Notification Reflection Modal -->
  <div class="modal-backdrop" id="worth-it-modal">
    <div class="modal-card">
      <div id="worth-it-modal-content"></div>
      <div style="text-align:center; margin-top:12px;">
        <button type="button" class="btn-xs btn-outline" data-close-modal="worth-it-modal">Remind me later</button>
      </div>
    </div>
  </div>

  <!-- Set Exact Card & Cash Balances Modal -->
  <div class="modal-backdrop" id="savings-modal">
    <div class="modal-card">
      <div class="card-header">
        <h3 class="card-title">💰 Set Card & Cash Balances</h3>
        <div style="display:flex; gap:6px; align-items:center;">
          <button type="submit" form="savings-modal-form" class="btn-xs btn-emerald" style="border:none;">✅ Save</button>
          <button type="button" class="btn-icon-delete" data-close-modal="savings-modal">✕</button>
        </div>
      </div>
      <p class="muted" style="font-size:0.82rem; margin-bottom:12px;">
        Enter your current <strong>💳 Card Balance</strong> and <strong>💵 Cash Balance</strong>. Total Balance = Card + Cash.
      </p>
      <form id="savings-modal-form">
        <div class="form-group">
          <label class="form-label">💳 Card Only Balance</label>
          <input type="number" step="0.01" inputmode="decimal" enterkeyhint="done" id="modal-card-balance" class="input-field input-amount-large" placeholder="0.00" required />
        </div>
        <div class="form-group">
          <label class="form-label">💵 Cash Only Balance</label>
          <input type="number" step="0.01" inputmode="decimal" enterkeyhint="done" id="modal-cash-balance" class="input-field input-amount-large" placeholder="0.00" required />
        </div>
        <div style="background:rgba(15,23,42,0.8); padding:10px 14px; border-radius:10px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
          <span class="muted" style="font-size:0.82rem;">🏦 New Total Balance:</span>
          <strong id="modal-total-preview" style="font-size:1.15rem; color:#6ee7b7;">$0.00</strong>
        </div>
        <div class="form-group">
          <label class="form-label">Note (Optional)</label>
          <input type="text" enterkeyhint="done" id="savings-modal-note" class="input-field" placeholder="e.g., Starting balances" />
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:14px;">
          <button type="button" class="btn btn-secondary" data-close-modal="savings-modal">Cancel</button>
          <button type="submit" class="btn btn-emerald">✅ Save Balances</button>
        </div>
      </form>
    </div>
  </div>

  <!-- Set Monthly Limit Modal -->
  <div class="modal-backdrop" id="limit-modal">
    <div class="modal-card">
      <div class="card-header">
        <h3 class="card-title">🎯 Set Monthly Spending Limit</h3>
        <div style="display:flex; gap:6px; align-items:center;">
          <button type="submit" form="limit-modal-form" class="btn-xs btn-primary" style="border:none;">✅ Save</button>
          <button type="button" class="btn-icon-delete" data-close-modal="limit-modal">✕</button>
        </div>
      </div>
      <p class="muted" style="font-size:0.82rem; margin-bottom:12px;">
        Tracks how much you spend each month and <strong>automatically resets to 0 on the 1st day of every month</strong>.
      </p>
      <form id="limit-modal-form">
        <div class="form-group">
          <label class="form-label">Monthly Spending Limit</label>
          <input type="number" step="0.01" min="0" inputmode="decimal" enterkeyhint="done" id="limit-modal-amount" class="input-field input-amount-large" placeholder="1000.00" required />
        </div>
        <div class="form-group">
          <label class="form-label">Currency Symbol</label>
          <input type="text" maxlength="5" enterkeyhint="done" id="limit-modal-currency" class="input-field" value="$" placeholder="$, €, £, SAR, AED..." />
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:14px;">
          <button type="button" class="btn btn-secondary" data-close-modal="limit-modal">Cancel</button>
          <button type="submit" class="btn btn-primary">✅ Save Limit</button>
        </div>
      </form>
    </div>
  </div>
  `;
}

function renderSavingsCardHtml() {
  return `
  <section class="card savings-vault-card">
    <div class="savings-label">🏦 Counter 1: Total Balance (Card + Cash)</div>
    <div class="savings-amount" id="savings-balance-value">$0.00</div>

    <!-- Counter 2 (Card Only Balance) & Counter 3 (Cash Only Balance) -->
    <div class="three-counters-grid">
      <div class="sub-counter-box counter-box-card">
        <span class="sub-counter-label">💳 Counter 2: Card Only</span>
        <strong class="sub-counter-value" id="card-balance-value">$0.00</strong>
      </div>
      <div class="sub-counter-box counter-box-cash">
        <span class="sub-counter-label">💵 Counter 3: Cash Only</span>
        <strong class="sub-counter-value" id="cash-balance-value">$0.00</strong>
      </div>
    </div>

    <div class="savings-meta" id="all-time-stats">
      <span>➕ All-Time Income: <strong>$0.00</strong></span>
      <span>•</span>
      <span>💸 All-Time Spent: <strong>$0.00</strong></span>
    </div>
    <div class="savings-actions savings-actions-3">
      <button type="button" class="btn btn-secondary" data-open-balances-modal="true">✏️ Edit Balances</button>
      <button type="button" class="btn btn-primary" data-jump-payment="true">💸 Pay</button>
      <button type="button" class="btn btn-emerald" data-jump-income="true">➕ Income</button>
    </div>
  </section>
  `;
}

function renderMonthlyLimitCardHtml() {
  return `
  <section class="card monthly-limit-card">
    <div class="card-header">
      <div class="card-title">
        📅 Spent in <span id="current-month-label">This Month</span>
      </div>
      <button type="button" class="btn-xs btn-outline" data-open-limit-modal="true">🎯 Set Limit</button>
    </div>
    <div class="reset-pill" id="monthly-reset-badge">
      🔄 Auto-resets 1st of every month
    </div>
    <div class="spent-vs-limit-row" id="monthly-spent-vs-limit">
      <span class="spent-big">$0.00</span>
      <span class="limit-slash">/ $1,000.00 limit</span>
    </div>
    <div class="progress-bar-track">
      <div class="progress-bar-fill fill-safe" id="limit-progress-fill" style="width: 0%"></div>
    </div>
    <div class="limit-alert alert-safe" id="limit-status-banner">
      ✅ 0% of monthly limit used
    </div>
    <div class="method-breakdown-grid" style="margin-bottom:8px;">
      <div class="method-stat-box">
        <span>💳 Card Spent (Month)</span>
        <strong id="month-card-spent">$0.00</strong>
      </div>
      <div class="method-stat-box">
        <span>💵 Cash Spent (Month)</span>
        <strong id="month-cash-spent">$0.00</strong>
      </div>
    </div>
    <div class="method-breakdown-grid">
      <div class="method-stat-box">
        <span>💳 Card Income (Month)</span>
        <strong id="month-card-income" style="color:#6ee7b7">+$0.00</strong>
      </div>
      <div class="method-stat-box">
        <span>💵 Cash Income (Month)</span>
        <strong id="month-cash-income" style="color:#6ee7b7">+$0.00</strong>
      </div>
    </div>
  </section>
  `;
}

// Every-Month Spending Analysis Card (Food, Cinema, Taxi & Every Specific Thing Paid For)
function renderMonthlyAnalysisCardHtml() {
  return `
  <section class="card">
    <div class="card-header">
      <div class="card-title">📊 Every-Month Spending Analysis</div>
      <select id="analysis-month-select" class="analysis-month-select" title="Select month to analyze"></select>
    </div>
    <p class="muted" style="font-size:0.78rem; margin-bottom:10px;">
      Shows how much you spent on <strong>🍔 Food</strong>, <strong>🎬 Cinema</strong>, <strong>🚕 Taxi</strong>, and <strong>every specific thing</strong> you paid for in the selected month.
    </p>

    <!-- Spotlight Grid: Food, Cinema, Taxi -->
    <div class="analysis-spotlight-grid" id="analysis-spotlight-grid"></div>

    <!-- Category Progress Bars -->
    <div class="analysis-section-subtitle">Category Breakdown</div>
    <div id="analysis-categories-list"></div>

    <!-- Exact Thing / Item Breakdown ("How much you paid for this thing in this month") -->
    <div class="analysis-section-subtitle">Exact Things You Paid For This Month</div>
    <div class="analysis-items-container" id="analysis-items-list"></div>
  </section>
  `;
}

function renderPaymentFormFieldsHtml() {
  return `
      <div class="card-header" style="margin-bottom:10px;">
        <div class="card-title">💸 Record a Payment</div>
        <div style="display:flex; gap:6px; align-items:center;">
          <button type="button" class="btn-xs btn-outline hide-kb-inline-btn" data-dismiss-keyboard="true">⌨️⬇️ Hide Key</button>
          <button type="submit" form="payment-form" class="btn-xs btn-primary" style="border:none; padding:6px 12px;">✅ Save</button>
        </div>
      </div>
      <form id="payment-form" autocomplete="off">
        <div class="form-group">
          <label class="form-label" for="pay-amount">1. How much did you spend?</label>
          <input type="number" step="0.01" min="0.01" inputmode="decimal" enterkeyhint="done" id="pay-amount" class="input-field input-amount-large" placeholder="0.00" required />
        </div>

        <div class="form-group">
          <label class="form-label">2. How did you spend this money? (Tap Card or Cash)</label>
          <div class="method-selector-grid">
            <button type="button" class="method-choice-btn" data-method-choice="card">
              💳 Card
            </button>
            <button type="button" class="method-choice-btn" data-method-choice="cash">
              💵 Cash
            </button>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="pay-what">3. For what? (Food, Cinema, Taxi, or any item)</label>
          <input type="text" enterkeyhint="done" id="pay-what" class="input-field" placeholder="e.g., Food, Cinema, Taxi, Coffee..." required />
          <div class="quick-chips-row" id="recent-what-chips"></div>
        </div>

        <div class="form-group">
          <label class="form-label" for="pay-where">4. Where? (Store, restaurant, or place)</label>
          <input type="text" enterkeyhint="done" id="pay-where" class="input-field" placeholder="e.g., Mall, Restaurant, Uber, Cinema..." required />
          <div class="quick-chips-row" id="recent-where-chips"></div>
        </div>

        <div class="form-group">
          <label class="form-label">5. "Was it worth it?" Notification Timer</label>
          <div class="notify-timer-row">
            <button type="button" class="notify-delay-btn active" data-notify-delay="3600000">
              ⏱️ After 1 Hour (Default)
            </button>
            <button type="button" class="notify-delay-btn" data-notify-delay="10000">
              ⚡ After 10 Sec (Test Now)
            </button>
          </div>
        </div>

        <div class="form-error" id="payment-form-error"></div>

        <button type="submit" class="btn btn-primary btn-block">
          ✅ Record Payment & Start 1-Hour Timer
        </button>
      </form>
  `;
}

function renderIncomeFormFieldsHtml() {
  return `
      <div class="card-header" style="margin-bottom:10px;">
        <div class="card-title">➕ Record Income</div>
        <div style="display:flex; gap:6px; align-items:center;">
          <button type="button" class="btn-xs btn-outline hide-kb-inline-btn" data-dismiss-keyboard="true">⌨️⬇️ Hide Key</button>
          <button type="submit" form="income-form" class="btn-xs btn-emerald" style="border:none; padding:6px 12px;">➕ Save</button>
        </div>
      </div>
      <form id="income-form" autocomplete="off">
        <div class="form-group">
          <label class="form-label" for="inc-amount">1. How much income did you receive?</label>
          <input type="number" step="0.01" min="0.01" inputmode="decimal" enterkeyhint="done" id="inc-amount" class="input-field input-amount-large" placeholder="0.00" required />
        </div>

        <div class="form-group">
          <label class="form-label">2. Did you receive it in Card or Cash? (Tap Card or Cash)</label>
          <div class="method-selector-grid">
            <button type="button" class="method-choice-btn" data-income-method-choice="card">
              💳 Card (Add to Card Balance)
            </button>
            <button type="button" class="method-choice-btn" data-income-method-choice="cash">
              💵 Cash (Add to Cash Balance)
            </button>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="inc-source">3. From what / Source? (Required)</label>
          <input type="text" enterkeyhint="done" id="inc-source" class="input-field" placeholder="e.g., Salary, Gift, Freelance, Bonus..." required />
          <div class="quick-chips-row" id="recent-income-chips"></div>
        </div>

        <div class="form-group">
          <label class="form-label" for="inc-note">4. Note (Optional)</label>
          <input type="text" enterkeyhint="done" id="inc-note" class="input-field" placeholder="Optional details..." />
        </div>

        <div class="form-error" id="income-form-error"></div>

        <button type="submit" class="btn btn-emerald btn-block">
          ➕ Add Income to Balance
        </button>
      </form>
  `;
}

// Combined Payment/Income Switcher Card (for Desktop & iPhone)
function renderPaymentFormCardHtml() {
  return `
  <section class="card">
    <div class="entry-mode-tabs">
      <button type="button" class="entry-mode-btn active" data-entry-mode="payment">
        💸 Enter Payment
      </button>
      <button type="button" class="entry-mode-btn" data-entry-mode="income">
        ➕ Enter Income
      </button>
    </div>

    <!-- PANEL 1: ENTER PAYMENT -->
    <div id="entry-panel-payment">
      ${renderPaymentFormFieldsHtml()}
    </div>

    <!-- PANEL 2: ENTER INCOME -->
    <div id="entry-panel-income" style="display:none;">
      ${renderIncomeFormFieldsHtml()}
    </div>
  </section>
  `;
}

// Dedicated Payment-Only Card (for iPad Separate Payment Page)
function renderPaymentOnlyCardHtml() {
  return `
  <section class="card">
    ${renderPaymentFormFieldsHtml()}
  </section>
  `;
}

// Dedicated Income-Only Card (for iPad Separate Income Page)
function renderIncomeOnlyCardHtml() {
  return `
  <section class="card">
    ${renderIncomeFormFieldsHtml()}
  </section>
  `;
}

function renderWorthItCardHtml() {
  return `
  <section class="card">
    <div class="card-header">
      <div class="card-title">💭 "Was It Worth It?" (1-Hour Check)</div>
      <span class="badge badge-neutral" id="worth-it-due-badge">0 Pending</span>
    </div>
    <div class="worth-score-row" id="worth-it-score-summary"></div>
    <div id="worth-it-queue-list"></div>
    <div style="margin-top:10px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
      <span class="muted" style="font-size:0.74rem;">Fires system + in-app notification 1 hour after each payment.</span>
      <button type="button" class="btn-xs btn-outline" id="enable-notifications-btn">🔔 Enable OS Alerts</button>
    </div>
  </section>
  `;
}

function renderHistoryCardHtml() {
  return `
  <section class="card">
    <div class="card-header">
      <div class="card-title">📒 Permanent Ledger (Income & Payments)</div>
    </div>
    <div class="history-controls">
      <input type="search" enterkeyhint="search" id="history-search" class="input-field" placeholder="🔍 Search by What, Where, Source, or Card/Cash..." />
      <div class="filter-pills">
        <button type="button" class="filter-pill active" data-history-filter="all">All Activity</button>
        <button type="button" class="filter-pill" data-history-filter="payments">💸 Payments</button>
        <button type="button" class="filter-pill" data-history-filter="incomes">➕ Income</button>
        <button type="button" class="filter-pill" data-history-filter="month">This Month</button>
        <button type="button" class="filter-pill" data-history-filter="card">💳 Card</button>
        <button type="button" class="filter-pill" data-history-filter="cash">💵 Cash</button>
        <button type="button" class="filter-pill" data-history-filter="yes">👍 Worth It</button>
        <button type="button" class="filter-pill" data-history-filter="no">👎 Regretted</button>
        <button type="button" class="filter-pill" data-history-filter="pending">⏳ 1h Pending</button>
      </div>
    </div>
    <div class="payments-list" id="payments-history-list"></div>
  </section>
  `;
}

function renderArchivesOnlyCardHtml() {
  return `
  <section class="card">
    <div class="card-header">
      <div class="card-title">🗂️ Monthly Reset Archives (1st of Month History)</div>
    </div>
    <div id="monthly-archives-list"></div>
  </section>
  `;
}

function renderSyncOnlyCardHtml() {
  return `
  <section class="card">
    <div class="card-header">
      <div class="card-title">🔗 Shared Database & 3-Device Sync Vault</div>
      <span class="badge badge-neutral">No Login Required</span>
    </div>
    <p class="muted" style="font-size:0.8rem; margin-bottom:10px;">
      Your <strong>iPhone Copy</strong>, <strong>iPad Copy</strong>, and <strong>Desktop Copy</strong> of <strong>3MK F X G</strong> all share the same permanent database.
    </p>
    <div id="lan-device-links"></div>

    <form id="server-url-form" style="margin-top:14px; display:flex; gap:8px;">
      <input type="text" enterkeyhint="done" id="server-url-input" class="input-field" placeholder="http://YOUR-PC-IP:3456" style="font-size:0.82rem; padding:9px 12px;" />
      <button type="submit" class="btn-xs btn-outline" style="white-space:nowrap; padding:0 14px;">Connect DB</button>
    </form>

    <div style="display:flex; gap:10px; margin-top:14px; flex-wrap:wrap;">
      <a href="/api/backup/export" class="btn-xs btn-outline" download>⬇️ Export Full DB Backup</a>
      <label class="btn-xs btn-outline" style="cursor:pointer;">
        ⬆️ Restore DB Backup
        <input type="file" id="backup-restore-input" accept=".json" style="display:none;" />
      </label>
    </div>
  </section>
  `;
}

function renderArchivesAndSyncCardHtml() {
  return `
  ${renderArchivesOnlyCardHtml()}
  ${renderSyncOnlyCardHtml()}
  `;
}

function buildDesktopHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>3MK F X G — Desktop Copy</title>
  <link rel="icon" type="image/png" href="./icon.png" />
  <link rel="apple-touch-icon" href="./apple-touch-icon.png" />
  <link rel="stylesheet" href="./1money-styles.css" />
  <script>window.ONE_MONEY_EDITION = 'desktop';</script>
</head>
<body class="edition-desktop">
  <header class="app-topbar">
    <div class="brand-wrap">
      <div class="brand-logo"><img src="./icon.png" alt="3MK F X G" /></div>
      <div class="brand-title">
        <h1>3MK F X G <span class="edition-chip">🖥️ Copy 1: Desktop</span></h1>
        <div class="brand-subtitle">3 Live Counters (Total, Card, Cash) • Monthly Food/Cinema/Taxi Analysis • Resets 1st of Month</div>
      </div>
    </div>
    <div class="topbar-right">
      <nav class="edition-switcher" title="Switch between your 3 copies">
        <a href="/desktop" class="active">🖥️ Desktop Copy</a>
        <a href="/iphone">📱 iPhone Copy</a>
        <a href="/ipad">📲 iPad Copy</a>
      </nav>
      <div class="sync-pill sync-online" id="sync-status-badge">
        <span class="dot"></span> Shared DB Live
      </div>
    </div>
  </header>

  <main class="main-container">
    <!-- Left Column: 3 Balance Counters + Monthly Limit + Monthly Analysis -->
    <div class="col-stack">
      ${renderSavingsCardHtml()}
      ${renderMonthlyLimitCardHtml()}
      ${renderMonthlyAnalysisCardHtml()}
    </div>

    <!-- Center Column: Enter Payment / Enter Income + 1-Hour "Was It Worth It?" Queue -->
    <div class="col-stack">
      ${renderPaymentFormCardHtml()}
      ${renderWorthItCardHtml()}
    </div>

    <!-- Right Column: Permanent Ledger + Monthly Archives + 3-Device Sync Hub -->
    <div class="col-stack">
      ${renderHistoryCardHtml()}
      ${renderArchivesAndSyncCardHtml()}
    </div>
  </main>

  ${renderModalsHtml()}
  <script src="./1money-core.js"></script>
  <script src="./1money-ui.js"></script>
</body>
</html>`;
}

function buildIPhoneHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="3MK F X G" />
  <meta name="theme-color" content="#090d16" />
  <title>3MK F X G</title>
  <link rel="manifest" href="./manifest.webmanifest" />
  <link rel="apple-touch-icon" href="./apple-touch-icon.png" />
  <link rel="icon" type="image/png" href="./icon.png" />
  <link rel="stylesheet" href="./1money-styles.css" />
  <script>window.ONE_MONEY_EDITION = 'iphone';</script>
</head>
<body class="edition-iphone">
  <header class="app-topbar">
    <div class="brand-wrap">
      <div class="brand-logo"><img src="./icon.png" alt="3MK F X G" /></div>
      <div class="brand-title">
        <h1>3MK F X G <span class="edition-chip">📱 iPhone</span></h1>
        <div class="brand-subtitle">Total • Card • Cash + Monthly Analysis</div>
      </div>
    </div>
    <div class="topbar-right">
      <button type="button" class="btn-xs btn-outline hide-kb-inline-btn" data-dismiss-keyboard="true">⌨️⬇️ Done</button>
      <div class="sync-pill sync-online" id="sync-status-badge">
        <span class="dot"></span> Synced
      </div>
    </div>
  </header>

  <main class="main-container">
    <!-- Tab 1: Balances & Monthly Limit -->
    <div data-tab-panel="home" class="tab-active">
      ${renderSavingsCardHtml()}
      ${renderMonthlyLimitCardHtml()}
    </div>

    <!-- Tab 2: Dedicated Payment & Income Page (Right at the top so keyboard never blocks!) -->
    <div data-tab-panel="pay">
      ${renderPaymentFormCardHtml()}
    </div>

    <!-- Tab 3: Every-Month Analysis (Food, Cinema, Taxi & Exact Items Paid For) -->
    <div data-tab-panel="analysis">
      ${renderMonthlyAnalysisCardHtml()}
    </div>

    <!-- Tab 4: 1-Hour "Was It Worth It?" Check-Ins -->
    <div data-tab-panel="worth">
      ${renderWorthItCardHtml()}
    </div>

    <!-- Tab 5: Full Permanent Ledger -->
    <div data-tab-panel="history">
      ${renderHistoryCardHtml()}
    </div>

    <!-- Tab 6: Monthly Archives & Shared DB Sync -->
    <div data-tab-panel="sync">
      ${renderArchivesAndSyncCardHtml()}
    </div>
  </main>

  <nav class="ios-bottom-tabbar">
    <button type="button" class="ios-tab-btn active" data-mobile-tab="home">
      <span class="tab-icon">🏦</span>
      <span>Balances</span>
    </button>
    <button type="button" class="ios-tab-btn" data-mobile-tab="pay">
      <span class="tab-icon">💸</span>
      <span>Pay / +Inc</span>
    </button>
    <button type="button" class="ios-tab-btn" data-mobile-tab="analysis">
      <span class="tab-icon">📊</span>
      <span>Analysis</span>
    </button>
    <button type="button" class="ios-tab-btn" data-mobile-tab="worth">
      <span class="tab-icon">💭</span>
      <span>Worth It</span>
      <span class="tab-badge" id="mobile-worth-tab-badge">0</span>
    </button>
    <button type="button" class="ios-tab-btn" data-mobile-tab="history">
      <span class="tab-icon">📒</span>
      <span>Ledger</span>
    </button>
    <button type="button" class="ios-tab-btn" data-mobile-tab="sync">
      <span class="tab-icon">🔄</span>
      <span>Sync</span>
    </button>
  </nav>

  ${renderModalsHtml()}
  <script src="./1money-core.js"></script>
  <script src="./1money-ui.js"></script>
  <script>
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  </script>
</body>
</html>`;
}

function buildIPadHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="3MK F X G" />
  <meta name="theme-color" content="#090d16" />
  <title>3MK F X G — iPad Copy</title>
  <link rel="manifest" href="./manifest.webmanifest" />
  <link rel="apple-touch-icon" href="./apple-touch-icon.png" />
  <link rel="icon" type="image/png" href="./icon.png" />
  <link rel="stylesheet" href="./1money-styles.css" />
  <script>window.ONE_MONEY_EDITION = 'ipad';</script>
</head>
<body class="edition-ipad">
  <header class="app-topbar">
    <div class="brand-wrap">
      <div class="brand-logo"><img src="./icon.png" alt="3MK F X G" /></div>
      <div class="brand-title">
        <h1>3MK F X G <span class="edition-chip">📲 Copy 3: iPad Edition</span></h1>
        <div class="brand-subtitle" id="ipad-current-page-subtitle">Page 1 of 9 — 🏦 3 Live Balance Counters</div>
      </div>
    </div>
    <div class="topbar-right">
      <button type="button" class="btn-xs btn-outline hide-kb-inline-btn" data-dismiss-keyboard="true">⌨️⬇️ Hide Keyboard</button>
      <div class="sync-pill sync-online" id="sync-status-badge">
        <span class="dot"></span> Shared DB Live
      </div>
    </div>
  </header>

  <div class="ipad-shell">
    <!-- Left Sidebar / Page Switcher: Every Single Thing Has Its Own Dedicated Page -->
    <aside class="ipad-sidebar" aria-label="iPad Pages">
      <div class="ipad-sidebar-heading">📄 Pages (1 Thing Per Page)</div>

      <button type="button" class="ipad-nav-btn active" data-mobile-tab="balances" data-page-title="Page 1 of 9 — 🏦 3 Live Balance Counters">
        <span class="ipad-nav-icon">🏦</span>
        <span>1. 3 Balances</span>
      </button>

      <button type="button" class="ipad-nav-btn" data-mobile-tab="payment" data-page-title="Page 2 of 9 — 💸 Record a Payment">
        <span class="ipad-nav-icon">💸</span>
        <span>2. Enter Payment</span>
      </button>

      <button type="button" class="ipad-nav-btn" data-mobile-tab="income" data-page-title="Page 3 of 9 — ➕ Record Income">
        <span class="ipad-nav-icon">➕</span>
        <span>3. Enter Income</span>
      </button>

      <button type="button" class="ipad-nav-btn" data-mobile-tab="limit" data-page-title="Page 4 of 9 — 🎯 Monthly Spending Limit">
        <span class="ipad-nav-icon">🎯</span>
        <span>4. Monthly Limit</span>
      </button>

      <button type="button" class="ipad-nav-btn" data-mobile-tab="analysis" data-page-title="Page 5 of 9 — 📊 Every-Month Spending Analysis">
        <span class="ipad-nav-icon">📊</span>
        <span>5. Monthly Analysis</span>
      </button>

      <button type="button" class="ipad-nav-btn" data-mobile-tab="worth" data-page-title="Page 6 of 9 — 💭 Was It Worth It? (1-Hour Check)">
        <span class="ipad-nav-icon">💭</span>
        <span>6. Worth It? (1h)</span>
        <span class="tab-badge ipad-worth-badge" id="mobile-worth-tab-badge">0</span>
      </button>

      <button type="button" class="ipad-nav-btn" data-mobile-tab="history" data-page-title="Page 7 of 9 — 📒 Permanent Ledger">
        <span class="ipad-nav-icon">📒</span>
        <span>7. Ledger History</span>
      </button>

      <button type="button" class="ipad-nav-btn" data-mobile-tab="archives" data-page-title="Page 8 of 9 — 🗂️ Monthly Reset Archives">
        <span class="ipad-nav-icon">🗂️</span>
        <span>8. Monthly Archives</span>
      </button>

      <button type="button" class="ipad-nav-btn" data-mobile-tab="sync" data-page-title="Page 9 of 9 — 🔄 Shared Database & Sync">
        <span class="ipad-nav-icon">🔄</span>
        <span>9. Shared DB Sync</span>
      </button>
    </aside>

    <!-- Single-Page Workspace: Only ONE Page is visible at a time! -->
    <main class="ipad-workspace">
      <!-- Page 1: 3 Live Balance Counters -->
      <div class="ipad-page-panel tab-active" data-tab-panel="balances">
        ${renderSavingsCardHtml()}
      </div>

      <!-- Page 2: Enter Payment Only -->
      <div class="ipad-page-panel" data-tab-panel="payment">
        ${renderPaymentOnlyCardHtml()}
      </div>

      <!-- Page 3: Enter Income Only -->
      <div class="ipad-page-panel" data-tab-panel="income">
        ${renderIncomeOnlyCardHtml()}
      </div>

      <!-- Page 4: Monthly Spending Limit Only -->
      <div class="ipad-page-panel" data-tab-panel="limit">
        ${renderMonthlyLimitCardHtml()}
      </div>

      <!-- Page 5: Every-Month Spending Analysis Only -->
      <div class="ipad-page-panel" data-tab-panel="analysis">
        ${renderMonthlyAnalysisCardHtml()}
      </div>

      <!-- Page 6: 1-Hour "Was It Worth It?" Check Only -->
      <div class="ipad-page-panel" data-tab-panel="worth">
        ${renderWorthItCardHtml()}
      </div>

      <!-- Page 7: Permanent Ledger Only -->
      <div class="ipad-page-panel" data-tab-panel="history">
        ${renderHistoryCardHtml()}
      </div>

      <!-- Page 8: Monthly Reset Archives Only -->
      <div class="ipad-page-panel" data-tab-panel="archives">
        ${renderArchivesOnlyCardHtml()}
      </div>

      <!-- Page 9: Shared Database & 3-Device Sync Only -->
      <div class="ipad-page-panel" data-tab-panel="sync">
        ${renderSyncOnlyCardHtml()}
      </div>
    </main>
  </div>

  ${renderModalsHtml()}
  <script src="./1money-core.js"></script>
  <script src="./1money-ui.js"></script>
  <script>
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  </script>
</body>
</html>`;
}

function buildEditions() {
  const coreJs = fs.readFileSync(path.join(SHARED_DIR, '1money-core.js'), 'utf8');
  const uiJs = fs.readFileSync(path.join(SHARED_DIR, '1money-ui.js'), 'utf8');
  const stylesCss = fs.readFileSync(path.join(SHARED_DIR, '1money-styles.css'), 'utf8');
  const icon512Path = path.join(SHARED_DIR, 'icons', 'icon-512.png');
  const icon180Path = path.join(SHARED_DIR, 'icons', 'icon-180.png');

  for (const edition of EDITIONS) {
    fs.mkdirSync(edition.folder, { recursive: true });
    fs.writeFileSync(path.join(edition.folder, '1money-core.js'), coreJs, 'utf8');
    fs.writeFileSync(path.join(edition.folder, '1money-ui.js'), uiJs, 'utf8');
    fs.writeFileSync(path.join(edition.folder, '1money-styles.css'), stylesCss, 'utf8');
    fs.writeFileSync(path.join(edition.folder, 'index.html'), edition.htmlBuilder(), 'utf8');
    fs.writeFileSync(path.join(edition.folder, 'manifest.webmanifest'), buildManifest(edition), 'utf8');
    fs.writeFileSync(path.join(edition.folder, 'sw.js'), buildServiceWorker(), 'utf8');
    if (fs.existsSync(icon512Path)) {
      fs.copyFileSync(icon512Path, path.join(edition.folder, 'icon.png'));
    }
    if (fs.existsSync(icon180Path)) {
      fs.copyFileSync(icon180Path, path.join(edition.folder, 'apple-touch-icon.png'));
    }
  }
  console.log('[sync-editions] Successfully generated all 3 copies of 3MK F X G with dedicated iPad pages & keyboard-safe layout.');
}

if (require.main === module) {
  buildEditions();
}

module.exports = { buildEditions };
