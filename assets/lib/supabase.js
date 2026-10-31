import { createClient } from '@supabase/supabase-js';
const runtime = window.APC_CONFIG;
const supabaseUrl = runtime?.VITE_SUPABASE_URL;
const supabaseKey = runtime?.VITE_SUPABASE_PUBLISHABLE_KEY;
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);
// APC Inventario no usa Auth: el acceso de escritura se concede mediante el QR
// físico de cada contenedor. Solo se utiliza la clave pública publishable.
export const supabase = isSupabaseConfigured
    ? createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        realtime: { params: { eventsPerSecond: 5 } },
    })
    : null;
