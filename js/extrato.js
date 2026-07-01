// extrato.js — Full transaction extract with filters, edit, cancel and delete
import { requireAuth, logout, getUserInitials } from './auth.js';
import {
  getLancamentosByDateRange, getCartoes, getCiclosMap, getBillingDateRange, findBillingMonthForDate,
  updateLancamento, deleteLancamento, deleteGrupoParcelas, updateGrupoParcelasFields,
  formatCurrency, formatDate, formatMonth, getCategoriaById, CATEGORIAS, loadCategorias
} from './db.js';

// ── State ──
let currentUser  = null;
let currentYear  = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let allCartoes   = [];
let lancamentos  = [];
let filtered     = [];
let ciclosMap    = {};
let deleteTarget = null;
let editTarget   = null;
let editSelectedCat   = 'outros';
let editSelectedForma = 'credito';
let editSelectedTipo  = 'despesa';

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

  document.getElementById('prev-month').addEventListener('click', () => changeMonth(-1));
  document.getElementById('next-month').addEventListener('click', () => changeMonth(1));

  document.getElementById('search-input').addEventListener('input', applyFilters);
  document.getElementById('filter-tipo').addEventListener('change', applyFilters);
  document.getElementById('filter-cartao').addEventListener('change', applyFilters);
  document.getElementById('filter-cat').addEventListener('change', applyFilters);
  document.getElementById('filter-status').addEventListener('change', applyFilters);

  // Populate category filter
  await loadCategorias(currentUser.uid);
  const catSelect = document.getElementById('filter-cat');
  const desp = CATEGORIAS.filter(c => (c.tipo || 'despesa') === 'despesa');
  const rec = CATEGORIAS.filter(c => c.tipo === 'receita');
  catSelect.innerHTML += `<optgroup label="Despesas">${desp.map(c => `<option value="${c.id}">${c.icon} ${c.label}</option>`).join('')}</optgroup>`;
  catSelect.innerHTML += `<optgroup label="Receitas">${rec.map(c => `<option value="${c.id}">${c.icon} ${c.label}</option>`).join('')}</optgroup>`;

  // Edit form submit
  document.getElementById('edit-form').addEventListener('submit', handleEditSubmit);

  // Populate edit cartão select
  await loadCartoes();
  ciclosMap = await getCiclosMap(currentUser.uid);

  // Set default view to the current billing month instead of calendar month
  const billing = findBillingMonthForDate(new Date(), ciclosMap);
  currentYear = billing.year;
  currentMonth = billing.month;

  await loadData();
}

// ── Month Nav ──
function changeMonth(delta) {
  currentMonth += delta;
  if (currentMonth > 11) { currentMonth = 0;  currentYear++; }
  if (currentMonth < 0)  { currentMonth = 11; currentYear--; }
  loadData();
}

// ── Load Cartoes ──
async function loadCartoes() {
  allCartoes = await getCartoes(currentUser.uid);

  // Filter dropdown
  const select = document.getElementById('filter-cartao');
  select.innerHTML = '<option value="">Todos os cartões</option>';
  allCartoes.forEach(c => {
    select.innerHTML += `<option value="${c.id}">${c.nome}</option>`;
  });

  // Edit modal cartão select
  const editCartao = document.getElementById('edit-cartao');
  editCartao.innerHTML = '<option value="">Sem cartão / N/A</option>';
  allCartoes.forEach(c => {
    editCartao.innerHTML += `<option value="${c.id}">${c.nome}</option>`;
  });
}

// ── Load Data ──
async function loadData() {
  const { start, end, fromCiclo } = getBillingDateRange(currentYear, currentMonth, ciclosMap);

  // Show billing period in label
  const fmtShort = d => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const baseLabel = formatMonth(currentYear, currentMonth);
  document.getElementById('month-label').textContent = baseLabel;
  const subLabel = document.getElementById('month-sublabel');
  if (subLabel) {
    subLabel.textContent = fromCiclo ? `${fmtShort(start)} a ${fmtShort(end)}` : '';
  }

  document.getElementById('table-loading').style.display = 'flex';
  document.getElementById('table-wrapper').style.display = 'none';
  document.getElementById('table-empty').style.display = 'none';

  try {
    lancamentos = await getLancamentosByDateRange(currentUser.uid, start, end);
    
    // Auto-fix any corrupted string dates that got "lost" out of the date range
    const all = await import('./db.js').then(m => m.getAllLancamentos(currentUser.uid));
    all.forEach(l => {
      if (typeof l.data === 'string') {
        import('./db.js').then(m => m.updateLancamento(currentUser.uid, l.id, { data: new Date(l.data + 'T12:00:00') }));
      }
    });
    
    applyFilters();
  } catch (err) {
    showToast('Erro ao carregar extrato.', 'error');
    console.error(err);
  } finally {
    document.getElementById('table-loading').style.display = 'none';
  }
}

// ── Apply Filters ──
function applyFilters() {
  const search    = document.getElementById('search-input').value.toLowerCase();
  const tipo      = document.getElementById('filter-tipo').value;
  const cartaoId  = document.getElementById('filter-cartao').value;
  const catId     = document.getElementById('filter-cat').value;
  const status    = document.getElementById('filter-status').value;

  filtered = lancamentos.filter(l => {
    if (search && !l.descricao?.toLowerCase().includes(search) && !l.local?.toLowerCase().includes(search)) return false;
    if (tipo    && l.tipo     !== tipo)    return false;
    if (cartaoId && l.cartaoId !== cartaoId) return false;
    if (catId   && l.categoria !== catId)  return false;
    if (status  && (l.status || 'ativo') !== status) return false;
    return true;
  });

  renderTable();
  updateSummary();
}

// ── Update Summary ──
function updateSummary() {
  // Only count active items in totals
  const ativos = filtered.filter(l => (l.status || 'ativo') === 'ativo');
  
  // Apply cash flow rule: ignore credit and unpaid items from Despesas/Receitas/Saldo sums
  const pagos = ativos.filter(l => l.pago !== false && l.formaPagamento !== 'credito' && l.formaPagamento !== 'cartao_credito' && !l.cartaoId);

  const despesas = pagos.filter(l => l.tipo === 'despesa').reduce((s, l) => s + l.valor, 0);
  const receitas = pagos.filter(l => l.tipo === 'receita').reduce((s, l) => s + l.valor, 0);
  const saldo    = receitas - despesas;

  // Cancelled total (across all filtered)
  const cancelados = filtered.filter(l => l.status === 'cancelado').reduce((s, l) => s + l.valor, 0);

  document.getElementById('sum-despesas').textContent  = formatCurrency(despesas);
  document.getElementById('sum-receitas').textContent  = formatCurrency(receitas);
  document.getElementById('sum-saldo').textContent     = formatCurrency(saldo);
  document.getElementById('sum-saldo').style.color     = saldo >= 0 ? '#34D399' : '#F87171';
  document.getElementById('sum-count').textContent     = ativos.length.toString();
  document.getElementById('sum-cancelados').textContent = formatCurrency(cancelados);
}

// ── Render Table ──
function renderTable() {
  const wrapper = document.getElementById('table-wrapper');
  const empty   = document.getElementById('table-empty');
  const tbody   = document.getElementById('table-body');

  if (filtered.length === 0) {
    wrapper.style.display = 'none';
    empty.style.display   = 'flex';
    return;
  }

  wrapper.style.display = 'block';
  empty.style.display   = 'none';

  tbody.innerHTML = filtered.map(l => {
    const cat    = getCategoriaById(l.categoria);
    const cartao = allCartoes.find(c => c.id === l.cartaoId);
    const isInc  = l.tipo === 'receita';
    const isCancelled = l.status === 'cancelado';

    const parcelaStr = l.parcelado && l.totalParcelas > 1
      ? `${l.parcelaAtual}/${l.totalParcelas}`
      : '—';

    const formaMap = {
      credito:        { label: 'Crédito', icon: '💳', cls: 'badge-purple' },
      cartao_credito: { label: 'Crédito', icon: '💳', cls: 'badge-purple' },
      pix:            { label: 'Pix',     icon: '⚡', cls: 'badge-green'  },
      debito:         { label: 'Débito',  icon: '🏦', cls: 'badge-blue'   },
      boleto:         { label: 'Boleto',  icon: '📄', cls: 'badge-orange' },
    };
    const forma = formaMap[l.formaPagamento] || formaMap.credito;

    const descSafe = (l.descricao || '').replace(/'/g, "\\'");

    return `
      <tr class="${isCancelled ? 'row-cancelado' : ''}">
        <td>
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:1.1rem">${cat.icon}</span>
            <div>
              <div style="font-weight:600;font-size:0.88rem;${isCancelled ? 'text-decoration:line-through;color:var(--text-muted)' : ''}">
                ${l.descricao}
                ${!l.pago && l.formaPagamento !== 'credito' && l.formaPagamento !== 'cartao_credito' && !l.cartaoId && !isCancelled ? `<span style="margin-left:6px;font-size:0.7rem;background:rgba(245,158,11,0.15);color:#F59E0B;padding:2px 6px;border-radius:4px;border:1px solid rgba(245,158,11,0.3)">⏳ Pendente</span>` : ''}
              </div>
              ${l.local ? `<div style="font-size:0.73rem;color:var(--text-muted)">${l.local}</div>` : ''}
              ${isCancelled ? `<span class="badge-cancelado">↩️ Cancelado</span>` : ''}
            </div>
          </div>
        </td>
        <td style="color:var(--text-secondary);font-size:0.83rem;white-space:nowrap">${formatDate(l.data)}</td>
        <td>
          <span class="badge ${forma.cls}" style="${isCancelled ? 'opacity:0.4' : ''}">${forma.icon} ${forma.label}</span>
        </td>
        <td>
          ${cartao
            ? `<span class="transaction-card-chip">${cartao.nome}</span>`
            : `<span style="color:var(--text-muted);font-size:0.8rem">—</span>`
          }
        </td>
        <td>
          <span class="badge badge-purple" style="background:${cat.color}22;color:${cat.color};${isCancelled ? 'opacity:0.4' : ''}">
            ${cat.label}
          </span>
        </td>
        <td>
          ${parcelaStr !== '—'
            ? `<span class="badge badge-cyan" style="${isCancelled ? 'opacity:0.4' : ''}">${parcelaStr}</span>`
            : `<span style="color:var(--text-muted);font-size:0.8rem">—</span>`
          }
        </td>
        <td style="text-align:right;font-weight:700;white-space:nowrap;${isCancelled ? 'text-decoration:line-through;color:var(--text-muted)' : `color:${isInc ? '#34D399' : '#F87171'}`}">
          ${isCancelled ? '' : (isInc ? '+' : '-')}${formatCurrency(l.valor)}
          ${l.parcelado && l.totalParcelas > 1
            ? `<div style="font-size:0.7rem;font-weight:400;color:var(--text-muted)">de ${formatCurrency(l.valorTotal)}</div>`
            : ''
          }
        </td>
        <td style="text-align:center">
          <div style="display:flex;gap:6px;justify-content:center">
            ${!isCancelled ? `
              <button
                class="btn btn-sm"
                style="background:rgba(59,130,246,0.08);color:#60A5FA;border:1px solid rgba(59,130,246,0.2);padding:6px 10px"
                onclick="openEditModal('${l.id}')"
                title="Editar"
              >✏️</button>
              ${!l.pago && l.formaPagamento !== 'credito' ? `
                <button
                  class="btn btn-sm"
                  style="background:rgba(16,185,129,0.08);color:#34D399;border:1px solid rgba(16,185,129,0.2);padding:6px 10px"
                  onclick="markAsPaid('${l.id}', '${l.grupoParcelaId || ''}')"
                  title="Marcar como Pago"
                >✅</button>
              ` : ''}
            ` : `
              <button
                class="btn btn-sm"
                style="background:rgba(16,185,129,0.08);color:#34D399;border:1px solid rgba(16,185,129,0.2);padding:6px 10px"
                onclick="reativarLancamento('${l.id}')"
                title="Reativar"
              >↩️</button>
            `}
            <button
              class="btn btn-sm"
              style="background:rgba(239,68,68,0.08);color:#F87171;border:1px solid rgba(239,68,68,0.15);padding:6px 10px"
              onclick="openActionsModal('${l.id}', '${l.grupoParcelaId || ''}', ${l.parcelaAtual || 1}, ${l.totalParcelas || 1}, '${descSafe}', ${!!l.parcelado}, '${l.status || 'ativo'}')"
              title="Excluir / Cancelar"
            >🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ══════════════════════════════════════════
// EDIT MODAL
// ══════════════════════════════════════════

window.openEditModal = function(id) {
  const l = lancamentos.find(x => x.id === id);
  if (!l) return;

  editTarget = l;
  editSelectedCat   = l.categoria || 'outros';
  editSelectedForma = l.formaPagamento || 'credito';
  editSelectedTipo  = l.tipo || 'despesa';

  // Populate fields
  document.getElementById('edit-id').value        = id;
  document.getElementById('edit-descricao').value = l.descricao || '';
  document.getElementById('edit-valor').value     = l.valor || '';
  document.getElementById('edit-local').value     = l.local || '';
  document.getElementById('edit-obs').value       = l.observacao || '';
  document.getElementById('edit-cartao').value    = l.cartaoId || '';
  document.getElementById('edit-categoria').value = editSelectedCat;

  const pagoSection = document.getElementById('edit-pago-section');
  if (pagoSection) {
    pagoSection.style.display = (l.formaPagamento === 'credito' || l.tipo === 'receita') ? 'none' : 'block';
    document.getElementById('edit-pago-checkbox').checked = l.pago !== false;
  }

  // Date
  if (l.data) {
    const d = l.data.toDate ? l.data.toDate() : new Date(l.data);
    const yyyy = d.getFullYear();
    const mm   = String(d.getMonth() + 1).padStart(2, '0');
    const dd   = String(d.getDate()).padStart(2, '0');
    document.getElementById('edit-data').value = `${yyyy}-${mm}-${dd}`;
  }

  // Tipo
  editSetTipo(editSelectedTipo);

  // Forma de pagamento
  editSetForma(editSelectedForma);

  // Category grid
  renderEditCategories();

  // Parcela notice
  const notice = document.getElementById('edit-parcela-notice');
  notice.style.display = (l.parcelado && l.totalParcelas > 1) ? 'block' : 'none';

  // Clear error
  document.getElementById('edit-error').classList.remove('visible');

  document.getElementById('modal-edit').classList.add('active');
};

window.closeEditModal = function() {
  document.getElementById('modal-edit').classList.remove('active');
  editTarget = null;
};

window.editSetTipo = function(tipo) {
  editSelectedTipo = tipo;
  document.getElementById('edit-tipo').value = tipo;
  document.getElementById('edit-tipo-despesa').classList.toggle('active', tipo === 'despesa');
  document.getElementById('edit-tipo-receita').classList.toggle('active', tipo === 'receita');
  
  const pagoSection = document.getElementById('edit-pago-section');
  if (pagoSection) {
    pagoSection.style.display = (editSelectedForma === 'credito' || tipo === 'receita') ? 'none' : 'block';
  }
  renderEditCategories();
};

window.editSetForma = function(forma) {
  editSelectedForma = forma;
  document.getElementById('edit-forma-pagamento').value = forma;
  ['credito', 'pix', 'debito', 'boleto'].forEach(f => {
    const el = document.getElementById(`edit-forma-${f}`);
    if (el) el.classList.toggle('active', f === forma);
  });

  const pagoSection = document.getElementById('edit-pago-section');
  if (pagoSection) {
    pagoSection.style.display = (forma === 'credito' || editSelectedTipo === 'receita') ? 'none' : 'block';
  }
};

function renderEditCategories() {
  const filtered = CATEGORIAS.filter(cat => (cat.tipo || 'despesa') === editSelectedTipo);
  if (!filtered.some(c => c.id === editSelectedCat) && filtered.length > 0) {
    editSelectedCat = filtered[0].id;
    document.getElementById('edit-categoria').value = editSelectedCat;
  }
  const grid = document.getElementById('edit-category-grid');
  grid.innerHTML = filtered.map(cat => `
    <div
      class="category-option ${cat.id === editSelectedCat ? 'selected' : ''}"
      data-cat="${cat.id}"
      onclick="editSelectCat('${cat.id}')"
      role="button" tabindex="0"
    >
      <div class="category-option-icon">${cat.icon}</div>
      <div class="category-option-label">${cat.label}</div>
    </div>
  `).join('');
}

window.editSelectCat = function(id) {
  editSelectedCat = id;
  document.getElementById('edit-categoria').value = id;
  document.querySelectorAll('#edit-category-grid .category-option').forEach(el => {
    el.classList.toggle('selected', el.dataset.cat === id);
  });
};

async function handleEditSubmit(e) {
  e.preventDefault();

  const descricao = document.getElementById('edit-descricao').value.trim();
  const valor     = parseFloat(document.getElementById('edit-valor').value);
  const data      = document.getElementById('edit-data').value;

  if (!descricao || !valor || valor <= 0 || !data) {
    document.getElementById('edit-error-msg').textContent = 'Preencha descrição, valor e data.';
    document.getElementById('edit-error').classList.add('visible');
    return;
  }

  const btn = document.getElementById('edit-submit-btn');
  btn.classList.add('loading');
  btn.disabled = true;

  try {
    const { Timestamp } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    
    const basePayload = {
      descricao,
      valor,
      cartaoId:       document.getElementById('edit-cartao').value || '',
      categoria:      document.getElementById('edit-categoria').value || 'outros',
      local:          document.getElementById('edit-local').value.trim(),
      observacao:     document.getElementById('edit-obs').value.trim(),
      tipo:           document.getElementById('edit-tipo').value,
      formaPagamento: document.getElementById('edit-forma-pagamento').value,
    };
    
    // Read pago
    const pagoSection = document.getElementById('edit-pago-section');
    if (pagoSection && pagoSection.style.display !== 'none') {
      basePayload.pago = document.getElementById('edit-pago-checkbox').checked;
    }
    if (basePayload.formaPagamento === 'credito') basePayload.pago = false;

    // Check scope
    const scopeRadio = document.querySelector('input[name="edit-parcela-scope"]:checked');
    const scope = scopeRadio ? scopeRadio.value : 'single';
    
    if (scope === 'all' && editTarget.grupoParcelaId) {
      await updateGrupoParcelasFields(currentUser.uid, editTarget.grupoParcelaId, basePayload);
      showToast('Todas as parcelas do grupo foram atualizadas! ✅', 'success');
    } else {
      // Single update includes date change
      await updateLancamento(currentUser.uid, editTarget.id, {
        ...basePayload,
        data: Timestamp.fromDate(new Date(data + 'T12:00:00'))
      });
      showToast('Lançamento atualizado! ✅', 'success');
    }

    closeEditModal();
    await loadData();
  } catch (err) {
    console.error(err);
    document.getElementById('edit-error-msg').textContent = 'Erro ao salvar. Tente novamente.';
    document.getElementById('edit-error').classList.add('visible');
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

// ══════════════════════════════════════════
// ACTIONS MODAL (Cancel / Delete)
// ══════════════════════════════════════════

window.openActionsModal = function(id, grupoId, parcelaAtual, totalParcelas, descricao, parcelado, status) {
  deleteTarget = { id, grupoParcelaId: grupoId, parcelaAtual, totalParcelas };

  const isCancelled = status === 'cancelado';

  document.getElementById('action-modal-title').textContent = `"${descricao}"`;
  document.getElementById('delete-desc').textContent =
    parcelado && totalParcelas > 1
      ? `Parcela ${parcelaAtual}/${totalParcelas}`
      : formatDate_safe(id);

  // Show/hide installment scope selector
  const parcelaOpts = document.getElementById('delete-parcela-opts');
  if (parcelado && totalParcelas > 1 && grupoId) {
    parcelaOpts.style.display = 'block';
    document.getElementById('del-parcela-atual').textContent = `${parcelaAtual}/${totalParcelas}`;
    document.querySelector('input[name="delete-opt"][value="single"]').checked = true;
  } else {
    parcelaOpts.style.display = 'none';
  }

  // Update cancel button label based on current status
  const btnCancelar = document.getElementById('btn-cancelar');
  const btnLabel    = document.getElementById('btn-cancelar-label');
  if (isCancelled) {
    btnLabel.textContent = 'Reativar lançamento';
    btnCancelar.style.background = 'rgba(16,185,129,0.08)';
    btnCancelar.style.color      = '#34D399';
    btnCancelar.style.borderColor = 'rgba(16,185,129,0.2)';
  } else {
    btnLabel.textContent = 'Cancelar / Estorno';
    btnCancelar.style.background = 'rgba(245,158,11,0.08)';
    btnCancelar.style.color      = '#FCD34D';
    btnCancelar.style.borderColor = 'rgba(245,158,11,0.25)';
  }
  btnCancelar.dataset.currentStatus = status;

  document.getElementById('modal-delete').classList.add('active');
};

function formatDate_safe() { return ''; } // placeholder for display only

window.closeDeleteModal = function() {
  document.getElementById('modal-delete').classList.remove('active');
  deleteTarget = null;
};

// ── Cancelar / Reativar ──
window.confirmCancelar = async function() {
  if (!deleteTarget) return;

  const btn = document.getElementById('btn-cancelar');
  btn.classList.add('loading');
  btn.disabled = true;

  const currentStatus = btn.dataset.currentStatus || 'ativo';
  const newStatus     = currentStatus === 'cancelado' ? 'ativo' : 'cancelado';
  const opt = document.querySelector('input[name="delete-opt"]:checked')?.value || 'single';

  try {
    if (opt === 'group' && deleteTarget.grupoParcelaId) {
      // Apply to all installments in the group
      const { db } = await import('./firebase-config.js');
      const { collection, doc, query, where, getDocs, writeBatch } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");

      const ref  = collection(db, 'users', currentUser.uid, 'lancamentos');
      const q    = query(ref, where('grupoParcelaId', '==', deleteTarget.grupoParcelaId));
      const snap = await getDocs(q);
      const batch = writeBatch(db);
      snap.docs.forEach(d => batch.update(d.ref, { status: newStatus }));
      await batch.commit();
    } else {
      await updateLancamento(currentUser.uid, deleteTarget.id, { status: newStatus });
    }

    const msg = newStatus === 'cancelado'
      ? 'Lançamento cancelado (estorno). ↩️'
      : 'Lançamento reativado! ✅';
    showToast(msg, newStatus === 'cancelado' ? 'info' : 'success');

    closeDeleteModal();
    await loadData();
  } catch (err) {
    showToast('Erro ao atualizar status.', 'error');
    console.error(err);
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
};

// ── Reativar direto da tabela ──
window.reativarLancamento = async function(id) {
  if (!confirm('Deseja reativar este lançamento?')) return;
  try {
    await updateLancamento(currentUser.uid, id, { status: 'ativo' });
    showToast('Lançamento reativado!', 'success');
    await loadData();
  } catch (err) {
    console.error(err);
    showToast('Erro ao reativar', 'error');
  }
};

window.markAsPaid = async function(id, grupoId) {
  if (!confirm('Marcar esta conta como paga?')) return;
  try {
    // Check if we should ask about applying to all if it has a group
    if (grupoId && confirm('Deseja marcar TODAS as parcelas deste grupo como pagas?')) {
      await updateGrupoParcelasFields(currentUser.uid, grupoId, { pago: true });
    } else {
      await updateLancamento(currentUser.uid, id, { pago: true });
    }
    showToast('Conta marcada como paga!', 'success');
    await loadData();
  } catch (err) {
    console.error(err);
    showToast('Erro ao atualizar', 'error');
  }
};


// ── Excluir permanentemente ──
window.confirmDelete = async function() {
  if (!deleteTarget) return;

  const btn = document.getElementById('confirm-delete-btn');
  btn.classList.add('loading');
  btn.disabled = true;

  const opt = document.querySelector('input[name="delete-opt"]:checked')?.value || 'single';

  try {
    if (opt === 'group' && deleteTarget.grupoParcelaId) {
      await deleteGrupoParcelas(currentUser.uid, deleteTarget.grupoParcelaId);
      showToast('Todas as parcelas excluídas! 🗑️', 'success');
    } else {
      await deleteLancamento(currentUser.uid, deleteTarget.id);
      showToast('Lançamento excluído! 🗑️', 'success');
    }

    closeDeleteModal();
    await loadData();
  } catch (err) {
    showToast('Erro ao excluir.', 'error');
    console.error(err);
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
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
