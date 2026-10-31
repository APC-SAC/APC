import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, ClipboardList, Download, History, Home, Info, PlusSquare, QrCode, RefreshCw, Wifi, WifiOff, CheckCircle2, ChevronRight, Plus, Minus, Printer, Link as LinkIcon, } from 'lucide-react';
import { supabase } from './lib/supabase.js';
import { readInventoryCache, readPendingQueue, writeInventoryCache, writePendingQueue } from './lib/offline.js';
import { ITEM_DEFS } from './lib/types.js';
const BASE = window.APC_CONFIG?.BASE_URL || '/APC/';
const MAX_QTY = 100000;
const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const formatNumber = (n) => new Intl.NumberFormat('es-PE').format(n);
const formatDate = (value) => new Intl.DateTimeFormat('es-PE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
const safeName = (text) => text.replace(/[^A-Za-zÁÉÍÓÚáéíóúÑñ0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const qrApi = (url) => `https://api.qrserver.com/v1/create-qr-code/?size=800x800&margin=20&data=${encodeURIComponent(url)}`;
const protocolText = [
    'Brillith es responsable de la entrega y rotación de tápers.',
    'Jonathan recibe el transportado saliente y retorna tápers y tenedores.',
    'Raúl recepciona las cantidades retornadas y cuenta con apoyo de Cinthya.',
    'Al finalizar el lavado, Raúl informa las cantidades contadas a Brillith.',
    'Brillith comunica el stock final del día.',
    'Está prohibido tomar tápers para uso personal o salidas no autorizadas.',
];
function getQrAccess() {
    const params = new URLSearchParams(window.location.search);
    return { containerId: params.get('c') ?? '', token: params.get('k') ?? '' };
}
function getDefaultDescription(kind) {
    if (kind === 'caja')
        return 'Contenedor de almacenamiento';
    if (kind === 'tacho')
        return 'Contenedor de rotación';
    return 'Zona adicional';
}
function App() {
    const qrAccess = useMemo(getQrAccess, []);
    const [page, setPage] = useState(qrAccess.containerId ? 'containers' : 'overview');
    const [containers, setContainers] = useState([]);
    const [inventory, setInventory] = useState(() => readInventoryCache());
    const [movements, setMovements] = useState([]);
    const [selectedContainer, setSelectedContainer] = useState(qrAccess.containerId || 'caja-01');
    const [drafts, setDrafts] = useState({});
    const [online, setOnline] = useState(navigator.onLine);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [pending, setPending] = useState(() => readPendingQueue());
    const [toast, setToast] = useState(null);
    const [qrPreview, setQrPreview] = useState(null);
    const [createName, setCreateName] = useState('');
    const [createKind, setCreateKind] = useState('caja');
    const [createDescription, setCreateDescription] = useState('');
    const queueRef = useRef(readPendingQueue());
    const toastTimer = useRef(undefined);
    const notify = useCallback((next) => {
        setToast(next);
        if (toastTimer.current)
            window.clearTimeout(toastTimer.current);
        toastTimer.current = window.setTimeout(() => setToast(null), 3200);
    }, []);
    const setQueue = useCallback((next) => {
        queueRef.current = next;
        setPending(next);
        writePendingQueue(next);
    }, []);
    const loadContainers = useCallback(async () => {
        if (!supabase)
            return [];
        const { data, error } = await supabase.from('apci_containers')
            .select('id,name,description,kind,sort_order,active,created_at')
            .eq('active', true)
            .order('sort_order')
            .order('name');
        if (error)
            throw error;
        return (data ?? []);
    }, []);
    const loadInventory = useCallback(async () => {
        if (!supabase)
            return readInventoryCache();
        const { data, error } = await supabase.from('apci_inventory')
            .select('id,container_id,item_key,quantity,updated_at')
            .order('container_id').order('item_key');
        if (error)
            throw error;
        const rows = (data ?? []);
        writeInventoryCache(rows);
        return rows;
    }, []);
    const loadMovements = useCallback(async () => {
        if (!supabase)
            return [];
        const { data, error } = await supabase.from('apci_movements')
            .select('id,container_id,item_key,delta,quantity_before,quantity_after,movement_type,note,created_at')
            .order('created_at', { ascending: false }).limit(120);
        if (error)
            return [];
        return (data ?? []);
    }, []);
    const initializeData = useCallback(async () => {
        setLoading(true);
        try {
            const [nextContainers, nextInventory, nextMovements] = await Promise.all([
                loadContainers(),
                loadInventory().catch(() => readInventoryCache()),
                loadMovements(),
            ]);
            setContainers(nextContainers);
            setInventory(nextInventory);
            setMovements(nextMovements);
            if (!nextContainers.some((c) => c.id === selectedContainer) && nextContainers[0]) {
                setSelectedContainer(nextContainers[0].id);
            }
        }
        catch (error) {
            notify({ type: 'error', text: error?.message || 'No se pudo conectar con Supabase.' });
            setInventory(readInventoryCache());
        }
        finally {
            setLoading(false);
        }
    }, [loadContainers, loadInventory, loadMovements, notify, selectedContainer]);
    useEffect(() => { initializeData(); }, [initializeData]);
    useEffect(() => {
        if (!supabase)
            return;
        const channel = supabase.channel('apci-live-v2')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'apci_inventory' }, async () => {
            if (!navigator.onLine)
                return;
            const nextInventory = await loadInventory().catch(() => readInventoryCache());
            setInventory(nextInventory);
        })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'apci_movements' }, async () => {
            if (!navigator.onLine)
                return;
            const nextMovements = await loadMovements();
            setMovements(nextMovements);
        })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'apci_containers' }, async () => {
            if (!navigator.onLine)
                return;
            const nextContainers = await loadContainers().catch(() => []);
            setContainers(nextContainers);
        })
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [loadContainers, loadInventory, loadMovements]);
    const selectedInfo = useMemo(() => containers.find((container) => container.id === selectedContainer) ?? null, [containers, selectedContainer]);
    const getQuantity = useCallback((containerId, itemKey) => {
        const row = inventory.find((item) => item.container_id === containerId && item.item_key === itemKey);
        return row?.quantity ?? 0;
    }, [inventory]);
    const selectedTotal = useMemo(() => ITEM_DEFS.reduce((sum, item) => sum + getQuantity(selectedContainer, item.key), 0), [getQuantity, selectedContainer]);
    const totals = useMemo(() => ITEM_DEFS.map((item) => ({
        ...item,
        quantity: inventory.filter((row) => row.item_key === item.key).reduce((sum, row) => sum + row.quantity, 0),
    })), [inventory]);
    const totalUnits = useMemo(() => totals.reduce((sum, item) => sum + item.quantity, 0), [totals]);
    useEffect(() => {
        const nextDrafts = {};
        containers.forEach((container) => {
            ITEM_DEFS.forEach((item) => {
                nextDrafts[`${container.id}:${item.key}`] = String(getQuantity(container.id, item.key));
            });
        });
        setDrafts((old) => ({ ...nextDrafts, ...old }));
    }, [containers, getQuantity]);
    const syncPending = useCallback(async () => {
        if (!supabase || !navigator.onLine || queueRef.current.length === 0)
            return;
        setSyncing(true);
        let queue = [...queueRef.current];
        for (const operation of queue) {
            const { error } = await supabase.rpc('apci_save_container_stock', {
                p_container_id: operation.container_id,
                p_access_token: operation.access_token,
                p_quantities: operation.quantities,
                p_expected: operation.expected,
            });
            if (error) {
                notify({ type: 'error', text: error.message });
                break;
            }
            queue = queue.filter((item) => item.id !== operation.id);
            setQueue(queue);
        }
        setSyncing(false);
        const nextInventory = await loadInventory().catch(() => readInventoryCache());
        const nextMovements = await loadMovements();
        setInventory(nextInventory);
        setMovements(nextMovements);
    }, [loadInventory, loadMovements, notify, setQueue]);
    useEffect(() => {
        const onOnline = () => { setOnline(true); window.setTimeout(syncPending, 500); };
        const onOffline = () => setOnline(false);
        window.addEventListener('online', onOnline);
        window.addEventListener('offline', onOffline);
        return () => {
            window.removeEventListener('online', onOnline);
            window.removeEventListener('offline', onOffline);
        };
    }, [syncPending]);
    const canEdit = Boolean(qrAccess.containerId && qrAccess.containerId === selectedContainer && qrAccess.token);
    const updateDraft = (containerId, itemKey, value) => {
        const clean = value.replace(/[^0-9]/g, '').slice(0, 6);
        setDrafts((old) => ({ ...old, [`${containerId}:${itemKey}`]: clean }));
    };
    const stepDraft = (containerId, itemKey, delta) => {
        const key = `${containerId}:${itemKey}`;
        const current = Number(drafts[key] || getQuantity(containerId, itemKey) || 0);
        const next = Math.max(0, Math.min(MAX_QTY, current + delta));
        setDrafts((old) => ({ ...old, [key]: String(next) }));
    };
    const saveContainer = async () => {
        if (!selectedInfo)
            return;
        if (!canEdit) {
            notify({ type: 'error', text: 'Para guardar cambios, debes abrir el contenedor desde su QR.' });
            return;
        }
        const quantities = {};
        const expected = {};
        for (const item of ITEM_DEFS) {
            const raw = drafts[`${selectedContainer}:${item.key}`] || '0';
            const value = Number(raw);
            if (!Number.isFinite(value) || value < 0 || value > MAX_QTY) {
                notify({ type: 'error', text: `Cantidad inválida en ${item.label}.` });
                return;
            }
            quantities[item.key] = value;
            expected[item.key] = getQuantity(selectedContainer, item.key);
        }
        setSaving(true);
        const op = {
            id: makeId(), kind: 'container-set', container_id: selectedContainer,
            access_token: qrAccess.token, quantities, expected, created_at: new Date().toISOString(),
        };
        if (!navigator.onLine || !supabase) {
            const optimistic = inventory.map((row) => row.container_id === selectedContainer
                ? { ...row, quantity: quantities[row.item_key], updated_at: new Date().toISOString() }
                : row);
            setInventory(optimistic);
            writeInventoryCache(optimistic);
            setQueue([...queueRef.current, op]);
            notify({ type: 'info', text: 'Sin internet. El conteo quedó guardado y se enviará luego.' });
            setSaving(false);
            return;
        }
        const { error } = await supabase.rpc('apci_save_container_stock', {
            p_container_id: selectedContainer,
            p_access_token: qrAccess.token,
            p_quantities: quantities,
            p_expected: expected,
        });
        if (error) {
            notify({ type: 'error', text: error.message });
            setSaving(false);
            return;
        }
        notify({ type: 'success', text: `Conteo guardado en ${selectedInfo.name}.` });
        const nextInventory = await loadInventory().catch(() => readInventoryCache());
        const nextMovements = await loadMovements();
        setInventory(nextInventory);
        setMovements(nextMovements);
        setSaving(false);
    };
    const createContainer = async () => {
        const name = safeName(createName) || undefined;
        const description = safeName(createDescription) || getDefaultDescription(createKind);
        if (!supabase) {
            notify({ type: 'error', text: 'Supabase no está configurado.' });
            return;
        }
        const { data, error } = await supabase.rpc('apci_create_container', {
            p_kind: createKind,
            p_name: name || null,
            p_description: description || null,
        });
        if (error) {
            notify({ type: 'error', text: error.message });
            return;
        }
        const result = Array.isArray(data) ? data[0] : data;
        if (!result?.container_id || !result?.access_token) {
            notify({ type: 'error', text: 'No se pudo crear el contenedor.' });
            return;
        }
        const nextContainers = await loadContainers().catch(() => []);
        const nextInventory = await loadInventory().catch(() => readInventoryCache());
        setContainers(nextContainers);
        setInventory(nextInventory);
        setSelectedContainer(result.container_id);
        setPage('manage');
        const url = `${window.location.origin}${BASE}?c=${encodeURIComponent(result.container_id)}&k=${encodeURIComponent(result.access_token)}`;
        setQrPreview({ name: result.name, url });
        setCreateName('');
        setCreateDescription('');
        setCreateKind('caja');
        notify({ type: 'success', text: `${result.name} creado correctamente.` });
    };
    const openQrPreview = async (container) => {
        if (!supabase)
            return;
        const { data, error } = await supabase.rpc('apci_reset_container_token', { p_container_id: container.id });
        if (error) {
            notify({ type: 'error', text: error.message });
            return;
        }
        const result = Array.isArray(data) ? data[0] : data;
        if (!result?.access_token) {
            notify({ type: 'error', text: 'No se pudo generar el QR.' });
            return;
        }
        const url = `${window.location.origin}${BASE}?c=${encodeURIComponent(container.id)}&k=${encodeURIComponent(result.access_token)}`;
        setQrPreview({ name: result.name || container.name, url });
        notify({ type: 'success', text: `QR generado para ${container.name}.` });
    };
    const renderOverview = () => (_jsxs("div", { className: "page-stack", children: [_jsxs("section", { className: "hero-card", children: [_jsxs("div", { children: [_jsx("div", { className: "eyebrow", children: "APC Corporaci\u00F3n \u00B7 Inventario" }), _jsx("h1", { children: "Control r\u00E1pido y claro de t\u00E1pers, tapas y tenedores" }), _jsx("p", { children: "Escanea el QR del contenedor, registra la cantidad real y guarda. En PC puedes revisar el resumen, el historial y crear nuevas cajas o tachos." }), _jsxs("div", { className: "hero-actions", children: [_jsxs("button", { className: "primary-btn", onClick: () => setPage('containers'), children: [_jsx(Boxes, { size: 16 }), " Ver contenedores"] }), _jsxs("button", { className: "secondary-btn", onClick: () => setPage('manage'), children: [_jsx(PlusSquare, { size: 16 }), " Agregar caja o tacho"] })] })] }), _jsxs("div", { className: "hero-summary-grid", children: [_jsxs("div", { className: "summary-box", children: [_jsx("span", { children: "Contenedores" }), _jsx("strong", { children: containers.length })] }), _jsxs("div", { className: "summary-box", children: [_jsx("span", { children: "Unidades totales" }), _jsx("strong", { children: formatNumber(totalUnits) })] }), _jsxs("div", { className: "summary-box", children: [_jsx("span", { children: "Pendientes" }), _jsx("strong", { children: pending.length })] }), _jsxs("div", { className: "summary-box", children: [_jsx("span", { children: "Estado" }), _jsx("strong", { children: online ? 'En línea' : 'Sin internet' })] })] })] }), _jsx("section", { className: "totals-grid", children: totals.map((item) => (_jsxs("article", { className: "total-card", children: [_jsxs("div", { className: "total-card-top", children: [_jsxs("div", { children: [_jsx("small", { children: item.short }), _jsx("h3", { children: item.label })] }), item.image ? _jsx("img", { src: item.image, alt: item.label, className: "item-thumb" }) : _jsx("div", { className: "item-badge", style: { background: item.accent }, children: item.short.slice(0, 1) })] }), _jsx("strong", { children: formatNumber(item.quantity) }), _jsx("span", { children: item.unit })] }, item.key))) }), _jsxs("section", { className: "desktop-grid", children: [_jsxs("div", { className: "panel-card", children: [_jsxs("div", { className: "section-head", children: [_jsx("h2", { children: "Contenedores" }), _jsxs("button", { className: "text-btn", onClick: () => setPage('containers'), children: ["Abrir ", _jsx(ChevronRight, { size: 14 })] })] }), _jsx("div", { className: "container-grid", children: containers.map((container) => {
                                    const total = ITEM_DEFS.reduce((sum, item) => sum + getQuantity(container.id, item.key), 0);
                                    return (_jsxs("button", { className: `container-card ${selectedContainer === container.id ? 'active' : ''}`, onClick: () => { setSelectedContainer(container.id); setPage('containers'); }, children: [_jsxs("div", { className: "container-card-top", children: [_jsx("span", { children: container.kind === 'tacho' ? 'Tacho' : 'Caja' }), _jsx("strong", { children: container.name })] }), _jsx("p", { children: container.description }), _jsxs("div", { className: "container-card-total", children: [formatNumber(total), " ", _jsx("small", { children: "unidades" })] })] }, container.id));
                                }) })] }), _jsxs("div", { className: "panel-card", children: [_jsxs("div", { className: "section-head", children: [_jsx("h2", { children: "\u00DAltimos movimientos" }), _jsxs("button", { className: "text-btn", onClick: () => setPage('history'), children: ["Ver todo ", _jsx(ChevronRight, { size: 14 })] })] }), _jsxs("div", { className: "history-mini-list", children: [movements.slice(0, 8).map((move) => (_jsxs("div", { className: "history-mini-row", children: [_jsxs("div", { children: [_jsx("strong", { children: containerName(move.container_id, containers) }), _jsx("span", { children: itemLabel(move.item_key) })] }), _jsxs("div", { className: `delta-pill ${move.delta >= 0 ? 'plus' : 'minus'}`, children: [move.delta >= 0 ? '+' : '', move.delta] })] }, move.id))), movements.length === 0 && _jsx("p", { className: "empty-note", children: "A\u00FAn no hay movimientos registrados." })] })] })] })] }));
    const renderContainerEditor = () => (_jsxs("div", { className: "page-stack", children: [_jsx("div", { className: "section-head", children: _jsxs("div", { children: [_jsx("div", { className: "eyebrow", children: "Control por contenedor" }), _jsx("h2", { children: selectedInfo?.name || 'Contenedor' })] }) }), _jsx("div", { className: "container-switch-row", children: containers.map((container) => (_jsx("button", { className: `container-pill ${selectedContainer === container.id ? 'active' : ''}`, onClick: () => setSelectedContainer(container.id), children: container.name }, container.id))) }), _jsxs("section", { className: "panel-card editor-card", children: [_jsxs("div", { className: "editor-head", children: [_jsxs("div", { children: [_jsx("div", { className: "eyebrow", children: "Registro r\u00E1pido" }), _jsx("h3", { children: selectedInfo?.name }), _jsxs("p", { children: [selectedInfo?.description, ". ", canEdit ? 'Este QR permite guardar cambios.' : 'Abre el contenedor desde su QR para poder guardar.'] })] }), _jsxs("div", { className: "editor-total", children: [_jsx("span", { children: "Total actual" }), _jsx("strong", { children: formatNumber(selectedTotal) })] })] }), _jsx("div", { className: "editor-grid", children: ITEM_DEFS.map((item) => {
                            const key = `${selectedContainer}:${item.key}`;
                            return (_jsxs("article", { className: "count-card", children: [_jsxs("div", { className: "count-card-top", children: [item.image ? _jsx("img", { src: item.image, alt: item.label, className: "count-image" }) : _jsx("div", { className: "count-placeholder", style: { background: item.accent }, children: item.short.slice(0, 1) }), _jsxs("div", { children: [_jsx("small", { children: item.short }), _jsx("h4", { children: item.label }), _jsxs("span", { children: ["Actual: ", formatNumber(getQuantity(selectedContainer, item.key))] })] })] }), _jsxs("div", { className: "count-controls", children: [_jsxs("button", { type: "button", onClick: () => stepDraft(selectedContainer, item.key, -5), children: [_jsx(Minus, { size: 14 }), "5"] }), _jsxs("button", { type: "button", onClick: () => stepDraft(selectedContainer, item.key, -1), children: [_jsx(Minus, { size: 14 }), "1"] }), _jsx("input", { inputMode: "numeric", pattern: "[0-9]*", value: drafts[key] ?? '', onChange: (e) => updateDraft(selectedContainer, item.key, e.target.value), placeholder: "0" }), _jsxs("button", { type: "button", onClick: () => stepDraft(selectedContainer, item.key, 1), children: [_jsx(Plus, { size: 14 }), "1"] }), _jsxs("button", { type: "button", onClick: () => stepDraft(selectedContainer, item.key, 5), children: [_jsx(Plus, { size: 14 }), "5"] })] })] }, item.key));
                        }) }), _jsxs("div", { className: "editor-actions", children: [_jsxs("button", { className: "primary-btn large", disabled: saving, onClick: saveContainer, children: [_jsx(CheckCircle2, { size: 18 }), saving ? 'Guardando...' : `Guardar conteo de ${selectedInfo?.name || ''}`] }), _jsx("div", { className: `inline-badge ${canEdit ? 'ok' : 'warn'}`, children: canEdit ? 'QR válido para guardar' : 'Modo solo lectura' })] })] })] }));
    const renderHistory = () => (_jsxs("div", { className: "page-stack", children: [_jsx("div", { className: "section-head", children: _jsxs("div", { children: [_jsx("div", { className: "eyebrow", children: "Historial" }), _jsx("h2", { children: "Movimientos recientes" })] }) }), _jsx("section", { className: "panel-card", children: _jsxs("div", { className: "history-list", children: [movements.map((move) => (_jsxs("article", { className: "history-row", children: [_jsxs("div", { className: "history-row-main", children: [_jsx("strong", { children: containerName(move.container_id, containers) }), _jsxs("span", { children: [itemLabel(move.item_key), " \u00B7 ", formatDate(move.created_at)] })] }), _jsxs("div", { className: `delta-pill ${move.delta >= 0 ? 'plus' : 'minus'}`, children: [move.delta >= 0 ? '+' : '', move.delta] }), _jsxs("div", { className: "history-row-side", children: [formatNumber(move.quantity_before), " \u2192 ", formatNumber(move.quantity_after)] })] }, move.id))), movements.length === 0 && _jsx("p", { className: "empty-note", children: "No hay movimientos para mostrar." })] }) })] }));
    const renderProtocol = () => (_jsx("div", { className: "page-stack", children: _jsxs("section", { className: "panel-card", children: [_jsx("div", { className: "section-head", children: _jsxs("div", { children: [_jsx("div", { className: "eyebrow", children: "Instructivo administrativo" }), _jsx("h2", { children: "Procedimiento vigente" })] }) }), _jsx("div", { className: "protocol-list", children: protocolText.map((text, index) => (_jsxs("div", { className: "protocol-item", children: [_jsx("span", { children: index + 1 }), _jsx("p", { children: text })] }, index))) })] }) }));
    const renderManage = () => (_jsxs("div", { className: "page-stack", children: [_jsxs("section", { className: "panel-card manage-grid", children: [_jsxs("div", { children: [_jsx("div", { className: "section-head", children: _jsxs("div", { children: [_jsx("div", { className: "eyebrow", children: "Configuraci\u00F3n" }), _jsx("h2", { children: "Agregar caja o tacho" })] }) }), _jsxs("div", { className: "manage-form", children: [_jsxs("label", { children: [_jsx("span", { children: "Tipo" }), _jsxs("select", { value: createKind, onChange: (e) => setCreateKind(e.target.value), children: [_jsx("option", { value: "caja", children: "Caja" }), _jsx("option", { value: "tacho", children: "Tacho" }), _jsx("option", { value: "otro", children: "Otro" })] })] }), _jsxs("label", { children: [_jsx("span", { children: "Nombre (opcional)" }), _jsx("input", { value: createName, onChange: (e) => setCreateName(e.target.value), placeholder: "Ejemplo: Caja 04" })] }), _jsxs("label", { children: [_jsx("span", { children: "Descripci\u00F3n" }), _jsx("input", { value: createDescription, onChange: (e) => setCreateDescription(e.target.value), placeholder: getDefaultDescription(createKind) })] }), _jsxs("button", { className: "primary-btn", onClick: createContainer, children: [_jsx(PlusSquare, { size: 16 }), " Crear contenedor y generar QR"] })] })] }), _jsxs("div", { children: [_jsx("div", { className: "section-head", children: _jsxs("div", { children: [_jsx("div", { className: "eyebrow", children: "Impresi\u00F3n" }), _jsx("h2", { children: "QR decorado" })] }) }), qrPreview ? _jsx(QrPrintCard, { preview: qrPreview }) : _jsx("p", { className: "empty-note", children: "Cuando crees una nueva caja o tacho, aqu\u00ED aparecer\u00E1 su QR decorado listo para imprimir." })] })] }), _jsxs("section", { className: "panel-card", children: [_jsx("div", { className: "section-head", children: _jsx("div", { children: _jsx("h2", { children: "Contenedores actuales" }) }) }), _jsx("div", { className: "container-grid compact", children: containers.map((container) => (_jsxs("div", { className: "container-card static", children: [_jsxs("div", { className: "container-card-top", children: [_jsx("span", { children: container.kind || 'caja' }), _jsx("strong", { children: container.name })] }), _jsx("p", { children: container.description }), _jsx("div", { className: "container-actions", children: _jsxs("button", { className: "secondary-btn", onClick: () => openQrPreview(container), children: [_jsx(QrCode, { size: 15 }), " Ver QR"] }) })] }, container.id))) })] })] }));
    return (_jsxs("div", { className: "app-shell", children: [_jsxs("aside", { className: "sidebar", children: [_jsxs("div", { className: "brand-block", children: [_jsx("img", { src: `${BASE}apc-logo.png`, alt: "APC" }), _jsxs("div", { children: [_jsx("strong", { children: "APC Inventario" }), _jsx("span", { children: "Control de suministros" })] })] }), _jsxs("nav", { className: "side-nav", children: [_jsxs("button", { className: page === 'overview' ? 'active' : '', onClick: () => setPage('overview'), children: [_jsx(Home, { size: 18 }), " Resumen"] }), _jsxs("button", { className: page === 'containers' ? 'active' : '', onClick: () => setPage('containers'), children: [_jsx(Boxes, { size: 18 }), " Contenedores"] }), _jsxs("button", { className: page === 'history' ? 'active' : '', onClick: () => setPage('history'), children: [_jsx(History, { size: 18 }), " Movimientos"] }), _jsxs("button", { className: page === 'manage' ? 'active' : '', onClick: () => setPage('manage'), children: [_jsx(QrCode, { size: 18 }), " Cajas y QR"] }), _jsxs("button", { className: page === 'protocol' ? 'active' : '', onClick: () => setPage('protocol'), children: [_jsx(ClipboardList, { size: 18 }), " Protocolo"] })] }), _jsxs("div", { className: "sidebar-help", children: [_jsx(Info, { size: 15 }), _jsx("p", { children: "Para guardar cambios, siempre escanea el QR del contenedor. Para ver el resumen, puedes entrar tambi\u00E9n desde PC." })] })] }), _jsxs("main", { className: "main-area", children: [_jsxs("header", { className: "topbar", children: [_jsxs("div", { children: [_jsx("div", { className: "eyebrow", children: "APC Corporaci\u00F3n" }), _jsx("h1", { children: page === 'overview' ? 'Inventario de suministros' : page === 'containers' ? 'Conteo por contenedor' : page === 'history' ? 'Movimientos' : page === 'manage' ? 'Cajas y QR' : 'Protocolo administrativo' })] }), _jsxs("div", { className: "topbar-actions", children: [_jsx("button", { className: "secondary-icon-btn", onClick: () => initializeData(), title: "Actualizar", children: _jsx(RefreshCw, { size: 17 }) }), _jsxs("div", { className: `status-chip ${online ? 'online' : 'offline'}`, children: [online ? _jsx(Wifi, { size: 15 }) : _jsx(WifiOff, { size: 15 }), online ? 'En línea' : 'Sin internet'] })] })] }), loading ? _jsx("div", { className: "panel-card", children: _jsx("p", { className: "empty-note", children: "Cargando datos..." }) }) : (_jsxs(_Fragment, { children: [page === 'overview' && renderOverview(), page === 'containers' && renderContainerEditor(), page === 'history' && renderHistory(), page === 'protocol' && renderProtocol(), page === 'manage' && renderManage()] }))] }), toast && _jsx("div", { className: `toast ${toast.type}`, children: toast.text }), qrPreview && _jsx(QrModal, { preview: qrPreview, onClose: () => setQrPreview(null) })] }));
}
function containerName(id, containers) {
    return containers.find((container) => container.id === id)?.name ?? id;
}
function itemLabel(key) {
    return ITEM_DEFS.find((item) => item.key === key)?.label ?? key;
}
function QrPrintCard({ preview }) {
    return (_jsxs("div", { className: "qr-preview-card", id: "qr-card-print", children: [_jsxs("div", { className: "qr-frame", children: [_jsxs("div", { className: "qr-topline", children: [_jsx("img", { src: `${BASE}apc-logo.png`, alt: "APC" }), _jsxs("div", { children: [_jsx("strong", { children: "APC CORPORACI\u00D3N" }), _jsx("span", { children: "Inventario de suministros" })] })] }), _jsx("div", { className: "qr-image-wrap", children: _jsx("img", { src: qrApi(preview.url), alt: `QR ${preview.name}` }) }), _jsx("div", { className: "qr-name-pill", children: preview.name.toUpperCase() }), _jsx("div", { className: "qr-sub", children: "ESCANEAR PARA ACTUALIZAR INVENTARIO" })] }), _jsxs("div", { className: "qr-card-actions", children: [_jsxs("button", { className: "secondary-btn", onClick: () => navigator.clipboard.writeText(preview.url), children: [_jsx(LinkIcon, { size: 15 }), " Copiar enlace"] }), _jsxs("button", { className: "secondary-btn", onClick: () => window.open(qrApi(preview.url), '_blank'), children: [_jsx(Download, { size: 15 }), " Abrir QR"] }), _jsxs("button", { className: "primary-btn", onClick: () => window.print(), children: [_jsx(Printer, { size: 15 }), " Imprimir"] })] })] }));
}
function QrModal({ preview, onClose }) {
    return (_jsx("div", { className: "modal-backdrop", onClick: onClose, children: _jsxs("div", { className: "modal-card", onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { className: "modal-head", children: [_jsx("h3", { children: "QR listo para imprimir" }), _jsx("button", { onClick: onClose, children: "\u00D7" })] }), _jsx(QrPrintCard, { preview: preview })] }) }));
}
export default App;
