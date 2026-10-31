import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, ClipboardList, Download, History, Home, Info, PlusSquare, QrCode, RefreshCw, Wifi, WifiOff, CheckCircle2, Plus, Minus, Printer, Link as LinkIcon, Edit3, Trash2, Save, X, Menu, } from 'lucide-react';
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
const TACHO_OPTIONS = [
    { value: 'tapers', label: 'Solo tapas' },
    { value: 'tenedores', label: 'Solo tenedores' },
    { value: 'mixto', label: 'Tapas y tenedores' },
];
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
        return 'Almacenamiento de tápers Rey y GyG';
    if (kind === 'tacho')
        return 'Almacenamiento de suministros sin tápers';
    return 'Zona adicional';
}
function parseRpcResult(data) {
    return Array.isArray(data) ? (data[0] ?? {}) : (data ?? {});
}
function visibleKeysForContainer(container) {
    if (!container)
        return [];
    const kind = container.kind || (String(container.id || '').startsWith('tacho-') ? 'tacho' : 'caja');
    // Las CAJAS guardan exclusivamente tápers (Rey o GyG).
    if (kind === 'caja')
        return ['taper_rey', 'taper_gyg'];
    // Los TACHOS nunca guardan tápers. Pueden guardar tapas, tenedores o ambos.
    if (kind === 'tacho') {
        if (container.item_group === 'tenedores')
            return ['tenedores'];
        if (container.item_group === 'mixto')
            return ['tapas', 'tenedores'];
        return ['tapas'];
    }
    // Compatibilidad con contenedores antiguos de tipo "otro".
    if (container.item_group === 'tenedores')
        return ['tenedores'];
    if (container.item_group === 'mixto')
        return ['tapas', 'tenedores'];
    return ['taper_rey', 'taper_gyg'];
}
function containerContentsLabel(container) {
    if (!container)
        return 'Suministros';
    const kind = container.kind || (String(container.id || '').startsWith('tacho-') ? 'tacho' : 'caja');
    if (kind === 'caja')
        return 'Solo tápers · Rey y GyG';
    if (kind === 'tacho') {
        if (container.item_group === 'tenedores')
            return 'Solo tenedores';
        if (container.item_group === 'mixto')
            return 'Tapas y tenedores';
        return 'Solo tapas';
    }
    return visibleKeysForContainer(container).map((key) => ITEM_DEFS.find((item) => item.key === key)?.label || key).join(' y ');
}
function App() {
    const qrAccess = useMemo(getQrAccess, []);
    const qrOnlyMode = Boolean(qrAccess.containerId && qrAccess.token);
    const [page, setPage] = useState(qrOnlyMode ? 'containers' : 'overview');
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
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
    const [createGroup, setCreateGroup] = useState('mixto');
    const [editingId, setEditingId] = useState(null);
    const [editName, setEditName] = useState('');
    const [editKind, setEditKind] = useState('caja');
    const [editDescription, setEditDescription] = useState('');
    const [editGroup, setEditGroup] = useState('mixto');
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
        const query = () => supabase.from('apci_containers')
            .select('id,name,description,kind,item_group,sort_order,active,created_at')
            .eq('active', true)
            .order('sort_order')
            .order('name');
        const { data, error } = await query();
        if (error) {
            // Compatibilidad temporal: si la migración SQL aún no añadió item_group,
            // no bloqueamos la lectura de las cajas existentes.
            if (/item_group.*does not exist|column .*item_group/i.test(error.message || '')) {
                const fallback = await supabase.from('apci_containers')
                    .select('id,name,description,kind,sort_order,active,created_at')
                    .eq('active', true)
                    .order('sort_order')
                    .order('name');
                if (fallback.error)
                    throw fallback.error;
                return (fallback.data ?? []).map((container) => ({ ...container, item_group: 'tapers' }));
            }
            throw error;
        }
        return (data ?? []).map((container) => ({ ...container, item_group: container.item_group || 'tapers' }));
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
        const channel = supabase.channel('apci-live-v3')
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
    const activeContainerIds = useMemo(() => new Set(containers.map((container) => container.id)), [containers]);
    const selectedInfo = useMemo(() => containers.find((container) => container.id === selectedContainer) ?? null, [containers, selectedContainer]);
    const visibleItems = useMemo(() => {
        const keys = visibleKeysForContainer(selectedInfo);
        return ITEM_DEFS.filter((item) => keys.includes(item.key));
    }, [selectedInfo]);
    const getQuantity = useCallback((containerId, itemKey) => {
        const row = inventory.find((item) => item.container_id === containerId && item.item_key === itemKey);
        return row?.quantity ?? 0;
    }, [inventory]);
    const selectedTotal = useMemo(() => visibleItems.reduce((sum, item) => sum + getQuantity(selectedContainer, item.key), 0), [getQuantity, selectedContainer, visibleItems]);
    const totals = useMemo(() => ITEM_DEFS.map((item) => ({
        ...item,
        quantity: inventory
            .filter((row) => {
            const container = containers.find((entry) => entry.id === row.container_id);
            if (!container || !activeContainerIds.has(row.container_id) || row.item_key !== item.key)
                return false;
            return visibleKeysForContainer(container).includes(item.key);
        })
            .reduce((sum, row) => sum + row.quantity, 0),
    })), [activeContainerIds, containers, inventory]);
    const totalUnits = useMemo(() => totals.reduce((sum, item) => sum + item.quantity, 0), [totals]);
    useEffect(() => {
        const nextDrafts = {};
        containers.forEach((container) => {
            ITEM_DEFS.forEach((item) => {
                nextDrafts[`${container.id}:${item.key}`] = String(getQuantity(container.id, item.key));
            });
        });
        setDrafts(nextDrafts);
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
    const canEdit = Boolean(qrOnlyMode && qrAccess.containerId === selectedContainer && qrAccess.token);
    const updateDraft = (containerId, itemKey, value) => {
        const clean = value.replace(/[^0-9]/g, '').slice(0, 6);
        setDrafts((old) => ({ ...old, [`${containerId}:${itemKey}`]: clean }));
    };
    const stepDraft = (containerId, itemKey, delta) => {
        const key = `${containerId}:${itemKey}`;
        const raw = drafts[key];
        const current = Number(raw !== undefined && raw !== '' ? raw : getQuantity(containerId, itemKey));
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
        const allowedKeys = new Set(visibleItems.map((item) => item.key));
        for (const item of ITEM_DEFS) {
            const current = getQuantity(selectedContainer, item.key);
            // Los artículos que no pertenecen a este tipo de contenedor se conservan,
            // pero no se muestran ni se modifican desde este QR.
            const raw = allowedKeys.has(item.key)
                ? (drafts[`${selectedContainer}:${item.key}`] ?? String(current))
                : String(current);
            if (allowedKeys.has(item.key) && String(raw).trim() === '') {
                notify({ type: 'error', text: `Completa ${item.label} o escribe 0.` });
                return;
            }
            const value = Number(raw);
            if (!Number.isFinite(value) || value < 0 || value > MAX_QTY) {
                notify({ type: 'error', text: `Cantidad inválida en ${item.label}.` });
                return;
            }
            quantities[item.key] = value;
            expected[item.key] = current;
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
            p_item_group: createKind === 'caja' ? 'tapers' : createGroup,
        });
        if (error) {
            notify({ type: 'error', text: error.message });
            return;
        }
        const result = parseRpcResult(data);
        const containerId = result.out_container_id || result.container_id || '';
        const accessToken = result.out_access_token || result.access_token || '';
        const containerName = result.out_name || result.name || 'Contenedor';
        if (!containerId || !accessToken) {
            notify({ type: 'error', text: 'No se pudo crear el contenedor.' });
            return;
        }
        const nextContainers = await loadContainers().catch(() => []);
        const nextInventory = await loadInventory().catch(() => readInventoryCache());
        setContainers(nextContainers);
        setInventory(nextInventory);
        setSelectedContainer(containerId);
        setPage('manage');
        const url = `${window.location.origin}${BASE}?c=${encodeURIComponent(containerId)}&k=${encodeURIComponent(accessToken)}`;
        setQrPreview({ name: containerName, url });
        setCreateName('');
        setCreateDescription('');
        setCreateKind('caja');
        setCreateGroup('mixto');
        notify({ type: 'success', text: `${containerName} creado correctamente.` });
    };
    const openQrPreview = async (container) => {
        if (!supabase)
            return;
        const { data, error } = await supabase.rpc('apci_get_container_qr', { p_container_id: container.id });
        if (error) {
            notify({ type: 'error', text: error.message });
            return;
        }
        const result = parseRpcResult(data);
        const accessToken = result.out_access_token || result.access_token || '';
        const containerName = result.out_name || result.name || container.name;
        if (!accessToken) {
            notify({ type: 'error', text: 'No se pudo generar el QR.' });
            return;
        }
        const url = `${window.location.origin}${BASE}?c=${encodeURIComponent(container.id)}&k=${encodeURIComponent(accessToken)}`;
        setQrPreview({ name: containerName, url });
        notify({ type: 'success', text: `QR generado para ${container.name}.` });
    };
    const startEditContainer = (container) => {
        setEditingId(container.id);
        setEditName(container.name);
        setEditKind((container.kind || 'caja'));
        setEditDescription(container.description || '');
        setEditGroup(container.item_group || 'mixto');
    };
    const cancelEditContainer = () => {
        setEditingId(null);
        setEditName('');
        setEditDescription('');
        setEditKind('caja');
        setEditGroup('mixto');
    };
    const saveEditContainer = async () => {
        if (!editingId || !supabase)
            return;
        const { error } = await supabase.rpc('apci_update_container', {
            p_container_id: editingId,
            p_name: safeName(editName) || null,
            p_description: safeName(editDescription) || null,
            p_kind: editKind,
            p_item_group: editKind === 'caja' ? 'tapers' : editGroup,
        });
        if (error) {
            notify({ type: 'error', text: error.message });
            return;
        }
        const nextContainers = await loadContainers().catch(() => []);
        setContainers(nextContainers);
        cancelEditContainer();
        notify({ type: 'success', text: 'Contenedor actualizado.' });
    };
    const deleteContainer = async (container) => {
        if (!supabase)
            return;
        if (!window.confirm(`¿Seguro que deseas eliminar ${container.name}?`))
            return;
        const { error } = await supabase.rpc('apci_delete_container', { p_container_id: container.id });
        if (error) {
            notify({ type: 'error', text: error.message });
            return;
        }
        const nextContainers = await loadContainers().catch(() => []);
        setContainers(nextContainers);
        if (selectedContainer === container.id && nextContainers[0])
            setSelectedContainer(nextContainers[0].id);
        notify({ type: 'success', text: `${container.name} fue eliminado.` });
    };
    const renderOverview = () => (_jsxs("div", { className: "page-stack", children: [_jsxs("section", { className: "hero-card", children: [_jsxs("div", { children: [_jsx("div", { className: "eyebrow", children: "APC Corporaci\u00F3n \u00B7 Inventario" }), _jsxs("h1", { children: [_jsx("span", { className: "desktop-only", children: "Conteo simple para celular y control claro desde PC" }), _jsx("span", { className: "mobile-only", children: "Inventario APC" })] }), _jsxs("p", { children: [_jsx("span", { className: "desktop-only", children: "En m\u00F3vil lo m\u00E1s importante es escanear el QR y guardar r\u00E1pido. En PC puedes revisar el resumen, crear contenedores, editar nombres y volver a imprimir QR." }), _jsx("span", { className: "mobile-only", children: "Consulta el stock y registra las cantidades de cada contenedor." })] }), _jsxs("div", { className: "hero-actions", children: [_jsxs("button", { className: "primary-btn", onClick: () => { setPage('containers'); setMobileMenuOpen(false); }, children: [_jsx(Boxes, { size: 16 }), " Ver contenedores"] }), _jsxs("button", { className: "secondary-btn", onClick: () => { setPage('manage'); setMobileMenuOpen(false); }, children: [_jsx(PlusSquare, { size: 16 }), " Agregar caja o tacho"] })] })] }), _jsxs("div", { className: "hero-summary-grid", children: [_jsxs("div", { className: "summary-box", children: [_jsx("span", { children: "Contenedores activos" }), _jsx("strong", { children: containers.length })] }), _jsxs("div", { className: "summary-box", children: [_jsx("span", { children: "Unidades visibles" }), _jsx("strong", { children: formatNumber(totalUnits) })] }), _jsxs("div", { className: "summary-box", children: [_jsx("span", { children: "Pendientes" }), _jsx("strong", { children: pending.length })] }), _jsxs("div", { className: "summary-box", children: [_jsx("span", { children: "Estado" }), _jsx("strong", { children: online ? 'En línea' : 'Sin internet' })] })] })] }), _jsx("section", { className: "totals-grid", children: totals.map((item) => (_jsxs("article", { className: "total-card", children: [_jsxs("div", { className: "total-card-top", children: [_jsxs("div", { children: [_jsx("small", { children: item.short }), _jsx("h3", { children: item.label })] }), _jsx("img", { src: item.image, alt: item.label, className: "item-thumb" })] }), _jsx("strong", { children: formatNumber(item.quantity) }), _jsx("span", { children: item.unit })] }, item.key))) }), _jsxs("section", { className: "desktop-grid", children: [_jsxs("div", { className: "panel-card", children: [_jsxs("div", { className: "section-head", children: [_jsx("h2", { children: "Contenedores" }), _jsx("button", { className: "text-btn", onClick: () => setPage('containers'), children: "Abrir" })] }), _jsx("div", { className: "container-grid", children: containers.map((container) => {
                                    const total = visibleKeysForContainer(container).reduce((sum, key) => sum + getQuantity(container.id, key), 0);
                                    return (_jsxs("button", { className: `container-card ${selectedContainer === container.id ? 'active' : ''}`, onClick: () => { setSelectedContainer(container.id); setPage('containers'); }, children: [_jsxs("div", { className: "container-card-top", children: [_jsx("span", { children: container.kind === 'tacho' ? 'Tacho' : container.kind === 'otro' ? 'Otro' : 'Caja' }), _jsx("strong", { children: container.name })] }), _jsx("p", { children: container.description }), _jsx("div", { className: "container-meta-row", children: _jsx("span", { className: "mini-chip", children: containerContentsLabel(container) }) }), _jsxs("div", { className: "container-card-total", children: [formatNumber(total), " ", _jsx("small", { children: "unidades" })] })] }, container.id));
                                }) })] }), _jsxs("div", { className: "panel-card", children: [_jsxs("div", { className: "section-head", children: [_jsx("h2", { children: "\u00DAltimos movimientos" }), _jsx("button", { className: "text-btn", onClick: () => { setPage('history'); setMobileMenuOpen(false); }, children: "Ver todo" })] }), _jsxs("div", { className: "history-mini-list", children: [movements.slice(0, 8).map((move) => (_jsxs("div", { className: "history-mini-row", children: [_jsxs("div", { children: [_jsx("strong", { children: containerName(move.container_id, containers) }), _jsx("span", { children: itemLabel(move.item_key) })] }), _jsxs("div", { className: `delta-pill ${move.delta >= 0 ? 'plus' : 'minus'}`, children: [move.delta >= 0 ? '+' : '', move.delta] })] }, move.id))), movements.length === 0 && _jsx("p", { className: "empty-note", children: "A\u00FAn no hay movimientos registrados." })] })] })] })] }));
    const renderContainerEditor = () => (_jsxs("div", { className: "page-stack", children: [_jsx("div", { className: "section-head", children: _jsxs("div", { children: [_jsx("div", { className: "eyebrow", children: "Control por contenedor" }), _jsx("h2", { children: selectedInfo?.name || 'Contenedor' })] }) }), !qrOnlyMode && (_jsxs(_Fragment, { children: [
            _jsx("div", { className: "container-switch-row", children: containers.map((container) => (_jsx("button", { className: `container-pill ${selectedContainer === container.id ? 'active' : ''}`, onClick: () => setSelectedContainer(container.id), children: container.name }, container.id))) }),
            _jsxs("label", { className: "container-switch-select", children: [
                _jsx("span", { children: "Elegir contenedor" }),
                _jsx("select", { value: selectedContainer, onChange: (e) => setSelectedContainer(e.target.value), children: containers.map((container) => _jsx("option", { value: container.id, children: container.name }, container.id)) })
            ] })
        ] })), _jsxs("section", { className: "panel-card editor-card mobile-optimized-editor", children: [_jsxs("div", { className: "editor-head", children: [_jsxs("div", { children: [_jsx("div", { className: "eyebrow", children: "Registro r\u00E1pido" }), _jsx("h3", { children: selectedInfo?.name }), _jsxs("p", { children: [selectedInfo?.description, ". ", canEdit ? 'Cuenta las unidades físicas y registra el total encontrado.' : 'Vista de consulta. Escanea el QR del contenedor para guardar cambios.'] }), _jsx("div", { className: "container-meta-row", children: _jsx("span", { className: "mini-chip", children: containerContentsLabel(selectedInfo) }) })] }), _jsxs("div", { className: "editor-total", children: [_jsx("span", { children: "Total actual" }), _jsx("strong", { children: formatNumber(selectedTotal) })] })] }), _jsx("div", { className: "editor-grid", children: visibleItems.map((item) => {
                            const key = `${selectedContainer}:${item.key}`;
                            return (_jsxs("article", { className: "count-card", children: [_jsxs("div", { className: "count-card-top", children: [_jsx("img", { src: item.image, alt: item.label, className: "count-image" }), _jsxs("div", { children: [_jsx("small", { children: item.short }), _jsx("h4", { children: item.label }), _jsxs("span", { children: ["Stock registrado: ", formatNumber(getQuantity(selectedContainer, item.key))] })] })] }), _jsxs("div", { className: "count-entry", children: [_jsx("label", { className: "count-entry-label", htmlFor: `quantity-${selectedContainer}-${item.key}`, children: "Cantidad contada" }), _jsxs("div", { className: "count-controls", children: [_jsx("input", { id: `quantity-${selectedContainer}-${item.key}`, type: "text", inputMode: "numeric", pattern: "[0-9]*", maxLength: 6, "aria-label": `Cantidad contada de ${item.label}`, value: drafts[key] ?? '', onChange: (e) => updateDraft(selectedContainer, item.key, e.target.value), placeholder: "Escribe el total" }), _jsxs("button", { type: "button", className: "step-btn decrease", "aria-label": "Restar cinco", onClick: () => stepDraft(selectedContainer, item.key, -5), children: [_jsx(Minus, { size: 14 }), " −5"] }), _jsxs("button", { type: "button", className: "step-btn decrease", "aria-label": "Restar uno", onClick: () => stepDraft(selectedContainer, item.key, -1), children: [_jsx(Minus, { size: 14 }), " −1"] }), _jsxs("button", { type: "button", className: "step-btn increase", "aria-label": "Sumar uno", onClick: () => stepDraft(selectedContainer, item.key, 1), children: [_jsx(Plus, { size: 14 }), " +1"] }), _jsxs("button", { type: "button", className: "step-btn increase", "aria-label": "Sumar cinco", onClick: () => stepDraft(selectedContainer, item.key, 5), children: [_jsx(Plus, { size: 14 }), " +5"] })] }), _jsx("p", { className: "count-hint", children: "Escribe el total que contaste o ajústalo con los botones." })] })] }, item.key));
                        }) }), _jsxs("div", { className: "editor-actions", children: [_jsxs("button", { className: "primary-btn large", disabled: saving, onClick: saveContainer, children: [_jsx(CheckCircle2, { size: 18 }), saving ? 'Guardando...' : `Guardar conteo de ${selectedInfo?.name || ''}`] }), _jsx("div", { className: `inline-badge ${canEdit ? 'ok' : 'warn'}`, children: canEdit ? 'QR válido para guardar' : 'Modo solo lectura' })] })] })] }));
    const renderHistory = () => (_jsxs("div", { className: "page-stack", children: [_jsx("div", { className: "section-head", children: _jsxs("div", { children: [_jsx("div", { className: "eyebrow", children: "Historial" }), _jsx("h2", { children: "Movimientos recientes" })] }) }), _jsx("section", { className: "panel-card", children: _jsxs("div", { className: "history-list", children: [movements.map((move) => (_jsxs("article", { className: "history-row", children: [_jsxs("div", { className: "history-row-main", children: [_jsx("strong", { children: containerName(move.container_id, containers) }), _jsxs("span", { children: [itemLabel(move.item_key), " \u00B7 ", formatDate(move.created_at)] })] }), _jsxs("div", { className: `delta-pill ${move.delta >= 0 ? 'plus' : 'minus'}`, children: [move.delta >= 0 ? '+' : '', move.delta] }), _jsxs("div", { className: "history-row-side", children: [formatNumber(move.quantity_before), " \u2192 ", formatNumber(move.quantity_after)] })] }, move.id))), movements.length === 0 && _jsx("p", { className: "empty-note", children: "No hay movimientos para mostrar." })] }) })] }));
    const renderProtocol = () => (_jsx("div", { className: "page-stack", children: _jsxs("section", { className: "panel-card", children: [_jsx("div", { className: "section-head", children: _jsxs("div", { children: [_jsx("div", { className: "eyebrow", children: "Instructivo administrativo" }), _jsx("h2", { children: "Procedimiento vigente" })] }) }), _jsx("div", { className: "protocol-list", children: protocolText.map((text, index) => (_jsxs("div", { className: "protocol-item", children: [_jsx("span", { children: index + 1 }), _jsx("p", { children: text })] }, index))) })] }) }));
    const renderManage = () => (_jsxs("div", { className: "page-stack", children: [
        _jsxs("section", { className: "panel-card manage-grid", children: [
            _jsxs("div", { children: [
                _jsxs("div", { className: "section-head", children: [_jsxs("div", { children: [_jsx("div", { className: "eyebrow", children: "Configuración" }), _jsx("h2", { children: "Agregar contenedor" })] })] }),
                _jsxs("div", { className: "manage-form", children: [
                    _jsxs("label", { children: [_jsx("span", { children: "¿Qué vas a agregar?" }), _jsxs("select", { value: createKind, onChange: (e) => { const nextKind = e.target.value; setCreateKind(nextKind); if (nextKind === 'tacho' && createGroup === 'tapers') setCreateGroup('mixto'); }, children: [_jsx("option", { value: "caja", children: "Caja de tápers" }), _jsx("option", { value: "tacho", children: "Tacho (sin tápers)" })] })] }),
                    _jsxs("div", { className: "container-rule-card", children: [
                        _jsx("span", { className: "rule-title", children: "Suministros permitidos" }),
                        _jsx("strong", { children: createKind === 'caja' ? "Tápers Rey y GyG" : (TACHO_OPTIONS.find((option) => option.value === createGroup)?.label || "Tapas y tenedores") }),
                        _jsx("p", { children: createKind === 'caja' ? "Esta caja registra únicamente tápers de marca Rey o GyG. No incluye tapas ni tenedores." : "Los tachos no admiten tápers. Puedes elegir tapas, tenedores o ambos." })
                    ] }),
                    createKind === 'tacho' ? _jsxs("label", { children: [_jsx("span", { children: "¿Qué guardará este tacho?" }), _jsxs("select", { value: createGroup, onChange: (e) => setCreateGroup(e.target.value), children: TACHO_OPTIONS.map((option) => _jsx("option", { value: option.value, children: option.label }, option.value)) })] }) : null,
                    _jsxs("label", { children: [_jsx("span", { children: "Nombre (opcional)" }), _jsx("input", { value: createName, onChange: (e) => setCreateName(e.target.value), placeholder: createKind === 'caja' ? "Ejemplo: Caja 04" : "Ejemplo: Tacho 02" })] }),
                    _jsxs("label", { children: [_jsx("span", { children: "Descripción (opcional)" }), _jsx("input", { value: createDescription, onChange: (e) => setCreateDescription(e.target.value), placeholder: getDefaultDescription(createKind) })] }),
                    _jsxs("button", { className: "primary-btn", onClick: createContainer, children: [_jsx(PlusSquare, { size: 16 }), " Crear y generar QR"] })
                ] })
            ] }),
            _jsxs("div", { children: [
                _jsxs("div", { className: "section-head", children: [_jsxs("div", { children: [_jsx("div", { className: "eyebrow", children: "Impresión" }), _jsx("h2", { children: "QR decorado" })] })] }),
                qrPreview ? _jsx(QrPrintCard, { preview: qrPreview }) : _jsx("p", { className: "empty-note", children: "Al crear un contenedor, aquí aparecerá su QR decorado. También puedes abrir el QR de los contenedores existentes." })
            ] })
        ] }),
        _jsxs("section", { className: "panel-card", children: [
            _jsx("div", { className: "section-head", children: _jsx("div", { children: _jsx("h2", { children: "Contenedores actuales" }) }) }),
            _jsx("div", { className: "container-grid compact", children: containers.map((container) => (_jsxs("div", { className: "container-card static", children: [
                _jsxs("div", { className: "container-card-top", children: [_jsx("span", { children: container.kind === 'tacho' ? 'TACHO' : container.kind === 'otro' ? 'OTRO' : 'CAJA' }), _jsx("strong", { children: container.name })] }),
                _jsx("p", { children: container.description }),
                _jsx("div", { className: "container-meta-row", children: _jsx("span", { className: "mini-chip", children: containerContentsLabel(container) }) }),
                _jsxs("div", { className: "container-actions", children: [
                    _jsxs("button", { className: "secondary-btn", onClick: () => openQrPreview(container), children: [_jsx(QrCode, { size: 15 }), " Ver QR"] }),
                    _jsxs("button", { className: "secondary-btn", onClick: () => startEditContainer(container), children: [_jsx(Edit3, { size: 15 }), " Editar"] }),
                    _jsxs("button", { className: "secondary-btn danger", onClick: () => deleteContainer(container), children: [_jsx(Trash2, { size: 15 }), " Eliminar"] })
                ] }),
                editingId === container.id && (_jsxs("div", { className: "edit-panel", children: [
                    _jsxs("label", { children: [_jsx("span", { children: "Tipo de contenedor" }), _jsxs("select", { value: editKind, onChange: (e) => { const nextKind = e.target.value; setEditKind(nextKind); if (nextKind === 'tacho' && editGroup === 'tapers') setEditGroup('mixto'); }, children: [_jsx("option", { value: "caja", children: "Caja de tápers" }), _jsx("option", { value: "tacho", children: "Tacho (sin tápers)" }), editKind === 'otro' ? _jsx("option", { value: "otro", children: "Otro (existente)" }) : null] })] }),
                    _jsxs("div", { className: "container-rule-card compact-rule", children: [_jsx("span", { className: "rule-title", children: "Suministros que se mostrarán" }), _jsx("strong", { children: editKind === 'caja' ? "Tápers Rey y GyG" : (TACHO_OPTIONS.find((option) => option.value === editGroup)?.label || "Tapas y tenedores") }), _jsx("p", { children: editKind === 'caja' ? "No se mostrarán ni modificarán tapas o tenedores desde esta caja." : "Este tacho no mostrará ni modificará tápers." })] }),
                    editKind === 'tacho' ? _jsxs("label", { children: [_jsx("span", { children: "¿Qué guardará este tacho?" }), _jsxs("select", { value: editGroup, onChange: (e) => setEditGroup(e.target.value), children: TACHO_OPTIONS.map((option) => _jsx("option", { value: option.value, children: option.label }, option.value)) })] }) : null,
                    _jsxs("label", { children: [_jsx("span", { children: "Nombre" }), _jsx("input", { value: editName, onChange: (e) => setEditName(e.target.value) })] }),
                    _jsxs("label", { children: [_jsx("span", { children: "Descripción" }), _jsx("input", { value: editDescription, onChange: (e) => setEditDescription(e.target.value) })] }),
                    _jsxs("div", { className: "edit-actions", children: [_jsxs("button", { className: "primary-btn", onClick: saveEditContainer, children: [_jsx(Save, { size: 15 }), " Guardar cambios"] }), _jsxs("button", { className: "secondary-btn", onClick: cancelEditContainer, children: [_jsx(X, { size: 15 }), " Cancelar"] })] })
                ] }))
            ] }, container.id))) })
        ] })
    ] }));
    return (_jsxs("div", { className: `app-shell ${qrOnlyMode ? 'qr-only-shell' : ''}`, children: [_jsxs("aside", { className: `sidebar ${mobileMenuOpen ? 'mobile-menu-open' : ''}`, children: [_jsxs("div", { className: "brand-block", children: [_jsx("img", { src: `${BASE}apc-logo.png`, alt: "APC" }), _jsxs("div", { children: [_jsx("strong", { children: "APC Inventario" }), _jsx("span", { children: "Control de suministros" })] }), !qrOnlyMode && _jsx("button", { type: "button", className: "mobile-menu-toggle", "aria-label": mobileMenuOpen ? "Cerrar menú" : "Abrir menú", "aria-expanded": mobileMenuOpen, onClick: () => setMobileMenuOpen(!mobileMenuOpen), children: mobileMenuOpen ? _jsx(X, { size: 23 }) : _jsx(Menu, { size: 23 }) })] }), _jsxs("nav", { className: "side-nav", children: [_jsxs("button", { className: page === 'overview' ? 'active' : '', onClick: () => { setPage('overview'); setMobileMenuOpen(false); }, children: [_jsx(Home, { size: 18 }), " Resumen"] }), _jsxs("button", { className: page === 'containers' ? 'active' : '', onClick: () => { setPage('containers'); setMobileMenuOpen(false); }, children: [_jsx(Boxes, { size: 18 }), " Contenedores"] }), _jsxs("button", { className: page === 'history' ? 'active' : '', onClick: () => { setPage('history'); setMobileMenuOpen(false); }, children: [_jsx(History, { size: 18 }), " Movimientos"] }), _jsxs("button", { className: page === 'manage' ? 'active' : '', onClick: () => { setPage('manage'); setMobileMenuOpen(false); }, children: [_jsx(QrCode, { size: 18 }), " Cajas y QR"] }), _jsxs("button", { className: page === 'protocol' ? 'active' : '', onClick: () => { setPage('protocol'); setMobileMenuOpen(false); }, children: [_jsx(ClipboardList, { size: 18 }), " Protocolo"] })] }), _jsxs("div", { className: "sidebar-help", children: [_jsx(Info, { size: 15 }), _jsx("p", { children: qrOnlyMode ? 'Este enlace QR solo debe servir para este contenedor.' : 'Para guardar cambios, siempre escanea el QR del contenedor. Para ver el resumen, puedes entrar también desde PC.' })] })] }), _jsx("button", { type: "button", className: "mobile-menu-backdrop", "aria-label": "Cerrar menú", onClick: () => setMobileMenuOpen(false) }), _jsxs("main", { className: "main-area", children: [_jsxs("header", { className: "topbar", children: [_jsxs("div", { children: [_jsx("div", { className: "eyebrow", children: "APC Corporaci\u00F3n" }), _jsx("h1", { children: page === 'overview' ? 'Inventario de suministros' : page === 'containers' ? (qrOnlyMode ? 'Conteo del contenedor' : 'Conteo por contenedor') : page === 'history' ? 'Movimientos' : page === 'manage' ? 'Cajas y QR' : 'Protocolo administrativo' })] }), _jsxs("div", { className: "topbar-actions", children: [_jsx("button", { className: "secondary-icon-btn", onClick: () => initializeData(), title: "Actualizar", children: _jsx(RefreshCw, { size: 17 }) }), _jsxs("div", { className: `status-chip ${online ? 'online' : 'offline'}`, children: [online ? _jsx(Wifi, { size: 15 }) : _jsx(WifiOff, { size: 15 }), online ? 'En línea' : 'Sin internet'] }), syncing && _jsx("div", { className: "inline-badge ok", children: "Sincronizando\u2026" })] })] }), loading ? _jsx("div", { className: "panel-card", children: _jsx("p", { className: "empty-note", children: "Cargando datos..." }) }) : (_jsxs(_Fragment, { children: [page === 'overview' && renderOverview(), page === 'containers' && renderContainerEditor(), page === 'history' && renderHistory(), page === 'protocol' && renderProtocol(), page === 'manage' && renderManage()] }))] }), toast && _jsx("div", { className: `toast ${toast.type}`, children: toast.text }), qrPreview && _jsx(QrModal, { preview: qrPreview, onClose: () => setQrPreview(null) })] }));
}
function containerName(id, containers) {
    return containers.find((container) => container.id === id)?.name ?? id;
}
function itemLabel(key) {
    return ITEM_DEFS.find((item) => item.key === key)?.label ?? key;
}
function QrPrintCard({ preview }) {
    return (_jsxs("div", { className: "qr-preview-card", children: [_jsxs("div", { className: "qr-frame", children: [_jsxs("div", { className: "qr-topline", children: [_jsx("img", { src: `${BASE}apc-logo.png`, alt: "APC" }), _jsxs("div", { children: [_jsx("strong", { children: "APC CORPORACI\u00D3N" }), _jsx("span", { children: "Inventario de suministros" })] })] }), _jsx("div", { className: "qr-image-wrap", children: _jsx("img", { src: qrApi(preview.url), alt: `QR ${preview.name}` }) }), _jsx("div", { className: "qr-name-pill", children: preview.name.toUpperCase() }), _jsx("div", { className: "qr-sub", children: "ESCANEAR PARA ACTUALIZAR INVENTARIO" })] }), _jsxs("div", { className: "qr-card-actions", children: [_jsxs("button", { className: "secondary-btn", onClick: () => navigator.clipboard.writeText(preview.url), children: [_jsx(LinkIcon, { size: 15 }), " Copiar enlace"] }), _jsxs("button", { className: "secondary-btn", onClick: () => window.open(qrApi(preview.url), '_blank'), children: [_jsx(Download, { size: 15 }), " Abrir QR"] }), _jsxs("button", { className: "primary-btn", onClick: async () => { const imgs = Array.from(document.querySelectorAll(".qr-modal-backdrop .qr-frame img")); await Promise.all(imgs.map((img) => img.decode ? img.decode().catch(() => undefined) : Promise.resolve())); window.print(); }, children: [_jsx(Printer, { size: 15 }), " Imprimir"] })] })] }));
}
function QrModal({ preview, onClose }) {
    return (_jsx("div", { className: "modal-backdrop qr-modal-backdrop", onClick: onClose, children: _jsxs("div", { className: "modal-card", onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { className: "modal-head", children: [_jsx("h3", { children: "QR listo para imprimir" }), _jsx("button", { onClick: onClose, children: "\u00D7" })] }), _jsx(QrPrintCard, { preview: preview })] }) }));
}
export default App;
