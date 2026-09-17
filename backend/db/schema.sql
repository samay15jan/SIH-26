-- Nirmaan - Smart Mining Safety and Structural Monitoring
-- PostgreSQL schema
--
-- Identity model:
--   sites / zones          -> internal serial ids (rarely referenced by clients)
--   gateways / nodes       -> the hardware-assigned text id IS the primary key
--                             ("GW-001", "NODE-001"), so MQTT topics, REST paths
--                             and foreign keys all use the same value.
--   telemetry              -> RANGE partitioned by measured_at (monthly)

BEGIN;

-- ---------------------------------------------------------------- utilities

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------------- sites

CREATE TABLE IF NOT EXISTS sites (
  id            serial PRIMARY KEY,
  code          text NOT NULL UNIQUE,
  name          text NOT NULL,
  description   text,
  latitude      numeric(9,6),
  longitude     numeric(9,6),
  timezone      text NOT NULL DEFAULT 'Asia/Kolkata',
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS zones (
  id            serial PRIMARY KEY,
  site_id       integer NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  code          text NOT NULL,
  name          text NOT NULL,
  description   text,
  depth_m       numeric(8,2),
  risk_category text NOT NULL DEFAULT 'normal'
                CHECK (risk_category IN ('low','normal','elevated','critical')),
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, code)
);

-- ---------------------------------------------------------------- gateways

CREATE TABLE IF NOT EXISTS gateways (
  gateway_id       text PRIMARY KEY,
  name             text,
  site_id          integer REFERENCES sites(id) ON DELETE SET NULL,
  zone_id          integer REFERENCES zones(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'unknown'
                   CHECK (status IN ('online','offline','unknown','maintenance')),
  latitude         numeric(9,6),
  longitude        numeric(9,6),
  firmware_version text,
  first_seen_at    timestamptz,
  last_seen_at     timestamptz,
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gateways_status_idx    ON gateways (status);
CREATE INDEX IF NOT EXISTS gateways_last_seen_idx ON gateways (last_seen_at DESC);

-- ------------------------------------------------------------------- nodes

CREATE TABLE IF NOT EXISTS nodes (
  node_id               text PRIMARY KEY,
  name                  text,
  gateway_id            text REFERENCES gateways(gateway_id) ON DELETE SET NULL,
  site_id               integer REFERENCES sites(id) ON DELETE SET NULL,
  zone_id               integer REFERENCES zones(id) ON DELETE SET NULL,
  latitude              numeric(9,6),
  longitude             numeric(9,6),
  elevation_m           numeric(8,2),
  status                text NOT NULL DEFAULT 'unknown'
                        CHECK (status IN ('online','offline','unknown','maintenance')),
  firmware_version      text,
  hardware_revision     text,
  -- baseline used to convert ultrasonic distance into displacement/subsidence
  reference_distance_mm numeric(10,2),
  install_depth_m       numeric(8,2),
  first_seen_at         timestamptz,
  last_seen_at          timestamptz,
  last_sequence_number  bigint,
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nodes_gateway_idx   ON nodes (gateway_id);
CREATE INDEX IF NOT EXISTS nodes_zone_idx      ON nodes (zone_id);
CREATE INDEX IF NOT EXISTS nodes_status_idx    ON nodes (status);
CREATE INDEX IF NOT EXISTS nodes_last_seen_idx ON nodes (last_seen_at DESC);

-- Per-node sensor inventory + health. Also used by the dashboard "sensor status".
CREATE TABLE IF NOT EXISTS node_sensors (
  id             serial PRIMARY KEY,
  node_id        text NOT NULL REFERENCES nodes(node_id) ON DELETE CASCADE,
  sensor_type    text NOT NULL,
  model          text,
  enabled        boolean NOT NULL DEFAULT true,
  status         text NOT NULL DEFAULT 'unknown'
                 CHECK (status IN ('ok','degraded','failed','unknown','disabled')),
  last_status_at timestamptz,
  config         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (node_id, sensor_type)
);

CREATE INDEX IF NOT EXISTS node_sensors_status_idx ON node_sensors (status);

-- --------------------------------------------------------------- telemetry

CREATE TABLE IF NOT EXISTS telemetry (
  id                        bigserial,
  node_id                   text NOT NULL REFERENCES nodes(node_id) ON DELETE CASCADE,
  gateway_id                text REFERENCES gateways(gateway_id) ON DELETE SET NULL,
  measured_at               timestamptz NOT NULL,
  received_at               timestamptz NOT NULL DEFAULT now(),
  sequence_number           bigint,

  -- MPU6050
  accel_x                   double precision,
  accel_y                   double precision,
  accel_z                   double precision,
  gyro_x                    double precision,
  gyro_y                    double precision,
  gyro_z                    double precision,
  roll                      double precision,
  pitch                     double precision,
  relative_yaw              double precision,

  -- SW-420 vibration
  vibration_detected        boolean,
  vibration_count           integer,
  vibration_duration_ms     integer,
  vibration_intensity       double precision,

  -- potentiometer / relative displacement
  potentiometer_raw         integer,
  potentiometer_voltage     double precision,
  relative_displacement_mm  double precision,

  -- crack detection (copper tape)
  crack_sensor_raw          integer,
  crack_sensor_voltage      double precision,
  crack_detected            boolean,

  -- ultrasonic distance / subsidence
  ultrasonic_distance_mm    double precision,
  ultrasonic_echo_time_us   integer,
  reference_distance_mm     double precision,
  displacement_mm           double precision,
  subsidence_mm             double precision,
  subsidence_rate_mm_per_day double precision,

  -- servo
  servo_target_angle        double precision,
  servo_actual_angle        double precision,
  servo_state               text,

  -- power
  battery_voltage           double precision,
  supply_voltage            double precision,
  battery_percentage        double precision,

  -- LoRa / gateway link
  lora_rssi                 double precision,
  lora_snr                  double precision,
  packets_lost              integer,
  packet_loss_percent       double precision,

  -- device metadata
  firmware_version          text,
  uptime_s                  bigint,
  reset_reason              text,
  sensor_status             jsonb,

  raw_payload               jsonb NOT NULL DEFAULT '{}'::jsonb,

  PRIMARY KEY (id, measured_at)
) PARTITION BY RANGE (measured_at);

CREATE INDEX IF NOT EXISTS telemetry_node_time_idx    ON telemetry (node_id, measured_at DESC);
CREATE INDEX IF NOT EXISTS telemetry_time_idx         ON telemetry (measured_at DESC);
CREATE INDEX IF NOT EXISTS telemetry_gateway_time_idx ON telemetry (gateway_id, measured_at DESC);
-- duplicate suppression: NULL sequence numbers are never considered duplicates
CREATE UNIQUE INDEX IF NOT EXISTS telemetry_dedupe_idx
  ON telemetry (node_id, sequence_number, measured_at);

-- Monthly partition helper. Safe to call repeatedly.
CREATE OR REPLACE FUNCTION ensure_telemetry_partition(p_when timestamptz)
RETURNS text AS $$
DECLARE
  v_start date := date_trunc('month', p_when AT TIME ZONE 'UTC')::date;
  v_end   date := (date_trunc('month', p_when AT TIME ZONE 'UTC') + interval '1 month')::date;
  v_name  text := 'telemetry_' || to_char(v_start, 'YYYY_MM');
BEGIN
  IF to_regclass(v_name) IS NULL THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF telemetry FOR VALUES FROM (%L) TO (%L)',
      v_name, v_start, v_end);
  END IF;
  RETURN v_name;
END;
$$ LANGUAGE plpgsql;

SELECT ensure_telemetry_partition(now() - interval '1 month');
SELECT ensure_telemetry_partition(now());
SELECT ensure_telemetry_partition(now() + interval '1 month');

-- Denormalised "latest value per node" used by dashboards and the rule engine.
CREATE TABLE IF NOT EXISTS node_state (
  node_id          text PRIMARY KEY REFERENCES nodes(node_id) ON DELETE CASCADE,
  measured_at      timestamptz,
  received_at      timestamptz,
  sequence_number  bigint,
  gateway_id       text,
  telemetry        jsonb NOT NULL DEFAULT '{}'::jsonb,
  risk_score       numeric(5,2),
  risk_level       text CHECK (risk_level IN ('low','moderate','high','severe')),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------ events

CREATE TABLE IF NOT EXISTS events (
  id          bigserial PRIMARY KEY,
  node_id     text REFERENCES nodes(node_id) ON DELETE CASCADE,
  gateway_id  text REFERENCES gateways(gateway_id) ON DELETE SET NULL,
  event_type  text NOT NULL,
  severity    text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  source      text NOT NULL DEFAULT 'device'
              CHECK (source IN ('device','gateway','backend','rule','ai','manual')),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  message     text,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_time_idx      ON events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS events_node_time_idx ON events (node_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS events_type_idx      ON events (event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS events_severity_idx  ON events (severity, occurred_at DESC);

-- --------------------------------------------------------------- anomalies

CREATE TABLE IF NOT EXISTS anomalies (
  id             bigserial PRIMARY KEY,
  node_id        text NOT NULL REFERENCES nodes(node_id) ON DELETE CASCADE,
  detected_at    timestamptz NOT NULL DEFAULT now(),
  window_start   timestamptz,
  window_end     timestamptz,
  anomaly_type   text NOT NULL,
  metric         text,
  observed_value double precision,
  expected_value double precision,
  deviation      double precision,
  score          numeric(6,3),
  severity       text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  method         text NOT NULL DEFAULT 'rule' CHECK (method IN ('rule','statistical','model')),
  model_name     text,
  model_version  text,
  details        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS anomalies_node_time_idx ON anomalies (node_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS anomalies_type_idx      ON anomalies (anomaly_type, detected_at DESC);

-- ------------------------------------------------------------- predictions

CREATE TABLE IF NOT EXISTS predictions (
  id               bigserial PRIMARY KEY,
  node_id          text REFERENCES nodes(node_id) ON DELETE CASCADE,
  zone_id          integer REFERENCES zones(id) ON DELETE SET NULL,
  model_name       text NOT NULL,
  model_version    text NOT NULL DEFAULT 'v1',
  prediction_type  text NOT NULL,
  predicted_at     timestamptz NOT NULL DEFAULT now(),
  target_time      timestamptz,
  horizon_minutes  integer,
  predicted_value  double precision,
  predicted_label  text,
  confidence       numeric(5,4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  risk_score       numeric(5,2) CHECK (risk_score IS NULL OR (risk_score >= 0 AND risk_score <= 100)),
  severity         text CHECK (severity IN ('info','warning','critical')),
  features         jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_response     jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS predictions_node_time_idx ON predictions (node_id, predicted_at DESC);
CREATE INDEX IF NOT EXISTS predictions_type_idx      ON predictions (prediction_type, predicted_at DESC);
CREATE INDEX IF NOT EXISTS predictions_model_idx     ON predictions (model_name, model_version);

-- -------------------------------------------------------- risk assessments

CREATE TABLE IF NOT EXISTS risk_assessments (
  id                   bigserial PRIMARY KEY,
  node_id              text REFERENCES nodes(node_id) ON DELETE CASCADE,
  zone_id              integer REFERENCES zones(id) ON DELETE SET NULL,
  assessed_at          timestamptz NOT NULL DEFAULT now(),
  risk_score           numeric(5,2) NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
  risk_level           text NOT NULL CHECK (risk_level IN ('low','moderate','high','severe')),
  source               text NOT NULL DEFAULT 'rule' CHECK (source IN ('rule','ai','manual')),
  model_name           text,
  model_version        text,
  contributing_factors jsonb NOT NULL DEFAULT '{}'::jsonb,
  valid_until          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS risk_node_time_idx ON risk_assessments (node_id, assessed_at DESC);
CREATE INDEX IF NOT EXISTS risk_zone_time_idx ON risk_assessments (zone_id, assessed_at DESC);

-- ------------------------------------------------------------------ alerts

CREATE TABLE IF NOT EXISTS alerts (
  id              bigserial PRIMARY KEY,
  node_id         text REFERENCES nodes(node_id) ON DELETE CASCADE,
  gateway_id      text REFERENCES gateways(gateway_id) ON DELETE SET NULL,
  alert_type      text NOT NULL,
  severity        text NOT NULL CHECK (severity IN ('info','warning','critical')),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','acknowledged','resolved')),
  message         text NOT NULL,
  risk_score      numeric(5,2),
  source          text NOT NULL DEFAULT 'rule'
                  CHECK (source IN ('rule','anomaly','prediction','device','system','manual')),
  rule_key        text,
  event_id        bigint REFERENCES events(id) ON DELETE SET NULL,
  prediction_id   bigint REFERENCES predictions(id) ON DELETE SET NULL,
  triggered_at    timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by text,
  resolved_at     timestamptz,
  resolved_by     text,
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  occurrence_count integer NOT NULL DEFAULT 1,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alerts_status_idx    ON alerts (status, triggered_at DESC);
CREATE INDEX IF NOT EXISTS alerts_node_time_idx ON alerts (node_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS alerts_severity_idx  ON alerts (severity, triggered_at DESC);
-- one open alert per (node, alert_type): repeats update the existing row
CREATE UNIQUE INDEX IF NOT EXISTS alerts_open_unique_idx
  ON alerts (node_id, alert_type) WHERE status <> 'resolved';
-- gateway-scoped alerts carry no node_id, so they need their own open-alert guard
CREATE UNIQUE INDEX IF NOT EXISTS alerts_open_gateway_unique_idx
  ON alerts (gateway_id, alert_type) WHERE status <> 'resolved' AND node_id IS NULL;

CREATE TABLE IF NOT EXISTS alert_history (
  id          bigserial PRIMARY KEY,
  alert_id    bigint NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  from_status text,
  to_status   text NOT NULL,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  changed_by  text,
  note        text,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS alert_history_alert_idx ON alert_history (alert_id, changed_at DESC);

-- ------------------------------------------------------------- rule config

CREATE TABLE IF NOT EXISTS alert_rules (
  rule_key       text PRIMARY KEY,
  name           text NOT NULL,
  description    text,
  metric         text,
  operator       text NOT NULL DEFAULT 'gt'
                 CHECK (operator IN ('gt','gte','lt','lte','eq','neq','is_true','is_false')),
  threshold      double precision,
  severity       text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  alert_type     text NOT NULL,
  event_type     text,
  risk_weight    numeric(5,2) NOT NULL DEFAULT 10,
  enabled        boolean NOT NULL DEFAULT true,
  auto_resolve   boolean NOT NULL DEFAULT true,
  scope          text NOT NULL DEFAULT 'telemetry'
                 CHECK (scope IN ('telemetry','liveness','event')),
  config         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Optional per-node threshold overrides (kept out of code, editable at runtime).
CREATE TABLE IF NOT EXISTS node_rule_overrides (
  node_id    text NOT NULL REFERENCES nodes(node_id) ON DELETE CASCADE,
  rule_key   text NOT NULL REFERENCES alert_rules(rule_key) ON DELETE CASCADE,
  threshold  double precision,
  severity   text CHECK (severity IN ('info','warning','critical')),
  enabled    boolean,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (node_id, rule_key)
);

-- ---------------------------------------------------------- system events

CREATE TABLE IF NOT EXISTS system_events (
  id         bigserial PRIMARY KEY,
  level      text NOT NULL DEFAULT 'info' CHECK (level IN ('debug','info','warn','error')),
  category   text NOT NULL,
  message    text NOT NULL,
  details    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS system_events_time_idx ON system_events (created_at DESC);
CREATE INDEX IF NOT EXISTS system_events_cat_idx  ON system_events (category, created_at DESC);

-- --------------------------------------------------------------- triggers

DROP TRIGGER IF EXISTS sites_updated_at ON sites;
CREATE TRIGGER sites_updated_at BEFORE UPDATE ON sites
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS zones_updated_at ON zones;
CREATE TRIGGER zones_updated_at BEFORE UPDATE ON zones
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS gateways_updated_at ON gateways;
CREATE TRIGGER gateways_updated_at BEFORE UPDATE ON gateways
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS nodes_updated_at ON nodes;
CREATE TRIGGER nodes_updated_at BEFORE UPDATE ON nodes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS node_sensors_updated_at ON node_sensors;
CREATE TRIGGER node_sensors_updated_at BEFORE UPDATE ON node_sensors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS alerts_updated_at ON alerts;
CREATE TRIGGER alerts_updated_at BEFORE UPDATE ON alerts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS alert_rules_updated_at ON alert_rules;
CREATE TRIGGER alert_rules_updated_at BEFORE UPDATE ON alert_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------------ views

CREATE OR REPLACE VIEW node_overview AS
SELECT
  n.node_id,
  n.name,
  n.gateway_id,
  n.site_id,
  s.code  AS site_code,
  s.name  AS site_name,
  n.zone_id,
  z.code  AS zone_code,
  z.name  AS zone_name,
  n.latitude,
  n.longitude,
  n.elevation_m,
  n.status,
  n.firmware_version,
  n.reference_distance_mm,
  n.first_seen_at,
  n.last_seen_at,
  n.last_sequence_number,
  n.metadata,
  st.measured_at      AS last_telemetry_at,
  st.telemetry        AS last_telemetry,
  st.risk_score,
  st.risk_level,
  COALESCE(a.active_alerts, 0)   AS active_alerts,
  COALESCE(a.critical_alerts, 0) AS critical_alerts
FROM nodes n
LEFT JOIN sites s ON s.id = n.site_id
LEFT JOIN zones z ON z.id = n.zone_id
LEFT JOIN node_state st ON st.node_id = n.node_id
LEFT JOIN (
  SELECT node_id,
         count(*) FILTER (WHERE status <> 'resolved')                          AS active_alerts,
         count(*) FILTER (WHERE status <> 'resolved' AND severity = 'critical') AS critical_alerts
  FROM alerts
  GROUP BY node_id
) a ON a.node_id = n.node_id;

COMMIT;
