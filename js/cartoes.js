// cartoes.js — Credit card management
import { requireAuth, logout, getUserInitials } from './auth.js';
import {
  addCartao, getCartoes, updateCartao, deleteCartao,
  CORES_CARTAO, BANDEIRAS
} from './db.js';

// ── State ──
let currentUser = null;
let allCartoes   = [];
let editingId    = null;
let selectedCor  = CORES_CARTAO[0].value;

// ── Init ──
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

  document.getElementById('btn-add-cartao').addEventListener('click', openModalNew);
  document.getElementById('cartao-form').addEventListener('submit', handleSubmit);
  document.getElementById('cartao-nome').addEventListener('input', updatePreview);
  document.getElementById('cartao-bandeira').addEventListener('change', updatePreview);

  renderCoresGrid();
  await loadCartoes();
}

// ── Load Cartoes ──
async function loadCartoes() {
  document.getElementById('cartoes-loading').style.display = 'flex';
  document.getElementById('cartoes-grid').style.display = 'none';
  document.getElementById('cartoes-empty').style.display = 'none';

  try {
    allCartoes = await getCartoes(currentUser.uid);
    renderCartoes();
  } catch (err) {
    showToast('Erro ao carregar cartões.', 'error');
  } finally {
    document.getElementById('cartoes-loading').style.display = 'none';
  }
}

// ── Render Cartoes ──
function renderCartoes() {
  const grid  = document.getElementById('cartoes-grid');
  const empty = document.getElementById('cartoes-empty');

  if (allCartoes.length === 0) {
    grid.style.display  = 'none';
    empty.style.display = 'flex';
    return;
  }

  grid.style.display  = 'grid';
  empty.style.display = 'none';

  grid.innerHTML = allCartoes.map(c => `
    <div class="card" style="padding:var(--space-md)">
      <!-- Mini card visual -->
      <div class="credit-card-visual" style="background:${c.cor || CORES_CARTAO[0].value};margin-bottom:var(--space-md)">
        <div class="card-chip"></div>
        <div class="card-number">•••• •••• •••• ••••</div>
        <div class="card-bottom">
          <div>
            <div style="font-size:0.6rem;color:rgba(255,255,255,0.6);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:2px">Nome</div>
            <div class="card-holder-name">${c.nome}</div>
          </div>
          <div class="card-brand">${c.bandeira || ''}</div>
        </div>
      </div>

      <!-- Info -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div>
          <div style="font-weight:700;font-size:0.95rem">${c.nome}</div>
          <div style="font-size:0.78rem;color:var(--text-muted)">
            ${c.bandeira ? c.bandeira + ' · ' : ''}
            ${c.diaFechamento ? `Fecha dia ${c.diaFechamento}` : 'Sem data de fechamento'}
          </div>
        </div>
      </div>

      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-ghost btn-sm" style="flex:1" onclick="editCartao('${c.id}')">
          ✏️ Editar
        </button>
        <button class="btn btn-sm" style="background:rgba(239,68,68,0.1);color:#F87171;border:1px solid rgba(239,68,68,0.2)" onclick="removeCartao('${c.id}', '${c.nome}')">
          🗑️
        </button>
      </div>
    </div>
  `).join('');
}

// ── Modal ──
function openModalNew() {
  editingId = null;
  document.getElementById('modal-title').textContent = 'Novo Cartão';
  document.getElementById('cartao-form').reset();
  document.getElementById('cartao-id').value = '';
  selectedCor = CORES_CARTAO[0].value;
  document.getElementById('cartao-cor').value = selectedCor;
  document.getElementById('cartao-error').classList.remove('visible');
  updatePreview();
  refreshCoresGrid();
  document.getElementById('modal-cartao').classList.add('active');
}

window.closeModal = function() {
  document.getElementById('modal-cartao').classList.remove('active');
};

window.editCartao = function(id) {
  const c = allCartoes.find(x => x.id === id);
  if (!c) return;

  editingId = id;
  document.getElementById('modal-title').textContent = 'Editar Cartão';
  document.getElementById('cartao-id').value       = id;
  document.getElementById('cartao-nome').value     = c.nome;
  document.getElementById('cartao-bandeira').value = c.bandeira || '';
  document.getElementById('cartao-fechamento').value = c.diaFechamento || '';
  selectedCor = c.cor || CORES_CARTAO[0].value;
  document.getElementById('cartao-cor').value = selectedCor;
  document.getElementById('cartao-error').classList.remove('visible');
  updatePreview();
  refreshCoresGrid();
  document.getElementById('modal-cartao').classList.add('active');
};

window.removeCartao = async function(id, nome) {
  if (!confirm(`Excluir o cartão "${nome}"? Os lançamentos vinculados não serão excluídos.`)) return;

  try {
    await deleteCartao(currentUser.uid, id);
    showToast('Cartão excluído!', 'success');
    await loadCartoes();
  } catch (err) {
    showToast('Erro ao excluir cartão.', 'error');
  }
};

// ── Handle Submit ──
async function handleSubmit(e) {
  e.preventDefault();

  const nome        = document.getElementById('cartao-nome').value.trim();
  const bandeira    = document.getElementById('cartao-bandeira').value;
  const fechamento  = parseInt(document.getElementById('cartao-fechamento').value) || null;
  const cor         = document.getElementById('cartao-cor').value;

  if (!nome) {
    document.getElementById('cartao-error-msg').textContent = 'Informe o nome do cartão.';
    document.getElementById('cartao-error').classList.add('visible');
    return;
  }

  const btn = document.getElementById('cartao-submit-btn');
  btn.classList.add('loading');
  btn.disabled = true;

  try {
    const data = { nome, bandeira, diaFechamento: fechamento, cor };

    if (editingId) {
      await updateCartao(currentUser.uid, editingId, data);
      showToast('Cartão atualizado! ✅', 'success');
    } else {
      await addCartao(currentUser.uid, data);
      showToast('Cartão adicionado! ✅', 'success');
    }

    closeModal();
    await loadCartoes();
  } catch (err) {
    document.getElementById('cartao-error-msg').textContent = 'Erro ao salvar cartão.';
    document.getElementById('cartao-error').classList.add('visible');
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

// ── Color Grid ──
function renderCoresGrid() {
  const grid = document.getElementById('cores-grid');
  grid.innerHTML = CORES_CARTAO.map(({ label, value }) => `
    <div
      class="cor-option ${value === selectedCor ? 'selected' : ''}"
      style="
        background: ${value};
        height: 36px;
        border-radius: 8px;
        cursor: pointer;
        border: 2px solid ${value === selectedCor ? 'white' : 'transparent'};
        box-shadow: ${value === selectedCor ? '0 0 0 3px rgba(124,58,237,0.4)' : 'none'};
        transition: all 0.2s;
      "
      title="${label}"
      onclick="selectCor(${JSON.stringify(value)})"
    ></div>
  `).join('');
}

function refreshCoresGrid() {
  document.querySelectorAll('.cor-option').forEach(el => {
    const isSel = el.title === CORES_CARTAO.find(c => c.value === selectedCor)?.label;
  });
  renderCoresGrid();
}

window.selectCor = function(value) {
  selectedCor = value;
  document.getElementById('cartao-cor').value = value;
  renderCoresGrid();
  updatePreview();
};

// ── Preview ──
function updatePreview() {
  const nome     = document.getElementById('cartao-nome').value || 'Meu Cartão';
  const bandeira = document.getElementById('cartao-bandeira').value || 'VISA';
  const preview  = document.getElementById('card-preview');

  document.getElementById('preview-nome').textContent     = nome;
  document.getElementById('preview-bandeira').textContent = bandeira;
  preview.style.background = selectedCor;
}

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
