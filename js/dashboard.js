// dashboard.js — Dashboard page logic
import { requireAuth, logout, getUserInitials } from './auth.js';
import {
  getLancamentosByDateRange, getAllLancamentos, getCartoes, getCiclosMap, getBillingDateRange, findBillingMonthForDate,
  formatCurrency, formatDate, formatMonth, getCategoriaById, CATEGORIAS, updateLancamento
} from './db.js';

// ── State ──
let currentUser = null;
let allLancamentosGlob = [];
let lancamentos = [];
let currentYear = new Date().getFullYear();
let currentViewMode = 'total'; // 'total', 'credito', 'boleto'
let currentMonth = new Date().getMonth(); // 0-indexed
let allCartoes   = [];
let ciclosMap    = {};
let categoryChartInstance = null;

// ── DOM ──
const yearLabel       = document.getElementById('year-label');
const transLoading    = document.getElementById('transactions-loading');
const cartoesSum      = document.getElementById('cartoes-summary');
const cartoesEmpty    = document.getElementById('cartoes-empty');

// ── Init ──
async function init() {
  currentUser = await requireAuth('index.html');

  // Set user info in sidebar
  document.getElementById('user-avatar').textContent = getUserInitials(currentUser);
  document.getElementById('user-name').textContent   = currentUser.displayName || 'Usuário';
  document.getElementById('user-email').textContent  = currentUser.email;

  // Logout
  document.getElementById('user-info-btn').addEventListener('click', () => {
    if (confirm('Deseja sair da conta?')) logout();
  });

  // Mobile menu
  document.getElementById('mobile-menu-btn').addEventListener('click', toggleMobileMenu);
  document.getElementById('nav-overlay').addEventListener('click', closeMobileMenu);

  // Close button for month details modal
  const btnCloseMes = document.getElementById('mes-detalhes-close');
  if (btnCloseMes) {
    btnCloseMes.addEventListener('click', () => {
      document.getElementById('modal-mes-detalhes').classList.remove('active');
    });
  }
  const btnFecharMes = document.getElementById('mes-detalhes-btn-fechar');
  if (btnFecharMes) {
    btnFecharMes.addEventListener('click', () => {
      document.getElementById('modal-mes-detalhes').classList.remove('active');
    });
  }

  // Year navigation and mode toggle
  const prevYearBtn = document.getElementById('prev-year');
  if (prevYearBtn) prevYearBtn.addEventListener('click', () => { currentYear--; loadData(); });
  
  const nextYearBtn = document.getElementById('next-year');
  if (nextYearBtn) nextYearBtn.addEventListener('click', () => { currentYear++; loadData(); });
  
  initModalPagarBoleto();

  // Modal Faturas
  const modalFatura = document.getElementById('modal-fatura');
  if (modalFatura) {
    const closeModal = () => {
      modalFatura.classList.remove('active');
      document.body.style.overflow = '';
    };
    document.getElementById('fatura-modal-close').addEventListener('click', closeModal);
    document.getElementById('fatura-modal-btn-fechar').addEventListener('click', closeModal);
    modalFatura.addEventListener('click', e => {
      if (e.target === modalFatura) closeModal();
    });
  }

  try {
    await loadCartoes();
    ciclosMap = await getCiclosMap(currentUser.uid);
  } catch (err) {
    console.error('Erro ao carregar configurações iniciais (Cartões/Ciclos):', err);
    // Continue execution so buttons still work
  }
  
  // Set default view to current year
  currentYear = new Date().getFullYear();

  // Setup View Mode Toggle
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      const target = e.currentTarget;
      target.classList.add('active');
      currentViewMode = target.getAttribute('data-mode');
      applyViewMode();
    });
  });

  await loadData();
}

// ── Mobile Menu ──
function toggleMobileMenu() {
  document.getElementById('nav-sidebar').classList.toggle('open');
  document.getElementById('nav-overlay').classList.toggle('active');
}
function closeMobileMenu() {
  document.getElementById('nav-sidebar').classList.remove('open');
  document.getElementById('nav-overlay').classList.remove('active');
}

// ── Year Navigation ──
function changeYear(delta) {
  currentYear += delta;
  loadData();
}

// ── Load Cartoes ──
async function loadCartoes() {
  allCartoes = await getCartoes(currentUser.uid);
}

// ── Load Data ──
async function loadData() {
  if (yearLabel) yearLabel.textContent = currentYear;

  transLoading.style.display = 'flex';
  const faturasList = document.getElementById('faturas-list');
  const faturasEmpty = document.getElementById('faturas-empty');
  if (faturasList) faturasList.style.display = 'none';
  if (faturasEmpty) faturasEmpty.style.display = 'none';

  try {
    const { start, end } = getBillingDateRange(currentYear, currentMonth, ciclosMap);
    lancamentos = await getLancamentosByDateRange(currentUser.uid, start, end);
    allLancamentosGlob = await getAllLancamentos(currentUser.uid);
    
    // Auto-fix any corrupted string dates
    allLancamentosGlob.forEach(l => {
      if (typeof l.data === 'string') {
        updateLancamento(currentUser.uid, l.id, { data: new Date(l.data + 'T12:00:00') }).then(() => console.log('Fixed corrupted date for:', l.descricao));
      }
    });
    
    applyViewMode();
    renderCartoesSum();
  } catch (err) {
    console.error('Erro ao carregar dados:', err);
    showToast('Erro ao carregar dados.', 'error');
  } finally {
    transLoading.style.display = 'none';
  }
  
  // Fallback de segurança para garantir que o spinner não fique travado
  setTimeout(() => {
    if (transLoading) transLoading.style.display = 'none';
  }, 5000);
}

// ── View Mode ──
function applyViewMode() {
  lancamentos = allLancamentosGlob.filter(l => {
    const d = l.data.toDate ? l.data.toDate() : new Date(l.data);
    if (d.getFullYear() !== currentYear) return false;
    
    if (currentViewMode === 'credito') {
      return (l.formaPagamento === 'credito' || l.formaPagamento === 'cartao_credito' || (l.cartaoId && l.formaPagamento !== 'boleto' && l.formaPagamento !== 'pix' && l.formaPagamento !== 'dinheiro'));
    }
    if (currentViewMode === 'boleto') {
      return l.formaPagamento === 'boleto';
    }
    
    return true; // total
  });

  updateStats();
  
  const sectionBoletos = document.getElementById('section-boletos');
  const sectionFaturas = document.getElementById('section-faturas');
  const sectionTotal = document.getElementById('section-total');

  if (currentViewMode === 'boleto') {
    if (sectionTotal) sectionTotal.style.display = 'none';
    if (sectionBoletos) sectionBoletos.style.display = 'block';
    if (sectionFaturas) sectionFaturas.style.display = 'none';
    renderBoletos();
  } else if (currentViewMode === 'credito') {
    if (sectionTotal) sectionTotal.style.display = 'none';
    if (sectionBoletos) sectionBoletos.style.display = 'none';
    if (sectionFaturas) sectionFaturas.style.display = 'block';
    renderFaturas();
  } else {
    // Total mode: show Despesas do Mês
    if (sectionTotal) sectionTotal.style.display = 'block';
    if (sectionBoletos) sectionBoletos.style.display = 'none';
    if (sectionFaturas) sectionFaturas.style.display = 'none';
    renderTotalMes();
  }
  
  renderCategoryChart();
  checkBoletoAlerts();
}

// ── Update Stats ──
async function updateStats() {
  // Apenas itens ativos
  const ativos = lancamentos.filter(l => l.status !== 'cancelado');
  const despesas = ativos.filter(l => l.tipo === 'despesa');
  const receitas = ativos.filter(l => l.tipo === 'receita');

  let despesasPagas, receitasPagas;

  if (currentViewMode === 'credito') {
    // Show all credit card expenses (whether paid or not)
    despesasPagas = despesas;
    receitasPagas = receitas;
  } else if (currentViewMode === 'boleto') {
    // Boletos costumam ser pagos depois, vamos mostrar todos (pagos ou não) para dar a noção do total de boletos do ano
    despesasPagas = despesas;
    receitasPagas = receitas;
  } else {
    // Fluxo de caixa Total: reflete apenas o dinheiro real (pagos).
    // Ignora gastos no crédito que ainda não foram pagos.
    despesasPagas = despesas.filter(l => l.pago !== false && l.formaPagamento !== 'credito' && l.formaPagamento !== 'cartao_credito' && (!l.cartaoId || l.formaPagamento === 'boleto' || l.formaPagamento === 'pix' || l.formaPagamento === 'dinheiro'));
    receitasPagas = receitas.filter(l => l.pago !== false && l.formaPagamento !== 'credito' && l.formaPagamento !== 'cartao_credito' && (!l.cartaoId || l.formaPagamento === 'boleto' || l.formaPagamento === 'pix' || l.formaPagamento === 'dinheiro'));
  }

  const totalDespesas = despesasPagas.reduce((s, l) => s + l.valor, 0);
  const totalReceitas = receitasPagas.reduce((s, l) => s + l.valor, 0);
  const saldo = totalReceitas - totalDespesas;
  
  // Store globally so faturas can check before paying
  window._currentSaldo = saldo;

  document.getElementById('stat-despesas').textContent = formatCurrency(totalDespesas);
  document.getElementById('stat-receitas').textContent = formatCurrency(totalReceitas);
  document.getElementById('stat-saldo').textContent    = formatCurrency(saldo);
  document.getElementById('stat-saldo').style.color = saldo >= 0 ? '#34D399' : '#F87171';

  document.getElementById('stat-despesas-count').textContent = `${despesasPagas.length} lançamento${despesasPagas.length !== 1 ? 's' : ''}`;
  document.getElementById('stat-receitas-count').textContent = `${receitasPagas.length} lançamento${receitasPagas.length !== 1 ? 's' : ''}`;

  // Calculate future installments (next 3 months/future)
  try {
    const now = new Date();
    const future = allLancamentosGlob.filter(l => {
      const d = l.data.toDate ? l.data.toDate() : new Date(l.data);
      return l.parcelado && d > now;
    });
    const totalFuture = future.reduce((s, l) => s + l.valor, 0);
    document.getElementById('stat-parcelas').textContent = formatCurrency(totalFuture);
    document.getElementById('stat-parcelas-count').textContent = `${future.length} parcela${future.length !== 1 ? 's' : ''} pendentes`;
  } catch (e) {
    // non-critical
  }
}

// ── Render Boletos ──
function renderBoletos() {
  const boletosList = document.getElementById('boletos-list');
  const empty = document.getElementById('boletos-empty');
  
  const pendentes = allLancamentosGlob.filter(l => l.status !== 'cancelado' && l.formaPagamento === 'boleto' && l.pago === false && l.tipo === 'despesa');
  
  if (pendentes.length === 0) {
    if (boletosList) boletosList.style.display = 'none';
    if (empty) empty.style.display = 'flex';
    return;
  }
  
  // Ordenar pela data de vencimento
  pendentes.sort((a, b) => {
    const da = a.data.toDate ? a.data.toDate() : new Date(a.data);
    const db = b.data.toDate ? b.data.toDate() : new Date(b.data);
    return da - db;
  });
  
  if (boletosList) {
    boletosList.style.display = 'flex';
    boletosList.style.flexDirection = 'column';
    boletosList.style.gap = '8px';
    boletosList.innerHTML = '';
    
    const now = new Date();
    now.setHours(0,0,0,0);
    
    const grupos = {};
    pendentes.forEach(b => {
      const dbDate = b.data.toDate ? b.data.toDate() : new Date(b.data);
      const chaveMes = `${dbDate.getFullYear()}-${dbDate.getMonth()}`;
      if (!grupos[chaveMes]) {
        grupos[chaveMes] = { mes: dbDate.getMonth(), ano: dbDate.getFullYear(), boletos: [] };
      }
      grupos[chaveMes].boletos.push(b);
    });

    const nomeMes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const sortedKeys = Object.keys(grupos).sort((a,b) => {
       const [anoA, mesA] = a.split('-').map(Number);
       const [anoB, mesB] = b.split('-').map(Number);
       if (anoA !== anoB) return anoA - anoB;
       return mesA - mesB;
    });

    sortedKeys.forEach(key => {
      const g = grupos[key];
      
      const header = document.createElement('div');
      header.style.fontWeight = '700';
      header.style.color = 'var(--text-primary)';
      header.style.margin = '16px 0 4px 4px';
      header.style.fontSize = '1.1rem';
      header.textContent = `${nomeMes[g.mes]} de ${g.ano}`;
      boletosList.appendChild(header);
      
      g.boletos.forEach(b => {
        const dbDate = b.data.toDate ? b.data.toDate() : new Date(b.data);
        dbDate.setHours(12,0,0,0); // Avoid timezone shifts
        
        const isPastDue = dbDate < now;
        const isDueToday = dbDate.getTime() === now.getTime();
        const blinkClass = (isPastDue || isDueToday) ? 'blink-danger' : '';
        const dueStatus = isPastDue ? 'Vencido' : (isDueToday ? 'Vence Hoje' : 'Pendente');
        const statusColor = isPastDue ? '#EF4444' : (isDueToday ? '#F59E0B' : 'var(--text-light)');
        
        const item = document.createElement('div');
        item.className = `transaction-item ${blinkClass}`;
        item.style.padding = '12px 16px';
        
        item.innerHTML = `
          <div class="transaction-icon" style="background:#f3e8ff; color:#a855f7;">📄</div>
          <div class="transaction-info">
            <div class="transaction-desc">${b.descricao}</div>
            <div class="transaction-meta">
              ${formatDate(dbDate)} - <span style="color:${statusColor};font-weight:600">${dueStatus}</span>
            </div>
          </div>
          <div class="transaction-amount" style="color:var(--danger)">
            ${formatCurrency(b.valor)}
            <button class="btn btn-primary btn-sm btn-pagar-boleto" data-id="${b.id}" style="margin-top:6px;width:100%">Pagar</button>
          </div>
        `;
        boletosList.appendChild(item);
      });
    });
    
    document.querySelectorAll('.btn-pagar-boleto').forEach(btn => {
      btn.addEventListener('click', (e) => {
        openModalPagarBoleto(e.target.getAttribute('data-id'));
      });
    });
  }
  if (empty) empty.style.display = 'none';
}

// ── Check Boleto Alerts ──
function checkBoletoAlerts() {
  const btnBoletos = document.querySelector('.view-btn[data-mode="boleto"]');
  if (!btnBoletos) return;
  
  const now = new Date();
  now.setHours(0,0,0,0);
  const in5Days = new Date(now);
  in5Days.setDate(in5Days.getDate() + 5);
  
  const nearDue = allLancamentosGlob.some(l => {
    if (l.status === 'cancelado' || l.formaPagamento !== 'boleto' || l.pago !== false || l.tipo !== 'despesa') return false;
    const dbDate = l.data.toDate ? l.data.toDate() : new Date(l.data);
    dbDate.setHours(12,0,0,0);
    return dbDate <= in5Days; // Vencido ou vence em até 5 dias
  });
  
  if (nearDue) {
    btnBoletos.classList.add('blink-alert');
  } else {
    btnBoletos.classList.remove('blink-alert');
  }
}


// ── Render Total (Despesas do Mês) ──
function renderTotalMes() {
  const totalList = document.getElementById('total-list');
  const empty = document.getElementById('total-empty');
  
  const somaPorMes = {};
  const detalhesPorMes = {};
  
  allLancamentosGlob.forEach(l => {
    if (l.status === 'cancelado' || l.tipo !== 'despesa') return;
    
    // Ignorar Pix e Dinheiro (manter apenas Cartões e Boletos)
    if (l.formaPagamento !== 'credito' && l.formaPagamento !== 'cartao_credito' && l.formaPagamento !== 'boleto' && !l.cartaoId) {
      return;
    }
    
    const d = l.data.toDate ? l.data.toDate() : new Date(l.data);
    let month, year;
    let tipoDetalhe = '';
    
    if (l.formaPagamento === 'credito' || l.formaPagamento === 'cartao_credito' || l.cartaoId) {
      const billing = findBillingMonthForDate(d, ciclosMap);
      month = billing.month;
      year = billing.year;
      tipoDetalhe = 'cartao';
    } else {
      month = d.getMonth();
      year = d.getFullYear();
      tipoDetalhe = 'boleto';
    }
    
    // Filtro rigoroso pelo ano atual
    if (year !== currentYear) return;
    
    somaPorMes[month] = (somaPorMes[month] || 0) + l.valor;
    
    if (!detalhesPorMes[month]) {
      detalhesPorMes[month] = { cartoes: {}, boleto: 0, total: 0 };
    }
    
    if (tipoDetalhe === 'cartao') {
      detalhesPorMes[month].cartoes[l.cartaoId] = (detalhesPorMes[month].cartoes[l.cartaoId] || 0) + l.valor;
    } else {
      detalhesPorMes[month].boleto += l.valor;
    }
    detalhesPorMes[month].total += l.valor;
  });
  
  const mesesOrdenados = Object.keys(somaPorMes).sort((a,b) => a - b);
  
  if (mesesOrdenados.length === 0) {
    if (totalList) totalList.style.display = 'none';
    if (empty) empty.style.display = 'flex';
    return;
  }
  
  if (totalList) {
    totalList.style.display = 'flex';
    totalList.style.flexDirection = 'column';
    totalList.style.gap = '8px';
    totalList.innerHTML = '';
    
    const nomeMes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    
    mesesOrdenados.forEach(m => {
      const mesIdx = Number(m);
      const mesKey = `${currentYear}-${String(mesIdx + 1).padStart(2, '0')}`;
      const ciclo = ciclosMap[mesKey] || {};
      const limiteGasto = ciclo.limiteGasto || 3000;
      const soma = somaPorMes[m];
      const percent = (soma / limiteGasto) * 100;
      
      let amountColor = 'var(--text-light)';
      let statusText = '';
      
      if (soma > limiteGasto) {
        amountColor = '#EF4444'; // Vermelho
        statusText = `Passou ${formatCurrency(soma - limiteGasto)} do limite`;
      } else if (percent > 85) {
        amountColor = '#F59E0B'; // Laranja/Amarelo
        statusText = `Falta ${formatCurrency(limiteGasto - soma)} para o limite`;
      } else {
        amountColor = '#10B981'; // Verde
        statusText = `Falta ${formatCurrency(limiteGasto - soma)} para o limite`;
      }

      const item = document.createElement('div');
      item.className = 'transaction-item';
      item.style.padding = '12px 16px';
      item.style.cursor = 'pointer';
      
      item.innerHTML = `
        <div class="transaction-icon" style="background:#e0f2fe; color:#0ea5e9;">
          📅
        </div>
        <div class="transaction-info">
          <div class="transaction-desc" style="display:flex; align-items:center; gap:8px;">
            Despesas de ${nomeMes[m]}
          </div>
          <div class="transaction-meta" style="color: ${amountColor}; font-weight: 500;">
            ${statusText} <span style="color:var(--text-muted); font-weight:normal; font-size:0.8rem">(Limite: ${formatCurrency(limiteGasto)})</span>
          </div>
        </div>
        <div class="transaction-amount expense" style="color: ${amountColor}; font-weight:700; font-size:1.1rem;">
          ${formatCurrency(soma)}
        </div>
      `;
      
      item.addEventListener('click', () => {
        const modal = document.getElementById('modal-mes-detalhes');
        document.getElementById('mes-detalhes-title').textContent = `Detalhes de ${nomeMes[m]}`;
        
        let html = '';
        
        const cartoesMes = detalhesPorMes[m].cartoes;
        for (const [cid, valor] of Object.entries(cartoesMes)) {
          const cartaoData = allCartoes.find(c => c.id === cid);
          const nomeCartao = cartaoData ? cartaoData.nome : 'Cartão Excluído';
          
          html += `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px; border-bottom:1px solid rgba(255,255,255,0.05); border-radius:6px; background:rgba(255,255,255,0.02)">
              <div style="display:flex; align-items:center; gap:10px; overflow:hidden">
                <span style="font-size:1.2rem">💳</span>
                <div style="display:flex; flex-direction:column; overflow:hidden">
                   <span style="font-size:0.9rem; font-weight:500; white-space:nowrap; text-overflow:ellipsis; overflow:hidden">${nomeCartao}</span>
                   <span style="font-size:0.75rem; color:var(--text-muted)">Fatura de Cartão</span>
                </div>
              </div>
              <div style="font-family:monospace; font-weight:600; color:var(--danger-color)">
                ${formatCurrency(valor)}
              </div>
            </div>
          `;
        }
        
        if (detalhesPorMes[m].boleto > 0) {
          html += `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px; border-bottom:1px solid rgba(255,255,255,0.05); border-radius:6px; background:rgba(255,255,255,0.02)">
              <div style="display:flex; align-items:center; gap:10px; overflow:hidden">
                <span style="font-size:1.2rem">📄</span>
                <div style="display:flex; flex-direction:column; overflow:hidden">
                   <span style="font-size:0.9rem; font-weight:500; white-space:nowrap; text-overflow:ellipsis; overflow:hidden">Boletos Pendentes</span>
                   <span style="font-size:0.75rem; color:var(--text-muted)">Boleto</span>
                </div>
              </div>
              <div style="font-family:monospace; font-weight:600; color:var(--danger-color)">
                ${formatCurrency(detalhesPorMes[m].boleto)}
              </div>
            </div>
          `;
        }
        
        if (html === '') {
          html = `<div style="text-align:center; color:var(--text-muted); padding:20px 0">Nenhuma despesa.</div>`;
        }
        
        document.getElementById('mes-detalhes-total').textContent = formatCurrency(detalhesPorMes[m].total);
        document.getElementById('mes-detalhes-body').innerHTML = html;
        modal.classList.add('active');
      });
      
      totalList.appendChild(item);
    });
  }
  
  if (empty) empty.style.display = 'none';
}

// ── Render Faturas ──
function renderFaturas() {
  const faturasList = document.getElementById('faturas-list');
  const empty = document.getElementById('faturas-empty');
  
  if (allCartoes.length === 0 || currentViewMode === 'boleto') {
    faturasList.style.display = 'none';
    if (currentViewMode === 'boleto') {
      empty.style.display = 'none'; // Hide empty faturas state if in boleto mode
    } else {
      empty.style.display = 'flex';
    }
    return;
  }
  
  // Faturas view always uses allLancamentosGlob so it doesn't break if we are in 'total' mode
  const creditos = allLancamentosGlob.filter(l => l.status !== 'cancelado' && (l.formaPagamento === 'credito' || l.formaPagamento === 'cartao_credito' || (l.cartaoId && l.formaPagamento !== 'boleto' && l.formaPagamento !== 'pix' && l.formaPagamento !== 'dinheiro')) && l.tipo === 'despesa');
  
  const faturasPorMes = {};
  
  creditos.forEach(l => {
    const d = l.data.toDate ? l.data.toDate() : new Date(l.data);
    const billing = findBillingMonthForDate(d, ciclosMap);
    if (billing.year === currentYear) {
      if (!faturasPorMes[billing.month]) faturasPorMes[billing.month] = [];
      faturasPorMes[billing.month].push(l);
    }
  });
  
  const mesesOrdenados = Object.keys(faturasPorMes).sort((a,b) => a - b);
  
  if (mesesOrdenados.length === 0) {
    faturasList.style.display = 'none';
    empty.style.display = 'flex';
    return;
  }
  
  faturasList.style.display = 'flex';
  faturasList.style.flexDirection = 'column';
  faturasList.style.gap = '8px';
  empty.style.display = 'none';
  
  const nomeMes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  
  // Store globally so the modal can access it
  window._faturasCurrentYear = faturasPorMes;
  
  faturasList.innerHTML = mesesOrdenados.map(mesStr => {
    const mes = parseInt(mesStr);
    const lancsMes = faturasPorMes[mes];
    const total = lancsMes.reduce((s,l) => s + l.valor, 0);
    
    // Check payment
    // Assumimos que o usuário tem apenas 1 cartão como ele mencionou, então procuramos qualquer pagamento de fatura no mês
    const payment = allLancamentosGlob.find(l => {
       if (l.status === 'cancelado' || l.tipo !== 'despesa' || !(l.descricao || '').startsWith('Pagamento Fatura')) return false;
       const pd = l.data.toDate ? l.data.toDate() : new Date(l.data);
       const pbilling = findBillingMonthForDate(pd, ciclosMap);
       return pbilling.year === currentYear && pbilling.month === mes;
    });
    const isPaid = !!payment;
    
    // Get due date & cycle dates
    const pad = n => String(n).padStart(2, '0');
    const mesKey = `${currentYear}-${pad(mes + 1)}`;
    const ciclo = ciclosMap[mesKey];
    
    let dueStr = '';
    let startStr = '';
    let endStr = '';
    
    if (ciclo && ciclo.fechamento) {
      // Find previous month's closing date for the start of the current cycle
      let prevM = mes - 1;
      let prevY = currentYear;
      if (prevM < 0) { prevM = 11; prevY--; }
      const prevKey = `${prevY}-${pad(prevM + 1)}`;
      const prevCiclo = ciclosMap[prevKey];
      
      let prevFechamentoDate;
      if (prevCiclo && prevCiclo.fechamento) {
        prevFechamentoDate = new Date(prevCiclo.fechamento + 'T12:00:00');
      } else {
        prevFechamentoDate = new Date(currentYear, mes - 1, 27, 12, 0, 0); // fallback
      }
      
      // start is the day of previous fechamento
      startStr = prevFechamentoDate.toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit'});
      
      // end is the day before the current fechamento
      const currentFechamentoDate = new Date(ciclo.fechamento + 'T12:00:00');
      const endDate = new Date(currentFechamentoDate);
      endDate.setDate(endDate.getDate() - 1);
      endStr = endDate.toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit'});
      
      if (ciclo.vencimento) {
        dueStr = ciclo.vencimento.split('-').reverse().join('/');
      }
    } else {
      // Default fallback
      startStr = `27/${pad(mes === 0 ? 12 : mes)}`;
      endStr = `26/${pad(mes + 1)}`;
      let nextM = mes + 2;
      let nextY = currentYear;
      if (nextM > 12) { nextM -= 12; nextY++; }
      dueStr = `04/${pad(nextM)}/${nextY}`;
    }
    
    // Determine invoice status & colors
    const todayDate = new Date();
    const todayBillingState = findBillingMonthForDate(todayDate, ciclosMap);
    
    const isCurrentUi = (todayBillingState.year === currentYear && todayBillingState.month === mes);
    const borderStyle = isCurrentUi ? 'border: 1px solid var(--primary-color); background: rgba(59, 130, 246, 0.05);' : 'border: 1px solid rgba(255,255,255,0.05);';
    const currentBadge = isCurrentUi ? '<span class="badge badge-purple" style="font-size:0.7rem; padding: 2px 6px; margin-left: 8px;">Fatura Atual</span>' : '';
    
    let valueColor = '#EAB308'; // Default future (amarelo)
    if (isPaid) {
      valueColor = '#34D399'; // Paid (verde)
    } else {
      if (todayBillingState.year > currentYear || (todayBillingState.year === currentYear && todayBillingState.month > mes)) {
        valueColor = '#F87171'; // Closed but unpaid (vermelho)
      } else if (isCurrentUi) {
        valueColor = '#F97316'; // Current invoice (laranja)
      }
    }
    
    // Cartao ID to pass to pagarFatura (uses the first available card, assuming 1 card setup)
    const cartaoId = allCartoes[0]?.id || '';
    const cartaoNome = allCartoes[0]?.nome || 'Cartão';
    
    return `
      <div class="transaction-item" style="cursor:pointer; padding:16px; border-radius:12px; ${borderStyle} transition: background 0.2s; align-items: flex-start;" onclick="abrirModalFatura(${mes})" onmouseover="this.style.background='rgba(255,255,255,0.03)'" onmouseout="this.style.background='${isCurrentUi ? 'rgba(59, 130, 246, 0.05)' : 'transparent'}'">
        <div class="transaction-info" style="flex:1">
          <div class="transaction-desc" style="font-weight:700; font-size:1.1rem; display: flex; align-items: center; margin-bottom: 6px;">
            Fatura de ${nomeMes[mes]} ${currentBadge}
          </div>
          <div class="transaction-meta" style="color:var(--text-muted); font-size:0.85rem; display: flex; align-items: center; gap: 8px;">
            <span>${startStr} a ${endStr}</span>
            <span style="opacity: 0.5">•</span>
            <span>Vence: <strong style="color:var(--text-secondary)">${dueStr.slice(0,5)}</strong></span>
          </div>
        </div>
        <div style="display:flex; flex-direction:column; align-items:flex-end; justify-content:flex-start; gap:8px" onclick="event.stopPropagation()">
          <div class="transaction-amount expense" style="font-size:1.1rem; font-weight:700; color: ${valueColor};">
            ${formatCurrency(total)}
          </div>
          ${isPaid ? `
            <span class="badge badge-green" style="padding: 4px 10px;">Pago</span>
          ` : ((window._currentSaldo || 0) >= total ? `
            <button class="btn btn-sm" style="padding:6px 12px; font-size:0.75rem; background:rgba(59,130,246,0.1); color:#60A5FA; border:1px solid rgba(59,130,246,0.3); font-weight: 600;" onclick="pagarFatura('${cartaoId}', ${total}, '${cartaoNome}', ${mes})">Pagar Fatura</button>
          ` : `
            <button class="btn btn-sm" style="padding:6px 12px; font-size:0.75rem; background:rgba(255,255,255,0.05); color:var(--text-muted); border:1px solid rgba(255,255,255,0.1); font-weight: 600; cursor:not-allowed;" title="Saldo insuficiente" onclick="showToast('Saldo insuficiente. Você tem ' + formatCurrency(window._currentSaldo || 0) + '.', 'error')">Pagar Fatura</button>
          `)}
        </div>
      </div>
    `;
  }).join('');
}

window.abrirModalFatura = function(mes) {
  const nomeMes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const modal = document.getElementById('modal-fatura');
  const title = document.getElementById('fatura-modal-title');
  const list = document.getElementById('fatura-modal-list');
  const totalEl = document.getElementById('fatura-modal-total');
  
  const lancs = window._faturasCurrentYear[mes] || [];
  
  title.textContent = `Fatura de ${nomeMes[mes]}`;
  
  if (lancs.length === 0) {
    list.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:20px 0">Nenhuma despesa.</div>`;
    totalEl.textContent = 'R$ 0,00';
  } else {
    // Ordenar pela data
    const sorted = [...lancs].sort((a,b) => {
       const da = a.data.toDate ? a.data.toDate() : new Date(a.data);
       const db = b.data.toDate ? b.data.toDate() : new Date(b.data);
       return db - da;
    });
    
    const total = sorted.reduce((s,l) => s + l.valor, 0);
    totalEl.textContent = formatCurrency(total);
    
    list.innerHTML = sorted.map(l => {
      const d = l.data.toDate ? l.data.toDate() : new Date(l.data);
      const dataStr = d.toLocaleDateString('pt-BR', {day:'2-digit', month:'2-digit'});
      const cat = getCategoriaById(l.categoria);
      
      return `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px; border-bottom:1px solid rgba(255,255,255,0.05); border-radius:6px; background:rgba(255,255,255,0.02)">
          <div style="display:flex; align-items:center; gap:10px; overflow:hidden">
            <span style="font-size:1.2rem">${cat.icon}</span>
            <div style="display:flex; flex-direction:column; overflow:hidden">
               <span style="font-size:0.9rem; font-weight:500; white-space:nowrap; text-overflow:ellipsis; overflow:hidden">${l.descricao}</span>
               <span style="font-size:0.75rem; color:var(--text-muted)">${dataStr}</span>
            </div>
          </div>
          <div style="font-family:monospace; font-weight:600; color:var(--danger-color)">
            ${formatCurrency(l.valor)}
          </div>
        </div>
      `;
    }).join('');
  }
  
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

window.pagarFatura = async function(cartaoId, total, cartaoNome, mes) {
  if (!confirm(`Deseja gerar o pagamento da fatura do ${cartaoNome} no valor de ${formatCurrency(total)}?`)) return;
  
  const { end } = getBillingDateRange(currentYear, mes, ciclosMap);
  const dataPagamento = end.toISOString().split('T')[0];
  
  try {
    const { addLancamento } = await import('./db.js');
    await addLancamento(currentUser.uid, {
      descricao: `Pagamento Fatura ${cartaoNome}`,
      valor: total,
      data: dataPagamento,
      cartaoId: cartaoId,
      categoria: 'outros', // Or 'casal' if you prefer, but 'outros' is standard
      local: '',
      observacao: 'Gerado automaticamente pelo sistema.',
      tipo: 'despesa',
      formaPagamento: 'pix',
      parcelado: false,
      totalParcelas: 1,
      parcelaInicial: 1,
      pago: true
    }, ciclosMap);
    showToast('Pagamento da fatura gerado com sucesso!', 'success');
    loadData();
  } catch (err) {
    console.error(err);
    showToast('Erro ao pagar fatura', 'error');
  }
}

// ── Render Category Chart ──
function renderCategoryChart() {
  const chartSelect = document.getElementById('chart-month-select');
  const nomeMes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  
  // Initialize select if empty
  if (chartSelect && chartSelect.options.length === 0 && window._faturasCurrentYear) {
    const meses = Object.keys(window._faturasCurrentYear).map(m => parseInt(m)).sort((a,b) => a - b);
    chartSelect.innerHTML = meses.map(m => `<option value="${m}">Fatura de ${nomeMes[m]}</option>`).join('');
    
    // Select current invoice by default
    const today = new Date();
    const todayBilling = findBillingMonthForDate(today, ciclosMap);
    if (meses.includes(todayBilling.month)) {
      chartSelect.value = todayBilling.month;
    }
    
    // Listen for changes
    chartSelect.addEventListener('change', () => renderCategoryChart());
  }

  const selectedMonth = chartSelect && chartSelect.value ? parseInt(chartSelect.value) : -1;
  const sourceArray = (window._faturasCurrentYear && window._faturasCurrentYear[selectedMonth]) ? window._faturasCurrentYear[selectedMonth] : [];
  const despesas = sourceArray.filter(l => l.tipo === 'despesa' && l.status !== 'cancelado');
  const catTotals = {};

  despesas.forEach(l => {
    catTotals[l.categoria] = (catTotals[l.categoria] || 0) + l.valor;
  });

  const entries = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);

  const chartEmpty = document.getElementById('chart-empty');
  const canvas = document.getElementById('category-chart');

  if (entries.length === 0) {
    canvas.style.display = 'none';
    chartEmpty.style.display = 'flex';
    document.getElementById('category-legend').innerHTML = '';
    return;
  }

  canvas.style.display = 'block';
  chartEmpty.style.display = 'none';

  const labels = entries.map(([id]) => getCategoriaById(id).label);
  const values = entries.map(([, v]) => v);
  const colors = entries.map(([id]) => getCategoriaById(id).color);

  if (categoryChartInstance) categoryChartInstance.destroy();

  categoryChartInstance = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors.map(c => c + 'CC'),
        borderColor: colors,
        borderWidth: 2,
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '65%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${formatCurrency(ctx.parsed)}`
          }
        }
      }
    }
  });

  // Legend
  const totalDespesas = values.reduce((a, b) => a + b, 0);
  document.getElementById('category-legend').innerHTML = entries.slice(0, 6).map(([id, v]) => {
    const cat = getCategoriaById(id);
    const pct = ((v / totalDespesas) * 100).toFixed(0);
    return `
      <div class="chart-legend-item">
        <div class="chart-legend-label">
          <div class="chart-legend-dot" style="background:${cat.color}"></div>
          <span>${cat.icon} ${cat.label}</span>
        </div>
        <div>
          <span class="chart-legend-value">${formatCurrency(v)}</span>
          <span style="color:var(--text-muted);font-size:0.72rem;margin-left:4px">${pct}%</span>
        </div>
      </div>
    `;
  }).join('');
}

// ── Render Cartoes Summary ──
function renderCartoesSum() {
  if (allCartoes.length === 0) {
    cartoesSum.style.display = 'none';
    cartoesEmpty.style.display = 'flex';
    return;
  }

  cartoesSum.style.display = 'flex';
  cartoesEmpty.style.display = 'none';

  cartoesSum.innerHTML = allCartoes.map(cartao => {
    const gastos = lancamentos
      .filter(l => l.cartaoId === cartao.id && l.tipo === 'despesa' && (l.formaPagamento === 'credito' || l.formaPagamento === 'cartao_credito'))
      .reduce((s, l) => s + l.valor, 0);

    return `
      <div class="transaction-item">
        <div class="transaction-icon" style="background:${cartao.cor?.split(',')[1]?.replace(')', '') || '#7C3AED'}22;font-size:1.2rem">
          💳
        </div>
        <div class="transaction-info">
          <div class="transaction-desc">${cartao.nome}</div>
          <div class="transaction-meta">
            <span class="transaction-date">${cartao.bandeira || ''}</span>
          </div>
        </div>
        <div class="transaction-amount expense">${formatCurrency(gastos)}</div>
      </div>
    `;
  }).join('');
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

// ── Lógica Modal Pagar Boleto ──
window.openModalPagarBoleto = function(id) {
  const modal = document.getElementById('modal-pagar-boleto');
  const inputId = document.getElementById('pagar-boleto-id');
  const radios = document.querySelectorAll('input[name="pagar-boleto-forma"]');
  const groupCartao = document.getElementById('pagar-boleto-cartao-group');
  const selectCartao = document.getElementById('pagar-boleto-cartao');
  const dataInput = document.getElementById('pagar-boleto-data');
  const valorInput = document.getElementById('pagar-boleto-valor');
  
  inputId.value = id;
  
  // Preencher valor original
  const boleto = allLancamentosGlob.find(l => l.id === id);
  if (boleto && valorInput) {
    valorInput.value = boleto.valor;
  }
  if (dataInput) {
    const today = new Date();
    // Ajuste fuso horário simples
    const local = new Date(today.getTime() - (today.getTimezoneOffset() * 60000));
    dataInput.value = local.toISOString().split('T')[0];
  }
  
  radios.forEach(r => {
    if (r.value === 'pix') r.checked = true;
  });
  groupCartao.style.display = 'none';
  
  selectCartao.innerHTML = '<option value="" disabled selected>Selecione um cartão</option>';
  allCartoes.forEach(c => {
    selectCartao.innerHTML += `<option value="${c.id}">${c.nome}</option>`;
  });
  
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
};

window.initModalPagarBoleto = function() {
  const modal = document.getElementById('modal-pagar-boleto');
  const radios = document.querySelectorAll('input[name="pagar-boleto-forma"]');
  const groupCartao = document.getElementById('pagar-boleto-cartao-group');
  const selectCartao = document.getElementById('pagar-boleto-cartao');
  const form = document.getElementById('form-pagar-boleto');
  const dataInput = document.getElementById('pagar-boleto-data');
  
  if (!modal) return;
  
  const closeModal = () => {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  };
  
  document.getElementById('pagar-boleto-close').addEventListener('click', closeModal);
  document.getElementById('pagar-boleto-cancel').addEventListener('click', closeModal);
  modal.addEventListener('click', e => {
    if (e.target === modal) closeModal();
  });
  
  radios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.checked && radio.value === 'credito') {
        groupCartao.style.display = 'block';
        selectCartao.setAttribute('required', 'true');
      } else if (radio.checked) {
        groupCartao.style.display = 'none';
        selectCartao.removeAttribute('required');
        selectCartao.value = '';
      }
    });
  });
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const originalText = btn.textContent;
    btn.textContent = 'Pagando...';
    btn.disabled = true;
    
    try {
      const id = document.getElementById('pagar-boleto-id').value;
      const checkedRadio = document.querySelector('input[name="pagar-boleto-forma"]:checked');
      const forma = checkedRadio ? checkedRadio.value : 'pix';
      const cartaoId = selectCartao.value;
      const valorInput = document.getElementById('pagar-boleto-valor');
      
      const novoValor = valorInput && valorInput.value ? parseFloat(valorInput.value) : null;
      
      const updateData = {
        pago: true,
        formaPagamento: forma
      };
      
      if (novoValor !== null && !isNaN(novoValor)) {
         const boletoOriginal = allLancamentosGlob.find(l => l.id === id);
         if (boletoOriginal && novoValor !== boletoOriginal.valor) {
            updateData.valor = novoValor;
            updateData.valorOriginal = boletoOriginal.valor;
            updateData.taxa = novoValor - boletoOriginal.valor;
         }
      }
      
      if (dataInput && dataInput.value) {
        // Converte a string YYYY-MM-DD para Date (meio-dia para evitar fuso)
        updateData.data = new Date(dataInput.value + 'T12:00:00');
      }
      
      if (forma === 'credito') {
        updateData.cartaoId = cartaoId;
      }
      
      await updateLancamento(currentUser.uid, id, updateData);
      showToast('Boleto pago com sucesso!', 'success');
      closeModal();
      await loadData(); // Reload UI
    } catch (err) {
      console.error(err);
      showToast('Erro ao pagar boleto.', 'error');
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  });
};
