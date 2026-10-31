import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Boxes, Check, ChevronDown, ClipboardList, CloudOff, History, Home, Info, LogOut, Menu, Package, RefreshCw, ShieldCheck, SlidersHorizontal, Wifi, WifiOff, X, } from 'lucide-react';
import { supabase, isSupabaseConfigured, dniToEmail } from './lib/supabase.js';
import { readInventoryCache, readQueue, writeInventoryCache, writeQueue } from './lib/offline.js';
import { CONTAINERS, ITEMS } from './lib/types.js';
const itemLabel = (key) => ITEMS.find((item) => item.key === key)?.label ?? key;
const containerLabel = (id) => CONTAINERS.find((container) => container.id === id)?.name ?? id;
const formatNumber = (n) => new Intl.NumberFormat('es-PE').format(n);
const formatDate = (value) => new Intl.DateTimeFormat('es-PE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
const createId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
function App() {
    const [session, setSession] = useState(null);
    const [profile, setProfile] = useState(null);
    const [inventory, setInventory] = useState([]);
    const [movements, setMovements] = useState([]);
    const [page, setPage] = useState('overview');
    const [selectedContainer, setSelectedContainer] = useState('caja-01');
    const [online, setOnline] = useState(navigator.onLine);
    const [pending, setPending] = useState([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [toast, setToast] = useState(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const [protocolOpen, setProtocolOpen] = useState(false);
    const [loginDni, setLoginDni] = useState('');
    const [loginPassword, setLoginPassword] = useState('');
    const [loginBusy, setLoginBusy] = useState(false);
    const [loginError, setLoginError] = useState('');
    const [drafts, setDrafts] = useState({});
    const toastTimer = useRef(undefined);
    const queueRef = useRef([]);
    const profileRef = useRef(null);
    const notify = useCallback((next) => {
        setToast(next);
        if (toastTimer.current)
            window.clearTimeout(toastTimer.current);
        toastTimer.current = window.setTimeout(() => setToast(null), 3600);
    }, []);
    const cacheKey = (userId) => `apci:profile:${userId}`;
    const setQueue = useCallback((userId, next) => {
        queueRef.current = next;
        setPending(next);
        writeQueue(userId, next);
    }, []);
    const loadProfile = useCallback(async (userId) => {
        if (!supabase)
            return null;
        const { data, error } = await supabase.from('apci_profiles').select('id,dni,full_name,role,is_active').eq('id', userId).maybeSingle();
        if (error)
            throw error;
        if (data) {
            localStorage.setItem(cacheKey(userId), JSON.stringify(data));
            return data;
        }
        const cached = localStorage.getItem(cacheKey(userId));
        if (!navigator.onLine && cached)
            return JSON.parse(cached);
        return null;
    }, []);
    const loadInventory = useCallback(async (userId) => {
        if (!supabase)
            return;
        if (!navigator.onLine) {
            const cached = readInventoryCache(userId);
            if (cached.length)
                setInventory(cached);
            return;
        }
        const { data, error } = await supabase.from('apci_inventory').select('id,container_id,item_key,quantity,updated_at,updated_by').order('container_id').order('item_key');
        if (error) {
            const cached = readInventoryCache(userId);
            if (cached.length)
                setInventory(cached);
            throw error;
        }
        const rows = (data ?? []);
        setInventory(rows);
        writeInventoryCache(userId, rows);
    }, []);
    const loadMovements = useCallback(async () => {
        if (!supabase || !navigator.onLine)
            return;
        const { data, error } = await supabase.from('apci_movements').select('id,container_id,item_key,delta,quantity_before,quantity_after,movement_type,note,actor_name,created_at').order('created_at', { ascending: false }).limit(60);
        if (!error && data)
            setMovements(data);
    }, []);
    const loadUserData = useCallback(async (userId) => {
        const cached = localStorage.getItem(cacheKey(userId));
        if (cached) {
            try {
                const p = JSON.parse(cached);
                setProfile(p);
                profileRef.current = p;
            }
            catch { /* ignore invalid cache */ }
        }
        const cachedInventory = readInventoryCache(userId);
        if (cachedInventory.length)
            setInventory(cachedInventory);
        const q = readQueue(userId);
        queueRef.current = q;
        setPending(q);
        try {
            const p = await loadProfile(userId);
            if (!p || !p.is_active) {
                await supabase?.auth.signOut();
                setProfile(null);
                profileRef.current = null;
                notify({ type: 'error', text: 'Tu usuario no tiene un perfil activo en APC Inventario.' });
                return;
            }
            setProfile(p);
            profileRef.current = p;
            await loadInventory(userId);
            await loadMovements();
        }
        catch (error) {
            if (!navigator.onLine)
                notify({ type: 'info', text: 'Modo sin conexión: se muestran los últimos datos guardados en este teléfono.' });
            else
                notify({ type: 'error', text: error?.message || 'No se pudieron cargar los datos.' });
        }
    }, [loadProfile, loadInventory, loadMovements, notify]);
    useEffect(() => {
        if (!supabase) {
            setLoading(false);
            return;
        }
        let alive = true;
        supabase.auth.getSession().then(({ data }) => {
            if (!alive)
                return;
            setSession(data.session);
            if (data.session?.user)
                loadUserData(data.session.user.id).finally(() => alive && setLoading(false));
            else
                setLoading(false);
        });
        const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
            if (!alive)
                return;
            setSession(nextSession);
            if (nextSession?.user) {
                setLoading(true);
                window.setTimeout(() => loadUserData(nextSession.user.id).finally(() => alive && setLoading(false)), 0);
            }
            else {
                setProfile(null);
                profileRef.current = null;
                setInventory([]);
                setMovements([]);
                setPending([]);
            }
        });
        return () => { alive = false; listener.subscription.unsubscribe(); };
    }, [loadUserData]);
    const syncPending = useCallback(async () => {
        if (!supabase || !session?.user?.id || !navigator.onLine || syncing || queueRef.current.length === 0)
            return;
        setSyncing(true);
        const userId = session.user.id;
        let queue = [...queueRef.current];
        let completed = 0;
        try {
            for (const op of queue) {
                const response = op.kind === 'delta'
                    ? await supabase.rpc('apci_adjust_stock', {
                        p_container_id: op.container_id,
                        p_item_key: op.item_key,
                        p_delta: op.delta,
                        p_note: op.note,
                        p_movement_type: (op.delta ?? 0) > 0 ? 'entrada' : 'salida',
                    })
                    : await supabase.rpc('apci_set_stock', {
                        p_container_id: op.container_id,
                        p_item_key: op.item_key,
                        p_quantity: op.quantity,
                        p_expected_quantity: op.expected_quantity,
                        p_note: op.note,
                    });
                if (response.error) {
                    if (response.error.message.includes('CONFLICTO'))
                        await loadInventory(userId);
                    notify({ type: 'error', text: response.error.message.includes('CONFLICTO')
                            ? 'El stock cambió en otro teléfono. Se actualizó el dato remoto; vuelve a ingresar el conteo físico para reemplazar el pendiente.'
                            : `No se pudo sincronizar un cambio: ${response.error.message}` });
                    break;
                }
                completed++;
                queue = queue.filter((item) => item.id !== op.id);
                setQueue(userId, queue);
            }
            if (completed > 0) {
                await loadInventory(userId);
                await loadMovements();
                notify({ type: 'success', text: `${completed} cambio(s) sincronizado(s) correctamente.` });
            }
        }
        catch (error) {
            notify({ type: 'error', text: error?.message || 'No se pudo completar la sincronización. Los cambios siguen guardados en este teléfono.' });
        }
        finally {
            setSyncing(false);
        }
    }, [session, syncing, setQueue, loadInventory, loadMovements, notify]);
    useEffect(() => {
        const handleOnline = () => { setOnline(true); if (session?.user?.id)
            window.setTimeout(() => syncPending(), 500); };
        const handleOffline = () => setOnline(false);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => { window.removeEventListener('online', handleOnline); window.removeEventListener('offline', handleOffline); };
    }, [session, syncPending]);
    useEffect(() => {
        if (!supabase || !session?.user?.id)
            return;
        const channel = supabase.channel('apci-inventory-live')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'apci_inventory' }, () => {
            if (navigator.onLine) {
                loadInventory(session.user.id);
                loadMovements();
            }
        })
            .subscribe();
        return () => { supabase?.removeChannel(channel); };
    }, [session, loadInventory, loadMovements]);
    useEffect(() => {
        if (session?.user?.id && online && pending.length > 0) {
            const timer = window.setTimeout(() => { syncPending(); }, 700);
            return () => window.clearTimeout(timer);
        }
    }, [session?.user?.id, online, pending.length]);
    const getQuantity = (containerId, itemKey) => inventory.find((row) => row.container_id === containerId && row.item_key === itemKey)?.quantity ?? 0;
    const totals = useMemo(() => ITEMS.map((item) => ({
        ...item,
        quantity: inventory.filter((row) => row.item_key === item.key).reduce((sum, row) => sum + row.quantity, 0),
    })), [inventory]);
    const totalUnits = useMemo(() => totals.reduce((sum, item) => sum + item.quantity, 0), [totals]);
    const queueOperation = (op) => {
        if (!session?.user?.id)
            return;
        const next = [...queueRef.current, op];
        setQueue(session.user.id, next);
    };
    const applyDelta = async (containerId, itemKey, delta) => {
        if (!profile || profile.role === 'viewer')
            return notify({ type: 'error', text: 'Tu perfil solo permite consultar el inventario.' });
        if (navigator.onLine && queueRef.current.some((op) => op.container_id === containerId && op.item_key === itemKey)) {
            return notify({ type: 'info', text: 'Este suministro tiene cambios pendientes. Sincroniza o vuelve a ingresar el conteo exacto antes de ajustarlo.' });
        }
        const current = getQuantity(containerId, itemKey);
        const next = current + delta;
        if (next < 0)
            return notify({ type: 'error', text: 'El stock no puede quedar por debajo de cero.' });
        const row = inventory.find((r) => r.container_id === containerId && r.item_key === itemKey);
        const optimistic = inventory.map((r) => r.id === row?.id ? { ...r, quantity: next, updated_at: new Date().toISOString() } : r);
        setInventory(optimistic);
        writeInventoryCache(session.user.id, optimistic);
        const op = { id: createId(), kind: 'delta', container_id: containerId, item_key: itemKey, delta, note: 'Ajuste rápido desde APC Inventario', created_at: new Date().toISOString() };
        if (!navigator.onLine) {
            queueOperation(op);
            return notify({ type: 'info', text: 'Cambio guardado en este teléfono. Se sincronizará al volver el internet.' });
        }
        const { error } = await supabase.rpc('apci_adjust_stock', {
            p_container_id: containerId, p_item_key: itemKey, p_delta: delta,
            p_note: op.note, p_movement_type: delta > 0 ? 'entrada' : 'salida',
        });
        if (error) {
            if (/fetch|network|offline|timeout/i.test(error.message)) {
                queueOperation(op);
                notify({ type: 'info', text: 'Conexión interrumpida. El cambio quedó guardado para sincronizarse.' });
            }
            else {
                setInventory(inventory);
                writeInventoryCache(session.user.id, inventory);
                notify({ type: 'error', text: error.message });
            }
        }
        else {
            await loadInventory(session.user.id);
            await loadMovements();
        }
    };
    const applySet = async (containerId, itemKey, value) => {
        if (!profile || profile.role === 'viewer')
            return notify({ type: 'error', text: 'Tu perfil solo permite consultar el inventario.' });
        if (!Number.isInteger(value) || value < 0)
            return notify({ type: 'error', text: 'Ingresa una cantidad entera igual o mayor a cero.' });
        const current = getQuantity(containerId, itemKey);
        const row = inventory.find((r) => r.container_id === containerId && r.item_key === itemKey);
        if (value === current)
            return notify({ type: 'info', text: 'La cantidad no ha cambiado.' });
        const optimistic = inventory.map((r) => r.id === row?.id ? { ...r, quantity: value, updated_at: new Date().toISOString() } : r);
        setInventory(optimistic);
        writeInventoryCache(session.user.id, optimistic);
        const op = { id: createId(), kind: 'set', container_id: containerId, item_key: itemKey, quantity: value, expected_quantity: current, note: 'Conteo físico ingresado manualmente', created_at: new Date().toISOString() };
        if (!navigator.onLine) {
            queueOperation(op);
            notify({ type: 'info', text: 'Conteo guardado localmente. Se sincronizará al volver el internet.' });
            return;
        }
        const remainingQueue = queueRef.current.filter((item) => !(item.container_id === containerId && item.item_key === itemKey));
        if (remainingQueue.length !== queueRef.current.length)
            setQueue(session.user.id, remainingQueue);
        const { error } = await supabase.rpc('apci_set_stock', {
            p_container_id: containerId, p_item_key: itemKey, p_quantity: value,
            p_expected_quantity: current, p_note: op.note,
        });
        if (error) {
            if (/fetch|network|offline|timeout/i.test(error.message)) {
                queueOperation(op);
                notify({ type: 'info', text: 'Conexión interrumpida. El conteo quedó guardado para sincronizarse.' });
            }
            else {
                setInventory(inventory);
                writeInventoryCache(session.user.id, inventory);
                if (error.message.includes('CONFLICTO'))
                    await loadInventory(session.user.id);
                notify({ type: 'error', text: error.message });
            }
        }
        else {
            setDrafts((old) => ({ ...old, [`${containerId}:${itemKey}`]: String(value) }));
            await loadInventory(session.user.id);
            await loadMovements();
            notify({ type: 'success', text: 'Conteo actualizado.' });
        }
    };
    const login = async (event) => {
        event.preventDefault();
        setLoginError('');
        if (!/^\d{8}$/.test(loginDni))
            return setLoginError('Ingresa un DNI de 8 dígitos.');
        if (!loginPassword)
            return setLoginError('Ingresa tu contraseña.');
        if (!supabase)
            return setLoginError('Falta configurar la conexión con Supabase.');
        setLoginBusy(true);
        const { error } = await supabase.auth.signInWithPassword({ email: dniToEmail(loginDni), password: loginPassword });
        setLoginBusy(false);
        if (error)
            setLoginError('DNI o contraseña incorrectos. Verifica que tu usuario esté creado en Supabase.');
    };
    const logout = async () => { await supabase?.auth.signOut(); setPage('overview'); setMenuOpen(false); };
    const selected = CONTAINERS.find((container) => container.id === selectedContainer);
    if (!isSupabaseConfigured)
        return _jsx(ConfigurationScreen, {});
    if (loading)
        return _jsxs("div", { className: "loading-screen", children: [_jsx("div", { className: "loading-mark", children: _jsx("img", { src: `${window.APC_CONFIG.BASE_URL}apc-logo.png` }) }), _jsx("div", { className: "spinner" }), _jsx("p", { children: "Preparando APC Inventario\u2026" })] });
    if (!session)
        return _jsx(LoginScreen, { dni: loginDni, setDni: setLoginDni, password: loginPassword, setPassword: setLoginPassword, onSubmit: login, busy: loginBusy, error: loginError });
    if (!profile)
        return _jsxs("div", { className: "loading-screen", children: [_jsx("div", { className: "loading-mark", children: _jsx("img", { src: `${window.APC_CONFIG.BASE_URL}apc-logo.png` }) }), _jsx("p", { children: "Verificando permisos del usuario\u2026" }), _jsx("button", { className: "btn btn-outline", onClick: logout, children: "Cerrar sesi\u00F3n" })] });
    return (_jsxs("div", { className: "app-shell", children: [_jsxs("aside", { className: `sidebar ${menuOpen ? 'sidebar-open' : ''}`, children: [_jsxs("div", { className: "brand-lockup", children: [_jsx("img", { src: `${window.APC_CONFIG.BASE_URL}apc-logo.png`, alt: "APC" }), _jsxs("div", { children: [_jsx("strong", { children: "INVENTARIO" }), _jsx("span", { children: "CONTROL DE SUMINISTROS" })] })] }), _jsx("div", { className: "sidebar-label", children: "MEN\u00DA PRINCIPAL" }), _jsxs("nav", { className: "side-nav", children: [_jsx(NavButton, { active: page === 'overview', icon: _jsx(Home, { size: 18 }), label: "Resumen", onClick: () => { setPage('overview'); setMenuOpen(false); } }), _jsx(NavButton, { active: page === 'containers', icon: _jsx(Boxes, { size: 18 }), label: "Contenedores", onClick: () => { setPage('containers'); setMenuOpen(false); } }), _jsx(NavButton, { active: page === 'history', icon: _jsx(History, { size: 18 }), label: "Movimientos", onClick: () => { setPage('history'); setMenuOpen(false); } }), _jsx(NavButton, { active: page === 'protocol', icon: _jsx(ClipboardList, { size: 18 }), label: "Protocolo administrativo", onClick: () => { setPage('protocol'); setMenuOpen(false); } })] }), _jsxs("div", { className: "sidebar-bottom", children: [_jsxs("div", { className: "secure-note", children: [_jsx(ShieldCheck, { size: 18 }), _jsxs("div", { children: [_jsx("strong", { children: "Acceso controlado" }), _jsx("span", { children: "Sesi\u00F3n protegida por Supabase" })] })] }), _jsxs("div", { className: "user-card", children: [_jsx("div", { className: "avatar", children: profile.full_name.split(' ').slice(0, 2).map((s) => s[0]).join('').toUpperCase() }), _jsxs("div", { className: "user-info", children: [_jsx("strong", { children: profile.full_name }), _jsxs("span", { children: [profile.role === 'admin' ? 'Administrador' : profile.role === 'viewer' ? 'Solo lectura' : 'Operador', " \u00B7 DNI ", profile.dni] })] }), _jsx("button", { className: "icon-button logout-button", title: "Cerrar sesi\u00F3n", onClick: logout, children: _jsx(LogOut, { size: 17 }) })] })] })] }), _jsxs("div", { className: "main-area", children: [_jsxs("header", { className: "topbar", children: [_jsx("button", { className: "icon-button mobile-menu", onClick: () => setMenuOpen(!menuOpen), "aria-label": "Abrir men\u00FA", children: menuOpen ? _jsx(X, { size: 21 }) : _jsx(Menu, { size: 21 }) }), _jsxs("div", { className: "breadcrumb", children: [_jsx("span", { children: "APC Corporaci\u00F3n" }), _jsx("span", { className: "crumb-sep", children: "/" }), _jsx("strong", { children: pageTitle(page) })] }), _jsxs("div", { className: "top-actions", children: [_jsxs("div", { className: `connection-pill ${online ? 'is-online' : 'is-offline'}`, children: [online ? _jsx(Wifi, { size: 15 }) : _jsx(WifiOff, { size: 15 }), _jsx("span", { children: online ? 'En línea' : 'Sin conexión' })] }), pending.length > 0 && _jsxs("button", { className: "sync-button", onClick: syncPending, disabled: !online || syncing, children: [_jsx(RefreshCw, { size: 15, className: syncing ? 'spin' : '' }), syncing ? 'Sincronizando' : `Sincronizar (${pending.length})`] }), _jsx("button", { className: "icon-button refresh-button", title: "Actualizar datos", onClick: () => session?.user?.id && loadUserData(session.user.id), children: _jsx(RefreshCw, { size: 18 }) })] })] }), _jsxs("main", { className: "content", children: [page === 'overview' && _jsx(Overview, { inventory: inventory, totals: totals, totalUnits: totalUnits, pending: pending.length, setPage: setPage, setContainer: (id) => { setSelectedContainer(id); setPage('containers'); }, movements: movements }), page === 'containers' && _jsx(ContainersPage, { selected: selected, selectedId: selectedContainer, setSelected: setSelectedContainer, inventory: inventory, getQuantity: getQuantity, drafts: drafts, setDrafts: setDrafts, applyDelta: applyDelta, applySet: applySet, canEdit: profile.role !== 'viewer' }), page === 'history' && _jsx(HistoryPage, { movements: movements }), page === 'protocol' && _jsx(ProtocolPage, {})] }), _jsxs("footer", { className: "app-footer", children: [_jsx("span", { children: "APC CORPORACI\u00D3N S.A.C. \u00B7 APC INVENTARIO" }), _jsx("span", { children: "Control interno de suministros" })] })] }), toast && _jsxs("div", { className: `toast toast-${toast.type}`, children: [_jsx("span", { className: "toast-icon", children: toast.type === 'success' ? _jsx(Check, { size: 17 }) : toast.type === 'error' ? _jsx(AlertTriangle, { size: 17 }) : _jsx(Info, { size: 17 }) }), toast.text, _jsx("button", { onClick: () => setToast(null), children: _jsx(X, { size: 15 }) })] }), protocolOpen && _jsx(ProtocolModal, { onClose: () => setProtocolOpen(false) })] }));
}
function pageTitle(page) {
    return ({ overview: 'Resumen general', containers: 'Control por contenedor', history: 'Historial de movimientos', protocol: 'Protocolo administrativo' })[page];
}
function NavButton({ active, icon, label, onClick }) {
    return _jsxs("button", { className: `nav-button ${active ? 'active' : ''}`, onClick: onClick, children: [icon, _jsx("span", { children: label }), active && _jsx("span", { className: "nav-active-dot" })] });
}
function LoginScreen({ dni, setDni, password, setPassword, onSubmit, busy, error }) {
    return _jsxs("div", { className: "login-screen", children: [_jsx("div", { className: "login-decoration decor-one" }), _jsx("div", { className: "login-decoration decor-two" }), _jsxs("div", { className: "login-card", children: [_jsx("div", { className: "login-brand", children: _jsx("img", { src: `${window.APC_CONFIG.BASE_URL}apc-logo.png`, alt: "APC Corporaci\u00F3n" }) }), _jsxs("div", { className: "login-heading", children: [_jsx("span", { className: "eyebrow", children: "SISTEMA INTERNO" }), _jsx("h1", { children: "APC Inventario" }), _jsx("p", { children: "Control de suministros de comedor" })] }), _jsxs("form", { onSubmit: onSubmit, className: "login-form", children: [_jsxs("label", { children: ["DNI del trabajador", _jsx("input", { value: dni, onChange: (e) => setDni(e.target.value.replace(/\D/g, '').slice(0, 8)), placeholder: "Ingresa 8 d\u00EDgitos", inputMode: "numeric", autoComplete: "username" })] }), _jsxs("label", { children: ["Contrase\u00F1a", _jsx("input", { type: "password", value: password, onChange: (e) => setPassword(e.target.value), placeholder: "Tu contrase\u00F1a", autoComplete: "current-password" })] }), error && _jsxs("div", { className: "login-error", children: [_jsx(AlertTriangle, { size: 16 }), error] }), _jsx("button", { className: "btn btn-primary login-submit", type: "submit", disabled: busy, children: busy ? _jsxs(_Fragment, { children: [_jsx(RefreshCw, { size: 17, className: "spin" }), " Verificando\u2026"] }) : _jsxs(_Fragment, { children: ["Ingresar al sistema ", _jsx(ArrowUpRight, { size: 17 })] }) })] }), _jsxs("div", { className: "login-security", children: [_jsx(ShieldCheck, { size: 16 }), _jsx("span", { children: "Acceso privado \u00B7 Los datos se sincronizan de forma segura" })] }), _jsxs("div", { className: "login-footer", children: ["APC CORPORACI\u00D3N S.A.C. ", _jsx("span", { children: "\u00B7" }), " 2026"] })] })] });
}
function ConfigurationScreen() {
    return _jsxs("div", { className: "loading-screen", children: [_jsx("img", { className: "config-logo", src: "/APC/apc-logo.png", alt: "APC" }), _jsx("h2", { children: "Falta configurar Supabase" }), _jsxs("p", { children: ["Revisa las variables ", _jsx("code", { children: "VITE_SUPABASE_URL" }), " y ", _jsx("code", { children: "VITE_SUPABASE_PUBLISHABLE_KEY" }), " antes de compilar."] })] });
}
function Overview({ inventory, totals, totalUnits, pending, setPage, setContainer, movements }) {
    return _jsxs("div", { className: "page-stack", children: [_jsxs("section", { className: "welcome-row", children: [_jsxs("div", { children: [_jsx("div", { className: "eyebrow", children: "PANEL DE CONTROL" }), _jsx("h1", { children: "Resumen de inventario" }), _jsx("p", { children: "Consulta el stock consolidado y controla cada zona de almacenamiento." })] }), _jsxs("button", { className: "btn btn-outline", onClick: () => setPage('protocol'), children: [_jsx(ClipboardList, { size: 17 }), " Ver protocolo"] })] }), _jsxs("section", { className: "stats-grid", children: [_jsx(StatCard, { label: "Stock total", value: formatNumber(totalUnits), unit: "unidades", icon: _jsx(Package, { size: 20 }), tone: "navy", detail: "Suma de los cuatro contenedores" }), _jsx(StatCard, { label: "T\u00E1pers Rey", value: formatNumber(totals.find((x) => x.key === 'taper_rey')?.quantity ?? 0), unit: "unidades", icon: _jsx(Boxes, { size: 20 }), tone: "green", detail: "En todas las zonas" }), _jsx(StatCard, { label: "T\u00E1pers GyG", value: formatNumber(totals.find((x) => x.key === 'taper_gyg')?.quantity ?? 0), unit: "unidades", icon: _jsx(Boxes, { size: 20 }), tone: "orange", detail: "En todas las zonas" }), _jsx(StatCard, { label: "Tapas", value: formatNumber(totals.find((x) => x.key === 'tapas')?.quantity ?? 0), unit: "unidades", icon: _jsx(SlidersHorizontal, { size: 20 }), tone: "slate", detail: "En todas las zonas" }), _jsx(StatCard, { label: "Tenedores", value: formatNumber(totals.find((x) => x.key === 'tenedores')?.quantity ?? 0), unit: "unidades", icon: _jsx(SlidersHorizontal, { size: 20 }), tone: "navy", detail: "En todas las zonas" })] }), pending > 0 && _jsxs("div", { className: "pending-banner", children: [_jsx(CloudOff, { size: 18 }), _jsxs("div", { children: [_jsxs("strong", { children: [pending, " cambio(s) pendiente(s) de sincronizaci\u00F3n"] }), _jsx("span", { children: "Los datos est\u00E1n guardados en este tel\u00E9fono y se enviar\u00E1n al recuperar la conexi\u00F3n." })] })] }), _jsxs("section", { className: "section-block", children: [_jsxs("div", { className: "section-heading", children: [_jsxs("div", { children: [_jsx("span", { className: "eyebrow", children: "DISTRIBUCI\u00D3N" }), _jsx("h2", { children: "Contenedores" })] }), _jsxs("button", { className: "text-action", onClick: () => setPage('containers'), children: ["Ver todos ", _jsx(ArrowUpRight, { size: 15 })] })] }), _jsx("div", { className: "container-grid", children: CONTAINERS.map((container, index) => {
                            const rows = inventory.filter((row) => row.container_id === container.id);
                            const sum = rows.reduce((n, row) => n + row.quantity, 0);
                            return _jsxs("button", { className: "container-card", onClick: () => setContainer(container.id), children: [_jsxs("div", { className: "container-card-top", children: [_jsx("div", { className: `container-icon container-tone-${index}`, children: _jsx(Boxes, { size: 21 }) }), _jsx("span", { className: "container-arrow", children: _jsx(ArrowUpRight, { size: 17 }) })] }), _jsx("div", { className: "container-card-name", children: container.name }), _jsx("div", { className: "container-card-desc", children: container.detail }), _jsxs("div", { className: "container-card-total", children: [_jsx("strong", { children: formatNumber(sum) }), _jsx("span", { children: "unidades registradas" })] }), _jsx("div", { className: "mini-stock-list", children: ITEMS.map((item) => _jsxs("div", { children: [_jsx("span", { children: item.label }), _jsx("b", { children: formatNumber(rows.find((r) => r.item_key === item.key)?.quantity ?? 0) })] }, item.key)) })] }, container.id);
                        }) })] }), _jsxs("section", { className: "lower-grid", children: [_jsxs("div", { className: "panel-card reference-panel", children: [_jsxs("div", { className: "panel-title", children: [_jsxs("div", { children: [_jsx("span", { className: "eyebrow", children: "REFERENCIA ADMINISTRATIVA" }), _jsx("h3", { children: "Stock comunicado" })] }), _jsx(Info, { size: 18 })] }), _jsxs("div", { className: "reference-stats", children: [_jsxs("div", { children: [_jsx("span", { children: "T\u00E1peres comunicados" }), _jsxs("strong", { children: ["528 ", _jsx("small", { children: "und." })] })] }), _jsxs("div", { children: [_jsx("span", { children: "Tenedores comunicados" }), _jsxs("strong", { children: ["522 ", _jsx("small", { children: "und." })] })] })] }), _jsx("p", { children: "Estas cantidades son una referencia del comunicado administrativo; no se han distribuido autom\u00E1ticamente entre las cajas." })] }), _jsxs("div", { className: "panel-card recent-panel", children: [_jsxs("div", { className: "panel-title", children: [_jsxs("div", { children: [_jsx("span", { className: "eyebrow", children: "SEGUIMIENTO" }), _jsx("h3", { children: "Actividad reciente" })] }), _jsxs("button", { className: "text-action", onClick: () => setPage('history'), children: ["Historial ", _jsx(ArrowUpRight, { size: 15 })] })] }), movements.length === 0 ? _jsxs("div", { className: "empty-state small-empty", children: [_jsx(History, { size: 22 }), _jsx("span", { children: "A\u00FAn no hay movimientos registrados." })] }) : movements.slice(0, 4).map((m) => _jsxs("div", { className: "recent-line", children: [_jsx("span", { className: `movement-dot ${m.delta >= 0 ? 'positive' : 'negative'}`, children: m.delta >= 0 ? _jsx(ArrowUpRight, { size: 13 }) : _jsx(ArrowDownRight, { size: 13 }) }), _jsxs("div", { className: "recent-info", children: [_jsx("strong", { children: itemLabel(m.item_key) }), _jsxs("span", { children: [containerLabel(m.container_id), " \u00B7 ", m.actor_name] })] }), _jsxs("b", { className: m.delta >= 0 ? 'positive-text' : 'negative-text', children: [m.delta > 0 ? '+' : '', m.delta] })] }, m.id))] })] })] });
}
function StatCard({ label, value, unit, icon, tone, detail }) {
    return _jsxs("div", { className: "stat-card", children: [_jsx("div", { className: `stat-icon stat-${tone}`, children: icon }), _jsx("div", { className: "stat-label", children: label }), _jsxs("div", { className: "stat-value", children: [value, _jsx("small", { children: unit })] }), _jsx("div", { className: "stat-detail", children: detail })] });
}
function ContainersPage({ selected, selectedId, setSelected, inventory, getQuantity, drafts, setDrafts, applyDelta, applySet, canEdit }) {
    return _jsxs("div", { className: "page-stack", children: [_jsxs("section", { className: "welcome-row", children: [_jsxs("div", { children: [_jsx("div", { className: "eyebrow", children: "CONTROL POR ZONA" }), _jsx("h1", { children: "Contenedores" }), _jsx("p", { children: "Selecciona una caja para revisar o actualizar sus cantidades." })] }), _jsxs("div", { className: "capacity-chip", children: [_jsx(Boxes, { size: 17 }), _jsx("span", { children: "4 zonas de almacenamiento" })] })] }), _jsx("div", { className: "container-tabs", children: CONTAINERS.map((c) => _jsxs("button", { className: selectedId === c.id ? 'selected' : '', onClick: () => setSelected(c.id), children: [_jsx("span", { className: "tab-box-icon", children: _jsx(Boxes, { size: 17 }) }), c.name, selectedId === c.id && _jsx("span", { className: "tab-selected-mark", children: _jsx(Check, { size: 14 }) })] }, c.id)) }), _jsxs("section", { className: "selected-container-head", children: [_jsx("div", { className: "selected-container-icon", children: _jsx(Boxes, { size: 24 }) }), _jsxs("div", { children: [_jsx("span", { className: "eyebrow", children: "ZONA SELECCIONADA" }), _jsx("h2", { children: selected.name }), _jsx("p", { children: selected.detail })] }), _jsxs("div", { className: "selected-container-total", children: [_jsx("span", { children: "Stock en este contenedor" }), _jsx("strong", { children: formatNumber(inventory.filter((row) => row.container_id === selectedId).reduce((sum, row) => sum + row.quantity, 0)) })] })] }), _jsx("div", { className: "items-grid", children: ITEMS.map((item) => {
                    const quantity = getQuantity(selectedId, item.key);
                    const draftKey = `${selectedId}:${item.key}`;
                    const draft = drafts[draftKey] ?? String(quantity);
                    return _jsxs("article", { className: "item-control-card", children: [_jsxs("div", { className: "item-control-top", children: [_jsx("div", { className: `item-symbol item-${item.key}`, children: _jsx(Package, { size: 19 }) }), _jsxs("div", { children: [_jsx("h3", { children: item.label }), _jsxs("span", { children: ["Conteo f\u00EDsico \u00B7 ", item.unit] })] }), _jsxs("div", { className: "item-quantity", children: [_jsx("strong", { children: formatNumber(quantity) }), _jsx("small", { children: "unidades" })] })] }), _jsx("div", { className: "quick-actions-label", children: "AJUSTE R\u00C1PIDO" }), _jsxs("div", { className: "quick-actions", children: [_jsx("button", { disabled: !canEdit, onClick: () => applyDelta(selectedId, item.key, -5), className: "quick-minus", children: "\u22125" }), _jsx("button", { disabled: !canEdit, onClick: () => applyDelta(selectedId, item.key, -1), className: "quick-minus", children: "\u22121" }), _jsx("button", { disabled: !canEdit, onClick: () => applyDelta(selectedId, item.key, 1), className: "quick-plus", children: "+1" }), _jsx("button", { disabled: !canEdit, onClick: () => applyDelta(selectedId, item.key, 5), className: "quick-plus", children: "+5" })] }), _jsxs("div", { className: "manual-count", children: [_jsx("label", { htmlFor: `count-${item.key}`, children: "Ingresar conteo exacto" }), _jsxs("div", { className: "manual-input-row", children: [_jsx("input", { id: `count-${item.key}`, type: "number", min: "0", step: "1", inputMode: "numeric", disabled: !canEdit, value: draft, onChange: (e) => setDrafts((old) => ({ ...old, [draftKey]: e.target.value })), onFocus: (e) => e.target.select() }), _jsx("button", { disabled: !canEdit || Number(draft) === quantity || draft === '', className: "btn btn-primary btn-save-count", onClick: () => applySet(selectedId, item.key, Number(draft)), children: "Guardar" })] })] })] }, item.key);
                }) }), _jsxs("div", { className: "info-strip", children: [_jsx(Info, { size: 17 }), _jsx("span", { children: "Cada ajuste queda registrado con fecha, hora, trabajador y cantidad anterior/nueva. No se permite guardar un stock negativo." })] })] });
}
function HistoryPage({ movements }) {
    const [filter, setFilter] = useState('todos');
    const filtered = movements.filter((m) => filter === 'todos' || m.movement_type === filter);
    return _jsxs("div", { className: "page-stack", children: [_jsxs("section", { className: "welcome-row", children: [_jsxs("div", { children: [_jsx("div", { className: "eyebrow", children: "TRAZABILIDAD" }), _jsx("h1", { children: "Historial de movimientos" }), _jsx("p", { children: "Registro de ajustes y conteos realizados en los contenedores." })] }), _jsxs("div", { className: "capacity-chip", children: [_jsx(History, { size: 17 }), _jsx("span", { children: "\u00DAltimos 60 movimientos" })] })] }), _jsxs("section", { className: "panel-card history-card", children: [_jsxs("div", { className: "history-toolbar", children: [_jsxs("div", { children: [_jsx("h3", { children: "Registro de actividad" }), _jsxs("span", { children: [filtered.length, " movimientos visibles"] })] }), _jsxs("div", { className: "filter-select-wrap", children: [_jsx(SlidersHorizontal, { size: 15 }), _jsxs("select", { value: filter, onChange: (e) => setFilter(e.target.value), children: [_jsx("option", { value: "todos", children: "Todos los movimientos" }), _jsx("option", { value: "entrada", children: "Entradas" }), _jsx("option", { value: "salida", children: "Salidas" }), _jsx("option", { value: "ajuste", children: "Ajustes" })] }), _jsx(ChevronDown, { size: 14 })] })] }), filtered.length === 0 ? _jsxs("div", { className: "empty-state", children: [_jsx(History, { size: 28 }), _jsx("strong", { children: "Sin movimientos registrados" }), _jsx("span", { children: "Cuando se actualice una cantidad, aparecer\u00E1 aqu\u00ED." })] }) : _jsx("div", { className: "table-scroll", children: _jsxs("table", { className: "movement-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Fecha y hora" }), _jsx("th", { children: "Contenedor" }), _jsx("th", { children: "Suministro" }), _jsx("th", { children: "Tipo" }), _jsx("th", { children: "Variaci\u00F3n" }), _jsx("th", { children: "Antes" }), _jsx("th", { children: "Despu\u00E9s" }), _jsx("th", { children: "Responsable" })] }) }), _jsx("tbody", { children: filtered.map((m) => _jsxs("tr", { children: [_jsx("td", { className: "date-cell", children: formatDate(m.created_at) }), _jsx("td", { children: containerLabel(m.container_id) }), _jsx("td", { children: _jsx("strong", { children: itemLabel(m.item_key) }) }), _jsx("td", { children: _jsx("span", { className: `movement-tag tag-${m.movement_type}`, children: m.movement_type }) }), _jsx("td", { className: m.delta >= 0 ? 'positive-text' : 'negative-text', children: _jsxs("strong", { children: [m.delta > 0 ? '+' : '', m.delta] }) }), _jsx("td", { children: formatNumber(m.quantity_before) }), _jsx("td", { children: _jsx("strong", { children: formatNumber(m.quantity_after) }) }), _jsx("td", { children: m.actor_name })] }, m.id)) })] }) })] })] });
}
function ProtocolPage() {
    return _jsxs("div", { className: "page-stack", children: [_jsxs("section", { className: "welcome-row", children: [_jsxs("div", { children: [_jsx("div", { className: "eyebrow", children: "DOCUMENTO DE REFERENCIA" }), _jsx("h1", { children: "Protocolo administrativo" }), _jsx("p", { children: "Procedimiento de entrega, retorno, lavado y conciliaci\u00F3n de suministros." })] }), _jsxs("div", { className: "protocol-stamp", children: [_jsx(ShieldCheck, { size: 18 }), _jsx("span", { children: "Uso interno APC" })] })] }), _jsxs("div", { className: "protocol-intro", children: [_jsx("div", { className: "protocol-intro-icon", children: _jsx(ClipboardList, { size: 22 }) }), _jsxs("div", { children: [_jsx("strong", { children: "Procedimientos a seguir \u00B7 De lunes a domingo" }), _jsx("p", { children: "Resumen operativo del comunicado administrativo con fecha de aplicaci\u00F3n 26 de octubre." })] })] }), _jsxs("section", { className: "protocol-steps", children: [_jsx(ProtocolStep, { number: "01", title: "Entrega y rotaci\u00F3n de transportados", responsible: "Brillith", text: "Responsable de la entrega de t\u00E1peres para el transportado y de la rotaci\u00F3n de los mismos dentro del radio indicado por la administraci\u00F3n (no menor a 500 metros, incluyendo Casevip y otros puntos)." }), _jsx(ProtocolStep, { number: "02", title: "Recepci\u00F3n y retorno de transportados", responsible: "Jonathan", text: "Recibe los transportados con la cantidad saliente de t\u00E1peres y tenedores. Al retorno, verifica y registra nuevamente las cantidades. Si falta alg\u00FAn suministro, reporta al Sr. Elar Espino y confirma el seguimiento hasta que llegue a su punto final." }), _jsx(ProtocolStep, { number: "03", title: "Recepci\u00F3n y conteo de coolers", responsible: "Ra\u00FAl \u00B7 apoyo de Cinthya", text: "Ra\u00FAl recepciona las cantidades salientes de los transportados. Cinthya brinda soporte en el conteo de los coolers, incluyendo t\u00E1peres y tenedores." }), _jsx(ProtocolStep, { number: "04", title: "Conteo despu\u00E9s del lavado", responsible: "Ra\u00FAl", text: "Al finalizar el lavado, informa a Brillith la cantidad de t\u00E1peres y tenedores disponibles para salida durante el d\u00EDa, para realizar el cuadre con el stock vigente." }), _jsx(ProtocolStep, { number: "05", title: "Notificaci\u00F3n del stock vigente", responsible: "Brillith", text: "Brillith comunica el stock actualizado de ambos suministros a la administraci\u00F3n y al equipo correspondiente." })] }), _jsxs("section", { className: "panel-card protocol-reference", children: [_jsxs("div", { className: "panel-title", children: [_jsxs("div", { children: [_jsx("span", { className: "eyebrow", children: "REFERENCIA DEL COMUNICADO" }), _jsx("h3", { children: "Stock informado inicialmente" })] }), _jsx("span", { className: "reference-date", children: "26 OCT 2026" })] }), _jsxs("div", { className: "protocol-stock-grid", children: [_jsxs("div", { children: [_jsx("span", { children: "T\u00E1peres" }), _jsxs("strong", { children: ["528 ", _jsx("small", { children: "unidades" })] }), _jsx("p", { children: "348 + 100 de 1.1 L + 80 de 1 L" })] }), _jsxs("div", { children: [_jsx("span", { children: "Tenedores" }), _jsxs("strong", { children: ["522 ", _jsx("small", { children: "unidades" })] }), _jsx("p", { children: "402 usados + 120 nuevos" })] })] }), _jsxs("div", { className: "protocol-warning", children: [_jsx(AlertTriangle, { size: 17 }), _jsx("p", { children: "El comunicado indica que no se consideran 14 t\u00E1peres comprados anteriormente y menciona una posible diferencia de un t\u00E1per, con tapa disponible. Verificar f\u00EDsicamente antes de establecer el stock inicial en el sistema." })] })] }), _jsxs("div", { className: "info-strip", children: [_jsx(Info, { size: 17 }), _jsx("span", { children: "El sistema registra cantidades por contenedor. La asignaci\u00F3n de responsabilidades y las comunicaciones oficiales siguen el instructivo de la administraci\u00F3n." })] })] });
}
function ProtocolStep({ number, title, responsible, text }) {
    return _jsxs("article", { className: "protocol-step", children: [_jsx("div", { className: "step-number", children: number }), _jsxs("div", { className: "step-body", children: [_jsxs("div", { className: "step-title-row", children: [_jsx("h3", { children: title }), _jsx("span", { children: responsible })] }), _jsx("p", { children: text })] })] });
}
function ProtocolModal({ onClose }) {
    return _jsx("div", { className: "modal-backdrop", onClick: onClose, children: _jsxs("div", { className: "modal-card", onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { className: "modal-head", children: [_jsxs("div", { children: [_jsx("span", { className: "eyebrow", children: "APC CORPORACI\u00D3N" }), _jsx("h2", { children: "Protocolo administrativo" })] }), _jsx("button", { className: "icon-button", onClick: onClose, children: _jsx(X, { size: 20 }) })] }), _jsx("div", { className: "modal-body", children: _jsx(ProtocolPage, {}) }), _jsx("div", { className: "modal-actions", children: _jsx("button", { className: "btn btn-primary", onClick: onClose, children: "Entendido" }) })] }) });
}
export default App;
