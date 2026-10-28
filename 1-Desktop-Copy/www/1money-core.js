/**
 * 1Money Core Engine (Shared across Copy 1: Desktop, Copy 2: iPhone, Copy 3: iPad)
 * Features:
 * - 3 Live Balance Counters: Total Balance, Card Only Balance, Cash Only Balance
 * - Full Income Tracker (requires Card or Cash + Source/From What)
 * - Full Payment Tracker (requires Card or Cash + For What + Where)
 * - Automatic 1st-of-the-month spending reset with permanent monthly archives
 * - 1-Hour "Was it worth it?" Notification Scheduler (Capacitor Native iOS + Web + In-App Modal)
 * - Offline-first persistent local database + real-time bi-directional sync with Shared DB Server
 */

(function (global) {
  const STORAGE_KEY = '1money_permanent_db_v1';
  const SERVER_URL_KEY = '1money_server_url_v1';
  const NOTIFIED_IDS_KEY = '1money_local_notified_ids_v1';

  const DEFAULT_LAN_SERVER = 'http://localhost:3456';

  function getCurrentMonthKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  function formatMonthLabel(monthKey) {
    if (!monthKey || !monthKey.includes('-')) return monthKey || '';
    const [y, m] = monthKey.split('-').map(Number);
    const d = new Date(y, (m || 1) - 1, 1);
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

  function resolveServerBaseUrl() {
    const saved = localStorage.getItem(SERVER_URL_KEY);
    if (saved && saved.trim()) {
      return saved.trim().replace(/\/+$/, '');
    }
    const proto = window.location.protocol;
    if (proto === 'http:' || proto === 'https:') {
      return window.location.origin;
    }
    return DEFAULT_LAN_SERVER;
  }

  function playWorthItChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.11);
        gain.gain.setValueAtTime(0.001, ctx.currentTime + idx * 0.11);
        gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + idx * 0.11 + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + idx * 0.11 + 0.45);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + idx * 0.11);
        osc.stop(ctx.currentTime + idx * 0.11 + 0.46);
      });
    } catch (e) {}
  }

  async function scheduleNativeAndWebNotification(payment, currency = '$') {
    const amountStr = `${currency}${Number(payment.amount).toFixed(2)}`;
    const methodLabel = payment.method === 'cash' ? 'Cash 💵' : 'Card 💳';
    const title = '💭 Was it worth it?';
    const body = `You spent ${amountStr} (${methodLabel}) on "${payment.what}" at "${payment.where}". Was it worth it?`;
    const fireDate = new Date(payment.notifyAt);

    try {
      const Cap = window.Capacitor;
      if (Cap) {
        const notifId = Math.abs(
          payment.id.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0)
        ) % 2147483000 || Math.floor(Math.random() * 100000);
        const schedulePayload = {
          notifications: [
            {
              id: notifId,
              title,
              body,
              schedule: { at: fireDate, allowWhileIdle: true },
              sound: 'default',
              extra: { paymentId: payment.id }
            }
          ]
        };

        if (Cap.Plugins && Cap.Plugins.LocalNotifications) {
          const LN = Cap.Plugins.LocalNotifications;
          const perm = await LN.requestPermissions();
          if (perm && perm.display === 'granted') {
            await LN.schedule(schedulePayload);
          }
        } else if (typeof Cap.nativePromise === 'function') {
          const perm = await Cap.nativePromise('LocalNotifications', 'requestPermissions', {});
          if (!perm || perm.display === 'granted') {
            await Cap.nativePromise('LocalNotifications', 'schedule', schedulePayload);
          }
        }
      }
    } catch (err) {
      console.warn('[Capacitor LocalNotifications warning]', err);
    }

    try {
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    } catch (e) {}
  }

  async function fireImmediateNotification(payment, currency = '$') {
    const amountStr = `${currency}${Number(payment.amount).toFixed(2)}`;
    const methodLabel = payment.method === 'cash' ? 'Cash 💵' : 'Card 💳';
    const title = '💭 Was it worth it?';
    const body = `1 hour ago you spent ${amountStr} (${methodLabel}) on "${payment.what}" at "${payment.where}". Was it worth it?`;

    playWorthItChime();

    try {
      if ('Notification' in window) {
        if (Notification.permission === 'granted') {
          if (navigator.serviceWorker && navigator.serviceWorker.ready) {
            const reg = await navigator.serviceWorker.ready;
            if (reg && reg.showNotification) {
              await reg.showNotification(title, {
                body,
                tag: `worth-it-${payment.id}`,
                renotify: true,
                requireInteraction: true,
                data: { paymentId: payment.id }
              });
              return;
            }
          }
          new Notification(title, {
            body,
            tag: `worth-it-${payment.id}`
          });
        }
      }
    } catch (e) {}
  }

  class OneMoneyEngine {
    constructor(edition = 'desktop') {
      this.edition = edition;
      this.serverUrl = resolveServerBaseUrl();
      this.online = false;
      this.lastSyncTime = null;
      this.listeners = new Set();
      this.worthItModalCallbacks = new Set();
      this.sse = null;
      this.notifiedIds = this._loadNotifiedIds();
      this.db = this._loadLocalDb();
      this._enrichLocalDb();
    }

    _loadNotifiedIds() {
      try {
        const raw = localStorage.getItem(NOTIFIED_IDS_KEY);
        return new Set(raw ? JSON.parse(raw) : []);
      } catch (e) {
        return new Set();
      }
    }

    _saveNotifiedIds() {
      try {
        localStorage.setItem(NOTIFIED_IDS_KEY, JSON.stringify([...this.notifiedIds].slice(-500)));
      } catch (e) {}
    }

    _loadLocalDb() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') return parsed;
        }
      } catch (e) {}
      const now = Date.now();
      return {
        version: 2,
        currency: '$',
        cardBalance: 0,
        cashBalance: 0,
        savingsBalance: 0,
        monthlyLimit: 1000,
        settingsUpdatedAt: 0,
        currentMonthKey: getCurrentMonthKey(),
        updatedAt: now,
        payments: [],
        incomes: [],
        savingsLogs: [],
        monthlyArchives: {}
      };
    }

    _saveLocalDb() {
      try {
        this.db.cardBalance = roundCurrency(this.db.cardBalance || 0);
        this.db.cashBalance = roundCurrency(this.db.cashBalance || 0);
        this.db.savingsBalance = roundCurrency(this.db.cardBalance + this.db.cashBalance);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.db));
      } catch (e) {
        console.error('[Local DB Save Error]', e);
      }
    }

    _enrichLocalDb() {
      const db = this.db;
      const now = Date.now();
      const actualMonthKey = getCurrentMonthKey(new Date(now));

      if (typeof db.cardBalance !== 'number' || Number.isNaN(db.cardBalance)) {
        db.cardBalance = typeof db.savingsBalance === 'number' ? roundCurrency(db.savingsBalance) : 0;
      }
      if (typeof db.cashBalance !== 'number' || Number.isNaN(db.cashBalance)) {
        db.cashBalance = 0;
      }
      db.cardBalance = roundCurrency(db.cardBalance);
      db.cashBalance = roundCurrency(db.cashBalance);
      db.savingsBalance = roundCurrency(db.cardBalance + db.cashBalance);
      if (!Array.isArray(db.payments)) db.payments = [];
      if (!Array.isArray(db.incomes)) db.incomes = [];
      if (!Array.isArray(db.savingsLogs)) db.savingsLogs = [];

      if (!db.currentMonthKey) {
        db.currentMonthKey = actualMonthKey;
      } else if (db.currentMonthKey !== actualMonthKey) {
        const prevKey = db.currentMonthKey;
        const prevPayments = db.payments.filter(p => !p.deleted && p.monthKey === prevKey);
        const prevIncomes = db.incomes.filter(i => !i.deleted && i.monthKey === prevKey);
        if (!db.monthlyArchives) db.monthlyArchives = {};
        db.monthlyArchives[prevKey] = {
          monthKey: prevKey,
          monthLabel: formatMonthLabel(prevKey),
          totalSpent: roundCurrency(prevPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0)),
          cardSpent: roundCurrency(prevPayments.filter(p => p.method === 'card').reduce((s, p) => s + (Number(p.amount) || 0), 0)),
          cashSpent: roundCurrency(prevPayments.filter(p => p.method === 'cash').reduce((s, p) => s + (Number(p.amount) || 0), 0)),
          totalIncome: roundCurrency(prevIncomes.reduce((s, i) => s + (Number(i.amount) || 0), 0)),
          cardIncome: roundCurrency(prevIncomes.filter(i => i.method === 'card').reduce((s, i) => s + (Number(i.amount) || 0), 0)),
          cashIncome: roundCurrency(prevIncomes.filter(i => i.method === 'cash').reduce((s, i) => s + (Number(i.amount) || 0), 0)),
          monthlyLimit: db.monthlyLimit,
          paymentCount: prevPayments.length,
          incomeCount: prevIncomes.length,
          worthItYes: prevPayments.filter(p => p.worthIt === 'yes').length,
          worthItNo: prevPayments.filter(p => p.worthIt === 'no').length,
          archivedAt: now
        };
        db.currentMonthKey = actualMonthKey;
        this._saveLocalDb();
      }

      const currentMonthKey = db.currentMonthKey;
      const activePayments = db.payments
        .filter(p => !p.deleted)
        .sort((a, b) => b.createdAt - a.createdAt);

      const activeIncomes = db.incomes
        .filter(i => !i.deleted)
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

      const currentMonthIncomes = activeIncomes.filter(i => i.monthKey === currentMonthKey);
      const currentMonthIncome = roundCurrency(
        currentMonthIncomes.reduce((acc, i) => acc + (Number(i.amount) || 0), 0)
      );
      const currentMonthCardIncome = roundCurrency(
        currentMonthIncomes.filter(i => i.method === 'card').reduce((acc, i) => acc + (Number(i.amount) || 0), 0)
      );
      const currentMonthCashIncome = roundCurrency(
        currentMonthIncomes.filter(i => i.method === 'cash').reduce((acc, i) => acc + (Number(i.amount) || 0), 0)
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
        activeIncomes.reduce((acc, i) => acc + (Number(i.amount) || 0), 0)
      );
      const allTimeCardIncome = roundCurrency(
        activeIncomes.filter(i => i.method === 'card').reduce((acc, i) => acc + (Number(i.amount) || 0), 0)
      );
      const allTimeCashIncome = roundCurrency(
        activeIncomes.filter(i => i.method === 'cash').reduce((acc, i) => acc + (Number(i.amount) || 0), 0)
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

      const monthBuckets = { ...(db.monthlyArchives || {}) };
      for (const p of activePayments) {
        const mk = p.monthKey || getCurrentMonthKey(new Date(p.createdAt));
        if (!monthBuckets[mk]) {
          monthBuckets[mk] = { monthKey: mk, monthLabel: formatMonthLabel(mk), monthlyLimit: db.monthlyLimit };
        }
      }
      for (const i of activeIncomes) {
        const mk = i.monthKey || getCurrentMonthKey(new Date(i.createdAt));
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

      db.computed = {
        ...(db.computed || {}),
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
        resetInfo: getNextResetInfo(new Date(now))
      };

      return db;
    }

    onChange(cb) {
      this.listeners.add(cb);
      cb(this.getState());
      return () => this.listeners.delete(cb);
    }

    onWorthItPrompt(cb) {
      this.worthItModalCallbacks.add(cb);
      return () => this.worthItModalCallbacks.delete(cb);
    }

    _emit() {
      this._enrichLocalDb();
      const state = this.getState();
      for (const cb of this.listeners) {
        try {
          cb(state);
        } catch (e) {
          console.error(e);
        }
      }
    }

    _emitWorthItPrompt(payment) {
      for (const cb of this.worthItModalCallbacks) {
        try {
          cb(payment);
        } catch (e) {
          console.error(e);
        }
      }
    }

    getState() {
      return {
        ...this.db,
        online: this.online,
        serverUrl: this.serverUrl,
        lastSyncTime: this.lastSyncTime,
        edition: this.edition
      };
    }

    setServerUrl(newUrl) {
      const cleaned = String(newUrl || '').trim().replace(/\/+$/, '');
      if (!cleaned) return;
      this.serverUrl = cleaned;
      localStorage.setItem(SERVER_URL_KEY, cleaned);
      this.connectSSE();
      this.syncWithServer();
      this._emit();
    }

    async init() {
      setInterval(() => {
        this._checkDueNotificationsLocally();
        this._emit();
      }, 1000);

      await this.syncWithServer();
      this.connectSSE();

      setInterval(() => {
        if (!this.online) {
          this.syncWithServer();
        }
      }, 15000);

      window.addEventListener('online', () => this.syncWithServer());
    }

    _checkDueNotificationsLocally() {
      const now = Date.now();
      for (const payment of this.db.payments || []) {
        if (
          !payment.deleted &&
          payment.worthIt === 'pending' &&
          now >= payment.notifyAt &&
          !this.notifiedIds.has(payment.id)
        ) {
          this.notifiedIds.add(payment.id);
          this._saveNotifiedIds();
          payment.notificationSent = true;
          this._saveLocalDb();
          fireImmediateNotification(payment, this.db.currency);
          this._emitWorthItPrompt(payment);
        }
      }
    }

    connectSSE() {
      if (this.sse) {
        try {
          this.sse.close();
        } catch (e) {}
        this.sse = null;
      }
      if (!window.EventSource) return;
      try {
        const es = new EventSource(`${this.serverUrl}/api/events`);
        this.sse = es;
        es.onopen = () => {
          this.online = true;
          this.lastSyncTime = Date.now();
          this._emit();
        };
        es.onmessage = evt => {
          try {
            const data = JSON.parse(evt.data);
            if (data && data.state) {
              this.online = true;
              this.lastSyncTime = Date.now();
              this._applyServerState(data.state);
              if (data.type === 'WORTH_IT_NOTIFICATION_DUE' && data.extra && data.extra.payment) {
                const p = data.extra.payment;
                this.notifiedIds.add(p.id);
                this._saveNotifiedIds();
                fireImmediateNotification(p, this.db.currency);
                this._emitWorthItPrompt(p);
              }
            }
          } catch (e) {}
        };
        es.onerror = () => {
          this.online = false;
          this._emit();
        };
      } catch (e) {
        this.online = false;
      }
    }

    _applyServerState(serverState) {
      const serverPaymentIds = new Set((serverState.payments || []).map(p => p.id));
      const unsyncedLocalPayments = (this.db.payments || []).filter(
        p => p && p.id && !serverPaymentIds.has(p.id) && (Date.now() - p.createdAt < 60000)
      );

      const serverIncomeIds = new Set((serverState.incomes || []).map(i => i.id));
      const unsyncedLocalIncomes = (this.db.incomes || []).filter(
        i => i && i.id && !serverIncomeIds.has(i.id) && (Date.now() - i.createdAt < 60000)
      );

      this.db = {
        ...serverState,
        payments: [...unsyncedLocalPayments, ...(serverState.payments || [])],
        incomes: [...unsyncedLocalIncomes, ...(serverState.incomes || [])]
      };
      this._saveLocalDb();
      this._emit();
    }

    async syncWithServer() {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4500);
        const res = await fetch(`${this.serverUrl}/api/sync`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Device-Edition': this.edition
          },
          body: JSON.stringify({
            currency: this.db.currency,
            monthlyLimit: this.db.monthlyLimit,
            settingsUpdatedAt: this.db.settingsUpdatedAt || 0,
            payments: this.db.payments || [],
            incomes: this.db.incomes || [],
            savingsLogs: this.db.savingsLogs || []
          }),
          signal: controller.signal
        });
        clearTimeout(timeout);
        if (res.ok) {
          const json = await res.json();
          if (json && json.state) {
            this.online = true;
            this.lastSyncTime = Date.now();
            this._applyServerState(json.state);
            return true;
          }
        }
      } catch (e) {
        this.online = false;
        this._emit();
      }
      return false;
    }

    // Set exact Card & Cash balances directly
    async setExactBalances({ cardBalance, cashBalance, note = '' }) {
      const cleanCard = roundCurrency(Number(cardBalance));
      const cleanCash = roundCurrency(Number(cashBalance));
      if (Number.isNaN(cleanCard) || Number.isNaN(cleanCash)) {
        throw new Error('Please enter valid Card and Cash balances.');
      }

      const now = Date.now();
      const prevTotal = roundCurrency((this.db.cardBalance || 0) + (this.db.cashBalance || 0));
      this.db.cardBalance = cleanCard;
      this.db.cashBalance = cleanCash;
      this.db.savingsBalance = roundCurrency(cleanCard + cleanCash);

      const logEntry = {
        id: `sav_${now}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'set-balances',
        target: 'both',
        cardBalance: cleanCard,
        cashBalance: cleanCash,
        amount: this.db.savingsBalance,
        previousBalance: prevTotal,
        newBalance: this.db.savingsBalance,
        note: String(note || 'Set Card & Cash balances').trim(),
        deviceOrigin: this.edition,
        createdAt: now
      };

      if (!Array.isArray(this.db.savingsLogs)) this.db.savingsLogs = [];
      this.db.savingsLogs.unshift(logEntry);
      this._saveLocalDb();
      this._emit();

      try {
        const res = await fetch(`${this.serverUrl}/api/savings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: logEntry.id,
            cardBalance: cleanCard,
            cashBalance: cleanCash,
            note: logEntry.note,
            deviceOrigin: this.edition,
            createdAt: now
          })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.state) this._applyServerState(data.state);
        }
      } catch (e) {}

      return logEntry;
    }

    // Add Income (Mandatory Card or Cash + Source/From What)
    async addIncome({ amount, method, source, note = '' }) {
      const cleanAmount = roundCurrency(Number(amount));
      const cleanMethod = String(method || '').toLowerCase();
      const cleanSource = String(source || '').trim();

      if (Number.isNaN(cleanAmount) || cleanAmount <= 0) {
        throw new Error('Please enter an income amount greater than 0.');
      }
      if (cleanMethod !== 'card' && cleanMethod !== 'cash') {
        throw new Error('Please choose Card or Cash — how did you receive this income?');
      }
      if (!cleanSource) {
        throw new Error('Please enter where this income came from (e.g., Salary, Gift, Freelance).');
      }

      const now = Date.now();
      const income = {
        id: `inc_${now}_${Math.random().toString(36).slice(2, 8)}`,
        amount: cleanAmount,
        method: cleanMethod,
        source: cleanSource,
        note: String(note || '').trim(),
        createdAt: now,
        monthKey: getCurrentMonthKey(new Date(now)),
        deviceOrigin: this.edition,
        updatedAt: now,
        deleted: false
      };

      if (cleanMethod === 'cash') {
        this.db.cashBalance = roundCurrency((this.db.cashBalance || 0) + cleanAmount);
      } else {
        this.db.cardBalance = roundCurrency((this.db.cardBalance || 0) + cleanAmount);
      }
      this.db.savingsBalance = roundCurrency(this.db.cardBalance + this.db.cashBalance);

      if (!Array.isArray(this.db.incomes)) this.db.incomes = [];
      this.db.incomes.unshift(income);
      this._saveLocalDb();
      this._emit();

      try {
        const res = await fetch(`${this.serverUrl}/api/incomes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(income)
        });
        if (res.ok) {
          const data = await res.json();
          if (data.state) this._applyServerState(data.state);
        }
      } catch (e) {}

      return income;
    }

    // Delete an Income record
    async deleteIncome(incomeId) {
      const now = Date.now();
      const target = (this.db.incomes || []).find(i => i.id === incomeId);
      if (target && !target.deleted) {
        target.deleted = true;
        target.updatedAt = now;
        if (target.method === 'cash') {
          this.db.cashBalance = roundCurrency((this.db.cashBalance || 0) - Number(target.amount));
        } else {
          this.db.cardBalance = roundCurrency((this.db.cardBalance || 0) - Number(target.amount));
        }
        this.db.savingsBalance = roundCurrency(this.db.cardBalance + this.db.cashBalance);
        this._saveLocalDb();
        this._emit();
      }

      try {
        const res = await fetch(`${this.serverUrl}/api/incomes/${encodeURIComponent(incomeId)}`, {
          method: 'DELETE'
        });
        if (res.ok) {
          const data = await res.json();
          if (data.state) this._applyServerState(data.state);
        }
      } catch (e) {}
    }

    // Update Monthly Spending Limit & Currency
    async updateSettings({ monthlyLimit, currency }) {
      const now = Date.now();
      if (monthlyLimit !== undefined) {
        const cleanLimit = roundCurrency(Number(monthlyLimit));
        if (Number.isNaN(cleanLimit) || cleanLimit < 0) {
          throw new Error('Please enter a valid monthly limit.');
        }
        this.db.monthlyLimit = cleanLimit;
      }
      if (typeof currency === 'string' && currency.trim()) {
        this.db.currency = currency.trim();
      }
      this.db.settingsUpdatedAt = now;
      this._saveLocalDb();
      this._emit();

      try {
        const res = await fetch(`${this.serverUrl}/api/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            monthlyLimit: this.db.monthlyLimit,
            currency: this.db.currency
          })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.state) this._applyServerState(data.state);
        }
      } catch (e) {}
    }

    // Add a Payment (Card or Cash + For What + Where)
    async addPayment({ amount, method, what, where, notifyDelayMs = 3600000 }) {
      const cleanAmount = roundCurrency(Number(amount));
      const cleanMethod = String(method || '').toLowerCase();
      const cleanWhat = String(what || '').trim();
      const cleanWhere = String(where || '').trim();

      if (Number.isNaN(cleanAmount) || cleanAmount <= 0) {
        throw new Error('Please enter a payment amount greater than 0.');
      }
      if (cleanMethod !== 'card' && cleanMethod !== 'cash') {
        throw new Error('Please choose Card or Cash — how did you spend this money?');
      }
      if (!cleanWhat) {
        throw new Error('Please enter what you spent this money on ("For what?").');
      }
      if (!cleanWhere) {
        throw new Error('Please enter where you spent this money ("Where?").');
      }

      const now = Date.now();
      const payment = {
        id: `pay_${now}_${Math.random().toString(36).slice(2, 8)}`,
        amount: cleanAmount,
        method: cleanMethod,
        what: cleanWhat,
        where: cleanWhere,
        createdAt: now,
        monthKey: getCurrentMonthKey(new Date(now)),
        notifyAt: now + Number(notifyDelayMs),
        notificationSent: false,
        worthIt: 'pending',
        worthItNote: '',
        worthItAnsweredAt: null,
        deviceOrigin: this.edition,
        updatedAt: now,
        deleted: false
      };

      // Deduct from matching counter (Card or Cash) & Total Balance immediately
      if (cleanMethod === 'cash') {
        this.db.cashBalance = roundCurrency((this.db.cashBalance || 0) - cleanAmount);
      } else {
        this.db.cardBalance = roundCurrency((this.db.cardBalance || 0) - cleanAmount);
      }
      this.db.savingsBalance = roundCurrency(this.db.cardBalance + this.db.cashBalance);

      if (!Array.isArray(this.db.payments)) this.db.payments = [];
      this.db.payments.unshift(payment);
      this._saveLocalDb();
      this._emit();

      scheduleNativeAndWebNotification(payment, this.db.currency);

      try {
        const res = await fetch(`${this.serverUrl}/api/payments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payment,
            notifyDelayMs: Number(notifyDelayMs)
          })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.state) this._applyServerState(data.state);
        }
      } catch (e) {}

      return payment;
    }

    async answerWorthIt(paymentId, worthIt, worthItNote = '') {
      const now = Date.now();
      const target = (this.db.payments || []).find(p => p.id === paymentId);
      if (target) {
        target.worthIt = worthIt;
        target.worthItNote = worthItNote;
        target.worthItAnsweredAt = now;
        target.notificationSent = true;
        target.updatedAt = now;
        this._saveLocalDb();
        this._emit();
      }

      try {
        const res = await fetch(`${this.serverUrl}/api/payments/${encodeURIComponent(paymentId)}/worth-it`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ worthIt, worthItNote })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.state) this._applyServerState(data.state);
        }
      } catch (e) {}
    }

    async triggerWorthItNow(paymentId) {
      const now = Date.now();
      const target = (this.db.payments || []).find(p => p.id === paymentId);
      if (target) {
        target.notifyAt = now - 500;
        target.worthIt = 'pending';
        target.updatedAt = now;
        this.notifiedIds.delete(paymentId);
        this._saveLocalDb();
        this._checkDueNotificationsLocally();
        this._emit();
      }

      try {
        const res = await fetch(`${this.serverUrl}/api/payments/${encodeURIComponent(paymentId)}/trigger-worth-it`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.state) this._applyServerState(data.state);
        }
      } catch (e) {}
    }

    async deletePayment(paymentId) {
      const now = Date.now();
      const target = (this.db.payments || []).find(p => p.id === paymentId);
      if (target && !target.deleted) {
        target.deleted = true;
        target.updatedAt = now;
        if (target.method === 'cash') {
          this.db.cashBalance = roundCurrency((this.db.cashBalance || 0) + Number(target.amount));
        } else {
          this.db.cardBalance = roundCurrency((this.db.cardBalance || 0) + Number(target.amount));
        }
        this.db.savingsBalance = roundCurrency(this.db.cardBalance + this.db.cashBalance);
        this._saveLocalDb();
        this._emit();
      }

      try {
        const res = await fetch(`${this.serverUrl}/api/payments/${encodeURIComponent(paymentId)}`, {
          method: 'DELETE'
        });
        if (res.ok) {
          const data = await res.json();
          if (data.state) this._applyServerState(data.state);
        }
      } catch (e) {}
    }
  }

  global.OneMoneyEngine = OneMoneyEngine;
})(window);
