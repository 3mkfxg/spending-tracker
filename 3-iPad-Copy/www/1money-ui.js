/**
 * 3MK F X G — Shared UI Controller
 * Powers all 3 Copies (Desktop, iPhone, iPad) with:
 * - 3 Live Counters: Total Balance, Card Only Balance, Cash Only Balance
 * - Every-Month Spending Analysis (Food, Cinema, Taxi & Exact "For What" Thing Breakdown per Month)
 * - Full Income Tracker (requires Card or Cash + Source)
 * - Full Payment Tracker (requires Card or Cash + For What + Where + 1-Hour "Was it worth it?" Notification)
 * - Monthly Spending Limit (auto-resets on 1st of every month)
 */

(function () {
  const EDITION = window.ONE_MONEY_EDITION || 'desktop';
  const engine = new window.OneMoneyEngine(EDITION);

  let selectedPaymentMethod = '';
  let selectedIncomeMethod = '';
  let selectedNotifyDelay = 3600000;
  let currentFilter = 'all';
  let searchQuery = '';
  let selectedAnalysisMonth = ''; // Defaults to currentMonthKey
  let activeModalPaymentId = null;

  // Smart Category Classifier for Monthly Analysis (Food, Cinema, Taxi, etc.)
  const CATEGORY_RULES = [
    {
      id: 'food',
      label: '🍔 Food & Drinks',
      color: '#f59e0b',
      keywords: [
        'food', 'drink', 'drinks', 'coffee', 'cafe', 'dinner', 'lunch', 'breakfast',
        'restaurant', 'burger', 'pizza', 'shawarma', 'snack', 'snacks', 'grocery',
        'groceries', 'supermarket', 'bakery', 'water', 'tea', 'juice', 'meal', 'kfc',
        'mcdonald', 'starbucks', 'hunger', 'talabat'
      ]
    },
    {
      id: 'cinema',
      label: '🎬 Cinema & Entertainment',
      color: '#ec4899',
      keywords: [
        'cinema', 'cinima', 'movie', 'movies', 'film', 'vox', 'amc', 'netflix',
        'popcorn', 'ticket', 'tickets', 'game', 'gaming', 'playstation', 'steam',
        'bowling', 'concert', 'entertainment', 'fun', 'arcade'
      ]
    },
    {
      id: 'taxi',
      label: '🚕 Taxi & Transport',
      color: '#06b6d4',
      keywords: [
        'taxi', 'uber', 'careem', 'bolt', 'lyft', 'cab', 'ride', 'bus', 'metro',
        'train', 'transport', 'gas', 'fuel', 'petrol', 'parking', 'car', 'flight'
      ]
    },
    {
      id: 'university',
      label: '🎓 University & Study',
      color: '#8b5cf6',
      keywords: [
        'university', 'uni', 'college', 'school', 'book', 'books', 'tuition',
        'course', 'study', 'notebook', 'pen', 'print', 'printing', 'exam'
      ]
    },
    {
      id: 'shopping',
      label: '🛍️ Shopping & Clothes',
      color: '#3b82f6',
      keywords: [
        'shopping', 'clothes', 'shirt', 'shoes', 'pants', 'jacket', 'mall',
        'amazon', 'noon', 'shein', 'zara', 'nike', 'adidas', 'phone', 'case',
        'headphones', 'watch', 'gift'
      ]
    },
    {
      id: 'bills',
      label: '🏠 Bills & Subscriptions',
      color: '#10b981',
      keywords: [
        'bill', 'bills', 'rent', 'internet', 'wifi', 'electricity', 'phone bill',
        'subscription', 'icloud', 'spotify', 'youtube', 'gym', 'health', 'pharmacy'
      ]
    }
  ];

  function classifyPaymentCategory(payment) {
    const whatLower = String(payment.what || '').toLowerCase();
    const whereLower = String(payment.where || '').toLowerCase();
    // Check item description first before store/location keywords
    for (const cat of CATEGORY_RULES) {
      if (cat.keywords.some(kw => whatLower.includes(kw))) {
        return cat;
      }
    }
    for (const cat of CATEGORY_RULES) {
      if (cat.keywords.some(kw => whereLower.includes(kw))) {
        return cat;
      }
    }
    return {
      id: 'other',
      label: '📦 Other Spending',
      color: '#94a3b8'
    };
  }

  function formatMoney(amount, currency = '$') {
    const num = Number(amount) || 0;
    const sign = num < 0 ? '-' : '';
    const abs = Math.abs(num).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return `${sign}${currency}${abs}`;
  }

  function formatRelativeCountdown(notifyAt, now = Date.now()) {
    const diff = Math.max(0, notifyAt - now);
    const totalSec = Math.ceil(diff / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    if (mins > 0) {
      return `${mins}m ${String(secs).padStart(2, '0')}s`;
    }
    return `${secs}s`;
  }

  function formatDateTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  function deviceBadge(origin) {
    if (origin === 'iphone') return '📱 iPhone';
    if (origin === 'ipad') return '📲 iPad';
    return '🖥️ Desktop';
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('toast-hide');
      setTimeout(() => toast.remove(), 300);
    }, 3600);
  }

  function dismissKeyboard() {
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      const tag = document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        document.activeElement.blur();
      }
    }
    try {
      if (
        window.Capacitor &&
        window.Capacitor.Plugins &&
        window.Capacitor.Plugins.Keyboard &&
        typeof window.Capacitor.Plugins.Keyboard.hide === 'function'
      ) {
        window.Capacitor.Plugins.Keyboard.hide();
      }
    } catch (e) {}
    document.body.classList.remove('keyboard-open');
  }

  function switchMobileOrIpadTab(targetTab) {
    dismissKeyboard();
    document.querySelectorAll('[data-mobile-tab]').forEach(b => {
      const isMatch = b.getAttribute('data-mobile-tab') === targetTab;
      b.classList.toggle('active', isMatch);
      if (isMatch) {
        const pageTitle = b.getAttribute('data-page-title');
        const subtitleEl = document.getElementById('ipad-current-page-subtitle');
        if (pageTitle && subtitleEl) {
          subtitleEl.textContent = pageTitle;
        }
      }
    });
    document.querySelectorAll('[data-tab-panel]').forEach(panel => {
      panel.classList.toggle('tab-active', panel.getAttribute('data-tab-panel') === targetTab);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setupEventListeners() {
    // 0. Keyboard-Safe Listeners (Fixes keyboard standing in the way of buttons!)
    document.querySelectorAll('[data-dismiss-keyboard], #floating-hide-keyboard-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        dismissKeyboard();
      });
    });

    // Track when any input is focused so we show "Done / Hide Keyboard" & add extra bottom scroll space
    document.addEventListener('focusin', e => {
      const el = e.target;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
        document.body.classList.add('keyboard-open');
        setTimeout(() => {
          try {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          } catch (err) {}
        }, 180);
      }
    });

    document.addEventListener('focusout', () => {
      setTimeout(() => {
        const active = document.activeElement;
        if (!active || (active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA')) {
          document.body.classList.remove('keyboard-open');
        }
      }, 120);
    });

    // Pressing Enter / "Done" on the iOS keyboard closes the keyboard instead of getting stuck
    document.querySelectorAll('input.input-field').forEach(inp => {
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter' && inp.id !== 'server-url-input') {
          e.preventDefault();
          dismissKeyboard();
        }
      });
    });

    // Tapping outside of inputs on card background closes the keyboard automatically
    document.addEventListener('pointerdown', e => {
      if (!document.body.classList.contains('keyboard-open')) return;
      const target = e.target;
      if (!target) return;
      if (target.closest('input, textarea, select, label')) return;
      // User tapped a button or background while keyboard was open -> dismiss keyboard immediately so click goes through cleanly!
      if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
        document.activeElement.blur();
      }
    });

    // 1. Payment Card vs Cash selector buttons
    document.querySelectorAll('[data-method-choice]').forEach(btn => {
      btn.addEventListener('click', () => {
        dismissKeyboard();
        selectedPaymentMethod = btn.getAttribute('data-method-choice');
        document.querySelectorAll('[data-method-choice]').forEach(b => {
          b.classList.toggle('active', b.getAttribute('data-method-choice') === selectedPaymentMethod);
        });
        const errEl = document.getElementById('payment-form-error');
        if (errEl) errEl.textContent = '';
      });
    });

    // 2. Income Card vs Cash selector buttons
    document.querySelectorAll('[data-income-method-choice]').forEach(btn => {
      btn.addEventListener('click', () => {
        dismissKeyboard();
        selectedIncomeMethod = btn.getAttribute('data-income-method-choice');
        document.querySelectorAll('[data-income-method-choice]').forEach(b => {
          b.classList.toggle('active', b.getAttribute('data-income-method-choice') === selectedIncomeMethod);
        });
        const errEl = document.getElementById('income-form-error');
        if (errEl) errEl.textContent = '';
      });
    });

    // 3. Notification delay selector (1 Hour vs 10s Test)
    document.querySelectorAll('[data-notify-delay]').forEach(btn => {
      btn.addEventListener('click', () => {
        dismissKeyboard();
        selectedNotifyDelay = Number(btn.getAttribute('data-notify-delay')) || 3600000;
        document.querySelectorAll('[data-notify-delay]').forEach(b => {
          b.classList.toggle('active', Number(b.getAttribute('data-notify-delay')) === selectedNotifyDelay);
        });
      });
    });

    // 4. Entry Mode Switcher Tabs (💸 Enter Payment vs ➕ Add Income)
    document.querySelectorAll('[data-entry-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        dismissKeyboard();
        const mode = btn.getAttribute('data-entry-mode');
        document.querySelectorAll('[data-entry-mode]').forEach(b => {
          b.classList.toggle('active', b.getAttribute('data-entry-mode') === mode);
        });
        const payWrap = document.getElementById('entry-panel-payment');
        const incWrap = document.getElementById('entry-panel-income');
        if (payWrap && incWrap) {
          payWrap.style.display = mode === 'payment' ? 'block' : 'none';
          incWrap.style.display = mode === 'income' ? 'block' : 'none';
        }
      });
    });

    // Jump to Payment Page/Form
    document.querySelectorAll('[data-jump-payment]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (document.querySelector('[data-mobile-tab="payment"]')) {
          switchMobileOrIpadTab('payment');
        } else if (document.querySelector('[data-mobile-tab="pay"]')) {
          switchMobileOrIpadTab('pay');
          const payTabBtn = document.querySelector('[data-entry-mode="payment"]');
          if (payTabBtn) payTabBtn.click();
        } else {
          const payTabBtn = document.querySelector('[data-entry-mode="payment"]');
          if (payTabBtn) payTabBtn.click();
        }
      });
    });

    // Jump to Income Page/Form
    document.querySelectorAll('[data-jump-income]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (document.querySelector('[data-mobile-tab="income"]')) {
          switchMobileOrIpadTab('income');
        } else if (document.querySelector('[data-mobile-tab="pay"]')) {
          switchMobileOrIpadTab('pay');
          const incTabBtn = document.querySelector('[data-entry-mode="income"]');
          if (incTabBtn) incTabBtn.click();
        } else {
          const incTabBtn = document.querySelector('[data-entry-mode="income"]');
          if (incTabBtn) incTabBtn.click();
        }
      });
    });

    // 5. Month selector dropdown for Monthly Spending Analysis
    const analysisMonthSelect = document.getElementById('analysis-month-select');
    if (analysisMonthSelect) {
      analysisMonthSelect.addEventListener('change', () => {
        selectedAnalysisMonth = analysisMonthSelect.value;
        render(engine.getState());
      });
    }

    // 6. Payment submission form
    const paymentForm = document.getElementById('payment-form');
    if (paymentForm) {
      paymentForm.addEventListener('submit', async e => {
        e.preventDefault();
        const errEl = document.getElementById('payment-form-error');
        if (errEl) errEl.textContent = '';

        const amountInput = document.getElementById('pay-amount');
        const whatInput = document.getElementById('pay-what');
        const whereInput = document.getElementById('pay-where');

        const amount = parseFloat(amountInput ? amountInput.value : '');
        const what = whatInput ? whatInput.value.trim() : '';
        const where = whereInput ? whereInput.value.trim() : '';

        if (!amount || amount <= 0) {
          if (errEl) errEl.textContent = '⚠️ Please enter how much money you spent.';
          if (amountInput) amountInput.focus();
          return;
        }
        if (selectedPaymentMethod !== 'card' && selectedPaymentMethod !== 'cash') {
          if (errEl) errEl.textContent = '⚠️ Please choose 💳 Card or 💵 Cash — how did you spend this money?';
          return;
        }
        if (!what) {
          if (errEl) errEl.textContent = '⚠️ Please enter what you bought ("For what?").';
          if (whatInput) whatInput.focus();
          return;
        }
        if (!where) {
          if (errEl) errEl.textContent = '⚠️ Please enter where you spent this money ("Where?").';
          if (whereInput) whereInput.focus();
          return;
        }

        try {
          const payment = await engine.addPayment({
            amount,
            method: selectedPaymentMethod,
            what,
            where,
            notifyDelayMs: selectedNotifyDelay
          });

          if (amountInput) amountInput.value = '';
          if (whatInput) whatInput.value = '';
          if (whereInput) whereInput.value = '';
          selectedPaymentMethod = '';
          document.querySelectorAll('[data-method-choice]').forEach(b => b.classList.remove('active'));

          const delayLabel = selectedNotifyDelay < 60000
            ? `${Math.round(selectedNotifyDelay / 1000)} seconds`
            : '1 hour';
          const targetCounterName = payment.method === 'cash' ? '💵 Cash Balance' : '💳 Card Balance';
          showToast(
            `Subtracted ${formatMoney(payment.amount, engine.getState().currency)} from ${targetCounterName} & Total Balance! Asking "Was it worth it?" in ${delayLabel}.`
          );
        } catch (err) {
          if (errEl) errEl.textContent = err.message || 'Could not save payment.';
        }
      });
    }

    // 7. Income submission form
    const incomeForm = document.getElementById('income-form');
    if (incomeForm) {
      incomeForm.addEventListener('submit', async e => {
        e.preventDefault();
        const errEl = document.getElementById('income-form-error');
        if (errEl) errEl.textContent = '';

        const amountInput = document.getElementById('inc-amount');
        const sourceInput = document.getElementById('inc-source');
        const noteInput = document.getElementById('inc-note');

        const amount = parseFloat(amountInput ? amountInput.value : '');
        const source = sourceInput ? sourceInput.value.trim() : '';
        const note = noteInput ? noteInput.value.trim() : '';

        if (!amount || amount <= 0) {
          if (errEl) errEl.textContent = '⚠️ Please enter how much income you received.';
          if (amountInput) amountInput.focus();
          return;
        }
        if (selectedIncomeMethod !== 'card' && selectedIncomeMethod !== 'cash') {
          if (errEl) errEl.textContent = '⚠️ Please choose 💳 Card or 💵 Cash — how did you receive this income?';
          return;
        }
        if (!source) {
          if (errEl) errEl.textContent = '⚠️ Please enter where this income came from (e.g., Salary, Gift, Freelance).';
          if (sourceInput) sourceInput.focus();
          return;
        }

        try {
          const income = await engine.addIncome({
            amount,
            method: selectedIncomeMethod,
            source,
            note
          });

          if (amountInput) amountInput.value = '';
          if (sourceInput) sourceInput.value = '';
          if (noteInput) noteInput.value = '';
          selectedIncomeMethod = '';
          document.querySelectorAll('[data-income-method-choice]').forEach(b => b.classList.remove('active'));

          const targetCounterName = income.method === 'cash' ? '💵 Cash Only Balance' : '💳 Card Only Balance';
          showToast(
            `➕ Added ${formatMoney(income.amount, engine.getState().currency)} to ${targetCounterName} and Total Balance!`
          );
        } catch (err) {
          if (errEl) errEl.textContent = err.message || 'Could not save income.';
        }
      });
    }

    // 8. Set Exact Card & Cash Balances Modal
    document.querySelectorAll('[data-open-balances-modal]').forEach(btn => {
      btn.addEventListener('click', () => {
        const state = engine.getState();
        const cardEl = document.getElementById('modal-card-balance');
        const cashEl = document.getElementById('modal-cash-balance');
        const previewEl = document.getElementById('modal-total-preview');
        if (cardEl) cardEl.value = state.cardBalance ?? 0;
        if (cashEl) cashEl.value = state.cashBalance ?? 0;
        const updatePreview = () => {
          const c1 = parseFloat(cardEl ? cardEl.value : '0') || 0;
          const c2 = parseFloat(cashEl ? cashEl.value : '0') || 0;
          if (previewEl) previewEl.textContent = formatMoney(c1 + c2, state.currency || '$');
        };
        if (cardEl) cardEl.oninput = updatePreview;
        if (cashEl) cashEl.oninput = updatePreview;
        updatePreview();
        openModal('savings-modal');
        if (cardEl) setTimeout(() => cardEl.focus(), 60);
      });
    });

    const savingsForm = document.getElementById('savings-modal-form');
    if (savingsForm) {
      savingsForm.addEventListener('submit', async e => {
        e.preventDefault();
        const cardEl = document.getElementById('modal-card-balance');
        const cashEl = document.getElementById('modal-cash-balance');
        const noteEl = document.getElementById('savings-modal-note');
        const cardVal = parseFloat(cardEl ? cardEl.value : '0');
        const cashVal = parseFloat(cashEl ? cashEl.value : '0');
        if (Number.isNaN(cardVal) || Number.isNaN(cashVal)) {
          showToast('Please enter valid numbers for Card and Cash balances.', 'error');
          return;
        }
        await engine.setExactBalances({
          cardBalance: cardVal,
          cashBalance: cashVal,
          note: noteEl ? noteEl.value.trim() : 'Set Card & Cash balances'
        });
        closeModal('savings-modal');
        showToast('Updated 💳 Card, 💵 Cash & 🏦 Total Balances!');
      });
    }

    // 9. Monthly Limit Modal controls
    document.querySelectorAll('[data-open-limit-modal]').forEach(btn => {
      btn.addEventListener('click', () => {
        const state = engine.getState();
        const input = document.getElementById('limit-modal-amount');
        const currInput = document.getElementById('limit-modal-currency');
        if (input) input.value = state.monthlyLimit;
        if (currInput) currInput.value = state.currency || '$';
        openModal('limit-modal');
        if (input) setTimeout(() => input.focus(), 60);
      });
    });

    const limitForm = document.getElementById('limit-modal-form');
    if (limitForm) {
      limitForm.addEventListener('submit', async e => {
        e.preventDefault();
        const input = document.getElementById('limit-modal-amount');
        const currInput = document.getElementById('limit-modal-currency');
        const val = parseFloat(input ? input.value : '');
        const curr = currInput ? currInput.value.trim() : '$';
        if (Number.isNaN(val) || val < 0) {
          showToast('Please enter a valid monthly limit.', 'error');
          return;
        }
        await engine.updateSettings({ monthlyLimit: val, currency: curr || '$' });
        closeModal('limit-modal');
        showToast('Monthly spending limit saved!');
      });
    }

    // Close modals
    document.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-close-modal');
        closeModal(target);
      });
    });

    // History filter pills
    document.querySelectorAll('[data-history-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        currentFilter = btn.getAttribute('data-history-filter') || 'all';
        document.querySelectorAll('[data-history-filter]').forEach(b => {
          b.classList.toggle('active', b.getAttribute('data-history-filter') === currentFilter);
        });
        render(engine.getState());
      });
    });

    const searchInput = document.getElementById('history-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        searchQuery = searchInput.value.trim().toLowerCase();
        render(engine.getState());
      });
    }

    const serverUrlForm = document.getElementById('server-url-form');
    if (serverUrlForm) {
      serverUrlForm.addEventListener('submit', e => {
        e.preventDefault();
        const input = document.getElementById('server-url-input');
        if (input && input.value.trim()) {
          engine.setServerUrl(input.value.trim());
          showToast('Updated Shared Database Server address & syncing...');
        }
      });
    }

    const restoreInput = document.getElementById('backup-restore-input');
    if (restoreInput) {
      restoreInput.addEventListener('change', async e => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          const parsed = JSON.parse(text);
          const res = await fetch(`${engine.serverUrl}/api/backup/restore`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(parsed)
          });
          if (res.ok) {
            showToast('Database backup restored across all devices!');
          } else {
            showToast('Failed to restore backup.', 'error');
          }
        } catch (err) {
          showToast('Invalid backup JSON file.', 'error');
        }
        restoreInput.value = '';
      });
    }

    document.querySelectorAll('[data-mobile-tab]').forEach(tabBtn => {
      tabBtn.addEventListener('click', () => {
        const targetTab = tabBtn.getAttribute('data-mobile-tab');
        switchMobileOrIpadTab(targetTab);
      });
    });

    const enableNotifBtn = document.getElementById('enable-notifications-btn');
    if (enableNotifBtn) {
      enableNotifBtn.addEventListener('click', async () => {
        if ('Notification' in window) {
          const perm = await Notification.requestPermission();
          if (perm === 'granted') {
            showToast('1-Hour Notifications enabled on this device!');
          } else {
            showToast('In-app 1-hour popups are active!', 'info');
          }
          render(engine.getState());
        }
      });
    }
  }

  function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('modal-open');
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('modal-open');
    if (id === 'worth-it-modal') {
      activeModalPaymentId = null;
    }
  }

  function openWorthItModal(payment) {
    if (!payment) return;
    activeModalPaymentId = payment.id;
    const state = engine.getState();
    const bodyEl = document.getElementById('worth-it-modal-content');
    if (!bodyEl) return;

    const methodBadge = payment.method === 'cash'
      ? '<span class="method-pill method-cash">💵 Cash</span>'
      : '<span class="method-pill method-card">💳 Card</span>';

    bodyEl.innerHTML = `
      <div class="worth-it-hero">
        <div class="worth-it-icon-pulse">💭</div>
        <h3>Was it worth it?</h3>
        <p class="worth-it-sub">1-Hour Post-Purchase Check-In</p>
      </div>
      <div class="worth-it-summary-box">
        <div class="worth-it-amount">${formatMoney(payment.amount, state.currency)}</div>
        <div class="worth-it-meta">${methodBadge} • <span>${formatDateTime(payment.createdAt)}</span></div>
        <div class="worth-it-details">
          <div><strong>For What:</strong> ${escapeHtml(payment.what)}</div>
          <div><strong>Where:</strong> ${escapeHtml(payment.where)}</div>
        </div>
      </div>
      <div class="worth-it-note-wrap">
        <input type="text" id="worth-it-modal-note" class="input-field" placeholder="Optional note (why was it worth it or not?)" value="${escapeHtml(payment.worthItNote || '')}" />
      </div>
      <div class="worth-it-actions">
        <button type="button" class="btn btn-worth-yes" id="modal-btn-worth-yes">
          👍 Yes, Worth It!
        </button>
        <button type="button" class="btn btn-worth-no" id="modal-btn-worth-no">
          👎 No, Regret It
        </button>
      </div>
    `;

    const yesBtn = document.getElementById('modal-btn-worth-yes');
    const noBtn = document.getElementById('modal-btn-worth-no');
    const noteInput = document.getElementById('worth-it-modal-note');

    if (yesBtn) {
      yesBtn.onclick = async () => {
        await engine.answerWorthIt(payment.id, 'yes', noteInput ? noteInput.value.trim() : '');
        closeModal('worth-it-modal');
        showToast('Marked as 👍 Worth It!');
      };
    }
    if (noBtn) {
      noBtn.onclick = async () => {
        await engine.answerWorthIt(payment.id, 'no', noteInput ? noteInput.value.trim() : '');
        closeModal('worth-it-modal');
        showToast('Marked as 👎 Regretted — good to keep in mind next time!', 'info');
      };
    }

    openModal('worth-it-modal');
  }

  // Render the Monthly Spending Analysis (Food, Cinema, Taxi & Every Specific Item/Thing Paid For)
  function renderMonthlyAnalysis(state) {
    const comp = state.computed || {};
    const curr = state.currency || '$';
    const currentMonthKey = comp.currentMonthKey || state.currentMonthKey || '';
    if (!selectedAnalysisMonth) {
      selectedAnalysisMonth = currentMonthKey;
    }

    // Populate month dropdown from monthlyHistory
    const monthSelectEl = document.getElementById('analysis-month-select');
    const historyMonths = comp.monthlyHistory || [];
    if (monthSelectEl) {
      const optionsHtml = historyMonths.map(m => {
        const selected = m.monthKey === selectedAnalysisMonth ? 'selected' : '';
        return `<option value="${escapeHtml(m.monthKey)}" ${selected}>${escapeHtml(m.monthLabel || m.monthKey)}${m.monthKey === currentMonthKey ? ' (Current)' : ''}</option>`;
      }).join('');
      if (monthSelectEl.innerHTML !== optionsHtml && optionsHtml) {
        monthSelectEl.innerHTML = optionsHtml;
        monthSelectEl.value = selectedAnalysisMonth;
      }
    }

    const activePayments = (state.payments || []).filter(
      p => !p.deleted && p.monthKey === selectedAnalysisMonth
    );

    const monthTotalSpent = activePayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);

    // 1. Compute Category Totals (Always include Food, Cinema, Taxi at the top so user always sees them!)
    const catTotals = new Map();
    for (const rule of CATEGORY_RULES.slice(0, 3)) {
      // Pre-seed Food, Cinema, Taxi
      catTotals.set(rule.id, {
        id: rule.id,
        label: rule.label,
        color: rule.color,
        total: 0,
        card: 0,
        cash: 0,
        count: 0
      });
    }

    for (const p of activePayments) {
      const cat = classifyPaymentCategory(p);
      if (!catTotals.has(cat.id)) {
        catTotals.set(cat.id, {
          id: cat.id,
          label: cat.label,
          color: cat.color,
          total: 0,
          card: 0,
          cash: 0,
          count: 0
        });
      }
      const entry = catTotals.get(cat.id);
      const amt = Number(p.amount) || 0;
      entry.total += amt;
      if (p.method === 'cash') entry.cash += amt;
      else entry.card += amt;
      entry.count += 1;
    }

    // Highlighted 3 Key Categories (🍔 Food, 🎬 Cinema, 🚕 Taxi)
    const spotlightEl = document.getElementById('analysis-spotlight-grid');
    if (spotlightEl) {
      const food = catTotals.get('food');
      const cinema = catTotals.get('cinema');
      const taxi = catTotals.get('taxi');
      spotlightEl.innerHTML = [food, cinema, taxi].map(c => `
        <div class="analysis-spotlight-box">
          <span class="spotlight-title">${escapeHtml(c.label)}</span>
          <strong class="spotlight-amount">${formatMoney(c.total, curr)}</strong>
          <span class="spotlight-sub">${c.count} payment${c.count === 1 ? '' : 's'} this month</span>
        </div>
      `).join('');
    }

    // All Categories Progress Bars
    const catListEl = document.getElementById('analysis-categories-list');
    if (catListEl) {
      const sortedCats = [...catTotals.values()].sort((a, b) => b.total - a.total);
      catListEl.innerHTML = sortedCats.map(c => {
        const pct = monthTotalSpent > 0 ? Math.round((c.total / monthTotalSpent) * 1000) / 10 : 0;
        return `
          <div class="analysis-bar-item">
            <div class="analysis-bar-header">
              <span><strong>${escapeHtml(c.label)}</strong> <span class="muted">(${c.count}x)</span></span>
              <span><strong>${formatMoney(c.total, curr)}</strong> <span class="muted">(${pct}%)</span></span>
            </div>
            <div class="analysis-bar-track">
              <div class="analysis-bar-fill" style="width:${Math.min(100, pct)}%; background:${c.color};"></div>
            </div>
          </div>
        `;
      }).join('');
    }

    // 2. Exact Item ("What You Paid For") Breakdown in This Month
    const itemsMap = new Map();
    for (const p of activePayments) {
      const rawWhat = String(p.what || 'Other').trim();
      const key = rawWhat.toLowerCase();
      if (!itemsMap.has(key)) {
        itemsMap.set(key, {
          name: rawWhat,
          total: 0,
          card: 0,
          cash: 0,
          count: 0,
          places: new Set()
        });
      }
      const item = itemsMap.get(key);
      const amt = Number(p.amount) || 0;
      item.total += amt;
      if (p.method === 'cash') item.cash += amt;
      else item.card += amt;
      item.count += 1;
      if (p.where) item.places.add(p.where);
    }

    const itemsListEl = document.getElementById('analysis-items-list');
    if (itemsListEl) {
      const sortedItems = [...itemsMap.values()].sort((a, b) => b.total - a.total);
      if (sortedItems.length === 0) {
        itemsListEl.innerHTML = `
          <div class="empty-state-mini">
            No payments recorded in this month yet. Enter a payment (e.g., <strong>Food</strong>, <strong>Cinema</strong>, <strong>Taxi</strong>) to see your item-by-item breakdown!
          </div>
        `;
      } else {
        itemsListEl.innerHTML = sortedItems.map(item => {
          const pct = monthTotalSpent > 0 ? Math.round((item.total / monthTotalSpent) * 1000) / 10 : 0;
          const placesStr = [...item.places].slice(0, 3).join(', ');
          return `
            <div class="analysis-item-row">
              <div class="analysis-item-left">
                <div class="analysis-item-name">
                  <strong>${escapeHtml(item.name)}</strong>
                  <span class="badge badge-neutral">${item.count}x this month</span>
                </div>
                <div class="analysis-item-meta">
                  💳 Card: ${formatMoney(item.card, curr)} • 💵 Cash: ${formatMoney(item.cash, curr)}
                  ${placesStr ? ` • 📍 ${escapeHtml(placesStr)}` : ''}
                </div>
              </div>
              <div class="analysis-item-right">
                <div class="analysis-item-total">${formatMoney(item.total, curr)}</div>
                <div class="analysis-item-pct">${pct}% of month</div>
              </div>
            </div>
          `;
        }).join('');
      }
    }
  }

  function render(state) {
    const comp = state.computed || {};
    const curr = state.currency || '$';

    // 1. Sync Status Badge
    const syncBadge = document.getElementById('sync-status-badge');
    if (syncBadge) {
      if (state.online) {
        syncBadge.className = 'sync-pill sync-online';
        syncBadge.innerHTML = `<span class="dot"></span> Shared DB Live (iPhone • iPad • Desktop)`;
      } else {
        syncBadge.className = 'sync-pill sync-offline';
        syncBadge.innerHTML = `<span class="dot"></span> Offline Vault Saved (Auto-Syncs)`;
      }
    }

    // 2. The 3 Live Balance Counters
    const totalBalanceEl = document.getElementById('savings-balance-value');
    if (totalBalanceEl) {
      totalBalanceEl.textContent = formatMoney(state.savingsBalance, curr);
      totalBalanceEl.classList.toggle('negative-balance', (state.savingsBalance || 0) < 0);
    }

    const cardBalanceEl = document.getElementById('card-balance-value');
    if (cardBalanceEl) {
      cardBalanceEl.textContent = formatMoney(state.cardBalance || 0, curr);
      cardBalanceEl.classList.toggle('negative-balance', (state.cardBalance || 0) < 0);
    }

    const cashBalanceEl = document.getElementById('cash-balance-value');
    if (cashBalanceEl) {
      cashBalanceEl.textContent = formatMoney(state.cashBalance || 0, curr);
      cashBalanceEl.classList.toggle('negative-balance', (state.cashBalance || 0) < 0);
    }

    const allTimeStatsEl = document.getElementById('all-time-stats');
    if (allTimeStatsEl) {
      allTimeStatsEl.innerHTML = `
        <span>➕ All-Time Income: <strong style="color:#6ee7b7">${formatMoney(comp.allTimeIncome || 0, curr)}</strong></span>
        <span>•</span>
        <span>💸 All-Time Spent: <strong style="color:#fca5a5">${formatMoney(comp.allTimeSpent || 0, curr)}</strong></span>
      `;
    }

    // 3. Monthly Limit & 1st-of-the-Month Reset Card
    const monthTitleEl = document.getElementById('current-month-label');
    if (monthTitleEl) {
      monthTitleEl.textContent = comp.currentMonthLabel || 'This Month';
    }

    const resetBadgeEl = document.getElementById('monthly-reset-badge');
    if (resetBadgeEl && comp.resetInfo) {
      resetBadgeEl.innerHTML = `🔄 Auto-resets 1st of month (<strong>${comp.resetInfo.nextResetDateFormatted}</strong> • ${comp.resetInfo.daysUntilReset}d left)`;
    }

    const spentVsLimitEl = document.getElementById('monthly-spent-vs-limit');
    if (spentVsLimitEl) {
      spentVsLimitEl.innerHTML = `
        <span class="spent-big ${comp.isOverLimit ? 'text-danger' : comp.isNearLimit ? 'text-warning' : ''}">${formatMoney(comp.currentMonthSpent || 0, curr)}</span>
        <span class="limit-slash">/ ${formatMoney(state.monthlyLimit || 0, curr)} limit</span>
      `;
    }

    const limitProgressFill = document.getElementById('limit-progress-fill');
    if (limitProgressFill) {
      const pct = Math.min(100, Math.max(0, comp.limitPercent || 0));
      limitProgressFill.style.width = `${pct}%`;
      limitProgressFill.className = 'progress-bar-fill ' + (
        comp.isOverLimit ? 'fill-danger' : comp.isNearLimit ? 'fill-warning' : 'fill-safe'
      );
    }

    const limitStatusBanner = document.getElementById('limit-status-banner');
    if (limitStatusBanner) {
      if (comp.isOverLimit) {
        const overBy = Math.abs(comp.limitRemaining || 0);
        limitStatusBanner.className = 'limit-alert alert-danger';
        limitStatusBanner.innerHTML = `🚨 <strong>Monthly Limit Reached!</strong> You have spent <strong>${formatMoney(comp.currentMonthSpent, curr)}</strong> this month (${formatMoney(overBy, curr)} over your ${formatMoney(state.monthlyLimit, curr)} limit).`;
      } else if (comp.isNearLimit) {
        limitStatusBanner.className = 'limit-alert alert-warning';
        limitStatusBanner.innerHTML = `⚠️ <strong>Approaching Limit (${comp.limitPercent}% used):</strong> You have <strong>${formatMoney(comp.limitRemaining, curr)}</strong> left for the rest of ${comp.currentMonthLabel}.`;
      } else {
        limitStatusBanner.className = 'limit-alert alert-safe';
        limitStatusBanner.innerHTML = `✅ <strong>${comp.limitPercent || 0}% of monthly limit used</strong> — You have <strong>${formatMoney(comp.limitRemaining || 0, curr)}</strong> left until the 1st of next month.`;
      }
    }

    const cardSpentEl = document.getElementById('month-card-spent');
    const cashSpentEl = document.getElementById('month-cash-spent');
    const cardIncomeEl = document.getElementById('month-card-income');
    const cashIncomeEl = document.getElementById('month-cash-income');
    if (cardSpentEl) cardSpentEl.textContent = formatMoney(comp.currentMonthCardSpent || 0, curr);
    if (cashSpentEl) cashSpentEl.textContent = formatMoney(comp.currentMonthCashSpent || 0, curr);
    if (cardIncomeEl) cardIncomeEl.textContent = '+' + formatMoney(comp.currentMonthCardIncome || 0, curr);
    if (cashIncomeEl) cashIncomeEl.textContent = '+' + formatMoney(comp.currentMonthCashIncome || 0, curr);

    // 4. Render Monthly Spending Analysis (Food, Cinema, Taxi & Every Thing Paid For)
    renderMonthlyAnalysis(state);

    // 5. Quick Autocomplete Chips for Payment ("What" including Food, Cinema, Taxi presets!)
    const whatChipsEl = document.getElementById('recent-what-chips');
    if (whatChipsEl) {
      const presetWhats = ['Food', 'Cinema', 'Taxi', 'Coffee', 'Groceries'];
      const mergedWhats = [...new Set([...presetWhats, ...(comp.recentWhats || [])])].slice(0, 8);
      whatChipsEl.innerHTML = mergedWhats.map(item =>
        `<button type="button" class="quick-chip" data-fill-what="${escapeHtml(item)}">${escapeHtml(item)}</button>`
      ).join('');
      whatChipsEl.querySelectorAll('[data-fill-what]').forEach(btn => {
        btn.onclick = () => {
          dismissKeyboard();
          const input = document.getElementById('pay-what');
          if (input) input.value = btn.getAttribute('data-fill-what');
        };
      });
    }

    const whereChipsEl = document.getElementById('recent-where-chips');
    if (whereChipsEl) {
      const places = (comp.recentWheres || []).slice(0, 6);
      whereChipsEl.innerHTML = places.map(place =>
        `<button type="button" class="quick-chip" data-fill-where="${escapeHtml(place)}">📍 ${escapeHtml(place)}</button>`
      ).join('');
      whereChipsEl.querySelectorAll('[data-fill-where]').forEach(btn => {
        btn.onclick = () => {
          dismissKeyboard();
          const input = document.getElementById('pay-where');
          if (input) input.value = btn.getAttribute('data-fill-where');
        };
      });
    }

    const incomeChipsEl = document.getElementById('recent-income-chips');
    if (incomeChipsEl) {
      const defaultSources = ['Salary', 'Freelance', 'Gift', 'Bonus', 'Allowance'];
      const mergedSources = [...new Set([...(comp.recentIncomeSources || []), ...defaultSources])].slice(0, 6);
      incomeChipsEl.innerHTML = mergedSources.map(src =>
        `<button type="button" class="quick-chip" data-fill-inc-source="${escapeHtml(src)}">💰 ${escapeHtml(src)}</button>`
      ).join('');
      incomeChipsEl.querySelectorAll('[data-fill-inc-source]').forEach(btn => {
        btn.onclick = () => {
          dismissKeyboard();
          const input = document.getElementById('inc-source');
          if (input) input.value = btn.getAttribute('data-fill-inc-source');
        };
      });
    }

    // 6. "Was it worth it?" 1-Hour Queue & Score Panel
    const dueList = comp.dueWorthItPayments || [];
    const upcomingList = comp.upcomingWorthItPayments || [];

    const dueCountBadge = document.getElementById('worth-it-due-badge');
    if (dueCountBadge) {
      const totalPending = dueList.length + upcomingList.length;
      dueCountBadge.textContent = dueList.length > 0 ? `${dueList.length} Due Now!` : `${totalPending} Pending`;
      dueCountBadge.className = `badge ${dueList.length > 0 ? 'badge-urgent' : 'badge-neutral'}`;
    }

    const mobileWorthBadge = document.getElementById('mobile-worth-tab-badge');
    if (mobileWorthBadge) {
      if (dueList.length > 0) {
        mobileWorthBadge.style.display = 'inline-flex';
        mobileWorthBadge.textContent = String(dueList.length);
      } else {
        mobileWorthBadge.style.display = 'none';
      }
    }

    const worthScoreEl = document.getElementById('worth-it-score-summary');
    if (worthScoreEl) {
      worthScoreEl.innerHTML = `
        <div class="worth-stat worth-yes-box">
          <span class="worth-stat-label">👍 Worth It</span>
          <strong>${comp.worthItYesCount || 0} (${formatMoney(comp.worthItYesAmount || 0, curr)})</strong>
        </div>
        <div class="worth-stat worth-no-box">
          <span class="worth-stat-label">👎 Regretted</span>
          <strong>${comp.worthItNoCount || 0} (${formatMoney(comp.worthItNoAmount || 0, curr)})</strong>
        </div>
      `;
    }

    const worthQueueEl = document.getElementById('worth-it-queue-list');
    if (worthQueueEl) {
      if (dueList.length === 0 && upcomingList.length === 0) {
        worthQueueEl.innerHTML = `
          <div class="empty-state-mini">
            <span>✨ All caught up! When you enter a payment, a 1-hour timer starts and asks you <strong>"Was it worth it?"</strong></span>
          </div>
        `;
      } else {
        const dueHtml = dueList.map(p => `
          <div class="worth-card worth-card-due">
            <div class="worth-card-top">
              <span class="worth-due-tag">🔔 1 Hour Passed — Was it worth it?</span>
              <strong>${formatMoney(p.amount, curr)} (${p.method === 'cash' ? '💵 Cash' : '💳 Card'})</strong>
            </div>
            <div class="worth-card-title">
              <strong>${escapeHtml(p.what)}</strong> <span class="muted">at</span> <strong>${escapeHtml(p.where)}</strong>
            </div>
            <div class="worth-card-buttons">
              <button type="button" class="btn-sm btn-yes" data-quick-worth="${escapeHtml(p.id)}" data-ans="yes">👍 Yes, Worth It</button>
              <button type="button" class="btn-sm btn-no" data-quick-worth="${escapeHtml(p.id)}" data-ans="no">👎 No, Regret It</button>
            </div>
          </div>
        `).join('');

        const upcomingHtml = upcomingList.map(p => `
          <div class="worth-card worth-card-upcoming">
            <div class="worth-card-top">
              <span class="worth-timer-tag">⏱️ Asking "Was it worth it?" in <strong>${formatRelativeCountdown(p.notifyAt)}</strong></span>
              <strong>${formatMoney(p.amount, curr)}</strong>
            </div>
            <div class="worth-card-title">
              <span>${p.method === 'cash' ? '💵' : '💳'} <strong>${escapeHtml(p.what)}</strong> at <strong>${escapeHtml(p.where)}</strong></span>
              <button type="button" class="btn-xs btn-outline" data-trigger-worth-now="${escapeHtml(p.id)}" title="Test the 1-hour notification right now">
                🔔 Ask Now
              </button>
            </div>
          </div>
        `).join('');

        worthQueueEl.innerHTML = dueHtml + upcomingHtml;

        worthQueueEl.querySelectorAll('[data-quick-worth]').forEach(btn => {
          btn.onclick = () => {
            const id = btn.getAttribute('data-quick-worth');
            const ans = btn.getAttribute('data-ans');
            engine.answerWorthIt(id, ans);
            showToast(ans === 'yes' ? 'Saved: 👍 Worth It!' : 'Saved: 👎 Regretted');
          };
        });

        worthQueueEl.querySelectorAll('[data-trigger-worth-now]').forEach(btn => {
          btn.onclick = () => {
            const id = btn.getAttribute('data-trigger-worth-now');
            engine.triggerWorthItNow(id);
          };
        });
      }
    }

    // 7. Combined Permanent Ledger (Payments + Income)
    const historyListEl = document.getElementById('payments-history-list');
    if (historyListEl) {
      const paymentEntries = (state.payments || [])
        .filter(p => !p.deleted)
        .map(p => ({ ...p, entryType: 'payment' }));

      const incomeEntries = (state.incomes || [])
        .filter(i => !i.deleted)
        .map(i => ({ ...i, entryType: 'income' }));

      let combined = [...paymentEntries, ...incomeEntries].sort((a, b) => b.createdAt - a.createdAt);

      if (currentFilter === 'payments') {
        combined = combined.filter(x => x.entryType === 'payment');
      } else if (currentFilter === 'incomes') {
        combined = combined.filter(x => x.entryType === 'income');
      } else if (currentFilter === 'month') {
        combined = combined.filter(x => x.monthKey === comp.currentMonthKey);
      } else if (currentFilter === 'card') {
        combined = combined.filter(x => x.method === 'card');
      } else if (currentFilter === 'cash') {
        combined = combined.filter(x => x.method === 'cash');
      } else if (currentFilter === 'yes') {
        combined = combined.filter(x => x.entryType === 'payment' && x.worthIt === 'yes');
      } else if (currentFilter === 'no') {
        combined = combined.filter(x => x.entryType === 'payment' && x.worthIt === 'no');
      } else if (currentFilter === 'pending') {
        combined = combined.filter(x => x.entryType === 'payment' && x.worthIt === 'pending');
      }

      if (searchQuery) {
        combined = combined.filter(x =>
          String(x.what || x.source || '').toLowerCase().includes(searchQuery) ||
          String(x.where || x.note || '').toLowerCase().includes(searchQuery) ||
          String(x.method || '').toLowerCase().includes(searchQuery)
        );
      }

      if (combined.length === 0) {
        historyListEl.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">📒</div>
            <p>No records match this view yet.</p>
            <span class="muted">Every income and payment you enter is permanently saved across your iPhone, iPad, and Desktop.</span>
          </div>
        `;
      } else {
        historyListEl.innerHTML = combined.map(item => {
          const isCash = item.method === 'cash';

          if (item.entryType === 'income') {
            return `
              <div class="payment-row income-row">
                <div class="payment-method-avatar avatar-income">
                  ${isCash ? '💵' : '💳'}
                </div>
                <div class="payment-info">
                  <div class="payment-primary">
                    <span class="payment-what">➕ ${escapeHtml(item.source)}</span>
                    ${item.note ? `<span class="payment-where">(${escapeHtml(item.note)})</span>` : ''}
                  </div>
                  <div class="payment-secondary">
                    <span class="method-tag ${isCash ? 'tag-cash' : 'tag-card'}">Added to ${isCash ? 'Cash' : 'Card'}</span>
                    <span>•</span>
                    <span>${formatDateTime(item.createdAt)}</span>
                    <span>•</span>
                    <span>${deviceBadge(item.deviceOrigin)}</span>
                  </div>
                </div>
                <div class="payment-right">
                  <div class="income-amount">+${formatMoney(item.amount, curr)}</div>
                  <div class="payment-actions-row">
                    <span class="worth-pill worth-yes" style="cursor:default;">💰 Income</span>
                    <button type="button" class="btn-icon-delete" data-delete-income="${escapeHtml(item.id)}" title="Delete income entry">✕</button>
                  </div>
                </div>
              </div>
            `;
          }

          const p = item;
          let worthBadge = '';
          if (p.worthIt === 'yes') {
            worthBadge = `<button type="button" class="worth-pill worth-yes" data-open-worth-modal="${escapeHtml(p.id)}" title="Click to change">👍 Worth It</button>`;
          } else if (p.worthIt === 'no') {
            worthBadge = `<button type="button" class="worth-pill worth-no" data-open-worth-modal="${escapeHtml(p.id)}" title="Click to change">👎 Not Worth It</button>`;
          } else if (Date.now() >= p.notifyAt) {
            worthBadge = `<button type="button" class="worth-pill worth-due" data-open-worth-modal="${escapeHtml(p.id)}">💭 Was it worth it? (Answer)</button>`;
          } else {
            worthBadge = `
              <span class="worth-pill worth-pending">
                ⏱️ ${formatRelativeCountdown(p.notifyAt)}
                <button type="button" class="link-btn" data-trigger-worth-now="${escapeHtml(p.id)}">Ask Now</button>
              </span>
            `;
          }

          return `
            <div class="payment-row">
              <div class="payment-method-avatar ${isCash ? 'avatar-cash' : 'avatar-card'}">
                ${isCash ? '💵' : '💳'}
              </div>
              <div class="payment-info">
                <div class="payment-primary">
                  <span class="payment-what">${escapeHtml(p.what)}</span>
                  <span class="payment-where">📍 ${escapeHtml(p.where)}</span>
                </div>
                <div class="payment-secondary">
                  <span class="method-tag ${isCash ? 'tag-cash' : 'tag-card'}">Paid by ${isCash ? 'Cash' : 'Card'}</span>
                  <span>•</span>
                  <span>${formatDateTime(p.createdAt)}</span>
                  <span>•</span>
                  <span>${deviceBadge(p.deviceOrigin)}</span>
                </div>
              </div>
              <div class="payment-right">
                <div class="payment-amount">-${formatMoney(p.amount, curr)}</div>
                <div class="payment-actions-row">
                  ${worthBadge}
                  <button type="button" class="btn-icon-delete" data-delete-payment="${escapeHtml(p.id)}" title="Delete & refund to ${isCash ? 'Cash' : 'Card'} balance">✕</button>
                </div>
              </div>
            </div>
          `;
        }).join('');

        historyListEl.querySelectorAll('[data-open-worth-modal]').forEach(btn => {
          btn.onclick = () => {
            const id = btn.getAttribute('data-open-worth-modal');
            const p = (state.payments || []).find(item => item.id === id);
            if (p) openWorthItModal(p);
          };
        });

        historyListEl.querySelectorAll('[data-trigger-worth-now]').forEach(btn => {
          btn.onclick = () => {
            const id = btn.getAttribute('data-trigger-worth-now');
            engine.triggerWorthItNow(id);
          };
        });

        historyListEl.querySelectorAll('[data-delete-payment]').forEach(btn => {
          btn.onclick = async () => {
            const id = btn.getAttribute('data-delete-payment');
            await engine.deletePayment(id);
            showToast('Payment removed & refunded to balance.');
          };
        });

        historyListEl.querySelectorAll('[data-delete-income]').forEach(btn => {
          btn.onclick = async () => {
            const id = btn.getAttribute('data-delete-income');
            await engine.deleteIncome(id);
            showToast('Income entry removed from balance.');
          };
        });
      }
    }

    // 8. Monthly Reset Archives
    const archivesEl = document.getElementById('monthly-archives-list');
    if (archivesEl) {
      const history = comp.monthlyHistory || [];
      if (history.length === 0) {
        archivesEl.innerHTML = `<div class="muted">Current month is active. Past months are archived here automatically on the 1st of every month.</div>`;
      } else {
        archivesEl.innerHTML = history.map(m => {
          const isCurrent = m.monthKey === comp.currentMonthKey;
          return `
            <div class="archive-item ${isCurrent ? 'archive-current' : ''}">
              <div>
                <strong>${escapeHtml(m.monthLabel || m.monthKey)}</strong>
                ${isCurrent ? '<span class="badge badge-current">Active Month</span>' : '<span class="badge badge-neutral">Archived on 1st</span>'}
                <div class="archive-sub">
                  💸 Spent: ${formatMoney(m.totalSpent || 0, curr)} (💳 ${formatMoney(m.cardSpent || 0, curr)} • 💵 ${formatMoney(m.cashSpent || 0, curr)})
                </div>
                <div class="archive-sub" style="color:#6ee7b7">
                  ➕ Income: +${formatMoney(m.totalIncome || 0, curr)} (💳 +${formatMoney(m.cardIncome || 0, curr)} • 💵 +${formatMoney(m.cashIncome || 0, curr)})
                </div>
              </div>
              <div class="archive-right">
                <div class="archive-spent">${formatMoney(m.totalSpent || 0, curr)}</div>
                <div class="archive-limit">Limit: ${formatMoney(m.monthlyLimit || state.monthlyLimit, curr)}</div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // 9. 3-Copy Device Sync Links
    const serverUrlInput = document.getElementById('server-url-input');
    if (serverUrlInput && document.activeElement !== serverUrlInput) {
      serverUrlInput.value = state.serverUrl || '';
    }

    const lanLinksEl = document.getElementById('lan-device-links');
    if (lanLinksEl) {
      const lans = comp.lanAddresses || [];
      if (lans.length > 0) {
        const primary = lans[0];
        lanLinksEl.innerHTML = `
          <div class="device-copy-grid">
            <div class="device-copy-card">
              <div class="device-copy-title">📱 Copy 1: iPhone App</div>
              <code>${escapeHtml(primary.iphoneUrl)}</code>
              <a href="${escapeHtml(primary.iphoneUrl)}" class="btn-xs btn-outline" target="_blank">Open iPhone Copy</a>
            </div>
            <div class="device-copy-card">
              <div class="device-copy-title">📲 Copy 2: iPad App</div>
              <code>${escapeHtml(primary.ipadUrl)}</code>
              <a href="${escapeHtml(primary.ipadUrl)}" class="btn-xs btn-outline" target="_blank">Open iPad Copy</a>
            </div>
            <div class="device-copy-card">
              <div class="device-copy-title">🖥️ Copy 3: Desktop App</div>
              <code>${escapeHtml(primary.desktopUrl)}</code>
              <a href="${escapeHtml(primary.desktopUrl)}" class="btn-xs btn-outline" target="_blank">Open Desktop Copy</a>
            </div>
          </div>
        `;
      }
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    engine.onChange(state => render(state));
    engine.onWorthItPrompt(payment => openWorthItModal(payment));
    engine.init();
  });
})();
