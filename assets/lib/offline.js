const INVENTORY_KEY = 'apci:inventory:public:v2';
const QUEUE_KEY = 'apci:pending:public:v2';
export function readInventoryCache() {
    try {
        return JSON.parse(localStorage.getItem(INVENTORY_KEY) || '[]');
    }
    catch {
        return [];
    }
}
export function writeInventoryCache(rows) {
    try {
        localStorage.setItem(INVENTORY_KEY, JSON.stringify(rows));
    }
    catch { /* storage unavailable */ }
}
export function readPendingQueue() {
    try {
        return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    }
    catch {
        return [];
    }
}
export function writePendingQueue(rows) {
    try {
        localStorage.setItem(QUEUE_KEY, JSON.stringify(rows));
    }
    catch { /* storage unavailable */ }
}
