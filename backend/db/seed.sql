-- Nirmaan seed data (development / demo).
-- Safe to re-run: existing rows are updated, telemetry is regenerated.

BEGIN;

TRUNCATE telemetry, node_state, events, anomalies, predictions, risk_assessments,
         alert_history, alerts, node_rule_overrides, node_sensors, system_events
  RESTART IDENTITY;

-- ------------------------------------------------------------------- sites

INSERT INTO sites (code, name, description, latitude, longitude) VALUES
  ('JHARIA-01', 'Jharia Coalfield - Block A', 'Underground coal mine, primary pilot site', 23.750000, 86.420000),
  ('SINGRAULI-02', 'Singrauli Mine - North Shaft', 'Secondary demo site', 24.199700, 82.675000)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO zones (site_id, code, name, description, depth_m, risk_category) VALUES
  ((SELECT id FROM sites WHERE code='JHARIA-01'), 'Z-MAIN', 'Main Haulage Tunnel', 'High traffic haulage way', 120.00, 'elevated'),
  ((SELECT id FROM sites WHERE code='JHARIA-01'), 'Z-P3',   'Panel 3 Working Face', 'Active extraction face', 180.50, 'critical'),
  ((SELECT id FROM sites WHERE code='JHARIA-01'), 'Z-VENT', 'Ventilation Shaft', 'Ventilation and escape route', 90.00, 'normal'),
  ((SELECT id FROM sites WHERE code='SINGRAULI-02'), 'Z-N1', 'North Drift 1', 'Support pillar monitoring', 140.00, 'normal')
ON CONFLICT (site_id, code) DO UPDATE SET name = EXCLUDED.name;

-- ---------------------------------------------------------------- gateways

INSERT INTO gateways (gateway_id, name, site_id, zone_id, status, latitude, longitude, firmware_version, first_seen_at, last_seen_at, metadata) VALUES
  ('GW-001', 'Surface Gateway - Shaft A',
   (SELECT id FROM sites WHERE code='JHARIA-01'),
   (SELECT id FROM zones WHERE code='Z-MAIN'),
   'online', 23.750500, 86.420900, '1.2.0', now() - interval '30 days', now(),
   '{"lora_frequency_mhz": 433, "uplink": "wifi"}'::jsonb),
  ('GW-002', 'Underground Gateway - Panel 3',
   (SELECT id FROM sites WHERE code='JHARIA-01'),
   (SELECT id FROM zones WHERE code='Z-P3'),
   'online', 23.751200, 86.421700, '1.2.0', now() - interval '21 days', now(),
   '{"lora_frequency_mhz": 433, "uplink": "ethernet"}'::jsonb),
  ('GW-003', 'Surface Gateway - Singrauli',
   (SELECT id FROM sites WHERE code='SINGRAULI-02'),
   (SELECT id FROM zones WHERE code='Z-N1'),
   'offline', 24.199900, 82.675500, '1.1.4', now() - interval '60 days', now() - interval '2 days',
   '{"lora_frequency_mhz": 433, "uplink": "4g"}'::jsonb)
ON CONFLICT (gateway_id) DO UPDATE
  SET name = EXCLUDED.name, status = EXCLUDED.status, last_seen_at = EXCLUDED.last_seen_at;

-- ------------------------------------------------------------------- nodes

INSERT INTO nodes (node_id, name, gateway_id, site_id, zone_id, latitude, longitude, elevation_m,
                   status, firmware_version, hardware_revision, reference_distance_mm, install_depth_m,
                   first_seen_at, last_seen_at, metadata) VALUES
  ('NODE-001', 'Roof Bolt Monitor A1', 'GW-001',
   (SELECT id FROM sites WHERE code='JHARIA-01'), (SELECT id FROM zones WHERE code='Z-MAIN'),
   23.750610, 86.420980, -120.00, 'online', '1.4.2', 'esp32-lora-v3', 2500.00, 120.00,
   now() - interval '30 days', now(), '{"install_type":"roof","support":"bolt"}'::jsonb),
  ('NODE-002', 'Pillar Monitor A2', 'GW-001',
   (SELECT id FROM sites WHERE code='JHARIA-01'), (SELECT id FROM zones WHERE code='Z-MAIN'),
   23.750720, 86.421100, -121.50, 'online', '1.4.2', 'esp32-lora-v3', 1800.00, 121.50,
   now() - interval '30 days', now(), '{"install_type":"pillar"}'::jsonb),
  ('NODE-003', 'Face Monitor P3-1', 'GW-002',
   (SELECT id FROM sites WHERE code='JHARIA-01'), (SELECT id FROM zones WHERE code='Z-P3'),
   23.751250, 86.421760, -180.50, 'online', '1.4.2', 'esp32-lora-v3', 3200.00, 180.50,
   now() - interval '21 days', now(), '{"install_type":"face","priority":"high"}'::jsonb),
  ('NODE-004', 'Face Monitor P3-2', 'GW-002',
   (SELECT id FROM sites WHERE code='JHARIA-01'), (SELECT id FROM zones WHERE code='Z-P3'),
   23.751340, 86.421890, -181.00, 'online', '1.4.0', 'esp32-lora-v3', 2750.00, 181.00,
   now() - interval '21 days', now(), '{"install_type":"face","priority":"high"}'::jsonb),
  ('NODE-005', 'Ventilation Shaft Monitor', 'GW-001',
   (SELECT id FROM sites WHERE code='JHARIA-01'), (SELECT id FROM zones WHERE code='Z-VENT'),
   23.749900, 86.419800, -90.00, 'offline', '1.3.9', 'esp32-lora-v2', 4000.00, 90.00,
   now() - interval '25 days', now() - interval '3 hours', '{"install_type":"shaft"}'::jsonb),
  ('NODE-006', 'North Drift Pillar', 'GW-003',
   (SELECT id FROM sites WHERE code='SINGRAULI-02'), (SELECT id FROM zones WHERE code='Z-N1'),
   24.199950, 82.675600, -140.00, 'offline', '1.3.9', 'esp32-lora-v2', 2200.00, 140.00,
   now() - interval '60 days', now() - interval '2 days', '{"install_type":"pillar"}'::jsonb)
ON CONFLICT (node_id) DO UPDATE
  SET name = EXCLUDED.name, gateway_id = EXCLUDED.gateway_id, status = EXCLUDED.status;

INSERT INTO node_sensors (node_id, sensor_type, model, status, last_status_at, config)
SELECT n.node_id, s.sensor_type, s.model, s.status, now(), s.config
FROM nodes n
CROSS JOIN (VALUES
  ('imu',          'MPU6050', 'ok',      '{"sample_rate_hz":10}'::jsonb),
  ('vibration',    'SW-420',  'ok',      '{"debounce_ms":50}'::jsonb),
  ('displacement', 'POT-10K', 'ok',      '{"travel_mm":50}'::jsonb),
  ('crack',        'COPPER-TAPE', 'ok',  '{"mode":"analog"}'::jsonb),
  ('ultrasonic',   'HC-SR04', 'ok',      '{"max_range_mm":4000}'::jsonb),
  ('servo',        'SG90',    'ok',      '{"min_angle":0,"max_angle":180}'::jsonb),
  ('power',        'ADC-DIV', 'ok',      '{"divider_ratio":2.0}'::jsonb),
  ('lora',         'SX1278',  'ok',      '{"frequency_mhz":433,"sf":9}'::jsonb)
) AS s(sensor_type, model, status, config)
ON CONFLICT (node_id, sensor_type) DO NOTHING;

UPDATE node_sensors SET status = 'failed'  WHERE node_id = 'NODE-004' AND sensor_type = 'ultrasonic';
UPDATE node_sensors SET status = 'unknown' WHERE node_id IN ('NODE-005','NODE-006');

-- ------------------------------------------------------------- alert rules

INSERT INTO alert_rules (rule_key, name, description, metric, operator, threshold, severity, alert_type, event_type, risk_weight, scope, config) VALUES
  ('crack_detected', 'Crack detected', 'Copper tape crack sensor reports a break',
   'crack_detected', 'is_true', NULL, 'critical', 'crack_detected', 'crack_detected', 40, 'telemetry', '{}'),
  ('crack_sensor_rising', 'Crack sensor reading rising', 'Copper tape resistance climbing before a full break',
   'crack_sensor_raw', 'gt', 800, 'warning', 'crack_risk', NULL, 15, 'telemetry', '{}'),
  ('displacement_high', 'Abnormal relative displacement', 'Potentiometer displacement above safe limit',
   'relative_displacement_mm', 'gt', 15.0, 'warning', 'displacement_abnormal', NULL, 20, 'telemetry', '{}'),
  ('displacement_critical', 'Severe relative displacement', 'Potentiometer displacement far above safe limit',
   'relative_displacement_mm', 'gt', 30.0, 'critical', 'displacement_critical', NULL, 35, 'telemetry', '{}'),
  ('subsidence_high', 'Excessive subsidence', 'Ultrasonic subsidence above safe limit',
   'subsidence_mm', 'gt', 25.0, 'critical', 'subsidence_excessive', NULL, 40, 'telemetry', '{}'),
  ('subsidence_rate_high', 'Rapid subsidence rate', 'Subsidence rate indicates accelerating roof movement',
   'subsidence_rate_mm_per_day', 'gt', 10.0, 'critical', 'subsidence_rate_high', NULL, 30, 'telemetry', '{}'),
  ('vibration_detected', 'Vibration detected', 'SW-420 reports vibration',
   'vibration_detected', 'is_true', NULL, 'warning', 'vibration_detected', 'vibration_detected', 12, 'telemetry', '{}'),
  ('vibration_intensity_high', 'Excessive vibration', 'Accelerometer magnitude deviates from 1g baseline',
   'vibration_intensity', 'gt', 2.5, 'warning', 'vibration_excessive', NULL, 18, 'telemetry', '{}'),
  ('tilt_high', 'Structural tilt', 'Roll or pitch beyond safe inclination',
   'tilt_deg', 'gt', 10.0, 'warning', 'tilt_abnormal', NULL, 20, 'telemetry', '{}'),
  ('battery_low', 'Low battery', 'Node battery voltage low',
   'battery_voltage', 'lt', 3.40, 'warning', 'battery_low', 'battery_low', 8, 'telemetry', '{}'),
  ('battery_critical', 'Critical battery', 'Node battery voltage critically low',
   'battery_voltage', 'lt', 3.20, 'critical', 'battery_critical', 'battery_critical', 15, 'telemetry', '{}'),
  ('lora_weak_signal', 'Weak LoRa signal', 'RSSI below usable threshold',
   'lora_rssi', 'lt', -115.0, 'info', 'lora_weak', NULL, 5, 'telemetry', '{}'),
  ('node_offline', 'Node offline', 'No telemetry received within the liveness window',
   'seconds_since_seen', 'gt', 180, 'warning', 'node_offline', 'communication_lost', 20, 'liveness', '{}'),
  ('gateway_offline', 'Gateway offline', 'No traffic from gateway within the liveness window',
   'seconds_since_seen', 'gt', 300, 'warning', 'gateway_offline', 'gateway_offline', 20, 'liveness', '{}'),
  ('sensor_failure', 'Sensor failure reported', 'Device reported a sensor fault',
   NULL, 'eq', NULL, 'warning', 'sensor_failure', 'sensor_failure', 15, 'event', '{}')
ON CONFLICT (rule_key) DO UPDATE
  SET threshold = EXCLUDED.threshold, severity = EXCLUDED.severity, enabled = true;

-- NODE-003 sits on the active face: tighter displacement threshold.
INSERT INTO node_rule_overrides (node_id, rule_key, threshold, severity) VALUES
  ('NODE-003', 'displacement_high', 10.0, 'warning')
ON CONFLICT (node_id, rule_key) DO UPDATE SET threshold = EXCLUDED.threshold;

-- --------------------------------------------- historical telemetry (3 days)

SELECT ensure_telemetry_partition(now() - interval '3 days');
SELECT ensure_telemetry_partition(now());

INSERT INTO telemetry (
  node_id, gateway_id, measured_at, received_at, sequence_number,
  accel_x, accel_y, accel_z, gyro_x, gyro_y, gyro_z, roll, pitch, relative_yaw,
  vibration_detected, vibration_count, vibration_duration_ms, vibration_intensity,
  potentiometer_raw, potentiometer_voltage, relative_displacement_mm,
  crack_sensor_raw, crack_sensor_voltage, crack_detected,
  ultrasonic_distance_mm, ultrasonic_echo_time_us, reference_distance_mm,
  displacement_mm, subsidence_mm, subsidence_rate_mm_per_day,
  servo_target_angle, servo_state,
  battery_voltage, supply_voltage, battery_percentage,
  lora_rssi, lora_snr, packets_lost, packet_loss_percent,
  firmware_version, uptime_s, reset_reason, sensor_status, raw_payload
)
SELECT
  d.node_id,
  d.gateway_id,
  ts,
  ts + interval '1.2 seconds',
  d.seq_base + row_number() OVER (PARTITION BY d.node_id ORDER BY ts),
  round((0.10 + 0.05 * sin(extract(epoch from ts) / 900.0) + random() * 0.02)::numeric, 4),
  round((0.03 + 0.04 * cos(extract(epoch from ts) / 1100.0) + random() * 0.02)::numeric, 4),
  round((9.79 + random() * 0.05)::numeric, 4),
  round((random() * 0.05 - 0.025)::numeric, 4),
  round((random() * 0.05 - 0.025)::numeric, 4),
  round((random() * 0.05 - 0.025)::numeric, 4),
  round((d.tilt_base + 0.8 * sin(extract(epoch from ts) / 3600.0) + random() * 0.3)::numeric, 3),
  round((d.tilt_base * 0.6 + 0.5 * cos(extract(epoch from ts) / 2700.0) + random() * 0.3)::numeric, 3),
  round((random() * 1.5)::numeric, 3),
  (random() < d.vib_prob),
  (random() * 3)::int,
  (random() * 400)::int,
  round((1.0 + random() * d.vib_scale)::numeric, 3),
  (d.pot_base + progress * d.pot_drift + random() * 12)::int,
  round(((d.pot_base + progress * d.pot_drift) * 3.3 / 4095.0)::numeric, 4),
  round((d.disp_base + progress * d.disp_drift + random() * 0.4)::numeric, 3),
  d.crack_raw,
  round((d.crack_raw * 3.3 / 4095.0)::numeric, 4),
  (d.crack_raw > 1500),
  round((d.ref_mm - (progress * d.subs_drift) + random() * 1.5)::numeric, 2),
  ((d.ref_mm - (progress * d.subs_drift)) / 0.1715)::int,
  d.ref_mm,
  round((progress * d.subs_drift)::numeric, 3),
  round((progress * d.subs_drift)::numeric, 3),
  round((d.subs_drift / 3.0)::numeric, 3),
  45,
  'idle',
  round((d.batt_base - progress * 0.18 + random() * 0.02)::numeric, 3),
  round((5.02 + random() * 0.05)::numeric, 3),
  round(((d.batt_base - progress * 0.18 - 3.0) / 1.2 * 100)::numeric, 1),
  round((d.rssi_base + random() * 8 - 4)::numeric, 1),
  round((7.5 + random() * 3 - 1.5)::numeric, 2),
  (random() * 2)::int,
  round((random() * 1.5)::numeric, 2),
  d.firmware,
  extract(epoch from (ts - (now() - interval '3 days')))::bigint,
  'POWERON',
  '{"imu":"ok","vibration":"ok","ultrasonic":"ok","crack":"ok"}'::jsonb,
  '{"seeded": true}'::jsonb
FROM (
  VALUES
    ('NODE-001','GW-001', 1000::bigint, 1.2::double precision, 0.05::double precision, 0.4::double precision,
     1800::double precision, 60::double precision, 4.5::double precision, 1.2::double precision,
     120::integer, 2500::double precision, 3.0::double precision, 3.95::double precision, -92::double precision, '1.4.2'),
    ('NODE-002','GW-001', 2000, 0.6, 0.03, 0.3, 1400, 30, 3.1, 0.6, 90,  1800, 1.5, 3.88, -97,  '1.4.2'),
    ('NODE-003','GW-002', 3000, 2.4, 0.12, 1.1, 2100, 260, 6.4, 6.5, 900, 3200, 28.0, 3.61, -104, '1.4.2'),
    ('NODE-004','GW-002', 4000, 1.0, 0.06, 0.5, 1650, 90, 5.2, 2.0, 200, 2750, 6.0, 3.35, -110, '1.4.0')
) AS d(node_id, gateway_id, seq_base, tilt_base, vib_prob, vib_scale,
       pot_base, pot_drift, disp_base, disp_drift, crack_raw, ref_mm, subs_drift,
       batt_base, rssi_base, firmware)
CROSS JOIN LATERAL (
  SELECT ts,
         extract(epoch from (ts - (now() - interval '3 days'))) / extract(epoch from interval '3 days') AS progress
  FROM generate_series(now() - interval '3 days', now(), interval '5 minutes') AS ts
) g
ON CONFLICT DO NOTHING;

-- NODE-005 stopped reporting 3 hours ago (offline demo)
INSERT INTO telemetry (node_id, gateway_id, measured_at, received_at, sequence_number,
                       accel_x, accel_y, accel_z, roll, pitch, vibration_detected,
                       potentiometer_raw, relative_displacement_mm, crack_detected,
                       ultrasonic_distance_mm, reference_distance_mm, displacement_mm, subsidence_mm,
                       battery_voltage, lora_rssi, lora_snr, firmware_version, raw_payload)
SELECT 'NODE-005', 'GW-001', ts, ts, 5000 + row_number() OVER (ORDER BY ts),
       0.08, 0.02, 9.80, 0.6, 0.4, false,
       1500, 2.1, false,
       3998.0, 4000.0, 2.0, 2.0,
       3.28, -113, 5.2, '1.3.9', '{"seeded": true}'::jsonb
FROM generate_series(now() - interval '2 days', now() - interval '3 hours', interval '10 minutes') AS ts
ON CONFLICT DO NOTHING;

-- latest snapshot per node
INSERT INTO node_state (node_id, measured_at, received_at, sequence_number, gateway_id, telemetry, risk_score, risk_level)
SELECT DISTINCT ON (t.node_id)
  t.node_id, t.measured_at, t.received_at, t.sequence_number, t.gateway_id,
  jsonb_strip_nulls(jsonb_build_object(
    'accel_x', t.accel_x, 'accel_y', t.accel_y, 'accel_z', t.accel_z,
    'roll', t.roll, 'pitch', t.pitch,
    'vibration_detected', t.vibration_detected,
    'vibration_intensity', t.vibration_intensity,
    'relative_displacement_mm', t.relative_displacement_mm,
    'potentiometer_raw', t.potentiometer_raw,
    'crack_detected', t.crack_detected,
    'crack_sensor_raw', t.crack_sensor_raw,
    'ultrasonic_distance_mm', t.ultrasonic_distance_mm,
    'reference_distance_mm', t.reference_distance_mm,
    'displacement_mm', t.displacement_mm,
    'subsidence_mm', t.subsidence_mm,
    'subsidence_rate_mm_per_day', t.subsidence_rate_mm_per_day,
    'servo_target_angle', t.servo_target_angle,
    'battery_voltage', t.battery_voltage,
    'battery_percentage', t.battery_percentage,
    'lora_rssi', t.lora_rssi, 'lora_snr', t.lora_snr
  )),
  CASE WHEN t.node_id = 'NODE-003' THEN 72.0
       WHEN t.node_id = 'NODE-004' THEN 41.0
       ELSE 12.0 END,
  CASE WHEN t.node_id = 'NODE-003' THEN 'high'
       WHEN t.node_id = 'NODE-004' THEN 'moderate'
       ELSE 'low' END
FROM telemetry t
ORDER BY t.node_id, t.measured_at DESC
ON CONFLICT (node_id) DO UPDATE
  SET measured_at = EXCLUDED.measured_at, telemetry = EXCLUDED.telemetry;

UPDATE nodes n
SET last_seen_at = s.measured_at,
    last_sequence_number = s.sequence_number
FROM node_state s WHERE s.node_id = n.node_id;

-- ------------------------------------------------------------------ events

INSERT INTO events (node_id, gateway_id, event_type, severity, source, occurred_at, message, details) VALUES
  ('NODE-001','GW-001','node_started','info','device', now() - interval '3 days', 'Node boot completed', '{"reset_reason":"POWERON"}'),
  ('NODE-003','GW-002','vibration_detected','warning','device', now() - interval '9 hours', 'Vibration burst detected', '{"duration_ms":820,"count":6}'),
  ('NODE-003','GW-002','anomaly_detected','warning','backend', now() - interval '6 hours', 'Displacement trend deviating from baseline', '{"metric":"relative_displacement_mm","z_score":3.4}'),
  ('NODE-004','GW-002','sensor_failure','warning','device', now() - interval '5 hours', 'Ultrasonic sensor returned no echo', '{"sensor":"ultrasonic","consecutive_failures":12}'),
  ('NODE-005','GW-001','communication_lost','warning','backend', now() - interval '3 hours', 'No telemetry received within liveness window', '{"seconds_since_seen":180}'),
  ('NODE-003','GW-002','crack_detected','critical','device', now() - interval '2 hours', 'Crack sensor circuit broken', '{"crack_sensor_raw":2100}'),
  ('NODE-002','GW-001','manual_test','info','manual', now() - interval '1 hour', 'Field technician test button pressed', '{"button":"test"}'),
  (NULL,'GW-003','gateway_offline','warning','backend', now() - interval '2 days', 'Gateway stopped reporting', '{"seconds_since_seen":172800}');

-- ------------------------------------------------------------------ alerts

INSERT INTO alerts (node_id, gateway_id, alert_type, severity, status, message, risk_score, source, rule_key, triggered_at, acknowledged_at, acknowledged_by, resolved_at, metadata) VALUES
  ('NODE-003','GW-002','crack_detected','critical','active',
   'Crack detected at Face Monitor P3-1 (Panel 3 Working Face)', 88.0, 'rule', 'crack_detected',
   now() - interval '2 hours', NULL, NULL, NULL, '{"crack_sensor_raw":2100}'),
  ('NODE-003','GW-002','displacement_abnormal','warning','acknowledged',
   'Relative displacement 28.4 mm exceeds threshold 10.0 mm', 55.0, 'rule', 'displacement_high',
   now() - interval '7 hours', now() - interval '5 hours', 'safety.officer', NULL, '{"value":28.4,"threshold":10.0}'),
  ('NODE-004','GW-002','sensor_failure','warning','active',
   'Ultrasonic sensor failure reported by device', 30.0, 'device', 'sensor_failure',
   now() - interval '5 hours', NULL, NULL, NULL, '{"sensor":"ultrasonic"}'),
  ('NODE-004','GW-002','battery_low','warning','active',
   'Battery voltage 3.35 V below threshold 3.40 V', 22.0, 'rule', 'battery_low',
   now() - interval '4 hours', NULL, NULL, NULL, '{"value":3.35,"threshold":3.4}'),
  ('NODE-005','GW-001','node_offline','warning','active',
   'No telemetry from NODE-005 for more than 180 s', 25.0, 'rule', 'node_offline',
   now() - interval '3 hours', NULL, NULL, NULL, '{"seconds_since_seen":10800}'),
  ('NODE-001','GW-001','vibration_detected','warning','resolved',
   'Vibration detected at Roof Bolt Monitor A1', 18.0, 'rule', 'vibration_detected',
   now() - interval '2 days', now() - interval '47 hours', 'control.room', now() - interval '46 hours', '{}');

INSERT INTO alert_history (alert_id, from_status, to_status, changed_at, changed_by, note)
SELECT id, NULL, 'active', triggered_at, 'system', 'Alert created' FROM alerts;

INSERT INTO alert_history (alert_id, from_status, to_status, changed_at, changed_by, note)
SELECT id, 'active', 'acknowledged', acknowledged_at, acknowledged_by, 'Acknowledged by operator'
FROM alerts WHERE acknowledged_at IS NOT NULL;

INSERT INTO alert_history (alert_id, from_status, to_status, changed_at, changed_by, note)
SELECT id, 'acknowledged', 'resolved', resolved_at, 'control.room', 'Condition cleared'
FROM alerts WHERE resolved_at IS NOT NULL;

-- --------------------------------------------------- anomalies/predictions

INSERT INTO anomalies (node_id, detected_at, window_start, window_end, anomaly_type, metric,
                       observed_value, expected_value, deviation, score, severity, method, model_name, model_version, details) VALUES
  ('NODE-003', now() - interval '6 hours', now() - interval '12 hours', now() - interval '6 hours',
   'trend_deviation', 'relative_displacement_mm', 26.8, 8.2, 18.6, 3.412, 'warning', 'statistical', NULL, NULL,
   '{"window":"6h","method":"rolling_zscore"}'),
  ('NODE-003', now() - interval '90 minutes', now() - interval '3 hours', now() - interval '90 minutes',
   'point_anomaly', 'subsidence_mm', 27.4, 9.1, 18.3, 4.107, 'critical', 'model', 'isolation-forest', 'v0.3',
   '{"contamination":0.02}'),
  ('NODE-004', now() - interval '4 hours', now() - interval '8 hours', now() - interval '4 hours',
   'sensor_dropout', 'ultrasonic_distance_mm', NULL, 2750.0, NULL, 2.800, 'warning', 'rule', NULL, NULL,
   '{"missing_samples":12}');

INSERT INTO predictions (node_id, zone_id, model_name, model_version, prediction_type, predicted_at,
                         target_time, horizon_minutes, predicted_value, predicted_label, confidence,
                         risk_score, severity, features, raw_response) VALUES
  ('NODE-003', (SELECT id FROM zones WHERE code='Z-P3'), 'subsidence-lstm', 'v0.4', 'subsidence_forecast',
   now() - interval '30 minutes', now() + interval '24 hours', 1440, 41.2, 'increasing', 0.8600, 78.0, 'critical',
   '{"window_hours":72,"features":["subsidence_mm","relative_displacement_mm","vibration_intensity"]}',
   '{"mean":41.2,"p95":48.9}'),
  ('NODE-003', (SELECT id FROM zones WHERE code='Z-P3'), 'roof-fall-classifier', 'v0.2', 'structural_risk',
   now() - interval '25 minutes', now() + interval '6 hours', 360, NULL, 'high_risk', 0.7400, 81.0, 'critical',
   '{"features":["crack_detected","subsidence_rate_mm_per_day","tilt_deg"]}', '{"class_probabilities":{"low":0.06,"moderate":0.20,"high":0.74}}'),
  ('NODE-001', (SELECT id FROM zones WHERE code='Z-MAIN'), 'subsidence-lstm', 'v0.4', 'subsidence_forecast',
   now() - interval '30 minutes', now() + interval '24 hours', 1440, 4.1, 'stable', 0.9100, 12.0, 'info',
   '{"window_hours":72}', '{"mean":4.1}'),
  ('NODE-004', (SELECT id FROM zones WHERE code='Z-P3'), 'vibration-anomaly', 'v0.1', 'vibration_anomaly',
   now() - interval '2 hours', now(), 0, 0.31, 'normal', 0.6800, 35.0, 'warning',
   '{"features":["accel_magnitude","vibration_count"]}', NULL);

INSERT INTO risk_assessments (node_id, zone_id, assessed_at, risk_score, risk_level, source, model_name, model_version, contributing_factors, valid_until) VALUES
  ('NODE-003', (SELECT id FROM zones WHERE code='Z-P3'), now() - interval '20 minutes', 79.5, 'high', 'ai',
   'risk-ensemble', 'v0.2', '{"crack":40,"subsidence":25,"vibration":14.5}', now() + interval '6 hours'),
  ('NODE-004', (SELECT id FROM zones WHERE code='Z-P3'), now() - interval '20 minutes', 41.0, 'moderate', 'rule',
   NULL, NULL, '{"sensor_failure":15,"battery":8,"displacement":18}', now() + interval '6 hours'),
  ('NODE-001', (SELECT id FROM zones WHERE code='Z-MAIN'), now() - interval '20 minutes', 12.0, 'low', 'rule',
   NULL, NULL, '{"baseline":12}', now() + interval '6 hours');

INSERT INTO system_events (level, category, message, details) VALUES
  ('info', 'system', 'Seed data loaded', '{"source":"db/seed.sql"}');

COMMIT;
