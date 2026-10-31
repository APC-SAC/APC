const cacheKey = (userId) => `apci:inventory:${userId}`;
const queueKey = (userId) => `apci:queue:${userId}`;
export function readInventoryCache(userId) {
    try {
        return JSON.parse(localStorage.getItem(cacheKey(userId)) || '[]');
    }
    catch {
        return [];
    }
}
export function writeInventoryCache(userId, rows) {
    localStorage.setItem(cacheKey(userId), JSON.stringify(rows));
}
export function readQueue(userId) {
    try {
        return JSON.parse(localStorage.getItem(queueKey(userId)) || '[]');
    }
    catch {
        return [];
    }
}
export function writeQueue(userId, rows) {
    localStorage.setItem(queueKey(userId), JSON.stringify(rows));
}
