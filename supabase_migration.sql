-- ═══════════════════════════════════════════════════════════
-- Spectra + Control Home — Supabase Migration
-- ═══════════════════════════════════════════════════════════

-- 1. Cámaras
CREATE TABLE IF NOT EXISTS home_cameras (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    location TEXT DEFAULT '',
    rtsp_url TEXT DEFAULT '',
    snapshot_url TEXT,
    username TEXT DEFAULT 'admin',
    password TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Personas autorizadas
CREATE TABLE IF NOT EXISTS home_persons (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    relationship TEXT,
    avatar_url TEXT,
    phone TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Fotos faciales de personas
CREATE TABLE IF NOT EXISTS home_person_photos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    person_id UUID REFERENCES home_persons(id) ON DELETE CASCADE,
    storage_path TEXT NOT NULL,
    original_name TEXT,
    url TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Eventos de presencia
CREATE TABLE IF NOT EXISTS home_presence_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    person_name TEXT NOT NULL DEFAULT 'Desconocido',
    event_type TEXT NOT NULL DEFAULT 'detected',
    camera_name TEXT,
    confidence REAL,
    is_known BOOLEAN DEFAULT false,
    photo_url TEXT,
    event_time TIMESTAMPTZ DEFAULT now()
);

-- 5. Configuración del sistema
CREATE TABLE IF NOT EXISTS home_config (
    id TEXT PRIMARY KEY DEFAULT 'main',
    alert_phones TEXT[] DEFAULT '{}',
    phone_limit_minutes INTEGER DEFAULT 60,
    detection_interval_seconds INTEGER DEFAULT 2,
    unknown_person_alert BOOLEAN DEFAULT true,
    phone_usage_alert BOOLEAN DEFAULT true,
    notifications_enabled BOOLEAN DEFAULT false,
    -- Spectra RF detection settings
    rf_threshold REAL DEFAULT 2.5,
    rf_movement_threshold INTEGER DEFAULT 15,
    rf_sensitivity REAL DEFAULT 0.15,
    rf_window_size INTEGER DEFAULT 30,
    -- Smart Home toggles
    alarm_perimeter BOOLEAN DEFAULT false,
    night_mode BOOLEAN DEFAULT false,
    email_alerts BOOLEAN DEFAULT false,
    rf_detection_enabled BOOLEAN DEFAULT true,
    camera_recording BOOLEAN DEFAULT false,
    siren_enabled BOOLEAN DEFAULT false,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Insert default config row
INSERT INTO home_config (id) VALUES ('main') ON CONFLICT (id) DO NOTHING;

-- 6. Uso de celular  
CREATE TABLE IF NOT EXISTS home_phone_usage (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    minutes_used REAL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 7. Heartbeats del RPi
CREATE TABLE IF NOT EXISTS home_heartbeats (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    cpu_temp REAL,
    uptime_seconds INTEGER,
    cameras_processing INTEGER DEFAULT 0,
    ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════
-- Índices para performance
-- ═══════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_presence_events_time ON home_presence_events(event_time DESC);
CREATE INDEX IF NOT EXISTS idx_presence_events_known ON home_presence_events(is_known);
CREATE INDEX IF NOT EXISTS idx_person_photos_person ON home_person_photos(person_id);
CREATE INDEX IF NOT EXISTS idx_heartbeats_time ON home_heartbeats(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_phone_usage_date ON home_phone_usage(date DESC);

-- ═══════════════════════════════════════════════════════════
-- RLS (Row Level Security) - Permitir acceso autenticado
-- ═══════════════════════════════════════════════════════════
ALTER TABLE home_cameras ENABLE ROW LEVEL SECURITY;
ALTER TABLE home_persons ENABLE ROW LEVEL SECURITY;
ALTER TABLE home_person_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE home_presence_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE home_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE home_phone_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE home_heartbeats ENABLE ROW LEVEL SECURITY;

-- Políticas: usuarios autenticados tienen acceso total
CREATE POLICY "auth_all" ON home_cameras FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_all" ON home_persons FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_all" ON home_person_photos FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_all" ON home_presence_events FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_all" ON home_config FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_all" ON home_phone_usage FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_all" ON home_heartbeats FOR ALL USING (auth.role() = 'authenticated');

-- Permitir también acceso anon para heartbeats (el RPi no tiene auth)
CREATE POLICY "anon_insert_heartbeat" ON home_heartbeats FOR INSERT WITH CHECK (true);
CREATE POLICY "anon_insert_events" ON home_presence_events FOR INSERT WITH CHECK (true);
