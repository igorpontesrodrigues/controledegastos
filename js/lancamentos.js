// lancamentos.js — New transaction form logic
import { requireAuth, logout, getUserInitials } from './auth.js';
import {
  addLancamento, getCartoes, getCiclosMap,
  formatCurrency, CATEGORIAS, loadCategorias
} from './db.js';

// ── State ──
let currentUser = null;
let allCartoes   = [];
let ciclosMap    = {};
let selectedTipo = 'despesa';
let selectedCat  = 'outros';
let selectedForma = 'credito';

// ── Init ──
async function init() {
  currentUser = await requireAuth('index.html');

  document.getElementById('user-avatar').textContent = getUserInitials(currentUser);
  document.getElementById('user-name').textContent   = currentUser.displayName || 'Usuário';
  document.getElementById('user-email').textContent  = currentUser.email;

  document.getElementById('user-info-btn').addEventListener('click', () => {
    if (confirm('Deseja sair da conta?')) logout();
  });

  // Mobile menu
  document.getElementById('mobile-menu-btn').addEventListener('click', () => {
    document.getElementById('nav-sidebar').classList.toggle('open');
    document.getElementById('nav-overlay').classList.toggle('active');
  });
  document.getElementById('nav-overlay').addEventListener('click', () => {
    document.getElementById('nav-sidebar').classList.remove('open');
    document.getElementById('nav-overlay').classList.remove('active');
  });

  // Set default date to today
  document.getElementById('data').value = new Date().toISOString().split('T')[0];

  await loadCartoes();
  ciclosMap = await getCiclosMap(currentUser.uid);
  await loadCategorias(currentUser.uid);
  renderCategories();
  bindEvents();
}

// ── Load Cartoes ──
async function loadCartoes() {
  allCartoes = await getCartoes(currentUser.uid);
  const select = document.getElementById('cartao-select');
  select.innerHTML = '<option value="">Selecione o cartão</option>';
  allCartoes.forEach(c => {
    select.innerHTML += `<option value="${c.id}">${c.nome}${c.bandeira ? ` · ${c.bandeira}` : ''}</option>`;
  });

  if (allCartoes.length === 0) {
    select.innerHTML = '<option value="">⚠️ Nenhum cartão cadastrado</option>';
  }
}

// ── Render Categories ──
function renderCategories() {
  const filtered = CATEGORIAS.filter(cat => (cat.tipo || 'despesa') === selectedTipo);
  if (!filtered.some(c => c.id === selectedCat) && filtered.length > 0) {
    selectedCat = filtered[0].id;
    document.getElementById('categoria').value = selectedCat;
  }
  const grid = document.getElementById('category-grid');
  grid.innerHTML = filtered.map(cat => `
    <div
      class="category-option ${cat.id === selectedCat ? 'selected' : ''}"
      data-cat="${cat.id}"
      onclick="selectCategory('${cat.id}')"
      role="button"
      tabindex="0"
    >
      <div class="category-option-icon">${cat.icon}</div>
      <div class="category-option-label">${cat.label}</div>
    </div>
  `).join('');
}

window.selectCategory = function(id) {
  selectedCat = id;
  document.getElementById('categoria').value = id;
  document.querySelectorAll('.category-option').forEach(el => {
    el.classList.toggle('selected', el.dataset.cat === id);
  });
};

// ── Tipo (despesa/receita) ──
window.setTipo = function(tipo) {
  selectedTipo = tipo;
  document.getElementById('tipo-despesa').classList.toggle('active', tipo === 'despesa');
  document.getElementById('tipo-receita').classList.toggle('active', tipo === 'receita');

  // Hide installment section for income
  const parcelaSection = document.getElementById('parcela-section');
  parcelaSection.style.display = (tipo === 'receita') ? 'none' : 'block';

  const pagoSection = document.getElementById('pago-section');
  if (pagoSection) {
    pagoSection.style.display = (tipo === 'receita' || selectedForma === 'credito') ? 'none' : 'block';
  }

  if (tipo === 'receita') {
    document.getElementById('toggle-parcelado').checked = false;
    document.getElementById('parcela-fields').style.display = 'none';
  }

  renderCategories();
};

// ── Forma de Pagamento ──
window.setForma = function(forma) {
  selectedForma = forma;
  document.getElementById('forma-pagamento').value = forma;

  ['credito', 'pix', 'debito', 'boleto'].forEach(f => {
    const el = document.getElementById(`forma-${f}`);
    if (el) el.classList.toggle('active', f === forma);
  });

  const parcelaSection = document.getElementById('parcela-section');
  const cartaoLabel    = document.getElementById('cartao-label');
  const cartaoSelect   = document.getElementById('cartao-select');
  const pagoSection    = document.getElementById('pago-section');

  if (pagoSection) {
    pagoSection.style.display = (forma === 'credito' || selectedTipo === 'receita') ? 'none' : 'block';
  }

  if (forma === 'pix' || forma === 'debito') {
    parcelaSection.style.display = 'none';
    document.getElementById('toggle-parcelado').checked = false;
    document.getElementById('parcela-fields').style.display = 'none';
    cartaoLabel.textContent = forma === 'pix' ? 'Conta / Banco (opcional)' : 'Cartão de Débito (opcional)';
    cartaoSelect.removeAttribute('required');
  } else if (forma === 'boleto') {
    if (selectedTipo !== 'receita') parcelaSection.style.display = 'block';
    cartaoLabel.textContent = 'Sem cartão (opcional)';
    cartaoSelect.removeAttribute('required');
  } else {
    if (selectedTipo !== 'receita') parcelaSection.style.display = 'block';
    cartaoLabel.textContent = 'Cartão *';
    cartaoSelect.setAttribute('required', '');
  }
};

// ── Bind Events ──
function bindEvents() {
  const toggleParcelado = document.getElementById('toggle-parcelado');
  const parcelaFields   = document.getElementById('parcela-fields');
  const totalParcelasEl = document.getElementById('total-parcelas');
  const parcelaInicialEl = document.getElementById('parcela-inicial');
  const valorEl          = document.getElementById('valor');

  toggleParcelado.addEventListener('change', () => {
    parcelaFields.style.display = toggleParcelado.checked ? 'flex' : 'none';
    if (toggleParcelado.checked) updateParcelaPreview();
  });

  [totalParcelasEl, parcelaInicialEl, valorEl].forEach(el => {
    el.addEventListener('input', updateParcelaPreview);
  });

  document.getElementById('lancamento-form').addEventListener('submit', handleSubmit);
}

// ── Parcela Preview ──
import { findBillingMonthForDate } from './db.js';

function updateParcelaPreview() {
  const valor         = parseFloat(document.getElementById('valor').value) || 0;
  const totalParcelas = parseInt(document.getElementById('total-parcelas').value) || 0;
  const parcelaInicial = parseInt(document.getElementById('parcela-inicial').value) || 1;
  const preview       = document.getElementById('parcela-preview');
  const previewList   = document.getElementById('parcela-preview-list');
  const valorDisplay  = document.getElementById('valor-parcela-display');

  if (!totalParcelas || totalParcelas < 2 || !valor) {
    preview.classList.remove('visible');
    valorDisplay.textContent = 'R$ —';
    return;
  }

  const safeInicial = Math.max(1, Math.min(parcelaInicial, totalParcelas));
  const valorTotal = valor * totalParcelas;
  valorDisplay.textContent = formatCurrency(valorTotal);

  // Determine starting month for the installments
  const dataStr = document.getElementById('data').value;
  const baseDate = dataStr ? new Date(dataStr + 'T12:00:00') : new Date();
  let startMonth;
  
  if (ciclosMap && Object.keys(ciclosMap).length > 0) {
    startMonth = findBillingMonthForDate(baseDate, ciclosMap).month;
  } else {
    startMonth = baseDate.getMonth();
  }
  
  const nomeMeses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

  const allBadges = [];
  for (let i = 1; i <= totalParcelas; i++) {
    const isCurrent = i === safeInicial;
    const isIncluded = i >= safeInicial;
    
    // offset is relative to safeInicial
    const m = (((startMonth + (i - safeInicial)) % 12) + 12) % 12;
    const mesNome = nomeMeses[m];
    
    allBadges.push(`
      <span class="parcela-badge ${isCurrent ? 'current' : ''}" 
            style="${!isIncluded ? 'opacity:0.3;text-decoration:line-through;' : ''}">
        ${i}/${totalParcelas} <span style="font-size:0.6rem; opacity:0.8; margin-left:2px">${mesNome}</span>
      </span>
    `);
  }

  previewList.innerHTML = allBadges.join('');
  preview.classList.add('visible');
}

// ── Handle Submit ──
async function handleSubmit(e) {
  e.preventDefault();

  const errorEl = document.getElementById('form-error');
  errorEl.classList.remove('visible');

  const descricao = document.getElementById('descricao').value.trim();
  const valor     = parseFloat(document.getElementById('valor').value);
  const data      = document.getElementById('data').value;
  const cartaoId  = document.getElementById('cartao-select').value;
  const categoria = document.getElementById('categoria').value || 'outros';
  const local     = document.getElementById('local').value.trim();
  const observacao = document.getElementById('observacao').value.trim();
  const formaPagamento = document.getElementById('forma-pagamento').value;
  const parcelado = document.getElementById('toggle-parcelado').checked;
  const totalParcelas  = parseInt(document.getElementById('total-parcelas').value) || 1;
  const parcelaInicial = parseInt(document.getElementById('parcela-inicial').value) || 1;
  
  // Default to true if not visible (e.g. credito) or checked
  let pago = true;
  const pagoSection = document.getElementById('pago-section');
  if (pagoSection && pagoSection.style.display !== 'none') {
    pago = document.getElementById('pago-checkbox').checked;
  }
  
  if (formaPagamento === 'credito') pago = false; // Crédito is technically unpaid until invoice

  // Validate
  if (!descricao) return showFormError('Informe a descrição do lançamento.');
  if (!valor || valor <= 0) return showFormError('Informe um valor válido.');
  if (!data) return showFormError('Informe a data do lançamento.');
  if (!cartaoId && selectedTipo === 'despesa' && selectedForma === 'credito') return showFormError('Selecione o cartão.');
  if (allCartoes.length === 0 && selectedForma === 'credito') return showFormError('Você precisa cadastrar um cartão primeiro.');
  if (parcelado && totalParcelas < 2) return showFormError('Informe o total de parcelas (mínimo 2).');
  if (parcelado && parcelaInicial > totalParcelas) return showFormError('A parcela inicial não pode ser maior que o total de parcelas.');

  const btn = document.getElementById('submit-btn');
  btn.classList.add('loading');
  btn.disabled = true;

  try {
    await addLancamento(currentUser.uid, {
      descricao,
      valor,
      data,
      cartaoId: cartaoId || '',
      categoria,
      local,
      observacao,
      tipo: selectedTipo,
      formaPagamento,
      parcelado,
      totalParcelas,
      parcelaInicial: Math.max(1, parcelaInicial),
      pago
    }, ciclosMap);

    showToast('Lançamento salvo com sucesso! ✅', 'success');

    // Reset form
    document.getElementById('lancamento-form').reset();
    document.getElementById('data').value = new Date().toISOString().split('T')[0];
    selectedCat = 'outros';
    selectedTipo = 'despesa';
    selectedForma = 'credito';
    document.getElementById('forma-pagamento').value = 'credito';
    ['credito', 'pix', 'debito', 'boleto'].forEach(f => {
      const el = document.getElementById(`forma-${f}`);
      if (el) el.classList.toggle('active', f === 'credito');
    });
    document.getElementById('cartao-label').textContent = 'Cartão *';
    document.getElementById('tipo-despesa').classList.add('active');
    document.getElementById('tipo-receita').classList.remove('active');
    document.getElementById('parcela-section').style.display = 'block';
    document.getElementById('toggle-parcelado').checked = false;
    document.getElementById('parcela-fields').style.display = 'none';
    document.getElementById('parcela-preview').classList.remove('visible');
    document.getElementById('valor-parcela-display').textContent = 'R$ —';
    renderCategories();

  } catch (err) {
    console.error('Erro ao salvar:', err);
    showFormError('Erro ao salvar lançamento. Tente novamente.');
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

function showFormError(msg) {
  const errorEl = document.getElementById('form-error');
  document.getElementById('form-error-msg').textContent = msg;
  errorEl.classList.add('visible');
  errorEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

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
