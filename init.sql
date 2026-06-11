-- Tables
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR UNIQUE NOT NULL,
  password_hash VARCHAR NOT NULL,
  created_at    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS regions (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR NOT NULL,
  description  VARCHAR,
  campus_lat   FLOAT DEFAULT 22.3149,
  campus_lng   FLOAT DEFAULT 87.3105,
  campus_zoom  INTEGER DEFAULT 15,
  model_status VARCHAR DEFAULT 'pending',
  created_by   INTEGER REFERENCES users(id),
  created_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_regions (
  user_id   INTEGER REFERENCES users(id),
  region_id INTEGER REFERENCES regions(id),
  role      VARCHAR DEFAULT 'owner',
  PRIMARY KEY (user_id, region_id)
);

CREATE TABLE IF NOT EXISTS street_lights (
  id                VARCHAR PRIMARY KEY,
  zone              VARCHAR,
  lamp_type         VARCHAR,
  rated_power       INTEGER,
  efficiency        FLOAT,
  install_age_days  INTEGER,
  initial_health    FLOAT,
  maintenance_cost  INTEGER,
  latitude          FLOAT,
  longitude         FLOAT,
  region_id         INTEGER REFERENCES regions(id),
  is_virtual        BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS twin_state (
  light_id         VARCHAR PRIMARY KEY REFERENCES street_lights(id),
  brightness       FLOAT DEFAULT 0,
  status           VARCHAR DEFAULT 'OFF',
  energy_consumed  FLOAT DEFAULT 0,
  health_score     FLOAT DEFAULT 100,
  ambient_light    FLOAT DEFAULT 0,
  weather          VARCHAR DEFAULT 'clear',
  fault_alert      BOOLEAN DEFAULT false,
  fault_probability FLOAT DEFAULT 0,
  simulated_hour   INTEGER DEFAULT 0,
  last_updated     TIMESTAMP DEFAULT NOW(),
  region_id        INTEGER REFERENCES regions(id)
);

CREATE TABLE IF NOT EXISTS state_history (
  id               SERIAL PRIMARY KEY,
  light_id         VARCHAR NOT NULL REFERENCES street_lights(id),
  brightness       FLOAT,
  health_score     FLOAT,
  energy_consumed  FLOAT,
  fault_occurred   BOOLEAN,
  fault_probability FLOAT,
  weather          VARCHAR,
  simulated_hour   INTEGER,
  recorded_at      TIMESTAMP DEFAULT NOW(),
  region_id        INTEGER REFERENCES regions(id),
  is_simulated     BOOLEAN DEFAULT true,
  real_timestamp   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS maintenance_log (
  id           SERIAL PRIMARY KEY,
  light_id     VARCHAR NOT NULL REFERENCES street_lights(id),
  performed_at TIMESTAMP DEFAULT NOW(),
  health_before FLOAT,
  health_after  FLOAT,
  scope        VARCHAR DEFAULT 'single',
  notes        VARCHAR,
  region_id    INTEGER REFERENCES regions(id)
);

CREATE TABLE IF NOT EXISTS system_settings (
  key   VARCHAR PRIMARY KEY,
  value VARCHAR NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_history_light_id ON state_history(light_id);
CREATE INDEX IF NOT EXISTS idx_history_recorded_at ON state_history(recorded_at);
CREATE INDEX IF NOT EXISTS idx_maintenance_light_id ON maintenance_log(light_id);

-- Default settings
INSERT INTO system_settings (key, value) VALUES
  ('retrain_schedule',    'weekly'),
  ('last_retrain_at',     to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
  ('sim_start_real_time', to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
ON CONFLICT (key) DO NOTHING;

-- Default region
INSERT INTO regions (id, name, description, campus_lat, campus_lng, campus_zoom, model_status)
VALUES (1, 'IIT Kharagpur', 'IIT Kharagpur main campus street lighting network',
        22.3149, 87.3105, 15, 'ready')
ON CONFLICT DO NOTHING;

-- Default admin user (password: admin123)
INSERT INTO users (id, username, password_hash)
VALUES (1, 'admin', '$2b$10$KAiH4kSqZhI0qb7X6y05HeSUsEu9uepK0MXA.OYbQtvktXPrqVB9G')
ON CONFLICT DO NOTHING;

INSERT INTO user_regions (user_id, region_id, role)
VALUES (1, 1, 'owner')
ON CONFLICT DO NOTHING;