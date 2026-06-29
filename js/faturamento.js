// faturamento.js — Billing cycle configuration
import { requireAuth, logout, getUserInitials } from './auth.js';
import { getCiclosMap, saveCicloById, getBillingDateRange } from './db.js';

let currentUser = null;
let ciclosMap   = {};
let selectedYear = new Date().getFullYear();

// Months from 2026 to 2030
const START_YEAR = 2026;
const END_YEAR   = 2030;
const MONTH_NAMES = [
  'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'
];

async function init() {
  currentUser = await requireAuth('index.html');

  document.getElementById('user-avatar').textContent = getUserInitials(currentUser);
  document.getElementById('user-name').textContent   = currentUser.displayName || 'Usuário';
  document.getElementById('user-email').textContent  = currentUser.email;

  document.getElementById('user-info-btn').addEventListener('click', () => {
    if (confirm('Deseja sair da conta?')) logout();
  });

  document.getElementById('mobile-menu-btn').addEventListener('click', () => {
    document.getElementById('nav-sidebar').classList.toggle('open');
    document.getElementById('nav-overlay').classList.toggle('active');
  });
  document.getElementById('nav-overlay').addEventListener('click', () => {
    document.getElementById('nav-sidebar').classList.remove('open');
    document.getElementById('nav-overlay').classList.remove('active');
  });

  renderYearChips();
  await loadCiclos();
}

// ── Year Chips ──
function renderYearChips() {
  const container = document.getElementById('year-chips');
  container.innerHTML = '';
  for (let y = START_YEAR; y <= END_YEAR; y++) {
    const chip = document.createElement('div');
    chip.className = `chip ${y === selectedYear ? 'active' : ''}`;
    chip.textContent = y;
    chip.onclick = () => {
      selectedYear = y;
      renderYearChips();
      renderTable();
    };
    container.appendChild(chip);
  }
}

// ── Load Ciclos from Firestore ──
async function loadCiclos() {
  document.getElementById('table-loading').style.display = 'flex';
  document.getElementById('table-card').style.display = 'none';

  try {
    ciclosMap = await getCiclosMap(currentUser.uid);
    renderTable();
  } catch (err) {
    console.error('Erro ao carregar ciclos:', err);
    showToast('Erro ao carregar configurações.', 'error');
  } finally {
    document.getElementById('table-loading').style.display = 'none';
    document.getElementById('table-card').style.display = 'block';
  }
}

// ── Render Table ──
function renderTable() {
  const tbody = document.getElementById('ciclos-tbody');
  const today = new Date();

  const rows = [];

  for (let m = 0; m < 12; m++) {
    const mesKey  = `${selectedYear}-${String(m + 1).padStart(2, '0')}`;
    const ciclo   = ciclosMap[mesKey] || {};
    const { start, end, fromCiclo } = getBillingDateRange(selectedYear, m, ciclosMap);

    // Format billing period display
    const fmtDate = d => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    const periodoStr = fromCiclo
      ? `${fmtDate(start)} → ${fmtDate(end)}`
      : `${fmtDate(start)} → ${fmtDate(end)} (padrão)`;

    // Is this the current or upcoming billing month?
    const isCurrent = today >= start && today <= end;
    const isPast    = end < today;

    rows.push(`
      <tr id="row-${mesKey}">
        <td>
          <div style="font-weight:700;font-size:0.9rem">${MONTH_NAMES[m]}</div>
          <div style="font-size:0.72rem;color:var(--text-muted)">${selectedYear}</div>
        </td>
        <td>
          <input
            type="date"
            class="ciclo-input ${ciclo.fechamento && !ciclo.isDefault ? 'saved' : ''}"
            id="fech-${mesKey}"
            value="${ciclo.fechamento || ''}"
            onchange="saveCicloField('${mesKey}')"
            title="Data de fechamento de ${MONTH_NAMES[m]}"
          />
        </td>
        <td>
          <input
            type="date"
            class="ciclo-input ${ciclo.vencimento && !ciclo.isDefault ? 'saved' : ''}"
            id="venc-${mesKey}"
            value="${ciclo.vencimento || ''}"
            onchange="saveCicloField('${mesKey}')"
            title="Data de vencimento de ${MONTH_NAMES[m]}"
          />
        </td>
        <td>
          <input
            type="number"
            step="0.01"
            class="ciclo-input ${ciclo.limiteGasto !== undefined ? 'saved' : ''}"
            id="limite-${mesKey}"
            value="${ciclo.limiteGasto !== undefined ? ciclo.limiteGasto : 3000}"
            onchange="saveCicloField('${mesKey}')"
            title="Limite de gastos para ${MONTH_NAMES[m]}"
          />
        </td>
        <td>
          <span class="periodo-text ${isCurrent ? 'active' : ''}">
            ${isCurrent ? '📍 ' : ''}${periodoStr}
          </span>
        </td>
        <td style="text-align:center">
          ${isCurrent
            ? `<span class="badge badge-purple">Atual</span>`
            : isPast
              ? `<span style="color:var(--text-muted);font-size:0.75rem">Passado</span>`
              : `<span style="color:var(--text-muted);font-size:0.75rem">Futuro</span>`
          }
          ${ciclo.fechamento && !ciclo.isDefault
            ? `<span class="badge badge-green" style="margin-left:4px;font-size:0.65rem">✓ Config</span>`
            : ''
          }
        </td>
      </tr>
    `);
  }

  tbody.innerHTML = rows.join('');
}

// ── Save a field on change ──
window.saveCicloField = async function(mesKey) {
  const fechamento = document.getElementById(`fech-${mesKey}`)?.value || null;
  const vencimento = document.getElementById(`venc-${mesKey}`)?.value || null;
  const limiteRaw = document.getElementById(`limite-${mesKey}`)?.value;
  const limiteGasto = limiteRaw ? parseFloat(limiteRaw) : 3000;

  const statusEl = document.getElementById('save-status');
  statusEl.textContent = 'Salvando...';

  try {
    await saveCicloById(currentUser.uid, mesKey, { fechamento, vencimento, limiteGasto });
    
    if (!ciclosMap[mesKey]) ciclosMap[mesKey] = {};
    ciclosMap[mesKey].fechamento = fechamento;
    ciclosMap[mesKey].vencimento = vencimento;
    ciclosMap[mesKey].limiteGasto = limiteGasto;
    ciclosMap[mesKey].isDefault = false;

    // Retain focus visually without full re-render breaking the input sequence
    document.getElementById(`fech-${mesKey}`).classList.toggle('saved', !!fechamento);
    document.getElementById(`venc-${mesKey}`).classList.toggle('saved', !!vencimento);
    document.getElementById(`limite-${mesKey}`).classList.add('saved');
    
    // We update the period string just in case
    const m = parseInt(mesKey.split('-')[1], 10) - 1;
    const { start, end, fromCiclo } = getBillingDateRange(selectedYear, m, ciclosMap);
    
    const fmtDate = d => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    const row = document.getElementById(`row-${mesKey}`);
    if (row) {
      const perSpan = row.querySelector('.periodo-text');
      if (perSpan) {
        perSpan.textContent = fromCiclo ? `${fmtDate(start)} → ${fmtDate(end)}` : `${fmtDate(start)} → ${fmtDate(end)} (padrão)`;
      }
    }

    statusEl.textContent = 'Salvo automaticamente!';
    setTimeout(() => { if (statusEl.textContent === 'Salvo automaticamente!') statusEl.textContent = ''; }, 3000);
  } catch (err) {
    console.error(err);
    showToast('Erro ao salvar.', 'error');
    statusEl.textContent = 'Erro ao salvar';
  }
};

// ── Toast ──
function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  toast.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

init();
