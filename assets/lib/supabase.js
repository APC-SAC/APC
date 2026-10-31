import { createClient } from '@supabase/supabase-js';
const supabaseUrl = window.APC_CONFIG.VITE_SUPABASE_URL;
const supabaseKey = window.APC_CONFIG.VITE_SUPABASE_PUBLISHABLE_KEY;
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);
export const supabase = isSupabaseConfigured
    ? createClient(supabaseUrl, supabaseKey, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
        },
        realtime: { params: { eventsPerSecond: 5 } },
    })
    : null;
export function dniToEmail(dni) {
    return `dni${dni.trim()}@apc.invalid`;
}
