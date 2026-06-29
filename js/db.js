// db.js — Firestore CRUD operations
import { db } from './firebase-config.js';
import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  getDocs, getDoc, query, where, orderBy, writeBatch, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function userRef(userId) {
  return doc(db, 'users', userId);
}

function cartoesRef(userId) {
  return collection(db, 'users', userId, 'cartoes');
}

function lancamentosRef(userId) {
  return collection(db, 'users', userId, 'lancamentos');
}

// ─────────────────────────────────────────────
// CARTÕES
// ─────────────────────────────────────────────

export async function addCartao(userId, data) {
  return addDoc(cartoesRef(userId), {
    ...data,
    ativo: true,
    criadoEm: Timestamp.now()
  });
}

export async function getCartoes(userId) {
  const q = query(cartoesRef(userId), orderBy('criadoEm', 'asc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function updateCartao(userId, cartaoId, data) {
  return updateDoc(doc(cartoesRef(userId), cartaoId), data);
}

export async function deleteCartao(userId, cartaoId) {
  return deleteDoc(doc(cartoesRef(userId), cartaoId));
}

// ─────────────────────────────────────────────
// LANÇAMENTOS
// ─────────────────────────────────────────────

/**
 * Adiciona um lançamento.
 * Se parcelado, cria N registros (um por parcela), cada um com a data correta do mês.
 * 
 * @param {string} userId
 * @param {object} formData - dados do formulário
 */
export async function addLancamento(userId, formData, ciclosMap = {}) {
  if (formData.formaPagamento && formData.formaPagamento !== 'credito' && formData.formaPagamento !== 'cartao_credito') {
    formData.cartaoId = '';
  }
  const { parcelado, totalParcelas } = formData;

  if (parcelado && totalParcelas > 1) {
    return _addParcelasComGrupo(userId, formData, ciclosMap);
  } else {
    const {
      descricao, valor, data, cartaoId, categoria, local,
      observacao, tipo, formaPagamento, parcelaInicial
    } = formData;
    return addDoc(lancamentosRef(userId), {
      descricao,
      valor:          parseFloat(valor),
      valorTotal:     parseFloat(valor),
      data:           Timestamp.fromDate(new Date(data + 'T12:00:00')),
      cartaoId:       cartaoId || '',
      categoria:      categoria || 'outros',
      local:          local || '',
      observacao:     observacao || '',
      tipo:           tipo || 'despesa',
      formaPagamento: formaPagamento || 'credito',
      status:         'ativo',
      pago:           formData.pago !== undefined ? Boolean(formData.pago) : true,
      parcelado:      false,
      totalParcelas:  1,
      parcelaAtual:   1,
      parcelaInicial: 1,
      grupoParcelaId: null,
      criadoEm:       Timestamp.now()
    });
  }
}

/**
 * Determina o mês de faturamento (year, month 0-indexed) em que uma data cai.
 * Regra: se a data <= fechamento do mês calendário, pertence a esse mês.
 *        se a data > fechamento do mês calendário, pertence ao mês seguinte.
 * Se não houver ciclo configurado, usa o mês calendário da data.
 */
export function findBillingMonthForDate(date, ciclosMap) {
  const year  = date.getFullYear();
  const month = date.getMonth();

  // Try the current calendar month's billing cycle
  const curCycle = getBillingDateRange(year, month, ciclosMap);
  if (date >= curCycle.start && date <= curCycle.end) {
    return { year, month };
  }

  // If before start, it belongs to the previous month
  if (date < curCycle.start) {
    return month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 };
  }

  // If after end, it belongs to the next month
  return month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 };
}

/**
 * Cria N registros de parcela, cada um com a data de fechamento do respectivo
 * mês de faturamento (ou +N meses na data base, como fallback).
 */
async function _addParcelasComGrupo(userId, formData, ciclosMap = {}) {
  const {
    descricao, valor, data, cartaoId, categoria, local,
    observacao, tipo, formaPagamento, totalParcelas, parcelaInicial
  } = formData;

  const valorParcela   = parseFloat(valor);
  const valorTotal     = parseFloat((valor * totalParcelas).toFixed(2));
  const baseDate       = new Date(data + 'T12:00:00');
  const grupoParcelaId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const batch          = writeBatch(db);

  // Billing month where parcelaInicial lands
  const startBilling = findBillingMonthForDate(baseDate, ciclosMap);

  for (let i = parcelaInicial - 1; i < totalParcelas; i++) {
    const offset = i - (parcelaInicial - 1); // 0 for first parcela

    // Advance billing month by offset
    let bMonth = startBilling.month + offset;
    let bYear  = startBilling.year;
    while (bMonth > 11) { bMonth -= 12; bYear++; }

    // Use closing date of that billing month, or fall back to +offset months
    const mesKey = `${bYear}-${String(bMonth + 1).padStart(2, '0')}`;
    const ciclo  = ciclosMap[mesKey];

    let dataLancamento;
    if (formaPagamento === 'credito' || formaPagamento === 'cartao_credito') {
      if (ciclo?.fechamento) {
        dataLancamento = new Date(ciclo.fechamento + 'T12:00:00');
        // Subtrai 1 dia para que a data caia dentro do ciclo (o dia do fechamento já é o 1º dia do ciclo seguinte)
        dataLancamento.setDate(dataLancamento.getDate() - 1);
      } else {
        // Fallback: same day-of-month as base date, just advance months
        dataLancamento = new Date(baseDate);
        dataLancamento.setMonth(baseDate.getMonth() + offset);
      }
    } else {
      // Para Boletos, Pix, etc: simplesmente avança os meses mantendo o mesmo dia do mês.
      dataLancamento = new Date(baseDate);
      dataLancamento.setMonth(baseDate.getMonth() + offset);
    }

    const ref = doc(lancamentosRef(userId));
    batch.set(ref, {
      descricao,
      valor:          valorParcela,
      valorTotal:     valorTotal,
      data:           Timestamp.fromDate(dataLancamento),
      cartaoId:       cartaoId || '',
      categoria:      categoria || 'outros',
      local:          local || '',
      observacao:     observacao || '',
      tipo:           tipo || 'despesa',
      formaPagamento: formaPagamento || 'credito',
      status:         'ativo',
      pago:           i === (parcelaInicial - 1) ? (formData.pago !== undefined ? Boolean(formData.pago) : true) : false,
      parcelado:      true,
      totalParcelas:  parseInt(totalParcelas),
      parcelaAtual:   i + 1,
      parcelaInicial: parseInt(parcelaInicial),
      grupoParcelaId,
      criadoEm:       Timestamp.now()
    });
  }

  return batch.commit();
}

/**
 * Busca lançamentos de um mês específico.
 */
export async function getLancamentosByMonth(userId, year, month) {
  const start = new Date(year, month, 1, 0, 0, 0);
  const end   = new Date(year, month + 1, 0, 23, 59, 59);

  const q = query(
    lancamentosRef(userId),
    where('data', '>=', Timestamp.fromDate(start)),
    where('data', '<=', Timestamp.fromDate(end)),
    orderBy('data', 'desc')
  );

  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Busca TODOS os lançamentos do usuário (para resumo geral).
 */
export async function getAllLancamentos(userId) {
  const q = query(lancamentosRef(userId), orderBy('data', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function updateLancamento(userId, lancId, data) {
  if (data.formaPagamento && data.formaPagamento !== 'credito' && data.formaPagamento !== 'cartao_credito') {
    data.cartaoId = '';
  }
  return updateDoc(doc(lancamentosRef(userId), lancId), data);
}

export async function deleteLancamento(userId, lancId) {
  return deleteDoc(doc(lancamentosRef(userId), lancId));
}

export async function deleteGrupoParcelas(userId, grupoParcelaId) {
  const q = query(
    lancamentosRef(userId),
    where('grupoParcelaId', '==', grupoParcelaId)
  );
  const snap = await getDocs(q);
  const batch = writeBatch(db);
  snap.docs.forEach(d => batch.delete(d.ref));
  return batch.commit();
}

/**
 * Atualiza campos em comum de todos os lançamentos do mesmo grupo de parcelas,
 * sem alterar a data específica de cada parcela.
 */
export async function updateGrupoParcelasFields(userId, grupoParcelaId, dataToUpdate) {
  const q = query(
    lancamentosRef(userId),
    where('grupoParcelaId', '==', grupoParcelaId)
  );
  const snap = await getDocs(q);
  const batch = writeBatch(db);
  
  // Excluir campos que não devem ser replicados
  const payload = { ...dataToUpdate };
  delete payload.data;
  delete payload.parcelaAtual;
  delete payload.parcelaInicial;

  snap.docs.forEach(d => batch.update(d.ref, payload));
  return batch.commit();
}

// ─────────────────────────────────────────────
// CICLOS DE FATURAMENTO
// ─────────────────────────────────────────────

function ciclosRef(userId) {
  return collection(db, 'users', userId, 'ciclosFaturamento');
}

/**
 * Salva (cria ou atualiza) o ciclo de um mês.
 * @param {string} userId
 * @param {string} mesKey - formato 'YYYY-MM'
 * @param {{ fechamento: string, vencimento: string }} data - datas em formato 'YYYY-MM-DD'
 */
export async function saveCiclo(userId, mesKey, data) {
  const ref = doc(ciclosRef(userId), mesKey);
  const payload = { updatedAt: Timestamp.now() };
  if (data.fechamento !== undefined) payload.fechamento = data.fechamento || null;
  if (data.vencimento !== undefined) payload.vencimento = data.vencimento || null;
  if (data.limiteGasto !== undefined) payload.limiteGasto = data.limiteGasto;

  return updateDoc(ref, payload).catch(() => {
    // doc doesn't exist yet — create it
    const newDoc = { mesKey, ...payload };
    if (newDoc.fechamento === undefined) newDoc.fechamento = null;
    if (newDoc.vencimento === undefined) newDoc.vencimento = null;
    return addDoc(collection(db, 'users', userId, 'ciclosFaturamento'), newDoc);
  });
}

export async function getCiclosMap(userId) {
  const snap = await getDocs(ciclosRef(userId));
  const map = {};
  snap.docs.forEach(d => {
    const data = d.data();
    // doc id is the mesKey OR stored inside as mesKey field
    const key = d.id.match(/^\d{4}-\d{2}$/) ? d.id : data.mesKey;
    if (key) {
      map[key] = {
        fechamento: data.fechamento || null,
        vencimento: data.vencimento || null,
        limiteGasto: data.limiteGasto,
        isDefault: false
      };
    }
  });

  return new Proxy(map, {
    get(target, prop) {
      if (typeof prop === 'string' && /^\d{4}-\d{2}$/.test(prop)) {
        if (!target[prop] || (!target[prop].fechamento && !target[prop].vencimento)) {
          const [yStr, mStr] = prop.split('-');
          let y = parseInt(yStr);
          let m = parseInt(mStr); // 1-12
          
          let nextM = m + 1;
          let nextY = y;
          if (nextM > 12) { nextM = 1; nextY++; }
          
          return {
            fechamento: `${prop}-27`,
            vencimento: `${nextY}-${String(nextM).padStart(2, '0')}-04`,
            limiteGasto: 3000,
            isDefault: true
          };
        }
        return target[prop];
      }
      return target[prop];
    }
  });
}

/**
 * Salva ciclo usando o ID do documento como mesKey (mais eficiente).
 */
export async function saveCicloById(userId, mesKey, data) {
  const { fechamento, vencimento, limiteGasto } = data;
  // 1. Get old closing date
  let oldFechamento = null;
  try {
    const oldDoc = await getDoc(doc(db, 'users', userId, 'ciclosFaturamento', mesKey));
    if (oldDoc.exists() && oldDoc.data().fechamento) {
      oldFechamento = oldDoc.data().fechamento;
    } else {
      oldFechamento = `${mesKey}-27`; // default
    }
  } catch (e) {
    oldFechamento = `${mesKey}-27`;
  }

  // 2. Save new cycle
  const ref = doc(db, 'users', userId, 'ciclosFaturamento', mesKey);
  const payload = { updatedAt: Timestamp.now() };
  if (fechamento !== undefined) payload.fechamento = fechamento;
  if (vencimento !== undefined) payload.vencimento = vencimento;
  if (limiteGasto !== undefined) payload.limiteGasto = limiteGasto;

  await updateDoc(ref, payload)
    .catch(() => setDoc(ref, { mesKey, ...payload }));

  // 3. Update existing installments if closing date changed
  if (fechamento && oldFechamento !== fechamento) {
    const oldTimestamp = Timestamp.fromDate(new Date(oldFechamento + 'T12:00:00'));
    const newTimestamp = Timestamp.fromDate(new Date(fechamento + 'T12:00:00'));
    
    const q = query(
      lancamentosRef(userId),
      where('parcelado', '==', true),
      where('data', '==', oldTimestamp)
    );
    
    const snap = await getDocs(q);
    if (!snap.empty) {
      const batch = writeBatch(db);
      snap.docs.forEach(d => {
        batch.update(d.ref, { data: newTimestamp });
      });
      await batch.commit();
    }
  }
}

/**
 * Calcula o intervalo de datas de faturamento para um dado mês,
 * usando os ciclos configurados.
 *
 * Regra: início = fechamento do mês anterior + 1 dia
 *        fim    = fechamento do mês atual
 * Se não configurado, usa o mês calendário (1º ao último dia).
 *
 * @param {number} year
 * @param {number} month - 0-indexed
 * @param {object} ciclosMap - { 'YYYY-MM': { fechamento, vencimento } }
 * @returns {{ start: Date, end: Date, fromCiclo: boolean }}
 */
export function getBillingDateRange(year, month, ciclosMap = {}) {
  const pad = n => String(n).padStart(2, '0');
  const curKey  = `${year}-${pad(month + 1)}`;
  const prevYear  = month === 0 ? year - 1 : year;
  const prevMonth = month === 0 ? 11 : month - 1;
  const prevKey = `${prevYear}-${pad(prevMonth + 1)}`;

  const cur  = ciclosMap[curKey];
  const prev = ciclosMap[prevKey];

  let start, end, fromCiclo = false;

  // Fim = fechamento do mês atual - 1 dia
  if (cur?.fechamento) {
    end = new Date(cur.fechamento + 'T23:59:59');
    end.setDate(end.getDate() - 1); // -1 dia
    fromCiclo = true;
  } else {
    end = new Date(year, month + 1, 0, 23, 59, 59); // último dia do mês
  }

  // Início = fechamento do mês anterior (inclusive, mesmo dia)
  if (prev?.fechamento) {
    start = new Date(prev.fechamento + 'T00:00:00');
    fromCiclo = true;
  } else {
    start = new Date(year, month, 1, 0, 0, 0); // primeiro dia do mês
  }

  return { start, end, fromCiclo };
}

/**
 * Busca lançamentos pelo intervalo de datas de faturamento.
 */
export async function getLancamentosByDateRange(userId, start, end) {
  const q = query(
    lancamentosRef(userId),
    where('data', '>=', Timestamp.fromDate(start)),
    where('data', '<=', Timestamp.fromDate(end)),
    orderBy('data', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ─────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────

export function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value || 0);
}

export function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString('pt-BR');
}

export function formatMonth(year, month) {
  const months = [
    'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
    'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'
  ];
  return `${months[month]} ${year}`;
}

export const CATEGORIAS = [
  { id: 'alimentacao',   label: 'Alimentação',   icon: '🍔', color: '#F59E0B' },
  { id: 'lanches',       label: 'Lanches',       icon: '🌭', color: '#FB923C' },
  { id: 'transporte',    label: 'Transporte',     icon: '🚗', color: '#3B82F6' },
  { id: 'lazer',         label: 'Lazer',          icon: '🎮', color: '#8B5CF6' },
  { id: 'saude',         label: 'Saúde',          icon: '🏥', color: '#10B981' },
  { id: 'assinaturas',   label: 'Assinaturas',    icon: '📺', color: '#EC4899' },
  { id: 'compras',       label: 'Compras',        icon: '🛍️', color: '#F97316' },
  { id: 'moradia',       label: 'Moradia',        icon: '🏠', color: '#06B6D4' },
  { id: 'educacao',      label: 'Educação',       icon: '📚', color: '#6366F1' },
  { id: 'viagem',        label: 'Viagem',         icon: '✈️', color: '#14B8A6' },
  { id: 'pets',          label: 'Pets',           icon: '🐾', color: '#84CC16' },
  { id: 'beleza',        label: 'Beleza',         icon: '💅', color: '#F43F5E' },
  { id: 'casal',         label: 'Casal',          icon: '💑', color: '#F472B6' },
  { id: 'outros',        label: 'Outros',         icon: '📦', color: '#94A3B8' },
];

export const BANDEIRAS = ['Visa', 'Mastercard', 'Elo', 'Amex', 'Hipercard', 'Outro'];

export const CORES_CARTAO = [
  { label: 'Roxo',    value: 'linear-gradient(135deg, #7C3AED, #5B21B6)' },
  { label: 'Azul',    value: 'linear-gradient(135deg, #2563EB, #1D4ED8)' },
  { label: 'Verde',   value: 'linear-gradient(135deg, #059669, #047857)' },
  { label: 'Preto',   value: 'linear-gradient(135deg, #1F2937, #111827)' },
  { label: 'Rosa',    value: 'linear-gradient(135deg, #DB2777, #BE185D)' },
  { label: 'Laranja', value: 'linear-gradient(135deg, #EA580C, #C2410C)' },
  { label: 'Ciano',   value: 'linear-gradient(135deg, #0891B2, #0E7490)' },
  { label: 'Dourado', value: 'linear-gradient(135deg, #D97706, #B45309)' },
];

export function getCategoriaById(id) {
  return CATEGORIAS.find(c => c.id === id) || CATEGORIAS[CATEGORIAS.length - 1];
}
