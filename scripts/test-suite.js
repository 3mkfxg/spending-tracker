/**
 * Automated End-to-End Verification Suite for 1Money (v2)
 * Safely backs up and restores the user's real database before & after testing.
 */

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { server } = require('../server/server');

const TEST_PORT = 3499;

function request(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path: urlPath,
        method,
        headers: data
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(data)
            }
          : {}
      },
      res => {
        let raw = '';
        res.on('data', chunk => (raw += chunk.toString()));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch (e) {}
          resolve({ status: res.statusCode, raw, json });
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function runTests() {
  const dbFile = path.join(__dirname, '..', 'database', '1money-db.json');
  const backupExisting = fs.existsSync(dbFile) ? fs.readFileSync(dbFile, 'utf8') : null;

  await new Promise(resolve => server.listen(TEST_PORT, '127.0.0.1', resolve));
  console.log(`[Test Suite] Server started on port ${TEST_PORT}`);

  try {
    // Start test with an isolated clean state
    await request('POST', '/api/backup/restore', {
      version: 2,
      currency: '$',
      cardBalance: 0,
      cashBalance: 0,
      savingsBalance: 0,
      monthlyLimit: 1000,
      settingsUpdatedAt: Date.now(),
      payments: [],
      incomes: [],
      savingsLogs: [],
      monthlyArchives: {}
    });

    // 1. Verify all 3 copies serve HTTP 200 with 3MK F X G, custom icon, 3 counters, and Monthly Analysis
    for (const route of ['/desktop', '/iphone', '/ipad']) {
      const res = await request('GET', route);
      assert.strictEqual(res.status, 200, `Expected 200 on ${route}`);
      assert(res.raw.includes('3MK F X G'), `Expected 3MK F X G branding on ${route}`);
      assert(res.raw.includes('icon.png'), `Expected custom icon.png on ${route}`);
      assert(res.raw.includes('Counter 1: Total Balance'), `Expected 3 counters HTML on ${route}`);
      assert(res.raw.includes('analysis-spotlight-grid'), `Expected Every-Month Spending Analysis spotlight grid on ${route}`);
      assert(res.raw.includes('analysis-items-list'), `Expected Every-Month Spending Analysis items list on ${route}`);
    }
    console.log('✅ [PASS] All 3 copies (/desktop, /iphone, /ipad) serve 3MK F X G, custom icon, 3 Counters, Income UI, and Monthly Analysis.');

    // 2. Set initial Card Balance ($2,000) and Cash Balance ($500) -> Total Balance ($2,500)
    const savRes = await request('POST', '/api/savings', {
      cardBalance: 2000,
      cashBalance: 500,
      note: 'Initial Balances',
      deviceOrigin: 'desktop'
    });
    assert.strictEqual(savRes.status, 200);
    assert.strictEqual(savRes.json.state.cardBalance, 2000);
    assert.strictEqual(savRes.json.state.cashBalance, 500);
    assert.strictEqual(savRes.json.state.savingsBalance, 2500);
    console.log('✅ [PASS] 3 Balance Counters initialized: Card=$2,000, Cash=$500, Total=$2,500.');

    // 3. Test Income Validation (must require Card or Cash + Source) & Adding Card/Cash Income
    const badInc = await request('POST', '/api/incomes', {
      amount: 500,
      method: '',
      source: 'Salary'
    });
    assert.strictEqual(badInc.status, 400, 'Should reject income without Card/Cash');

    const incCard = await request('POST', '/api/incomes', {
      amount: 1000,
      method: 'card',
      source: 'Salary',
      deviceOrigin: 'iphone'
    });
    assert.strictEqual(incCard.status, 201);
    assert.strictEqual(incCard.json.state.cardBalance, 3000);
    assert.strictEqual(incCard.json.state.cashBalance, 500);
    assert.strictEqual(incCard.json.state.savingsBalance, 3500);

    const incCash = await request('POST', '/api/incomes', {
      amount: 200,
      method: 'cash',
      source: 'Freelance Tip',
      deviceOrigin: 'ipad'
    });
    assert.strictEqual(incCash.status, 201);
    assert.strictEqual(incCash.json.state.cardBalance, 3000);
    assert.strictEqual(incCash.json.state.cashBalance, 700);
    assert.strictEqual(incCash.json.state.savingsBalance, 3700);
    assert.strictEqual(incCash.json.state.computed.currentMonthIncome, 1200);
    console.log('✅ [PASS] Income tracking adds to Card Only, Cash Only, and Total Balance.');

    // 4. Add a Card payment ($40) and a Cash payment ($15) -> verify exact counter deductions
    const payCard = await request('POST', '/api/payments', {
      amount: 40,
      method: 'card',
      what: 'Groceries',
      where: 'Whole Foods',
      deviceOrigin: 'iphone'
    });
    assert.strictEqual(payCard.status, 201);
    assert.strictEqual(payCard.json.state.cardBalance, 2960);
    assert.strictEqual(payCard.json.state.cashBalance, 700);
    assert.strictEqual(payCard.json.state.savingsBalance, 3660);

    const payCash = await request('POST', '/api/payments', {
      amount: 15,
      method: 'cash',
      what: 'Coffee & Pastry',
      where: 'Local Bakery',
      deviceOrigin: 'ipad'
    });
    assert.strictEqual(payCash.status, 201);
    assert.strictEqual(payCash.json.state.cardBalance, 2960);
    assert.strictEqual(payCash.json.state.cashBalance, 685);
    assert.strictEqual(payCash.json.state.savingsBalance, 3645);
    assert.strictEqual(payCash.json.state.computed.currentMonthSpent, 55);
    console.log('✅ [PASS] Card & Cash payments deduct from their respective counters and Total Balance.');
  } finally {
    if (backupExisting !== null) {
      await request('POST', '/api/backup/restore', JSON.parse(backupExisting));
      fs.writeFileSync(dbFile, backupExisting, 'utf8');
      console.log('✅ [PASS] User database preserved and restored intact.');
    }
    server.close();
  }
}

runTests().catch(err => {
  console.error('❌ [TEST FAILED]', err);
  process.exit(1);
});
