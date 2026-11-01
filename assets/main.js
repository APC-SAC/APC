import { createClient } from '@supabase/supabase-js';

const cfg = window.APC_CONFIG || {};
const BASE = cfg.BASE_URL || '/APC/';
const supabase = cfg.VITE_SUPABASE_URL && cfg.VITE_SUPABASE_PUBLISHABLE_KEY
  ? createClient(cfg.VITE_SUPABASE_URL, cfg.VITE_SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 5 } }
    })
  : null;

const ROOT = document.getElementById('root');
const TOKEN_KEY = 'apc_inventory_qr_tokens_v7';
const CACHE_KEY = 'apc_inventory_stock_v7';
const CONTAINERS_CACHE_KEY = 'apc_inventory_containers_v7';
const QUEUE_KEY = 'apc_inventory_pending_v7';
const MAX_QTY = 100000;
const DB_KEYS = ['taper_rey', 'taper_gyg', 'tapas', 'tenedores'];
const ITEM_DEFS = [
  { key: 'taper_rey', dbKey: 'taper_rey', brand: 'REY', label: 'Tápers Rey', short: 'Rey', image: 'https://www.plasticosrey.com/wp-content/uploads/2023/05/1563468038_2dca2a147e4758df6523c78be8b65869.22714-1.jpeg', alt: 'Táper de la marca Rey', group: 'taper' },
  { key: 'taper_gyg', dbKey: 'taper_gyg', brand: 'GyG', label: 'Tápers GyG', short: 'GyG', image: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRTmxjd8ING676s8rUTmxjQJe_pm5mqWhdSIXfzN1Nk254jaxosI79RhFsd&s=10', alt: 'Táper de la marca GyG', group: 'taper' },
  { key: 'tapas_rey', dbKey: 'tapas', brand: 'REY', label: 'Tapas Rey', short: 'Rey', image: `${BASE}assets/images/tapas-rey.jpg`, alt: 'Tapa Rey con borde azul', group: 'tapa' },
  { key: 'tapas_gyg', dbKey: 'tapas', brand: 'GyG', label: 'Tapas GyG', short: 'GyG', image: 'https://www.mallplast.pe/image/cache/catalog/mall/Basa/Cocina/taper-gyg-fr-1-1-l-reconectando-c-3-divisiones-600x315w.jpg', alt: 'Tapa de la marca GyG', group: 'tapa' },
  { key: 'tenedores', dbKey: 'tenedores', brand: 'APC', label: 'Tenedores', short: 'Tenedores', image: 'https://record.com.pe/cdn/shop/files/Tenedores_4-1.jpg?v=1753504444&width=1946', alt: 'Tenedores', group: 'otros' }
];
const DEFAULT_CREATE_KEYS = ['taper_rey', 'taper_gyg'];
const PROTOCOL = [
  'Brillith es responsable de la entrega y rotación de tápers.',
  'Jonathan recibe el transportado saliente y retorna tápers y tenedores.',
  'Raúl recepciona las cantidades retornadas y cuenta con apoyo de Cinthya.',
  'Al finalizar el lavado, Raúl informa las cantidades contadas a Brillith.',
  'Brillith comunica el stock final del día.',
  'Está prohibido tomar tápers para uso personal o salidas no autorizadas.'
];

const params = new URLSearchParams(location.search);
const initialContainerId = params.get('c') || '';
const initialToken = params.get('k') || '';
const state = {
  page: initialContainerId && initialToken ? 'containers' : 'home',
  qrMode: Boolean(initialContainerId && initialToken),
  qrContainerId: initialContainerId,
  menuOpen: false,
  loading: true,
  online: navigator.onLine,
  syncing: false,
  containers: [],
  inventory: readJSON(CACHE_KEY, []),
  movements: [],
  selectedContainer: initialContainerId || '',
  showEditor: Boolean(initialContainerId && initialToken),
  drafts: {},
  pending: readJSON(QUEUE_KEY, []),
  createName: '',
  createDescription: '',
  createKeys: [...DEFAULT_CREATE_KEYS],
  editContainerId: '',
  editName: '',
  editDescription: '',
  editKeys: [],
  qrPreview: null,
  toast: null,
  saving: false
};

function readJSON(key, fallback) {
  try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return value ?? fallback; }
  catch { return fallback; }
}
function writeJSON(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function formatNumber(value) { return new Intl.NumberFormat('es-PE').format(Number(value) || 0); }
function formatDate(value = new Date()) { return new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
function cleanText(value, max = 100) { return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
function getTokens() { return readJSON(TOKEN_KEY, {}); }
function getToken(containerId) { return getTokens()[containerId] || ''; }
function saveToken(containerId, token) { const tokens = getTokens(); tokens[containerId] = token; writeJSON(TOKEN_KEY, tokens); }
function notify(message, type = 'success') {
  state.toast = { message, type };
  render();
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => { state.toast = null; render(); }, 3600);
}
function getDbQuantity(containerId, itemKey) {
  const row = state.inventory.find(item => item.container_id === containerId && item.item_key === itemKey);
  return Number(row?.quantity || 0);
}
function parseMeta(container) {
  const raw = String(container?.description || '');
  const match = raw.match(/^\[\[APC_V7;([^\]]*)\]\]\s*/);
  if (!match) return { hasMeta: false, description: raw, keys: null, tapasRey: 0, tapasGyG: null };
  const fields = {};
  match[1].split(';').forEach(part => {
    const index = part.indexOf('=');
    if (index > 0) fields[part.slice(0, index)] = part.slice(index + 1);
  });
  const allowed = new Set(ITEM_DEFS.map(item => item.key));
  const keys = String(fields.items || '').split(',').filter(key => allowed.has(key));
  const rey = Math.max(0, Number.parseInt(fields.tapas_rey || '0', 10) || 0);
  const gyG = fields.tapas_gyg == null ? null : Math.max(0, Number.parseInt(fields.tapas_gyg, 10) || 0);
  return { hasMeta: true, description: raw.slice(match[0].length).trim(), keys, tapasRey: rey, tapasGyG: gyG };
}
function packDescription(description, keys, tapasRey = 0, tapasGyG = 0) {
  const safeKeys = [...new Set(keys)].filter(key => ITEM_DEFS.some(item => item.key === key));
  const marker = `[[APC_V7;items=${safeKeys.join(',')};tapas_rey=${Math.max(0, Number(tapasRey) || 0)};tapas_gyg=${Math.max(0, Number(tapasGyG) || 0)}]]`;
  const clean = cleanText(description, 350);
  return `${marker}${clean ? ` ${clean}` : ''}`;
}
function legacyKeys(container) {
  const kind = container.kind || (String(container.id || '').startsWith('tacho-') ? 'tacho' : String(container.id || '').startsWith('caja-') ? 'caja' : 'otro');
  const group = container.item_group || 'tapers';
  if (kind === 'caja') return ['taper_rey', 'taper_gyg'];
  if (kind === 'tacho') {
    if (group === 'tenedores') return ['tenedores'];
    if (group === 'mixto') return ['tapas_rey', 'tapas_gyg', 'tenedores'];
    return ['tapas_rey', 'tapas_gyg'];
  }
  if (group === 'tenedores') return ['tenedores'];
  if (group === 'mixto') return ['tapas_rey', 'tapas_gyg', 'tenedores'];
  return ['taper_rey', 'taper_gyg'];
}
function visibleKeys(container) {
  if (!container) return [];
  const meta = parseMeta(container);
  return meta.hasMeta ? meta.keys : legacyKeys(container);
}
function logicalQuantity(container, key) {
  if (!container) return 0;
  if (key === 'tapas_rey' || key === 'tapas_gyg') {
    const total = getDbQuantity(container.id, 'tapas');
    const meta = parseMeta(container);
    if (!meta.hasMeta) return key === 'tapas_gyg' ? total : 0;
    const rey = Math.min(total, meta.tapasRey);
    return key === 'tapas_rey' ? rey : Math.max(0, total - rey);
  }
  return getDbQuantity(container.id, key);
}
function getItem(key) { return ITEM_DEFS.find(item => item.key === key); }
function contentsLabel(container) {
  const keys = visibleKeys(container);
  if (!keys.length) return 'Sin suministros asignados';
  const labels = keys.map(key => getItem(key)?.label).filter(Boolean);
  if (keys.includes('taper_rey') && keys.includes('taper_gyg')) return labels.length > 2 ? 'Tápers Rey y GyG · ' + labels.filter(label => !label.startsWith('Tápers')).join(' · ') : 'Tápers Rey y GyG';
  return labels.join(' · ');
}
function containerTotal(container) { return visibleKeys(container).reduce((sum, key) => sum + logicalQuantity(container, key), 0); }
function aggregateTotals() {
  const totals = Object.fromEntries(ITEM_DEFS.map(item => [item.key, 0]));
  state.containers.forEach(container => {
    visibleKeys(container).forEach(key => { totals[key] = (totals[key] || 0) + logicalQuantity(container, key); });
  });
  totals.totalTapers = totals.taper_rey + totals.taper_gyg;
  totals.totalTapas = totals.tapas_rey + totals.tapas_gyg;
  totals.totalUnits = totals.totalTapers + totals.totalTapas + totals.tenedores;
  return totals;
}
function getContainer(id) { return state.containers.find(container => container.id === id) || null; }
function getQrUrl(containerId, token) { return `${location.origin}${BASE}?c=${encodeURIComponent(containerId)}&k=${encodeURIComponent(token)}`; }
function firstRow(data) { return Array.isArray(data) ? (data[0] || {}) : (data || {}); }

async function loadContainers() {
  if (!supabase) return readJSON(CONTAINERS_CACHE_KEY, []);
  let result = await supabase.from('apci_containers').select('id,name,description,kind,item_group,sort_order,active,created_at').eq('active', true).order('sort_order').order('name');
  if (result.error && /item_group.*does not exist|column .*item_group/i.test(result.error.message || '')) {
    result = await supabase.from('apci_containers').select('id,name,description,kind,sort_order,active,created_at').eq('active', true).order('sort_order').order('name');
    if (!result.error) result.data = (result.data || []).map(item => ({ ...item, item_group: 'tapers' }));
  }
  if (result.error && /kind.*does not exist|column .*kind/i.test(result.error.message || '')) {
    result = await supabase.from('apci_containers').select('id,name,description,sort_order,active,created_at').eq('active', true).order('sort_order').order('name');
    if (!result.error) result.data = (result.data || []).map(item => ({ ...item, kind: item.id?.startsWith('tacho-') ? 'tacho' : item.id?.startsWith('caja-') ? 'caja' : 'otro', item_group: 'tapers' }));
  }
  if (result.error) {
    if (!navigator.onLine) return readJSON(CONTAINERS_CACHE_KEY, []);
    throw result.error;
  }
  const rows = (result.data || []).map(item => ({ ...item, kind: item.kind || (item.id?.startsWith('tacho-') ? 'tacho' : item.id?.startsWith('caja-') ? 'caja' : 'otro'), item_group: item.item_group || 'tapers' }));
  writeJSON(CONTAINERS_CACHE_KEY, rows);
  return rows;
}
async function loadInventory() {
  if (!supabase) return state.inventory;
  const { data, error } = await supabase.from('apci_inventory').select('id,container_id,item_key,quantity,updated_at').order('container_id').order('item_key');
  if (error) throw error;
  const rows = data || [];
  state.inventory = rows;
  writeJSON(CACHE_KEY, rows);
  return rows;
}
async function loadMovements() {
  if (!supabase) return [];
  const { data, error } = await supabase.from('apci_movements').select('id,container_id,item_key,delta,quantity_before,quantity_after,movement_type,note,created_at').order('created_at', { ascending: false }).limit(100);
  if (error) return [];
  return data || [];
}
function refreshDrafts() {
  const next = {};
  state.containers.forEach(container => {
    visibleKeys(container).forEach(key => { next[`${container.id}:${key}`] = String(logicalQuantity(container, key)); });
  });
  state.drafts = { ...next, ...state.drafts };
}
async function initialize() {
  state.loading = true;
  render();
  if (!supabase) {
    state.loading = false;
    notify('Falta la configuración de Supabase en index.html.', 'error');
    return;
  }
  try {
    const [containers, inventory] = await Promise.all([
      loadContainers(),
      loadInventory().catch(() => state.inventory)
    ]);
    state.containers = containers;
    state.inventory = inventory;
    state.movements = await loadMovements();
    if (state.qrMode && !containers.some(item => item.id === state.qrContainerId)) {
      state.qrMode = false;
      state.page = 'home';
      state.showEditor = false;
    }
    if (!state.selectedContainer || !containers.some(item => item.id === state.selectedContainer)) state.selectedContainer = containers[0]?.id || '';
    if (state.qrMode) state.selectedContainer = state.qrContainerId;
    refreshDrafts();
    state.loading = false;
    render();
    if (state.pending.length && navigator.onLine) syncPending();
  } catch (error) {
    state.loading = false;
    render();
    notify(error?.message || 'No se pudieron cargar los datos.', 'error');
  }
}

function itemImage(item, compact = false) {
  const fallback = `<span class="image-fallback" style="display:none">${escapeHtml(item.short.slice(0, 2).toUpperCase())}</span>`;
  return `<div class="product-image ${compact ? 'compact' : ''}"><img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.alt)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'">${fallback}</div>`;
}
function itemImages(key, compact = false) {
  const item = getItem(key);
  if (key === 'tapas_rey' || key === 'tapas_gyg') return itemImage(item, compact);
  return itemImage(item, compact);
}
function renderProductCard(container, key) {
  const item = getItem(key);
  if (!item) return '';
  const qty = logicalQuantity(container, key);
  const draftKey = `${container.id}:${key}`;
  const draft = state.drafts[draftKey] ?? String(qty);
  return `<article class="product-card" data-item-card="${key}">
    <button class="product-pick" type="button" data-focus-item="${key}" aria-label="Seleccionar ${escapeHtml(item.label)}">
      ${itemImage(item)}
      <span class="product-heading"><span class="brand-tag ${item.brand.toLowerCase()}">${escapeHtml(item.brand)}</span><strong>${escapeHtml(item.label)}</strong><small>Stock registrado: ${formatNumber(qty)}</small></span>
      <span class="pick-indicator" aria-hidden="true">✓</span>
    </button>
    <label class="quantity-label" for="qty-${escapeHtml(container.id)}-${key}">¿Cuántas unidades contaste?</label>
    <input class="quantity-input" id="qty-${escapeHtml(container.id)}-${key}" data-qty-input="${key}" data-container="${escapeHtml(container.id)}" type="number" min="0" max="${MAX_QTY}" step="1" inputmode="numeric" pattern="[0-9]*" placeholder="Escribe la cantidad" value="${escapeHtml(draft)}" />
    <p class="quantity-help">Escribe el total que tienes físicamente.</p>
  </article>`;
}
function renderContainerCard(container, actionLabel = 'Contar') {
  const total = containerTotal(container);
  const token = getToken(container.id);
  return `<article class="container-tile">
    <div class="container-tile-icon">▦</div>
    <div class="container-tile-body"><span class="eyebrow">CONTENEDOR</span><h3>${escapeHtml(container.name)}</h3><p>${escapeHtml(parseMeta(container).description || 'Sin descripción adicional')}</p><span class="contents-chip">${escapeHtml(contentsLabel(container))}</span><strong class="container-tile-total">${formatNumber(total)} <small>unidades</small></strong></div>
    <div class="container-tile-actions"><button class="button primary small" data-action="open-container" data-id="${escapeHtml(container.id)}">${actionLabel}</button>${token ? '<span class="access-state ready">Edición activada</span>' : '<span class="access-state">Requiere QR</span>'}</div>
  </article>`;
}
function renderTotalsCard(label, value, imageKey, tone = '') {
  const item = getItem(imageKey);
  return `<article class="summary-product ${tone}">${itemImage(item, true)}<div><span>${escapeHtml(label)}</span><strong>${formatNumber(value)}</strong><small>unidades</small></div></article>`;
}
function renderHome() {
  const totals = aggregateTotals();
  return `<div class="page-stack">
    <section class="welcome-panel">
      <div class="welcome-copy"><span class="eyebrow">APC CORPORACIÓN · INVENTARIO</span><h2>Todo tu inventario, en un solo lugar.</h2><p>Elige un recipiente, escribe las cantidades y guarda. También puedes escanear su QR para entrar directamente al conteo.</p><div class="welcome-actions"><button class="button primary" data-action="go-containers">▦ &nbsp; Contar suministros</button><button class="button secondary" data-action="go-manage">＋ &nbsp; Crear recipiente</button></div></div>
      <div class="overview-stats"><div><span>Recipientes activos</span><strong>${state.containers.length}</strong></div><div><span>Total de unidades</span><strong>${formatNumber(totals.totalUnits)}</strong></div><div><span>Total de tápers</span><strong>${formatNumber(totals.totalTapers)}</strong></div><div><span>Total de tapas</span><strong>${formatNumber(totals.totalTapas)}</strong></div></div>
    </section>
    <section class="section-block"><div class="section-title-row"><div><span class="eyebrow">STOCK GENERAL</span><h2>Resumen de suministros</h2><p>Totales de todos los recipientes activos.</p></div><div class="report-actions"><button class="button secondary small" data-action="pdf-report">⇩ PDF</button><button class="button whatsapp small" data-action="whatsapp">Compartir WhatsApp</button></div></div>
      <div class="summary-products">
        ${renderTotalsCard('Tápers Rey', totals.taper_rey, 'taper_rey')}
        ${renderTotalsCard('Tápers GyG', totals.taper_gyg, 'taper_gyg')}
        <article class="summary-product combined"><div class="combined-icon">Σ</div><div><span>TOTAL DE TÁPERS</span><strong>${formatNumber(totals.totalTapers)}</strong><small>Rey + GyG</small></div></article>
        ${renderTotalsCard('Tapas Rey', totals.tapas_rey, 'tapas_rey')}
        ${renderTotalsCard('Tapas GyG', totals.tapas_gyg, 'tapas_gyg')}
        <article class="summary-product combined"><div class="combined-icon">Σ</div><div><span>TOTAL DE TAPAS</span><strong>${formatNumber(totals.totalTapas)}</strong><small>Rey + GyG</small></div></article>
        ${renderTotalsCard('Tenedores', totals.tenedores, 'tenedores')}
      </div>
    </section>
    <section class="section-block"><div class="section-title-row"><div><span class="eyebrow">ACCESO RÁPIDO</span><h2>Tus recipientes</h2><p>Toca “Abrir conteo” para registrar cantidades desde esta pantalla.</p></div><button class="button secondary small" data-action="go-containers">Ver todos</button></div>
      <div class="container-list">${state.containers.length ? state.containers.map(container => renderContainerCard(container, 'Abrir conteo')).join('') : '<div class="empty-state">Todavía no has creado recipientes. Crea el primero para empezar.</div>'}</div>
    </section>
    <section class="section-block recent-section"><div class="section-title-row"><div><span class="eyebrow">ACTIVIDAD</span><h2>Últimos movimientos</h2></div><button class="text-link" data-action="go-movements">Ver historial →</button></div>${renderMovementRows(state.movements.slice(0, 5))}</section>
  </div>`;
}
function renderMovementRows(movements) {
  if (!movements.length) return '<div class="empty-state">Aún no hay movimientos registrados.</div>';
  return `<div class="movement-list">${movements.map(move => `<article class="movement-row"><div class="movement-symbol">↻</div><div class="movement-main"><strong>${escapeHtml(getContainer(move.container_id)?.name || move.container_id)}</strong><span>${escapeHtml(movementItemLabel(move.item_key))} · ${escapeHtml(formatDate(move.created_at))}</span></div><strong class="movement-delta ${move.delta >= 0 ? 'positive' : 'negative'}">${move.delta >= 0 ? '+' : ''}${formatNumber(move.delta)}</strong></article>`).join('')}</div>`;
}
function movementItemLabel(key) { return key === 'tapas' ? 'Tapas (Rey y GyG)' : getItem(key)?.label || key; }
function renderContainersPage() {
  if (state.qrMode) {
    const container = getContainer(state.qrContainerId);
    return container ? renderEditor(container, true) : '<div class="empty-state">No se encontró este recipiente.</div>';
  }
  if (state.showEditor && getContainer(state.selectedContainer)) return renderEditor(getContainer(state.selectedContainer), false);
  return `<div class="page-stack"><section class="section-block"><div class="section-title-row"><div><span class="eyebrow">REGISTRO DE EXISTENCIAS</span><h2>¿Qué recipiente vas a contar?</h2><p>Selecciona uno para escribir sus cantidades.</p></div><button class="button primary small" data-action="go-manage">＋ Nuevo</button></div><div class="container-list">${state.containers.map(container => renderContainerCard(container, 'Abrir')).join('') || '<div class="empty-state">No hay recipientes. Crea uno para comenzar.</div>'}</div></section></div>`;
}
function renderEditor(container, qrMode) {
  const keys = visibleKeys(container);
  const total = keys.reduce((sum, key) => sum + logicalQuantity(container, key), 0);
  const token = getToken(container.id);
  const canSave = Boolean(token);
  const content = keys.map(key => renderProductCard(container, key)).join('');
  return `<div class="page-stack editor-page">
    ${!qrMode ? `<button class="back-link" data-action="back-containers">← Volver a todos los recipientes</button>` : `<div class="qr-entry-note"><span class="qr-entry-icon">✓</span><div><strong>Entraste al recipiente correcto</strong><small>Este QR abre únicamente ${escapeHtml(container.name)}.</small></div></div>`}
    <section class="editor-hero"><div><span class="eyebrow">${qrMode ? 'CONTEO POR QR' : 'CONTEO DE SUMINISTROS'}</span><h2>${escapeHtml(container.name)}</h2><p>${escapeHtml(parseMeta(container).description || 'Registra las cantidades físicas de este recipiente.')}</p><div class="contents-chip">Contiene: ${escapeHtml(contentsLabel(container))}</div></div><div class="editor-total"><span>Total actual</span><strong>${formatNumber(total)}</strong><small>unidades</small></div></section>
    <section class="section-block count-section"><div class="section-title-row"><div><span class="eyebrow">PASO 1</span><h2>Selecciona cada suministro y escribe su cantidad</h2><p>No necesitas sumar ni restar. Escribe el número que contaste.</p></div></div><div class="product-grid">${content || '<div class="empty-state">Este recipiente no tiene suministros asignados.</div>'}</div>
      ${canSave ? '' : `<div class="permission-panel"><div class="permission-icon">🔒</div><div><strong>Activa el guardado desde este equipo</strong><p>Escanea el QR físico de este recipiente una vez en este teléfono, o renueva su QR para habilitar el conteo desde Inicio.</p><button class="button secondary" data-action="activate-edit" data-id="${escapeHtml(container.id)}">Habilitar edición y generar QR</button></div></div>`}
      <div class="save-bar"><div><span class="eyebrow">PASO 2</span><strong>¿Ya terminaste el conteo?</strong><small>Revisa las cantidades antes de guardar.</small></div><button class="button primary save-button" data-action="save-count" data-id="${escapeHtml(container.id)}" ${!canSave || state.saving ? 'disabled' : ''}>${state.saving ? 'Guardando…' : '✓ Guardar cantidades'}</button></div>
    </section>
  </div>`;
}
function supplyChoice(key, selected) {
  const item = getItem(key);
  return `<label class="supply-choice ${selected ? 'checked' : ''}"><input type="checkbox" data-supply-key="${key}" ${selected ? 'checked' : ''}><span class="choice-check">✓</span>${itemImage(item, true)}<span class="choice-copy"><strong>${escapeHtml(item.label)}</strong><small>${key.startsWith('tapas_') ? 'Tapas de marca ' + item.brand : key.startsWith('taper_') ? 'Recipientes de marca ' + item.brand : 'Suministro adicional'}</small></span></label>`;
}
function renderManage() {
  return `<div class="page-stack"><section class="section-block manage-intro"><div class="section-title-row"><div><span class="eyebrow">CONFIGURACIÓN</span><h2>Crear un recipiente</h2><p>No importa si es caja, tacho, bandeja o estante. Escribe el nombre que usa tu personal y marca qué va a guardar.</p></div></div>
    <div class="form-card"><div class="form-field"><label for="create-name">Nombre del recipiente</label><input id="create-name" data-state-field="createName" value="${escapeHtml(state.createName)}" placeholder="Ej. Bandeja azul, Tacho de tapas, Estante 02" maxlength="70"></div>
    <div class="form-field"><label for="create-description">Descripción (opcional)</label><input id="create-description" data-state-field="createDescription" value="${escapeHtml(state.createDescription)}" placeholder="Ej. Almacén junto a la cocina" maxlength="350"></div>
    <div class="form-field"><label>¿Qué suministros guardará?</label><p class="field-help">Puedes marcar varios. El recipiente solo mostrará los que selecciones.</p><div class="supply-choice-grid">${ITEM_DEFS.map(item => supplyChoice(item.key, state.createKeys.includes(item.key))).join('')}</div></div>
    <div class="form-note"><strong>Importante:</strong> Las tapas Rey y GyG se contarán por separado en la web y en el informe; Supabase conservará el total combinado de tapas para mantener la base actual sin SQL nuevo.</div>
    <button class="button primary create-button" data-action="create-container">＋ Crear recipiente y generar QR</button></div></section>
    <section class="section-block"><div class="section-title-row"><div><span class="eyebrow">GESTIÓN</span><h2>Recipientes actuales</h2><p>Puedes consultar su QR, cambiar nombre y suministros, o eliminarlos.</p></div></div><div class="container-manage-list">${state.containers.map(container => renderManageCard(container)).join('') || '<div class="empty-state">No hay recipientes registrados.</div>'}</div></section>
  </div>`;
}
function renderManageCard(container) {
  const editing = state.editContainerId === container.id;
  const meta = parseMeta(container);
  return `<article class="manage-tile"><div class="manage-tile-head"><div class="container-tile-icon">▦</div><div><span class="eyebrow">RECIPIENTE</span><h3>${escapeHtml(container.name)}</h3><p>${escapeHtml(meta.description || 'Sin descripción')}</p></div></div><div class="manage-tile-meta"><span class="contents-chip">${escapeHtml(contentsLabel(container))}</span><strong>${formatNumber(containerTotal(container))} unidades</strong></div><div class="manage-actions"><button class="button secondary small" data-action="show-qr" data-id="${escapeHtml(container.id)}">▦ QR</button><button class="button secondary small" data-action="edit-container" data-id="${escapeHtml(container.id)}">✎ Editar</button><button class="button danger small" data-action="delete-container" data-id="${escapeHtml(container.id)}">Eliminar</button></div>${editing ? renderEditForm(container) : ''}</article>`;
}
function renderEditForm(container) {
  return `<div class="edit-form"><div class="form-field"><label>Nombre del recipiente</label><input data-state-field="editName" value="${escapeHtml(state.editName)}" maxlength="70"></div><div class="form-field"><label>Descripción</label><input data-state-field="editDescription" value="${escapeHtml(state.editDescription)}" maxlength="350"></div><div class="form-field"><label>Suministros asignados</label><div class="supply-choice-grid compact-choices">${ITEM_DEFS.map(item => supplyChoice(item.key, state.editKeys.includes(item.key))).join('')}</div></div><div class="edit-form-actions"><button class="button primary" data-action="save-edit" data-id="${escapeHtml(container.id)}">Guardar cambios</button><button class="button secondary" data-action="cancel-edit">Cancelar</button></div></div>`;
}
function renderMovements() {
  return `<div class="page-stack"><section class="section-block"><div class="section-title-row"><div><span class="eyebrow">HISTORIAL</span><h2>Movimientos recientes</h2><p>Registro automático de cada conteo guardado.</p></div><button class="button secondary small" data-action="pdf-report">⇩ Informe PDF</button></div>${renderMovementRows(state.movements)}</section></div>`;
}
function renderProtocol() {
  return `<div class="page-stack"><section class="section-block"><div class="section-title-row"><div><span class="eyebrow">INSTRUCTIVO</span><h2>Procedimiento administrativo</h2><p>Consulta rápida de las responsabilidades registradas.</p></div></div><div class="protocol-grid">${PROTOCOL.map((line, index) => `<article class="protocol-card"><span>${index + 1}</span><p>${escapeHtml(line)}</p></article>`).join('')}</div></section></div>`;
}
function renderDrawer() {
  if (!state.menuOpen) return '';
  const links = [
    ['home', '⌂', 'Resumen', 'Stock general y totales'],
    ['containers', '▦', 'Contenedores', 'Abrir y contar suministros'],
    ['manage', '＋', 'Recipientes y QR', 'Crear, editar e imprimir códigos'],
    ['movements', '↻', 'Movimientos', 'Consultar los últimos conteos'],
    ['protocol', '▤', 'Protocolo', 'Procedimiento administrativo']
  ];
  return `<div class="drawer-backdrop" data-action="close-menu"><aside class="mobile-drawer" role="dialog" aria-modal="true" aria-label="Menú principal"><div class="drawer-head"><div class="brand-lockup"><img src="${BASE}apc-logo.png" alt="APC"><div><strong>APC Inventario</strong><small>Menú principal</small></div></div><button class="icon-button" data-action="close-menu" aria-label="Cerrar menú">×</button></div><p class="drawer-intro">¿A dónde quieres ir?</p><div class="drawer-links">${links.map(([page, icon, title, desc]) => `<button class="drawer-link ${state.page === page ? 'active' : ''}" data-action="navigate" data-page="${page}"><span class="drawer-link-icon">${icon}</span><span><strong>${title}</strong><small>${desc}</small></span><b>›</b></button>`).join('')}</div><div class="drawer-foot"><span class="status-dot ${state.online ? 'online' : 'offline'}"></span>${state.online ? 'Conectado a internet' : 'Sin conexión a internet'}</div></aside></div>`;
}
function renderMobileNav() {
  if (state.qrMode) return '';
  return `<nav class="mobile-bottom-nav" aria-label="Navegación principal"><button class="${state.page === 'home' ? 'active' : ''}" data-action="navigate" data-page="home"><span>⌂</span><small>Inicio</small></button><button class="${state.page === 'containers' ? 'active' : ''}" data-action="navigate" data-page="containers"><span>▦</span><small>Contar</small></button><button class="${state.page === 'movements' ? 'active' : ''}" data-action="navigate" data-page="movements"><span>↻</span><small>Historial</small></button><button class="${state.menuOpen ? 'active' : ''}" data-action="open-menu"><span>☰</span><small>Más</small></button></nav>`;
}
function render() {
  const title = ({ home: 'Resumen', containers: state.qrMode ? 'Conteo del recipiente' : 'Contenedores', manage: 'Recipientes y QR', movements: 'Movimientos', protocol: 'Protocolo' })[state.page] || 'APC Inventario';
  ROOT.innerHTML = `<div class="app-shell ${state.qrMode ? 'qr-mode' : ''}">
    <aside class="desktop-sidebar"><button class="brand-lockup brand-home" data-action="home"><img src="${BASE}apc-logo.png" alt="APC"><span><strong>APC Inventario</strong><small>Control de suministros</small></span></button><nav class="desktop-nav"><button data-action="navigate" data-page="home" class="${state.page === 'home' ? 'active' : ''}"><span>⌂</span>Resumen</button><button data-action="navigate" data-page="containers" class="${state.page === 'containers' ? 'active' : ''}"><span>▦</span>Contenedores</button><button data-action="navigate" data-page="movements" class="${state.page === 'movements' ? 'active' : ''}"><span>↻</span>Movimientos</button><button data-action="navigate" data-page="manage" class="${state.page === 'manage' ? 'active' : ''}"><span>▣</span>Recipientes y QR</button><button data-action="navigate" data-page="protocol" class="${state.page === 'protocol' ? 'active' : ''}"><span>▤</span>Protocolo</button></nav><div class="sidebar-tip"><strong>Uso rápido</strong><p>Escanea el QR del recipiente, escribe las cantidades y guarda el conteo.</p></div></aside>
    <div class="mobile-topbar"><button class="brand-lockup brand-home" data-action="home"><img src="${BASE}apc-logo.png" alt="APC"><span><strong>APC Inventario</strong><small>Control de suministros</small></span></button><div class="mobile-header-actions"><span class="connection-pill ${state.online ? 'online' : 'offline'}">● ${state.online ? 'En línea' : 'Sin internet'}</span>${!state.qrMode ? '<button class="icon-button menu-trigger" data-action="open-menu" aria-label="Abrir menú">☰</button>' : '<button class="icon-button" data-action="home" aria-label="Volver al inicio">⌂</button>'}</div></div>
    <main class="main-area"><header class="page-header"><div><span class="eyebrow">APC CORPORACIÓN</span><h1>${title}</h1></div><div class="header-actions"><span class="connection-pill ${state.online ? 'online' : 'offline'}">● ${state.online ? 'En línea' : 'Sin internet'}</span><button class="icon-button" data-action="refresh" title="Actualizar">↻</button></div></header>
      ${state.loading ? '<div class="loading-card"><span class="spinner"></span><strong>Cargando inventario…</strong></div>' : state.page === 'home' ? renderHome() : state.page === 'containers' ? renderContainersPage() : state.page === 'manage' ? renderManage() : state.page === 'movements' ? renderMovements() : renderProtocol()}
    </main>
    ${renderMobileNav()}${renderDrawer()}${renderQrModal()}${state.toast ? `<div class="toast ${state.toast.type}">${escapeHtml(state.toast.message)}</div>` : ''}
  </div>`;
}
function renderQrModal() {
  if (!state.qrPreview) return '';
  const preview = state.qrPreview;
  const qr = qrImageUrl(preview.url);
  return `<div class="modal-backdrop" data-action="close-qr"><section class="qr-modal" role="dialog" aria-modal="true" aria-label="Código QR" data-stop-close="true"><div class="modal-heading"><div><span class="eyebrow">ETIQUETA DEL RECIPIENTE</span><h2>QR listo para imprimir</h2></div><button class="icon-button" data-action="close-qr" aria-label="Cerrar">×</button></div><div class="qr-label" id="qr-label"><div class="qr-label-head"><img src="${BASE}apc-logo.png" alt="APC"><div><strong>APC CORPORACIÓN</strong><small>Inventario de suministros</small></div></div><img class="qr-code" src="${qr}" alt="Código QR de ${escapeHtml(preview.name)}"><div class="qr-name">${escapeHtml(preview.name.toUpperCase())}</div><div class="qr-instruction">ESCANEAR PARA ACTUALIZAR INVENTARIO</div></div>${preview.renewed ? '<p class="qr-warning">Este código reemplaza al QR anterior. Retira la etiqueta antigua y coloca esta nueva.</p>' : ''}<div class="qr-actions"><button class="button secondary" data-action="copy-qr">Copiar enlace</button><button class="button secondary" data-action="open-qr-link">Abrir QR</button><button class="button secondary" data-action="renew-qr">Renovar QR</button><button class="button primary" data-action="print-qr">▣ Imprimir QR</button></div></section></div>`;
}
function qrImageUrl(url) { return `https://api.qrserver.com/v1/create-qr-code/?size=900x900&margin=20&data=${encodeURIComponent(url)}`; }

async function openQr(container, forceRenew = false) {
  let token = getToken(container.id);
  let renewed = false;
  if (!token || forceRenew) {
    if (token && forceRenew && !confirm(`¿Renovar el QR de ${container.name}? El código anterior dejará de funcionar.`)) return;
    if (!token && !confirm(`No se puede recuperar el código original de ${container.name}. Para mostrarlo hay que generar uno nuevo; el QR impreso anteriormente dejará de funcionar. ¿Continuar?`)) return;
    const { data, error } = await supabase.rpc('apci_reset_container_token', { p_container_id: container.id });
    if (error) { notify(error.message || 'No se pudo generar el QR.', 'error'); return; }
    const row = firstRow(data);
    token = row.out_access_token || row.access_token || '';
    if (!token) { notify('Supabase no devolvió el acceso del QR.', 'error'); return; }
    saveToken(container.id, token);
    renewed = true;
  }
  state.qrPreview = { containerId: container.id, name: container.name, url: getQrUrl(container.id, token), renewed };
  render();
}
async function createContainer() {
  const name = cleanText(state.createName, 70);
  const description = cleanText(state.createDescription, 350);
  const keys = [...new Set(state.createKeys)];
  if (!name) { notify('Escribe el nombre del recipiente.', 'error'); document.getElementById('create-name')?.focus(); return; }
  if (!keys.length) { notify('Selecciona al menos un suministro.', 'error'); return; }
  if (!supabase) { notify('Supabase no está configurado.', 'error'); return; }
  const packed = packDescription(description, keys, 0, 0);
  let result = await supabase.rpc('apci_create_container', { p_kind: 'otro', p_name: name, p_description: packed, p_item_group: 'mixto' });
  // Compatibilidad con la función V2, que no recibía p_item_group.
  if (result.error && /function .*apci_create_container|schema cache|item_group.*does not exist/i.test(result.error.message || '')) {
    result = await supabase.rpc('apci_create_container', { p_kind: 'otro', p_name: name, p_description: packed });
  }
  const { data, error } = result;
  if (error) { notify(error.message || 'No se pudo crear el recipiente.', 'error'); return; }
  const row = firstRow(data);
  const id = row.out_container_id || row.container_id;
  const token = row.out_access_token || row.access_token;
  const savedName = row.out_name || row.name || name;
  if (!id || !token) { notify('El recipiente se creó, pero no se recibió su QR.', 'error'); return; }
  saveToken(id, token);
  state.createName = '';
  state.createDescription = '';
  state.createKeys = [...DEFAULT_CREATE_KEYS];
  await reloadData();
  const current = getContainer(id) || { id, name: savedName };
  state.qrPreview = { containerId: id, name: current.name || savedName, url: getQrUrl(id, token), renewed: false };
  state.page = 'manage';
  render();
  notify(`${savedName} creado correctamente.`);
}
async function saveContainerEdit(containerId) {
  const container = getContainer(containerId);
  if (!container) return;
  const name = cleanText(state.editName, 70);
  const description = cleanText(state.editDescription, 350);
  const keys = [...new Set(state.editKeys)];
  if (!name) { notify('El nombre no puede quedar vacío.', 'error'); return; }
  if (!keys.length) { notify('Selecciona al menos un suministro.', 'error'); return; }
  const meta = parseMeta(container);
  const rey = logicalQuantity(container, 'tapas_rey');
  const gyG = logicalQuantity(container, 'tapas_gyg');
  const packed = packDescription(description, keys, rey, gyG);
  const error = await updateContainerMetadata(container, name, packed, container.kind || 'otro', container.item_group || 'mixto');
  if (error) { notify(error.message || 'No se pudo actualizar el recipiente.', 'error'); return; }
  state.editContainerId = '';
  await reloadData();
  notify('Cambios guardados.');
}
async function deleteContainer(container) {
  if (!confirm(`¿Eliminar ${container.name}? Dejará de aparecer en el inventario, pero se conservará el historial.`)) return;
  let { error } = await supabase.rpc('apci_delete_container', { p_container_id: container.id });
  if (error && /function .*apci_delete_container|schema cache/i.test(error.message || '')) {
    const fallback = await supabase.from('apci_containers').update({ active: false }).eq('id', container.id);
    error = fallback.error;
  }
  if (error) { notify(error.message || 'No se pudo eliminar.', 'error'); return; }
  const tokens = getTokens(); delete tokens[container.id]; writeJSON(TOKEN_KEY, tokens);
  await reloadData();
  if (state.selectedContainer === container.id) { state.selectedContainer = ''; state.showEditor = false; }
  notify(`${container.name} eliminado.`);
}
async function activateEdit(container) { await openQr(container, true); }

async function saveCount(containerId) {
  const container = getContainer(containerId);
  if (!container) return;
  const token = getToken(containerId);
  if (!token) { notify('Primero activa el guardado con el QR de este recipiente.', 'error'); return; }
  const keys = visibleKeys(container);
  const values = {};
  for (const key of keys) {
    const raw = state.drafts[`${containerId}:${key}`] ?? String(logicalQuantity(container, key));
    if (String(raw).trim() === '') { notify(`Completa la cantidad de ${getItem(key)?.label || key}.`, 'error'); return; }
    const number = Number(raw);
    if (!Number.isInteger(number) || number < 0 || number > MAX_QTY) { notify(`La cantidad de ${getItem(key)?.label || key} no es válida.`, 'error'); return; }
    values[key] = number;
  }
  const meta = parseMeta(container);
  const tapasRey = keys.includes('tapas_rey') ? (values.tapas_rey ?? 0) : logicalQuantity(container, 'tapas_rey');
  const tapasGyG = keys.includes('tapas_gyg') ? (values.tapas_gyg ?? 0) : logicalQuantity(container, 'tapas_gyg');
  const quantities = {
    taper_rey: keys.includes('taper_rey') ? (values.taper_rey ?? 0) : getDbQuantity(containerId, 'taper_rey'),
    taper_gyg: keys.includes('taper_gyg') ? (values.taper_gyg ?? 0) : getDbQuantity(containerId, 'taper_gyg'),
    tapas: (keys.includes('tapas_rey') || keys.includes('tapas_gyg')) ? tapasRey + tapasGyG : getDbQuantity(containerId, 'tapas'),
    tenedores: keys.includes('tenedores') ? (values.tenedores ?? 0) : getDbQuantity(containerId, 'tenedores')
  };
  const expected = Object.fromEntries(DB_KEYS.map(key => [key, getDbQuantity(containerId, key)]));
  const packedDescription = packDescription(meta.description, keys, tapasRey, tapasGyG);
  state.saving = true; render();
  const operation = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, container_id: containerId, access_token: token, quantities, expected, description: packedDescription, name: container.name, kind: container.kind || 'otro', item_group: container.item_group || 'mixto', created_at: new Date().toISOString() };
  if (!navigator.onLine) {
    applyOptimisticStock(containerId, quantities);
    state.pending.push(operation); writeJSON(QUEUE_KEY, state.pending);
    state.saving = false; render(); notify('Sin internet. El conteo quedó guardado en este teléfono y se sincronizará al volver la conexión.', 'info'); return;
  }
  const { error } = await supabase.rpc('apci_save_container_stock', { p_container_id: containerId, p_access_token: token, p_quantities: quantities, p_expected: expected });
  if (error) { state.saving = false; render(); notify(error.message || 'No se pudo guardar el conteo.', 'error'); return; }
  const metaError = await updateContainerMetadata(container, container.name, packedDescription, container.kind || 'otro', container.item_group || 'mixto');
  await reloadData();
  state.saving = false;
  if (metaError) notify('El stock se guardó, pero no se pudo actualizar el detalle de marcas de tapas. Revisa el contenedor.', 'error');
  else notify(`Conteo guardado en ${container.name}.`);
}
function applyOptimisticStock(containerId, quantities) {
  const next = state.inventory.map(row => row.container_id === containerId && Object.hasOwn(quantities, row.item_key) ? { ...row, quantity: quantities[row.item_key], updated_at: new Date().toISOString() } : row);
  state.inventory = next; writeJSON(CACHE_KEY, next);
}
async function syncPending() {
  if (!supabase || !navigator.onLine || state.syncing || !state.pending.length) return;
  state.syncing = true; render();
  const remaining = [];
  for (const op of state.pending) {
    const { error } = await supabase.rpc('apci_save_container_stock', { p_container_id: op.container_id, p_access_token: op.access_token, p_quantities: op.quantities, p_expected: op.expected });
    if (error) { remaining.push(op, ...state.pending.slice(state.pending.indexOf(op) + 1)); notify(error.message || 'Hay un conteo pendiente de sincronizar.', 'error'); break; }
    const { error: metaError } = await supabase.rpc('apci_update_container', { p_container_id: op.container_id, p_name: op.name, p_description: op.description, p_kind: op.kind, p_item_group: op.item_group });
    if (metaError) notify('El stock se sincronizó, pero quedó pendiente el detalle de tapas por marca.', 'error');
  }
  state.pending = remaining; writeJSON(QUEUE_KEY, remaining);
  state.syncing = false;
  await reloadData();
  if (!remaining.length) notify('Todos los conteos pendientes se sincronizaron.');
}
async function updateContainerMetadata(container, name, description, kind = 'otro', itemGroup = 'mixto') {
  let result = await supabase.rpc('apci_update_container', { p_container_id: container.id, p_name: name, p_description: description, p_kind: kind, p_item_group: itemGroup });
  if (!result.error) return null;
  // Compatibilidad con instalaciones antiguas: intenta actualizar solo columnas base.
  if (/function .*apci_update_container|schema cache|item_group.*does not exist|column .*kind/i.test(result.error.message || '')) {
    let fallback = await supabase.from('apci_containers').update({ name, description, kind }).eq('id', container.id);
    if (fallback.error && /kind.*does not exist|column .*kind/i.test(fallback.error.message || '')) {
      fallback = await supabase.from('apci_containers').update({ name, description }).eq('id', container.id);
    }
    if (!fallback.error) return null;
    return fallback.error;
  }
  return result.error;
}
async function reloadData() {
  try {
    state.containers = await loadContainers();
    await loadInventory();
    state.movements = await loadMovements();
    refreshDrafts();
    render();
  } catch (error) { notify(error?.message || 'No se pudieron actualizar los datos.', 'error'); }
}

function openContainer(containerId) {
  state.selectedContainer = containerId;
  state.showEditor = true;
  state.page = 'containers';
  render();
  setTimeout(() => document.querySelector('.editor-page')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}
function goHome() {
  state.qrMode = false;
  state.qrContainerId = '';
  state.page = 'home';
  state.showEditor = false;
  state.menuOpen = false;
  if (location.search) history.replaceState({}, '', BASE);
  render();
}
function navigate(page) {
  if (page === 'home' && state.qrMode) { goHome(); return; }
  state.page = page;
  state.menuOpen = false;
  if (page !== 'containers') state.showEditor = false;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function reportData() {
  const totals = aggregateTotals();
  const rows = state.containers.map(container => ({ container, keys: visibleKeys(container), total: containerTotal(container) }));
  return { totals, rows, generatedAt: new Date() };
}
function printReport() {
  const { totals, rows, generatedAt } = reportData();
  const w = window.open('', '_blank');
  if (!w) { notify('El navegador bloqueó la ventana del informe. Permite las ventanas emergentes e inténtalo otra vez.', 'error'); return; }
  const containerRows = rows.map(({ container, keys, total }) => `<section class="container-report"><div class="container-report-head"><h3>${escapeHtml(container.name)}</h3><strong>${formatNumber(total)} unidades</strong></div><p>${escapeHtml(parseMeta(container).description || contentsLabel(container))}</p><table><thead><tr><th>Suministro</th><th>Cantidad</th></tr></thead><tbody>${keys.map(key => `<tr><td>${escapeHtml(getItem(key)?.label || key)}</td><td>${formatNumber(logicalQuantity(container, key))}</td></tr>`).join('')}</tbody></table></section>`).join('');
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Informe APC Inventario</title><style>
    *{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#193b5e;margin:0;background:#fff}.report{max-width:900px;margin:0 auto;padding:30px}.report-head{display:flex;align-items:center;gap:18px;border-bottom:4px solid #15966b;padding-bottom:18px}.report-head img{width:76px;height:76px;object-fit:contain}.report-head h1{font-size:26px;margin:0}.report-head p{color:#6e7f8d;margin:5px 0 0}.date{margin-left:auto;text-align:right;color:#647887;font-size:12px}.report-title{margin:26px 0 8px;font-size:28px}.subtitle{color:#6e7f8d;margin:0 0 20px}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:20px 0}.metric{border:1px solid #dce6eb;border-radius:12px;padding:13px;background:#f6f9fb}.metric span{display:block;color:#6c7e8c;font-size:11px;text-transform:uppercase;font-weight:bold}.metric strong{display:block;font-size:24px;margin-top:7px}.container-report{border:1px solid #dce6eb;border-radius:14px;padding:15px;margin:13px 0;break-inside:avoid}.container-report-head{display:flex;justify-content:space-between;align-items:center}.container-report h3{margin:0;font-size:18px}.container-report-head strong{color:#15966b}.container-report p{color:#6c7e8c;font-size:12px;margin:6px 0 12px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;padding:8px;border-bottom:1px solid #e7edf0}th:last-child,td:last-child{text-align:right}.footer{border-top:1px solid #dce6eb;padding-top:12px;margin-top:24px;color:#7a8992;font-size:10px;text-align:center}@page{size:A4;margin:12mm}@media print{.report{padding:0}}</style></head><body><main class="report"><header class="report-head"><img src="${location.origin}${BASE}apc-logo.png"><div><h1>APC CORPORACIÓN S.A.C.</h1><p>Inventario de suministros · Informe de existencias</p></div><div class="date">Generado<br><strong>${escapeHtml(formatDate(generatedAt))}</strong></div></header><h2 class="report-title">Resumen general de inventario</h2><p class="subtitle">Cantidades registradas en todos los recipientes activos.</p><div class="metrics"><div class="metric"><span>Total tápers</span><strong>${formatNumber(totals.totalTapers)}</strong></div><div class="metric"><span>Total tapas</span><strong>${formatNumber(totals.totalTapas)}</strong></div><div class="metric"><span>Tenedores</span><strong>${formatNumber(totals.tenedores)}</strong></div><div class="metric"><span>Total unidades</span><strong>${formatNumber(totals.totalUnits)}</strong></div></div><div class="metrics"><div class="metric"><span>Tápers Rey</span><strong>${formatNumber(totals.taper_rey)}</strong></div><div class="metric"><span>Tápers GyG</span><strong>${formatNumber(totals.taper_gyg)}</strong></div><div class="metric"><span>Tapas Rey</span><strong>${formatNumber(totals.tapas_rey)}</strong></div><div class="metric"><span>Tapas GyG</span><strong>${formatNumber(totals.tapas_gyg)}</strong></div></div><h2>Detalle por recipiente</h2>${containerRows || '<p>No hay recipientes registrados.</p>'}<div class="footer">APC Inventario · Documento generado automáticamente · ${escapeHtml(formatDate(generatedAt))}</div></main><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),450));</script></body></html>`);
  w.document.close();
}
function shareWhatsApp() {
  const { totals, rows, generatedAt } = reportData();
  const lines = [
    '📦 *APC CORPORACIÓN | INVENTARIO*',
    `📅 ${formatDate(generatedAt)}`,
    '━━━━━━━━━━━━━━━━━━━━',
    '📊 *RESUMEN GENERAL*',
    `• Tápers Rey: *${formatNumber(totals.taper_rey)}*`,
    `• Tápers GyG: *${formatNumber(totals.taper_gyg)}*`,
    `• TOTAL TÁPERS: *${formatNumber(totals.totalTapers)}*`,
    `• Tapas Rey: *${formatNumber(totals.tapas_rey)}*`,
    `• Tapas GyG: *${formatNumber(totals.tapas_gyg)}*`,
    `• TOTAL TAPAS: *${formatNumber(totals.totalTapas)}*`,
    `• Tenedores: *${formatNumber(totals.tenedores)}*`,
    `• TOTAL DE UNIDADES: *${formatNumber(totals.totalUnits)}*`,
    '━━━━━━━━━━━━━━━━━━━━',
    '📍 *DETALLE POR RECIPIENTE*'
  ];
  rows.forEach(({ container, keys, total }, index) => {
    lines.push(`${index + 1}. *${container.name}* — ${formatNumber(total)} unidades`);
    keys.forEach(key => lines.push(`   · ${getItem(key)?.label || key}: ${formatNumber(logicalQuantity(container, key))}`));
  });
  lines.push('━━━━━━━━━━━━━━━━━━━━', '_Reporte generado desde APC Inventario._');
  window.open(`https://wa.me/?text=${encodeURIComponent(lines.join('\n'))}`, '_blank', 'noopener');
}
function printQrLabel() {
  const preview = state.qrPreview;
  if (!preview) return;
  const w = window.open('', '_blank');
  if (!w) { notify('Permite las ventanas emergentes para imprimir el QR.', 'error'); return; }
  const qr = qrImageUrl(preview.url);
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QR ${escapeHtml(preview.name)}</title><style>*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;font-family:Arial,Helvetica,sans-serif}.sheet{min-height:100vh;display:grid;place-items:center;padding:12mm}.label{width:100mm;max-width:100%;border:2mm solid #173d63;border-radius:8mm;padding:6mm 5mm 5mm;text-align:center;background:#fff;break-inside:avoid}.head{display:flex;align-items:center;justify-content:center;gap:4mm;margin-bottom:3mm}.head img{width:18mm;height:18mm;object-fit:contain}.head strong{display:block;color:#173d63;font-size:15pt}.head small{display:block;color:#71808d;font-size:8pt}.qr{display:block;width:69mm;height:69mm;object-fit:contain;margin:0 auto}.name{margin:3mm auto 2mm;background:#f47c22;color:#fff;border-radius:4mm;padding:3mm 2mm;font-size:22pt;font-weight:900;letter-spacing:1px}.instruction{font-size:9pt;font-weight:900;color:#263648;letter-spacing:.4px}@page{size:A5 portrait;margin:0}@media print{.sheet{min-height:0;height:148mm;padding:8mm}.label{width:100mm}}</style></head><body><main class="sheet"><section class="label"><div class="head"><img src="${location.origin}${BASE}apc-logo.png"><div><strong>APC CORPORACIÓN</strong><small>Inventario de suministros</small></div></div><img class="qr" src="${qr}" alt="Código QR"><div class="name">${escapeHtml(preview.name.toUpperCase())}</div><div class="instruction">ESCANEAR PARA ACTUALIZAR INVENTARIO</div></section></main><script>const imgs=[...document.images];Promise.all(imgs.map(i=>i.decode?i.decode().catch(()=>{}):Promise.resolve())).then(()=>setTimeout(()=>window.print(),250));</script></body></html>`);
  w.document.close();
}

ROOT.addEventListener('click', async event => {
  const actionNode = event.target.closest('[data-action]');
  const focusNode = event.target.closest('[data-focus-item]');
  if (focusNode) {
    const key = focusNode.dataset.focusItem;
    document.querySelectorAll('[data-item-card]').forEach(card => card.classList.toggle('selected', card.dataset.itemCard === key));
    document.querySelector(`[data-qty-input="${key}"]`)?.focus({ preventScroll: true });
    return;
  }
  if (!actionNode) return;
  const action = actionNode.dataset.action;
  const id = actionNode.dataset.id;
  if (action === 'home') { goHome(); return; }
  if (action === 'navigate') { navigate(actionNode.dataset.page); return; }
  if (action === 'open-menu') { state.menuOpen = true; render(); return; }
  if (action === 'close-menu') { if (event.target.closest('.mobile-drawer') && !event.target.closest('[data-action="close-menu"]')) return; state.menuOpen = false; render(); return; }
  if (action === 'go-containers') { navigate('containers'); return; }
  if (action === 'go-manage') { navigate('manage'); return; }
  if (action === 'go-movements') { navigate('movements'); return; }
  if (action === 'open-container') { openContainer(id); return; }
  if (action === 'back-containers') { state.showEditor = false; state.selectedContainer = ''; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  if (action === 'refresh') { await reloadData(); notify('Inventario actualizado.'); return; }
  if (action === 'create-container') { await createContainer(); return; }
  if (action === 'save-count') { await saveCount(id); return; }
  if (action === 'activate-edit') { const container = getContainer(id); if (container) await activateEdit(container); return; }
  if (action === 'show-qr') { const container = getContainer(id); if (container) await openQr(container); return; }
  if (action === 'edit-container') {
    const container = getContainer(id); if (!container) return;
    const meta = parseMeta(container);
    state.editContainerId = id; state.editName = container.name; state.editDescription = meta.description;
    state.editKeys = meta.hasMeta ? [...meta.keys] : [...visibleKeys(container)];
    render(); return;
  }
  if (action === 'cancel-edit') { state.editContainerId = ''; render(); return; }
  if (action === 'save-edit') { await saveContainerEdit(id); return; }
  if (action === 'delete-container') { const container = getContainer(id); if (container) await deleteContainer(container); return; }
  if (action === 'close-qr') { if (event.target.closest('.qr-modal') && !event.target.closest('.modal-heading [data-action="close-qr"]')) return; state.qrPreview = null; render(); return; }
  if (action === 'copy-qr') { try { await navigator.clipboard.writeText(state.qrPreview.url); notify('Enlace copiado.'); } catch { notify('No se pudo copiar el enlace.', 'error'); } return; }
  if (action === 'open-qr-link') { window.open(state.qrPreview.url, '_blank', 'noopener'); return; }
  if (action === 'renew-qr') { const container = getContainer(state.qrPreview?.containerId); if (container) await openQr(container, true); return; }
  if (action === 'print-qr') { printQrLabel(); return; }
  if (action === 'pdf-report') { printReport(); return; }
  if (action === 'whatsapp') { shareWhatsApp(); return; }
});
ROOT.addEventListener('focusin', event => {
  if (event.target.matches('[data-qty-input]')) {
    const key = event.target.dataset.qtyInput;
    document.querySelectorAll('[data-item-card]').forEach(card => card.classList.toggle('selected', card.dataset.itemCard === key));
  }
});
ROOT.addEventListener('input', event => {
  const input = event.target;
  if (input.matches('[data-qty-input]')) {
    const raw = input.value.replace(/[^0-9]/g, '').slice(0, 6);
    if (raw !== input.value) input.value = raw;
    state.drafts[`${input.dataset.container}:${input.dataset.qtyInput}`] = raw;
  }
  if (input.matches('[data-state-field]')) state[input.dataset.stateField] = input.value;
});
ROOT.addEventListener('change', event => {
  const input = event.target;
  if (input.matches('[data-supply-key]')) {
    const key = input.dataset.supplyKey;
    const inEdit = Boolean(state.editContainerId && input.closest('.edit-form'));
    const list = inEdit ? state.editKeys : state.createKeys;
    const next = input.checked ? [...new Set([...list, key])] : list.filter(item => item !== key);
    if (inEdit) state.editKeys = next; else state.createKeys = next;
    render();
  }
});
window.addEventListener('online', () => { state.online = true; render(); syncPending(); });
window.addEventListener('offline', () => { state.online = false; render(); });
if (supabase) {
  const channel = supabase.channel('apc-inventory-v7')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'apci_inventory' }, async () => { if (navigator.onLine) { await loadInventory().catch(() => {}); render(); } })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'apci_movements' }, async () => { if (navigator.onLine) { state.movements = await loadMovements(); render(); } })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'apci_containers' }, async () => { if (navigator.onLine) { state.containers = await loadContainers().catch(() => state.containers); refreshDrafts(); render(); } })
    .subscribe();
  window.addEventListener('beforeunload', () => supabase.removeChannel(channel));
}
if (state.qrMode) saveToken(state.qrContainerId, initialToken);
initialize();

if ('serviceWorker' in navigator) { window.addEventListener('load', () => navigator.serviceWorker.register(`${BASE}sw.js`).catch(() => undefined)); }
