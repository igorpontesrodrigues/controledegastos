// categorias.js — Categories management with reorder & tabs
import { requireAuth, logout, getUserInitials } from './auth.js';
import { loadCategorias, saveCategoria, deleteCategoria, reorderCategorias, CATEGORIAS } from './db.js';

let currentUser = null;
let editingId = null;
let selectedColor = '#8B5CF6';
let currentTab = 'despesa';
let reorderPromise = Promise.resolve();

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

  document.getElementById('btn-add-categoria').addEventListener('click', openModalNew);
  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);
  document.getElementById('categoria-form').addEventListener('submit', handleSubmit);

  // Emoji presets click
  document.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('categoria-icon').value = btn.dataset.emoji;
      document.querySelectorAll('.emoji-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  // Color presets click
  document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedColor = btn.dataset.color;
      document.getElementById('categoria-color').value = selectedColor;
      document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  await loadData();
}

window.switchCatTab = function(tipo) {
  currentTab = tipo;
  document.getElementById('tab-despesa').classList.toggle('active', tipo === 'despesa');
  document.getElementById('tab-receita').classList.toggle('active', tipo === 'receita');
  renderCategorias();
};

async function loadData() {
  document.getElementById('categorias-loading').style.display = 'flex';
  document.getElementById('categorias-grid').style.display = 'none';

  try {
    await loadCategorias(currentUser.uid);
    renderCategorias();
  } catch (err) {
    console.error('Erro ao carregar categorias:', err);
    showToast('Erro ao carregar categorias.', 'error');
  } finally {
    document.getElementById('categorias-loading').style.display = 'none';
  }
}

function renderCategorias() {
  const grid = document.getElementById('categorias-grid');
  grid.style.display = 'grid';

  const list = CATEGORIAS.filter(cat => (cat.tipo || 'despesa') === currentTab)
    .sort((a, b) => (a.ordem - b.ordem) || a.label.localeCompare(b.label));

  if (list.length === 0) {
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">Nenhuma categoria cadastrada para esta aba. Clique em "+ Nova Categoria" para adicionar!</div>`;
    return;
  }

  grid.innerHTML = list.map((cat, idx) => `
    <div class="cat-card">
      <div class="cat-info">
        <div class="cat-icon-badge" style="border-color: ${cat.color}40; background: ${cat.color}15;">
          ${cat.icon}
        </div>
        <div>
          <div class="cat-label-text">${cat.label}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted); display:flex; align-items:center; gap: 6px; margin-top: 4px;">
            <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${cat.color}"></span>
            ${cat.id}
          </div>
        </div>
      </div>
      <div class="cat-actions">
        <button class="cat-action-btn" onclick="moveCategoria('${cat.id}', -1)" title="Mover para cima" ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button class="cat-action-btn" onclick="moveCategoria('${cat.id}', 1)" title="Mover para baixo" ${idx === list.length - 1 ? 'disabled' : ''}>▼</button>
        <button class="cat-action-btn" onclick="editCategoria('${cat.id}')" title="Editar">✏️</button>
        ${(cat.id === 'outros' || cat.id === 'rec_outros') ? '' : `
        <button class="cat-action-btn delete-btn" onclick="removeCategoria('${cat.id}', '${cat.label}')" title="Excluir">🗑️</button>
        `}
      </div>
    </div>
  `).join('');
}

window.moveCategoria = function(id, direction) {
  const list = CATEGORIAS.filter(cat => (cat.tipo || 'despesa') === currentTab)
    .sort((a, b) => (a.ordem - b.ordem) || a.label.localeCompare(b.label));
  const idx = list.findIndex(c => c.id === id);
  if (idx === -1) return;
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= list.length) return;

  // Swap
  const temp = list[idx];
  list[idx] = list[newIdx];
  list[newIdx] = temp;

  // Reassign order for this tab
  list.forEach((c, i) => {
    c.ordem = i * 10;
  });

  // Immediately sort global CATEGORIAS in memory and render synchronously!
  CATEGORIAS.sort((a, b) => (a.ordem - b.ordem) || a.label.localeCompare(b.label));
  renderCategorias();

  // Queue background Firebase update so rapid clicks execute sequentially without race conditions
  const currentListToSave = [...list];
  reorderPromise = reorderPromise.then(async () => {
    try {
      await reorderCategorias(currentUser.uid, currentListToSave);
      showToast('Ordem atualizada! 🔄', 'success');
    } catch (err) {
      console.error('Erro ao reordenar:', err);
      showToast('Erro ao salvar nova ordem.', 'error');
    }
  });
};

function openModalNew() {
  editingId = null;
  const tipoLabel = currentTab === 'receita' ? 'Receita' : 'Despesa';
  document.getElementById('modal-title').textContent = `Nova Categoria (${tipoLabel})`;
  document.getElementById('categoria-form').reset();
  document.getElementById('categoria-id').value = '';
  document.getElementById('categoria-tipo').value = currentTab;
  selectedColor = '#8B5CF6';
  document.getElementById('categoria-color').value = selectedColor;
  document.getElementById('categoria-error').classList.remove('visible');
  
  document.querySelectorAll('.color-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.color === selectedColor);
  });
  document.querySelectorAll('.emoji-btn').forEach(b => b.classList.remove('selected'));

  document.getElementById('modal-categoria').classList.add('active');
}

function closeModal() {
  document.getElementById('modal-categoria').classList.remove('active');
}

window.editCategoria = function(id) {
  const cat = CATEGORIAS.find(c => c.id === id);
  if (!cat) return;

  editingId = id;
  const tipoLabel = (cat.tipo || 'despesa') === 'receita' ? 'Receita' : 'Despesa';
  document.getElementById('modal-title').textContent = `Editar Categoria (${tipoLabel})`;
  document.getElementById('categoria-id').value = id;
  document.getElementById('categoria-nome').value = cat.label;
  document.getElementById('categoria-icon').value = cat.icon;
  document.getElementById('categoria-tipo').value = cat.tipo || 'despesa';
  selectedColor = cat.color || '#8B5CF6';
  document.getElementById('categoria-color').value = selectedColor;
  document.getElementById('categoria-error').classList.remove('visible');

  document.querySelectorAll('.color-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.color === selectedColor);
  });
  document.querySelectorAll('.emoji-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.emoji === cat.icon);
  });

  document.getElementById('modal-categoria').classList.add('active');
};

window.removeCategoria = async function(id, label) {
  if (id === 'outros' || id === 'rec_outros') {
    showToast('A categoria Outros não pode ser excluída.', 'info');
    return;
  }
  if (!confirm(`Excluir a categoria "${label}"? Lançamentos existentes que usam esta categoria serão exibidos na categoria padrão/outros.`)) return;

  try {
    await deleteCategoria(currentUser.uid, id);
    showToast('Categoria excluída!', 'success');
    renderCategorias();
  } catch (err) {
    console.error('Erro ao excluir:', err);
    showToast('Erro ao excluir categoria.', 'error');
  }
};

async function handleSubmit(e) {
  e.preventDefault();

  const label = document.getElementById('categoria-nome').value.trim();
  const icon = document.getElementById('categoria-icon').value.trim() || '📦';
  const color = document.getElementById('categoria-color').value || '#8B5CF6';
  const tipo = document.getElementById('categoria-tipo').value || currentTab;

  if (!label) {
    document.getElementById('categoria-error-msg').textContent = 'Informe o nome da categoria.';
    document.getElementById('categoria-error').classList.add('visible');
    return;
  }

  const btn = document.getElementById('categoria-submit-btn');
  btn.classList.add('loading');
  btn.disabled = true;

  try {
    let catId = editingId;
    let ordem = 0;
    const existing = CATEGORIAS.find(c => c.id === catId);
    
    if (existing) {
      ordem = existing.ordem !== undefined ? existing.ordem : 999;
    } else {
      catId = label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '_');
      if (tipo === 'receita' && !catId.startsWith('rec_')) catId = 'rec_' + catId;
      if (!catId || catId === 'outros' || catId === 'rec_outros' || CATEGORIAS.some(c => c.id === catId)) {
        catId = (tipo === 'receita' ? 'rec_' : 'cat_') + Date.now();
      }
      const sameType = CATEGORIAS.filter(c => (c.tipo || 'despesa') === tipo);
      ordem = sameType.length * 10;
    }

    await saveCategoria(currentUser.uid, catId, { label, icon, color, tipo, ordem });
    
    if (existing) {
      existing.label = label;
      existing.icon = icon;
      existing.color = color;
      existing.tipo = tipo;
    } else {
      CATEGORIAS.push({ id: catId, label, icon, color, tipo, ordem });
    }

    CATEGORIAS.sort((a, b) => (a.ordem - b.ordem) || a.label.localeCompare(b.label));

    showToast(`Categoria ${editingId ? 'atualizada' : 'criada'} com sucesso! ✅`, 'success');
    closeModal();
    renderCategorias();
  } catch (err) {
    console.error('Erro ao salvar categoria:', err);
    document.getElementById('categoria-error-msg').textContent = 'Erro ao salvar categoria.';
    document.getElementById('categoria-error').classList.add('visible');
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
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
