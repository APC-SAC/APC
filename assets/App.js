import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Boxes, Check, ChevronDown, ClipboardList, CloudOff, History, Home, Info, Menu, Package, RefreshCw, ShieldCheck, SlidersHorizontal, Wifi, WifiOff, X, } from 'lucide-react';
import { supabase, isSupabaseConfigured } from './lib/supabase.js';
import { CONTAINERS, ITEMS } from './lib/types.js';
import { readInventoryCache, writeInventoryCache, readPendingQueue, writePendingQueue } from './lib/offline.js';
const BASE = window.APC_CONFIG?.BASE_URL || '/APC/';
const itemLabel = (key) => ITEMS.find((item) => item.key === key)?.label ?? key;
const containerLabel = (id) => CONTAINERS.find((container) => container.id === id)?.name ?? id;
const formatNumber = (n) => new Intl.NumberFormat('es-PE').format(n);
const formatDate = (value) => new Intl.DateTimeFormat('es-PE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
function getQrAccess() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('c');
    const container = CONTAINERS.find((item) => item.id === raw);
    return { containerId: container?.id ?? null, token: params.get('k') ?? '' };
}
function App() {
    const qrAccess = useMemo(getQrAccess, []);
    const [inventory, setInventory] = useState(() => readInventoryCache());
    const [movements, setMovements] = useState([]);
    const [page, setPage] = useState(qrAccess.containerId ? 'containers' : 'overview');
    const [selectedContainer, setSelectedContainer] = useState(qrAccess.containerId ?? 'caja-01');
    const [online, setOnline] = useState(navigator.onLine);
    const [pending, setPending] = useState(() => readPendingQueue());
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [toast, setToast] = useState(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const [drafts, setDrafts] = useState({});
    const toastTimer = useRef(undefined);
    const queueRef = useRef(readPendingQueue());
    const syncingRef = useRef(false);
    const notify = useCallback((next) => {
        setToast(next);
        if (toastTimer.current)
            window.clearTimeout(toastTimer.current);
        toastTimer.current = window.setTimeout(() => setToast(null), 3800);
    }, []);
    const setQueue = useCallback((next) => {
        queueRef.current = next;
        setPending(next);
        writePendingQueue(next);
    }, []);
    const loadInventory = useCallback(async (quiet = false) => {
        if (!supabase)
            return;
        if (!navigator.onLine) {
            setInventory(readInventoryCache());
            return;
        }
        const { data, error } = await supabase.from('apci_inventory')
            .select('id,container_id,item_key,quantity,updated_at')
            .order('container_id').order('item_key');
        if (error) {
            if (!quiet)
                notify({ type: 'error', text: `No se pudo actualizar el inventario: ${error.message}` });
            return;
        }
        const rows = (data ?? []);
        setInventory(rows);
        writeInventoryCache(rows);
    }, [notify]);
    const loadMovements = useCallback(async () => {
        if (!supabase || !navigator.onLine)
            return;
        const { data, error } = await supabase.from('apci_movements')
            .select('id,container_id,item_key,delta,quantity_before,quantity_after,movement_type,note,created_at')
            .order('created_at', { ascending: false }).limit(100);
        if (!error && data)
            setMovements(data);
    }, []);
    useEffect(() => {
        let alive = true;
        const start = async () => {
            if (!supabase) {
                setLoading(false);
                return;
            }
            if (!navigator.onLine) {
                setLoading(false);
                return;
            }
            const { data, error } = await supabase.from('apci_inventory')
                .select('id,container_id,item_key,quantity,updated_at')
                .order('container_id').order('item_key');
            if (!alive)
                return;
            if (!error && data) {
                const rows = data;
                setInventory(rows);
                writeInventoryCache(rows);
            }
            else if (error) {
                notify({ type: 'error', text: `No se pudo conectar con Supabase: ${error.message}` });
            }
            await loadMovements();
            if (alive)
                setLoading(false);
        };
        start().catch((error) => {
            if (alive) {
                notify({ type: 'error', text: error?.message || 'No se pudieron cargar los datos.' });
                setLoading(false);
            }
        });
        return () => { alive = false; };
    }, [loadMovements, notify]);
    useEffect(() => {
        if (!supabase)
            return;
        const channel = supabase.channel('apci-inventory-public-live')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'apci_inventory' }, () => {
            if (navigator.onLine) {
                loadInventory(true);
                loadMovements();
            }
        })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'apci_movements' }, () => {
            if (navigator.onLine)
                loadMovements();
        })
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [loadInventory, loadMovements]);
    const syncPending = useCallback(async () => {
        if (!supabase || !navigator.onLine || syncingRef.current || queueRef.current.length === 0)
            return;
        syncingRef.current = true;
        setSyncing(true);
        let queue = [...queueRef.current];
        let synced = 0;
        try {
            for (const operation of queue) {
                const { error } = await supabase.rpc('apci_save_container_stock', {
                    p_container_id: operation.container_id,
                    p_access_token: operation.access_token,
                    p_quantities: operation.quantities,
                    p_expected: operation.expected,
                });
                if (error) {
                    notify({ type: 'error', text: error.message.includes('CONFLICTO')
                            ? `El stock de ${containerLabel(operation.container_id)} cambió desde otro teléfono. Revisa el conteo y vuelve a guardarlo.`
                            : `No se pudo sincronizar ${containerLabel(operation.container_id)}: ${error.message}` });
                    break;
                }
                synced++;
                queue = queue.filter((item) => item.id !== operation.id);
                setQueue(queue);
            }
            if (synced > 0) {
                await loadInventory(true);
                await loadMovements();
                notify({ type: 'success', text: `${synced} conteo(s) sincronizado(s).` });
            }
        }
        finally {
            syncingRef.current = false;
            setSyncing(false);
        }
    }, [setQueue, loadInventory, loadMovements, notify]);
    useEffect(() => {
        const onOnline = () => { setOnline(true); window.setTimeout(() => syncPending(), 600); };
        const onOffline = () => setOnline(false);
        window.addEventListener('online', onOnline);
        window.addEventListener('offline', onOffline);
        return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
    }, [syncPending]);
    useEffect(() => {
        if (online && pending.length > 0) {
            const timer = window.setTimeout(() => syncPending(), 900);
            return () => window.clearTimeout(timer);
        }
    }, [online, pending.length]);
    const getQuantity = (containerId, itemKey) => inventory.find((row) => row.container_id === containerId && row.item_key === itemKey)?.quantity ?? 0;
    const totals = useMemo(() => ITEMS.map((item) => ({
        ...item,
        quantity: inventory.filter((row) => row.item_key === item.key).reduce((sum, row) => sum + row.quantity, 0),
    })), [inventory]);
    const totalUnits = useMemo(() => totals.reduce((sum, item) => sum + item.quantity, 0), [totals]);
    const qrCanEdit = Boolean(qrAccess.containerId && qrAccess.containerId === selectedContainer && qrAccess.token);
    const selectedContainerReady = ITEMS.every((item) => inventory.some((row) => row.container_id === selectedContainer && row.item_key === item.key));
    const canEditSelected = qrCanEdit && selectedContainerReady;
    const saveContainerCount = async () => {
        if (!qrCanEdit) {
            notify({ type: 'error', text: 'Para editar, escanea el QR pegado en el contenedor.' });
            return;
        }
        const quantities = {};
        const expected = {};
        for (const item of ITEMS) {
            const key = `${selectedContainer}:${item.key}`;
            const raw = drafts[key] ?? String(getQuantity(selectedContainer, item.key));
            if (!/^\d+$/.test(raw.trim())) {
                notify({ type: 'error', text: `Ingresa una cantidad válida para ${item.label}.` });
                return;
            }
            const value = Number(raw);
            if (!Number.isSafeInteger(value) || value < 0 || value > 100000) {
                notify({ type: 'error', text: `La cantidad de ${item.label} debe estar entre 0 y 100 000.` });
                return;
            }
            quantities[item.key] = value;
            expected[item.key] = getQuantity(selectedContainer, item.key);
        }
        if (ITEMS.every((item) => quantities[item.key] === expected[item.key])) {
            notify({ type: 'info', text: 'No hay cambios en las cantidades.' });
            return;
        }
        setSaving(true);
        const operation = {
            id: makeId(), kind: 'container-set', container_id: selectedContainer,
            access_token: qrAccess.token, quantities, expected, created_at: new Date().toISOString(),
        };
        if (!navigator.onLine || !supabase) {
            const optimistic = inventory.map((row) => row.container_id === selectedContainer
                ? { ...row, quantity: quantities[row.item_key], updated_at: new Date().toISOString() }
                : row);
            setInventory(optimistic);
            writeInventoryCache(optimistic);
            setQueue([...queueRef.current, operation]);
            setDrafts((old) => ({ ...old, ...Object.fromEntries(ITEMS.map((item) => [`${selectedContainer}:${item.key}`, String(quantities[item.key])])) }));
            setSaving(false);
            notify({ type: 'info', text: 'Conteo guardado en este teléfono. Se sincronizará cuando vuelva internet.' });
            return;
        }
        const { error } = await supabase.rpc('apci_save_container_stock', {
            p_container_id: selectedContainer,
            p_access_token: qrAccess.token,
            p_quantities: quantities,
            p_expected: expected,
        });
        setSaving(false);
        if (error) {
            if (/fetch|network|offline|timeout/i.test(error.message)) {
                const optimistic = inventory.map((row) => row.container_id === selectedContainer
                    ? { ...row, quantity: quantities[row.item_key], updated_at: new Date().toISOString() }
                    : row);
                setInventory(optimistic);
                writeInventoryCache(optimistic);
                setQueue([...queueRef.current, operation]);
                setDrafts((old) => ({ ...old, ...Object.fromEntries(ITEMS.map((item) => [`${selectedContainer}:${item.key}`, String(quantities[item.key])])) }));
                notify({ type: 'info', text: 'Se perdió la conexión. El conteo quedó guardado en este teléfono para sincronizarse.' });
            }
            else {
                notify({ type: 'error', text: error.message });
            }
            return;
        }
        setDrafts((old) => ({ ...old, ...Object.fromEntries(ITEMS.map((item) => [`${selectedContainer}:${item.key}`, String(quantities[item.key])])) }));
        await loadInventory(true);
        await loadMovements();
        notify({ type: 'success', text: `Conteo de ${containerLabel(selectedContainer)} guardado correctamente.` });
    };
    const selected = CONTAINERS.find((container) => container.id === selectedContainer);
    if (!isSupabaseConfigured)
        return _jsx(ConfigurationScreen, {});
    if (loading)
        return _jsxs("div", { className: "loading-screen", children: [_jsx("div", { className: "loading-mark", children: _jsx("img", { src: `${BASE}apc-logo.png`, alt: "APC" }) }), _jsx("div", { className: "spinner" }), _jsx("p", { children: "Preparando APC Inventario\u2026" })] });
    if (qrAccess.containerId) {
        return _jsxs("div", { className: "quick-count-shell", children: [_jsxs("header", { className: "quick-count-header", children: [_jsx("img", { src: `${BASE}apc-logo.png`, alt: "APC Corporaci\u00F3n" }), _jsxs("div", { className: "quick-count-status", children: [_jsx("span", { className: `status-dot ${online ? 'online' : 'offline'}` }), online ? 'En línea' : 'Sin conexión', _jsx("a", { className: "quick-count-dashboard-link", href: BASE, children: "Panel general" })] })] }), _jsxs("main", { className: "quick-count-main", children: [_jsx("div", { className: "quick-count-kicker", children: "APC CORPORACI\u00D3N S.A.C. \u00B7 INVENTARIO" }), _jsxs("div", { className: "quick-count-title-row", children: [_jsxs("div", { children: [_jsx("h1", { children: selected.name }), _jsx("p", { children: "Registro directo de cantidades" })] }), _jsx("div", { className: "qr-box-mark", children: _jsx(Boxes, { size: 25 }) })] }), _jsxs("div", { className: "quick-current-total", children: [_jsx("span", { children: "Stock registrado en este contenedor" }), _jsx("strong", { children: formatNumber(inventory.filter((row) => row.container_id === selectedContainer).reduce((sum, row) => sum + row.quantity, 0)) }), _jsx("small", { children: "unidades en total" })] }), _jsx(CountForm, { selected: selected, selectedId: selectedContainer, inventory: inventory, getQuantity: getQuantity, drafts: drafts, setDrafts: setDrafts, onSave: saveContainerCount, saving: saving, canEdit: canEditSelected }), !canEditSelected && _jsxs("div", { className: "qr-access-note", children: [_jsx(Info, { size: 17 }), _jsx("span", { children: !qrCanEdit ? 'Este enlace permite consultar el stock, pero no editarlo. Escanea el QR original pegado en este contenedor.' : 'Conéctate a internet una vez para cargar el stock inicial antes de registrar el primer conteo.' })] }), pending.length > 0 && _jsxs("div", { className: "pending-banner", children: [_jsx(CloudOff, { size: 18 }), _jsxs("div", { children: [_jsxs("strong", { children: [pending.length, " conteo(s) pendiente(s)"] }), _jsx("span", { children: "Se enviar\u00E1n al recuperar la conexi\u00F3n." })] })] }), _jsx("div", { className: "quick-count-footer", children: "APC CORPORACI\u00D3N S.A.C. \u00B7 Control interno de suministros" })] }), toast && _jsx(ToastView, { toast: toast, onClose: () => setToast(null) })] });
    }
    return _jsxs("div", { className: "app-shell", children: [_jsxs("aside", { className: `sidebar ${menuOpen ? 'sidebar-open' : ''}`, children: [_jsxs("div", { className: "brand-lockup", children: [_jsx("img", { src: `${BASE}apc-logo.png`, alt: "APC" }), _jsxs("div", { children: [_jsx("strong", { children: "INVENTARIO" }), _jsx("span", { children: "CONTROL DE SUMINISTROS" })] })] }), _jsx("div", { className: "sidebar-label", children: "MEN\u00DA PRINCIPAL" }), _jsxs("nav", { className: "side-nav", children: [_jsx(NavButton, { active: page === 'overview', icon: _jsx(Home, { size: 18 }), label: "Resumen", onClick: () => { setPage('overview'); setMenuOpen(false); } }), _jsx(NavButton, { active: page === 'containers', icon: _jsx(Boxes, { size: 18 }), label: "Contenedores", onClick: () => { setPage('containers'); setMenuOpen(false); } }), _jsx(NavButton, { active: page === 'history', icon: _jsx(History, { size: 18 }), label: "Movimientos", onClick: () => { setPage('history'); setMenuOpen(false); } }), _jsx(NavButton, { active: page === 'protocol', icon: _jsx(ClipboardList, { size: 18 }), label: "Protocolo administrativo", onClick: () => { setPage('protocol'); setMenuOpen(false); } })] }), _jsxs("div", { className: "sidebar-bottom", children: [_jsxs("div", { className: "secure-note", children: [_jsx(ShieldCheck, { size: 18 }), _jsxs("div", { children: [_jsx("strong", { children: "Acceso directo por QR" }), _jsx("span", { children: "Sin cuentas ni contrase\u00F1as" })] })] }), _jsx("div", { className: "sidebar-footnote", children: "Escanea el c\u00F3digo pegado en cada caja para registrar sus cantidades." })] })] }), _jsxs("div", { className: "main-area", children: [_jsxs("header", { className: "topbar", children: [_jsx("button", { className: "icon-button mobile-menu", onClick: () => setMenuOpen(!menuOpen), "aria-label": "Abrir men\u00FA", children: menuOpen ? _jsx(X, { size: 21 }) : _jsx(Menu, { size: 21 }) }), _jsxs("div", { className: "breadcrumb", children: [_jsx("span", { children: "APC Corporaci\u00F3n" }), _jsx("span", { className: "crumb-sep", children: "/" }), _jsx("strong", { children: pageTitle(page) })] }), _jsxs("div", { className: "top-actions", children: [_jsxs("div", { className: `connection-pill ${online ? 'is-online' : 'is-offline'}`, children: [online ? _jsx(Wifi, { size: 15 }) : _jsx(WifiOff, { size: 15 }), _jsx("span", { children: online ? 'En línea' : 'Sin conexión' })] }), pending.length > 0 && _jsxs("button", { className: "sync-button", onClick: syncPending, disabled: !online || syncing, children: [_jsx(RefreshCw, { size: 15, className: syncing ? 'spin' : '' }), syncing ? 'Sincronizando' : `Pendientes (${pending.length})`] }), _jsx("button", { className: "icon-button refresh-button", title: "Actualizar datos", onClick: () => { loadInventory(); loadMovements(); }, children: _jsx(RefreshCw, { size: 18 }) })] })] }), _jsxs("main", { className: "content", children: [page === 'overview' && _jsx(Overview, { inventory: inventory, totals: totals, totalUnits: totalUnits, pending: pending.length, setPage: setPage, setContainer: (id) => { setSelectedContainer(id); setPage('containers'); }, movements: movements }), page === 'containers' && _jsxs("div", { className: "page-stack", children: [_jsxs("section", { className: "welcome-row", children: [_jsxs("div", { children: [_jsx("div", { className: "eyebrow", children: "CONTROL POR ZONA" }), _jsx("h1", { children: "Contenedores" }), _jsx("p", { children: "Consulta el stock. Para modificarlo, escanea el QR del contenedor correspondiente." })] }), _jsxs("div", { className: "capacity-chip", children: [_jsx(Boxes, { size: 17 }), _jsx("span", { children: "4 zonas de almacenamiento" })] })] }), _jsx("div", { className: "container-tabs", children: CONTAINERS.map((c) => _jsxs("button", { className: selectedContainer === c.id ? 'selected' : '', onClick: () => setSelectedContainer(c.id), children: [_jsx("span", { className: "tab-box-icon", children: _jsx(Boxes, { size: 17 }) }), c.name, selectedContainer === c.id && _jsx("span", { className: "tab-selected-mark", children: _jsx(Check, { size: 14 }) })] }, c.id)) }), _jsxs("div", { className: "quick-count-panel", children: [_jsxs("div", { className: "quick-count-title-row", children: [_jsxs("div", { children: [_jsx("span", { className: "eyebrow", children: "ZONA SELECCIONADA" }), _jsx("h2", { children: selected.name })] }), _jsx("div", { className: "qr-box-mark", children: _jsx(Boxes, { size: 24 }) })] }), _jsx(CountForm, { selected: selected, selectedId: selectedContainer, inventory: inventory, getQuantity: getQuantity, drafts: drafts, setDrafts: setDrafts, onSave: saveContainerCount, saving: saving, canEdit: canEditSelected }), !canEditSelected && _jsxs("div", { className: "qr-access-note", children: [_jsx(Info, { size: 17 }), _jsx("span", { children: !qrCanEdit ? `Para guardar cambios, abre esta pantalla escaneando el QR físico de ${selected.name}.` : 'Conéctate a internet una vez para cargar el stock inicial.' })] })] })] }), page === 'history' && _jsx(HistoryPage, { movements: movements }), page === 'protocol' && _jsx(ProtocolPage, {})] }), _jsxs("footer", { className: "app-footer", children: [_jsx("span", { children: "APC CORPORACI\u00D3N S.A.C. \u00B7 APC INVENTARIO" }), _jsx("span", { children: "Acceso directo mediante QR" })] })] }), toast && _jsx(ToastView, { toast: toast, onClose: () => setToast(null) })] });
}
function pageTitle(page) { return ({ overview: 'Resumen general', containers: 'Control por contenedor', history: 'Historial de movimientos', protocol: 'Protocolo administrativo' })[page]; }
function NavButton({ active, icon, label, onClick }) {
    return _jsxs("button", { className: `nav-button ${active ? 'active' : ''}`, onClick: onClick, children: [icon, _jsx("span", { children: label }), active && _jsx("span", { className: "nav-active-dot" })] });
}
function ToastView({ toast, onClose }) {
    return _jsxs("div", { className: `toast toast-${toast.type}`, children: [_jsx("span", { className: "toast-icon", children: toast.type === 'success' ? _jsx(Check, { size: 17 }) : toast.type === 'error' ? _jsx(AlertTriangle, { size: 17 }) : _jsx(Info, { size: 17 }) }), toast.text, _jsx("button", { onClick: onClose, children: _jsx(X, { size: 15 }) })] });
}
function ConfigurationScreen() {
    return _jsxs("div", { className: "loading-screen", children: [_jsx("img", { className: "config-logo", src: `${BASE}apc-logo.png`, alt: "APC" }), _jsx("h2", { children: "Falta configurar Supabase" }), _jsx("p", { children: "Configura la URL y la clave publishable de tu proyecto APC antes de publicar." })] });
}
function Overview({ inventory, totals, totalUnits, pending, setPage, setContainer, movements }) {
    return _jsxs("div", { className: "page-stack", children: [_jsxs("section", { className: "welcome-row", children: [_jsxs("div", { children: [_jsx("div", { className: "eyebrow", children: "PANEL DE CONTROL" }), _jsx("h1", { children: "APC Inventario" }), _jsx("p", { children: "Stock consolidado de las cuatro zonas de almacenamiento." })] }), _jsxs("button", { className: "btn btn-outline", onClick: () => setPage('protocol'), children: [_jsx(ClipboardList, { size: 17 }), " Ver protocolo"] })] }), _jsxs("section", { className: "stats-grid", children: [_jsx(StatCard, { label: "Stock total", value: formatNumber(totalUnits), unit: "unidades", icon: _jsx(Package, { size: 20 }), tone: "navy", detail: "Suma de los cuatro contenedores" }), totals.map((item) => _jsx(StatCard, { label: item.label, value: formatNumber(item.quantity), unit: "unidades", icon: _jsx(Boxes, { size: 20 }), tone: item.key === 'taper_rey' ? 'green' : item.key === 'taper_gyg' ? 'orange' : 'slate', detail: "En todas las zonas" }, item.key))] }), pending > 0 && _jsxs("div", { className: "pending-banner", children: [_jsx(CloudOff, { size: 18 }), _jsxs("div", { children: [_jsxs("strong", { children: [pending, " conteo(s) pendiente(s) de sincronizaci\u00F3n"] }), _jsx("span", { children: "Guardados en este tel\u00E9fono; se enviar\u00E1n al recuperar internet." })] })] }), _jsxs("section", { className: "section-block", children: [_jsxs("div", { className: "section-heading", children: [_jsxs("div", { children: [_jsx("span", { className: "eyebrow", children: "DISTRIBUCI\u00D3N" }), _jsx("h2", { children: "Contenedores" })] }), _jsxs("button", { className: "text-action", onClick: () => setPage('containers'), children: ["Ver todos ", _jsx(ArrowUpRight, { size: 15 })] })] }), _jsx("div", { className: "container-grid", children: CONTAINERS.map((container, index) => { const rows = inventory.filter((row) => row.container_id === container.id); const sum = rows.reduce((n, row) => n + row.quantity, 0); return _jsxs("button", { className: "container-card", onClick: () => setContainer(container.id), children: [_jsxs("div", { className: "container-card-top", children: [_jsx("div", { className: `container-icon container-tone-${index}`, children: _jsx(Boxes, { size: 21 }) }), _jsx("span", { className: "container-arrow", children: _jsx(ArrowUpRight, { size: 17 }) })] }), _jsx("div", { className: "container-card-name", children: container.name }), _jsx("div", { className: "container-card-desc", children: container.detail }), _jsxs("div", { className: "container-card-total", children: [_jsx("strong", { children: formatNumber(sum) }), _jsx("span", { children: "unidades registradas" })] }), _jsx("div", { className: "mini-stock-list", children: ITEMS.map((item) => _jsxs("div", { children: [_jsx("span", { children: item.label }), _jsx("b", { children: formatNumber(rows.find((r) => r.item_key === item.key)?.quantity ?? 0) })] }, item.key)) })] }, container.id); }) })] }), _jsxs("section", { className: "lower-grid", children: [_jsxs("div", { className: "panel-card reference-panel", children: [_jsxs("div", { className: "panel-title", children: [_jsxs("div", { children: [_jsx("span", { className: "eyebrow", children: "REFERENCIA ADMINISTRATIVA" }), _jsx("h3", { children: "Stock comunicado" })] }), _jsx(Info, { size: 18 })] }), _jsxs("div", { className: "reference-stats", children: [_jsxs("div", { children: [_jsx("span", { children: "T\u00E1peres comunicados" }), _jsxs("strong", { children: ["528 ", _jsx("small", { children: "und." })] })] }), _jsxs("div", { children: [_jsx("span", { children: "Tenedores comunicados" }), _jsxs("strong", { children: ["522 ", _jsx("small", { children: "und." })] })] })] }), _jsx("p", { children: "Son cantidades de referencia del comunicado administrativo. No se distribuyen autom\u00E1ticamente entre las cajas." })] }), _jsxs("div", { className: "panel-card recent-panel", children: [_jsxs("div", { className: "panel-title", children: [_jsxs("div", { children: [_jsx("span", { className: "eyebrow", children: "SEGUIMIENTO" }), _jsx("h3", { children: "Actividad reciente" })] }), _jsxs("button", { className: "text-action", onClick: () => setPage('history'), children: ["Historial ", _jsx(ArrowUpRight, { size: 15 })] })] }), movements.length === 0 ? _jsxs("div", { className: "empty-state small-empty", children: [_jsx(History, { size: 22 }), _jsx("span", { children: "A\u00FAn no hay movimientos registrados." })] }) : movements.slice(0, 5).map((m) => _jsxs("div", { className: "recent-line", children: [_jsx("span", { className: `movement-dot ${m.delta >= 0 ? 'positive' : 'negative'}`, children: m.delta >= 0 ? _jsx(ArrowUpRight, { size: 13 }) : _jsx(ArrowDownRight, { size: 13 }) }), _jsxs("div", { className: "recent-info", children: [_jsx("strong", { children: itemLabel(m.item_key) }), _jsxs("span", { children: [containerLabel(m.container_id), " \u00B7 Registro QR"] })] }), _jsxs("b", { className: m.delta >= 0 ? 'positive-text' : 'negative-text', children: [m.delta > 0 ? '+' : '', formatNumber(m.delta)] })] }, m.id))] })] })] });
}
function StatCard({ label, value, unit, icon, tone, detail }) {
    return _jsxs("div", { className: "stat-card", children: [_jsx("div", { className: `stat-icon stat-${tone}`, children: icon }), _jsx("div", { className: "stat-label", children: label }), _jsxs("div", { className: "stat-value", children: [value, _jsx("small", { children: unit })] }), _jsx("div", { className: "stat-detail", children: detail })] });
}
function CountForm({ selected, selectedId, inventory, getQuantity, drafts, setDrafts, onSave, saving, canEdit }) {
    return _jsxs("div", { className: "count-form-wrap", children: [_jsxs("div", { className: "count-form-heading", children: [_jsxs("div", { children: [_jsx("strong", { children: "Registrar cantidades" }), _jsx("span", { children: "Escribe el total f\u00EDsico de cada suministro y guarda una sola vez." })] }), _jsx("span", { className: `qr-edit-badge ${canEdit ? 'enabled' : 'disabled'}`, children: canEdit ? 'QR de registro' : 'Solo consulta' })] }), _jsx("div", { className: "count-fields-grid", children: ITEMS.map((item) => { const quantity = getQuantity(selectedId, item.key); const key = `${selectedId}:${item.key}`; const draft = drafts[key] ?? String(quantity); return _jsxs("label", { className: "count-field", children: [_jsx("span", { children: item.label }), _jsxs("small", { children: ["Actual: ", formatNumber(quantity), " unidades"] }), _jsx("input", { type: "number", min: "0", max: "100000", step: "1", inputMode: "numeric", disabled: !canEdit || saving, value: draft, onFocus: (e) => e.currentTarget.select(), onChange: (e) => setDrafts((old) => ({ ...old, [key]: e.target.value.replace(/[^\d]/g, '').slice(0, 6) })) })] }, item.key); }) }), _jsx("button", { className: "btn btn-primary count-save-button", disabled: !canEdit || saving, onClick: onSave, children: saving ? _jsxs(_Fragment, { children: [_jsx(RefreshCw, { size: 17, className: "spin" }), " Guardando\u2026"] }) : _jsxs(_Fragment, { children: [_jsx(Check, { size: 18 }), " Guardar conteo de ", selected.name] }) }), _jsxs("div", { className: "count-form-footnote", children: [_jsx(ShieldCheck, { size: 15 }), " La hora se registra autom\u00E1ticamente. No necesitas ingresar tu nombre ni iniciar sesi\u00F3n."] })] });
}
function HistoryPage({ movements }) {
    const [filter, setFilter] = useState('todos');
    const filtered = movements.filter((m) => filter === 'todos' || m.movement_type === filter);
    return _jsxs("div", { className: "page-stack", children: [_jsxs("section", { className: "welcome-row", children: [_jsxs("div", { children: [_jsx("div", { className: "eyebrow", children: "TRAZABILIDAD" }), _jsx("h1", { children: "Historial de movimientos" }), _jsx("p", { children: "Registro de los cambios realizados en cada contenedor." })] }), _jsxs("div", { className: "capacity-chip", children: [_jsx(History, { size: 17 }), _jsx("span", { children: "\u00DAltimos 100 movimientos" })] })] }), _jsxs("section", { className: "panel-card history-card", children: [_jsxs("div", { className: "history-toolbar", children: [_jsxs("div", { children: [_jsx("h3", { children: "Registro de actividad" }), _jsxs("span", { children: [filtered.length, " movimientos visibles"] })] }), _jsxs("div", { className: "filter-select-wrap", children: [_jsx(SlidersHorizontal, { size: 15 }), _jsxs("select", { value: filter, onChange: (e) => setFilter(e.target.value), children: [_jsx("option", { value: "todos", children: "Todos" }), _jsx("option", { value: "ajuste", children: "Conteos f\u00EDsicos" })] }), _jsx(ChevronDown, { size: 14 })] })] }), filtered.length === 0 ? _jsxs("div", { className: "empty-state", children: [_jsx(History, { size: 28 }), _jsx("strong", { children: "Sin movimientos registrados" }), _jsx("span", { children: "Cuando se guarde un conteo, aparecer\u00E1 aqu\u00ED." })] }) : _jsx("div", { className: "table-scroll", children: _jsxs("table", { className: "movement-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Fecha y hora" }), _jsx("th", { children: "Contenedor" }), _jsx("th", { children: "Suministro" }), _jsx("th", { children: "Antes" }), _jsx("th", { children: "Despu\u00E9s" }), _jsx("th", { children: "Variaci\u00F3n" }), _jsx("th", { children: "Registro" })] }) }), _jsx("tbody", { children: filtered.map((m) => _jsxs("tr", { children: [_jsx("td", { className: "date-cell", children: formatDate(m.created_at) }), _jsx("td", { children: containerLabel(m.container_id) }), _jsx("td", { children: _jsx("strong", { children: itemLabel(m.item_key) }) }), _jsx("td", { children: formatNumber(m.quantity_before) }), _jsx("td", { children: _jsx("strong", { children: formatNumber(m.quantity_after) }) }), _jsx("td", { className: m.delta >= 0 ? 'positive-text' : 'negative-text', children: _jsxs("strong", { children: [m.delta > 0 ? '+' : '', formatNumber(m.delta)] }) }), _jsx("td", { children: "Registro QR" })] }, m.id)) })] }) })] })] });
}
function ProtocolPage() {
    return _jsxs("div", { className: "page-stack", children: [_jsxs("section", { className: "welcome-row", children: [_jsxs("div", { children: [_jsx("div", { className: "eyebrow", children: "DOCUMENTO DE REFERENCIA" }), _jsx("h1", { children: "Protocolo administrativo" }), _jsx("p", { children: "Procedimiento de entrega, retorno, lavado y conciliaci\u00F3n de suministros." })] }), _jsxs("div", { className: "protocol-stamp", children: [_jsx(ShieldCheck, { size: 18 }), _jsx("span", { children: "Uso interno APC" })] })] }), _jsxs("div", { className: "protocol-intro", children: [_jsx("div", { className: "protocol-intro-icon", children: _jsx(ClipboardList, { size: 22 }) }), _jsxs("div", { children: [_jsx("strong", { children: "Procedimientos a seguir \u00B7 De lunes a domingo" }), _jsx("p", { children: "Resumen operativo del comunicado administrativo con fecha de aplicaci\u00F3n 26 de octubre." })] })] }), _jsxs("section", { className: "protocol-steps", children: [_jsx(ProtocolStep, { number: "01", title: "Entrega y rotaci\u00F3n de transportados", responsible: "Brillith", text: "Responsable de la entrega de t\u00E1peres para el transportado y de la rotaci\u00F3n de los mismos dentro del radio indicado por la administraci\u00F3n (no menor a 500 metros, incluyendo Casevip y otros puntos)." }), _jsx(ProtocolStep, { number: "02", title: "Recepci\u00F3n y retorno de transportados", responsible: "Jonathan", text: "Recibe los transportados con la cantidad saliente de t\u00E1peres y tenedores. Al retorno, verifica y registra nuevamente las cantidades. Si falta alg\u00FAn suministro, reporta al Sr. Elar Espino y confirma el seguimiento hasta que llegue a su punto final." }), _jsx(ProtocolStep, { number: "03", title: "Recepci\u00F3n y conteo de coolers", responsible: "Ra\u00FAl \u00B7 apoyo de Cinthya", text: "Ra\u00FAl recepciona las cantidades salientes de los transportados. Cinthya brinda soporte en el conteo de los coolers, incluyendo t\u00E1peres y tenedores." }), _jsx(ProtocolStep, { number: "04", title: "Conteo despu\u00E9s del lavado", responsible: "Ra\u00FAl", text: "Al finalizar el lavado, informa a Brillith la cantidad de t\u00E1peres y tenedores disponibles para salida durante el d\u00EDa, para realizar el cuadre con el stock vigente." }), _jsx(ProtocolStep, { number: "05", title: "Notificaci\u00F3n del stock vigente", responsible: "Brillith", text: "Brillith comunica el stock actualizado de ambos suministros a la administraci\u00F3n y al equipo correspondiente." })] }), _jsxs("section", { className: "panel-card protocol-reference", children: [_jsxs("div", { className: "panel-title", children: [_jsxs("div", { children: [_jsx("span", { className: "eyebrow", children: "REFERENCIA DEL COMUNICADO" }), _jsx("h3", { children: "Stock informado inicialmente" })] }), _jsx("span", { className: "reference-date", children: "26 OCT 2026" })] }), _jsxs("div", { className: "protocol-stock-grid", children: [_jsxs("div", { children: [_jsx("span", { children: "T\u00E1peres" }), _jsxs("strong", { children: ["528 ", _jsx("small", { children: "unidades" })] }), _jsx("p", { children: "348 + 100 de 1.1 L + 80 de 1 L" })] }), _jsxs("div", { children: [_jsx("span", { children: "Tenedores" }), _jsxs("strong", { children: ["522 ", _jsx("small", { children: "unidades" })] }), _jsx("p", { children: "402 usados + 120 nuevos" })] })] }), _jsxs("div", { className: "protocol-warning", children: [_jsx(AlertTriangle, { size: 17 }), _jsx("p", { children: "El comunicado indica que no se consideran 14 t\u00E1peres comprados anteriormente y menciona una posible diferencia de un t\u00E1per, con tapa disponible. Verificar f\u00EDsicamente antes de establecer el stock inicial en el sistema." })] })] }), _jsxs("div", { className: "info-strip", children: [_jsx(Info, { size: 17 }), _jsx("span", { children: "El sistema registra cantidades por contenedor. La asignaci\u00F3n de responsabilidades y las comunicaciones oficiales siguen el instructivo de la administraci\u00F3n." })] })] });
}
function ProtocolStep({ number, title, responsible, text }) {
    return _jsxs("article", { className: "protocol-step", children: [_jsx("div", { className: "step-number", children: number }), _jsxs("div", { className: "step-body", children: [_jsxs("div", { className: "step-title-row", children: [_jsx("h3", { children: title }), _jsx("span", { children: responsible })] }), _jsx("p", { children: text })] })] });
}
export default App;
