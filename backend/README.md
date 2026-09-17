# Nirmaan — Smart Mining Safety & Structural Monitoring Backend

SIH 2026. A single modular Node.js backend that ingests LoRa sensor telemetry from underground
mining nodes over MQTT, stores it as time-series data in PostgreSQL, applies configurable safety
rules, and streams live updates to the dashboard over WebSocket.

**Stack:** Node.js (JavaScript, no TypeScript) · Fastify · PostgreSQL (raw `pg`, no ORM) · MQTT · WebSocket · Docker Compose

---

## 1. Architecture

```
ESP32 node (MPU6050, SW-420, potentiometer, copper-tape crack sensor,
            HC-SR04 ultrasonic, servo, button, LEDs, buzzer, battery)
      |
      |  LoRa  (SX1278, 433 MHz)
      v
  Gateway  ──► publishes JSON ──► MQTT broker (mqtt.samay15jan.com)  [already deployed]
                                          |
                                          |  backend subscribes as an MQTT client
                                          v
                            ┌─────────────────────────────┐
                            │   Nirmaan Node.js backend   │
                            │                             │
                            │  MQTT consumer              │
                            │    → parse & validate       │
                            │    → identify node/gateway  │
                            │    → derive metrics         │
                            │    → store telemetry        │
                            │    → update last_seen       │
                            │    → rule engine            │
                            │    → events & alerts        │
                            │    → WebSocket broadcast    │
                            │                             │
                            │  REST API      WebSocket    │
                            └───────┬──────────────┬──────┘
                                    │              │
                              PostgreSQL       Frontend
                             (partitioned      (live dashboard)
                              time-series)
                                    │
                                    └──► AI/ML team reads history,
                                         writes predictions back via REST
```

The frontend never touches MQTT. Everything reaches it as REST or WebSocket.

### Design decisions worth knowing

- **Hardware IDs are the primary keys.** `nodes.node_id = 'NODE-001'`, `gateways.gateway_id = 'GW-001'`.
  The MQTT topic segment, the REST path parameter, and the foreign key are all the same string —
  there is no internal/external ID translation anywhere.
- **Telemetry is monthly RANGE-partitioned** on `measured_at`. Partitions are created automatically
  at startup, every 6 hours, and on demand if a reading arrives for a month that has no partition yet.
- **Unknown devices auto-register.** No provisioning step — plug a node in and it appears in the API.
- **Nothing is ever lost.** Every telemetry row keeps the complete original MQTT payload in a
  `raw_payload` JSONB column, so new firmware fields land in the database before anyone touches
  the schema.
- **Thresholds live in the database** (`alert_rules`), not in code, with optional per-node overrides.
  Change a limit with a `PATCH`, no redeploy.

---

## 2. Project structure

```
nirmaan-backend/
├── db/
│   ├── schema.sql              full schema, partitioning, indexes, views
│   └── seed.sql                demo sites/zones/gateways/nodes + 3 days of telemetry
├── samples/                    ready-to-publish MQTT payloads
│   ├── telemetry.json          full/normal reading
│   ├── telemetry-minimal.json  sparse reading (most sensors absent)
│   ├── telemetry-critical.json crack + displacement + low battery
│   ├── event.json, event-sensor-failure.json
│   └── status.json, gateway-status.json
├── scripts/
│   ├── migrate.js              apply schema.sql   (--reset drops everything first)
│   ├── seed.js                 apply seed.sql
│   ├── simulate.js             continuous fake-hardware publisher
│   ├── publish-sample.js       publish one sample file
│   └── e2e-check.js            MQTT → DB → WebSocket smoke test
├── src/
│   ├── server.js               entry point, startup order, graceful shutdown
│   ├── app.js                  Fastify app, CORS, error handler
│   ├── config/
│   │   ├── index.js            all env vars in one place
│   │   └── telemetryFields.js  THE telemetry field contract (types, units, aliases)
│   ├── db/index.js             pool, query helpers, transactions, partition management
│   ├── mqtt/
│   │   ├── index.js            client, subscriptions, bounded ingest queue
│   │   ├── topics.js           topic builders + parser
│   │   └── parser.js           payload validation & normalisation
│   ├── routes/                 health, nodes, gateways, telemetry, events, alerts,
│   │                           predictions, analytics
│   ├── services/               nodes, gateways, telemetry, events, alerts, predictions,
│   │                           analytics, ingest (the pipeline), monitor (liveness)
│   ├── rules/engine.js         DB-backed threshold rules + risk scoring
│   ├── websocket/              hub (registry/filtering/broadcast) + Fastify plugin
│   └── utils/                  logger, helpers
├── tests/                      82 tests (unit + integration)
├── docker-compose.yml          PostgreSQL + backend (no broker — one already exists)
├── Dockerfile
├── .env.example
└── HARDWARE_API_CONTRACT.md    give this to the hardware/gateway team
```

---

## 3. Quick start

### Option A — everything in Docker

```bash
cp .env.example .env          # set MQTT_USERNAME / MQTT_PASSWORD if the broker needs them
docker compose up --build     # starts PostgreSQL + backend, runs migrations automatically
docker compose exec backend node scripts/seed.js   # optional demo data
curl http://localhost:4000/api/health
```

### Option B — PostgreSQL in Docker, backend on your machine (recommended while developing)

```bash
docker compose up -d postgres     # PostgreSQL only, on localhost:5432
cp .env.example .env
npm install
npm run migrate                   # create schema
npm run seed                      # load demo data (6 nodes, 3 gateways, ~3700 readings)
npm run dev                       # start with auto-reload
```

You should see:

```
{"level":"info","msg":"database connected"}
{"level":"info","msg":"HTTP server listening","port":4000}
{"level":"info","msg":"MQTT connected","url":"mqtt://mqtt.samay15jan.com:1883"}
{"level":"info","msg":"MQTT subscribed","topics":["nirmaan/gateways/+/nodes/+/telemetry", ...]}
{"level":"info","msg":"liveness monitor started"}
```

### Useful commands

| Command | What it does |
|---|---|
| `npm start` | Run the backend |
| `npm run dev` | Run with `--watch` auto-reload |
| `npm run migrate` | Apply `db/schema.sql` |
| `npm run migrate -- --reset` | **Drop everything** and re-apply |
| `npm run seed` | Load demo data |
| `npm run db:reset` | Reset + reseed in one go |
| `npm run simulate` | Publish fake hardware telemetry continuously |
| `npm run publish:sample` | Publish one sample payload |
| `npm test` | Run all 82 tests |

---

## 4. Configuration

Every setting comes from the environment. **No credentials are ever hardcoded.** Copy
`.env.example` to `.env` and edit. Key values:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `4000` | HTTP + WebSocket port |
| `DATABASE_URL` | `postgres://nirmaan:nirmaan@localhost:5432/nirmaan` | PostgreSQL connection |
| `MQTT_URL` | `mqtt://mqtt.samay15jan.com:1883` | Existing broker |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | empty | Omitted from the connection if blank |
| `MQTT_CLIENT_ID` | `nirmaan-backend` | A random suffix is appended so two instances never clash |
| `MQTT_TOPIC_PREFIX` | `nirmaan` | Root of every topic |
| `MQTT_ENABLED` | `true` | Set `false` to run the API with no broker |
| `MQTT_INGEST_CONCURRENCY` | `8` | Messages processed in parallel |
| `NODE_OFFLINE_AFTER_SECONDS` | `180` | Silence before a node is marked offline |
| `GATEWAY_OFFLINE_AFTER_SECONDS` | `300` | Same for gateways |
| `TELEMETRY_MAX_LIMIT` | `5000` | Cap on rows per history request |
| `CORS_ORIGIN` | `*` | Comma-separated origins, or `*` |

For **TLS** brokers use `mqtts://host:8883`; for **websocket** brokers use `ws://` or `wss://`.

---

## 5. MQTT

The backend is a **client only** — it never runs a broker. It subscribes to:

```
nirmaan/gateways/+/nodes/+/telemetry
nirmaan/gateways/+/nodes/+/status
nirmaan/gateways/+/nodes/+/events
nirmaan/gateways/+/status
```

Full payload specification: **[HARDWARE_API_CONTRACT.md](./HARDWARE_API_CONTRACT.md)**.

### Ingestion pipeline

```
message → parse JSON → validate & normalise → check duplicate (sequence number)
        → upsert gateway → upsert node → derive metrics (subsidence, tilt, battery %)
        → INSERT telemetry → update last_seen/status → evaluate rules
        → raise/resolve alerts & events → update node_state → WebSocket broadcast
```

Messages are handled through a bounded concurrent queue (`MQTT_INGEST_CONCURRENCY` at a time,
`MQTT_INGEST_QUEUE_MAX` buffered), so a slow database never blocks the MQTT socket. Malformed
messages are counted and dropped, never fatal. Duplicates are suppressed twice: an in-memory
cache of recent `(node, sequence)` pairs, and a unique index in PostgreSQL.

### Publishing test messages by hand

```bash
mosquitto_pub -h mqtt.samay15jan.com -t 'nirmaan/gateways/GW-001/nodes/NODE-001/telemetry' \
  -m '{"node_id":"NODE-001","gateway_id":"GW-001","timestamp":"2026-09-17T10:30:00Z",
       "sequence_number":1001,
       "sensors":{"accel_x":0.12,"accel_y":0.04,"accel_z":9.81,"roll":1.2,"pitch":0.8,
                  "vibration_detected":false,"potentiometer_raw":1820,
                  "relative_displacement_mm":4.7,"crack_sensor_raw":0,"crack_detected":false,
                  "ultrasonic_distance_mm":2495.3,"reference_distance_mm":2500},
       "device":{"battery_voltage":3.92,"firmware_version":"1.4.2"},
       "comm":{"lora_rssi":-92,"lora_snr":7.5}}'

# trigger a critical alert (crack + displacement + low battery)
mosquitto_pub -h mqtt.samay15jan.com \
  -t 'nirmaan/gateways/GW-002/nodes/NODE-003/telemetry' -f samples/telemetry-critical.json

# a device event
mosquitto_pub -h mqtt.samay15jan.com \
  -t 'nirmaan/gateways/GW-002/nodes/NODE-004/events' -f samples/event-sensor-failure.json

# watch everything flowing through the broker
mosquitto_sub -h mqtt.samay15jan.com -t 'nirmaan/#' -v
```

With credentials, add `-u "$MQTT_USERNAME" -P "$MQTT_PASSWORD"`.

---

## 6. Testing without hardware

The simulator publishes realistic, drifting telemetry for four nodes to the real broker:

```bash
npm run simulate                                  # normal operation, every 5 s
node scripts/simulate.js --interval=2000          # faster
node scripts/simulate.js --scenario=crack         # NODE-003 reports a crack → critical alert
node scripts/simulate.js --scenario=degrading     # NODE-003 subsidence climbs until it breaches
node scripts/simulate.js --scenario=vibration     # heavy vibration activity
node scripts/simulate.js --nodes=NODE-001,NODE-002
```

Then watch it land:

```bash
curl localhost:4000/api/telemetry/latest
curl localhost:4000/api/alerts?active=true
curl localhost:4000/api/analytics/overview
```

**Demo script for judges:** `npm run seed` (3 days of history) → `npm run dev` →
open the dashboard → `node scripts/simulate.js --scenario=degrading` → watch subsidence climb on
the live chart until the rule engine fires a critical alert and it appears instantly over WebSocket.

To simulate a node going offline, just stop the simulator and wait 180 s.

---

## 7. Database

### Tables

| Table | Purpose |
|---|---|
| `sites` | Mine sites |
| `zones` | Monitoring zones within a site (tunnel, working face, shaft) |
| `gateways` | LoRa gateways — `gateway_id` is the PK |
| `nodes` | Monitoring nodes — `node_id` is the PK; holds location, status, `reference_distance_mm` |
| `node_sensors` | Per-node sensor inventory + health (`ok`/`degraded`/`failed`) |
| `telemetry` | **Partitioned time-series.** One row per reading, all sensor columns + `raw_payload` |
| `node_state` | Latest reading per node, denormalised for instant dashboard loads |
| `events` | Discrete occurrences (crack detected, restart, comms lost) |
| `anomalies` | Statistical/model anomaly detections |
| `predictions` | AI model outputs |
| `risk_assessments` | Node/zone risk scores over time |
| `alerts` | Alert lifecycle with dedupe and occurrence counting |
| `alert_history` | Every status transition, who and when |
| `alert_rules` | Configurable thresholds — the rule engine reads these |
| `node_rule_overrides` | Per-node threshold overrides |
| `system_events` | Backend's own operational log |

`node_overview` is a view joining nodes + site + zone + latest state + open alert counts; it backs
`GET /api/nodes`.

### Telemetry table

One row per reading, associated with node, gateway, `measured_at` (device time),
`received_at` (backend time), `sequence_number`, all sensor values, LoRa link metadata, device
metadata, and the untouched `raw_payload`. Every sensor column is nullable — a node with no
ultrasonic sensor simply has NULLs there.

**Partitioning:** monthly by `measured_at`, primary key `(id, measured_at)`.
`ensure_telemetry_partition(timestamptz)` creates a partition on demand and is idempotent. If a
reading arrives for an uncovered month, the insert error is caught, the partition is created, and
the insert retried — data is never dropped for being early or late.

**Indexes:** `(node_id, measured_at DESC)` for per-node history, `(measured_at DESC)` for global
time scans, `(gateway_id, measured_at DESC)`, and a UNIQUE `(node_id, sequence_number, measured_at)`
for duplicate suppression.

### Derived values

The backend computes these when the gateway doesn't supply them (and never overwrites a supplied value):

```
displacement_mm            = reference_distance_mm - ultrasonic_distance_mm
subsidence_mm              = max(0, reference_distance_mm - ultrasonic_distance_mm)
subsidence_rate_mm_per_day = Δsubsidence / Δt(days)   vs the previous reading
tilt_deg                   = max(|roll|, |pitch|)
vibration_intensity        = |‖accel‖ - g| / g + 1
battery_percentage         = linear 3.0 V → 4.2 V
```

---

## 8. REST API

Base URL `http://localhost:4000/api`. All responses are JSON: collections as
`{ "count": n, "data": [...] }`, single objects as `{ "data": {...} }`, errors as
`{ "error": "...", "message": "..." }`.

Common query parameters: `start`, `end` (ISO 8601), `limit`, `offset`, `node`, `gateway`.

### Health & status
```
GET  /api/health                      database + MQTT + WebSocket status (503 if degraded)
GET  /api/health/live                 trivial liveness probe
GET  /api/status/mqtt                 connection state, queue depth, ingestion counters
GET  /api/status/websocket            connected clients and their subscriptions
```

### Nodes
```
GET   /api/nodes                      ?status= &gateway= &zone= &search=
GET   /api/nodes/:nodeId              node + sensors + latest telemetry + open alerts
PATCH /api/nodes/:nodeId              update name, location, reference_distance_mm, zone...
GET   /api/nodes/:nodeId/telemetry            ?start= &end= &limit= &order=
GET   /api/nodes/:nodeId/telemetry/latest
GET   /api/nodes/:nodeId/telemetry/summary    ?metrics=subsidence_mm,battery_voltage
GET   /api/nodes/:nodeId/telemetry/trend      ?bucket=3600&metrics=
GET   /api/nodes/:nodeId/events
GET   /api/nodes/:nodeId/alerts               ?active=true
GET   /api/nodes/:nodeId/predictions
GET   /api/nodes/:nodeId/anomalies
GET   /api/nodes/:nodeId/sensors
```

### Gateways
```
GET  /api/gateways                    includes node_count / online_nodes
GET  /api/gateways/:gatewayId         gateway + its nodes
GET  /api/gateways/:gatewayId/nodes
GET  /api/gateways/:gatewayId/events
```

### Telemetry
```
GET  /api/telemetry/latest            latest reading for every node (dashboard home)
GET  /api/telemetry/history           ?node= &gateway= &nodes=A,B &start= &end= &limit= &format=csv
GET  /api/telemetry/count
GET  /api/telemetry/summary           min/max/avg per metric
GET  /api/telemetry/trend             ?bucket=3600 time-bucketed averages
GET  /api/telemetry/fields            the live field contract (types, units, aliases)
```

### Events
```
GET  /api/events                      ?node= &type= &severity= &source= &start= &end=
GET  /api/events/summary              ?hours=24
GET  /api/events/:id
POST /api/events                      manual event entry
```

### Alerts
```
GET   /api/alerts                     ?status= &severity= &type= &active=true
GET   /api/alerts/summary             ?hours=24
GET   /api/alerts/:id                 includes full status history
PATCH /api/alerts/:id                 { "status": "acknowledged", "by": "...", "note": "..." }
POST  /api/alerts                     manually raise an alert
GET   /api/rules                      current thresholds
PATCH /api/rules/:ruleKey             { "threshold": 20, "severity": "critical", "enabled": true }
```

### Predictions / AI
```
GET  /api/predictions                 ?node= &type= &model= &severity=
GET  /api/predictions/latest          latest per node per prediction type
GET  /api/predictions/:id
POST /api/predictions                 single object, array, or { "predictions": [...] }
GET  /api/anomalies
GET  /api/anomalies/summary
POST /api/anomalies
GET  /api/risk-assessments
POST /api/risk-assessments
```

### Analytics (dashboard)
```
GET  /api/analytics/overview            node/gateway/alert counts, risk distribution, per-site rollup
GET  /api/analytics/nodes/health        per-node health: risk, battery, subsidence, open alerts
GET  /api/analytics/nodes/latest        latest state for every node
GET  /api/analytics/sensors/status      sensor health aggregated by type + list of failing sensors
GET  /api/analytics/alerts/summary      counts by status/severity + hourly timeline
GET  /api/analytics/events/summary
GET  /api/analytics/anomalies/summary
GET  /api/analytics/telemetry/summary
GET  /api/analytics/telemetry/trends    ?bucket=3600&metrics=subsidence_mm
GET  /api/analytics/zones/risk          average/max risk per zone
GET  /api/analytics/ingestion           samples per node + measured→received latency
```

### Examples

```bash
curl 'localhost:4000/api/nodes'
curl 'localhost:4000/api/nodes/NODE-003/telemetry?limit=50'
curl 'localhost:4000/api/telemetry/trend?node=NODE-003&metrics=subsidence_mm&bucket=3600'
curl 'localhost:4000/api/alerts?active=true&severity=critical'
curl -X PATCH localhost:4000/api/alerts/1 -H 'content-type: application/json' \
     -d '{"status":"acknowledged","by":"safety.officer","note":"Team dispatched"}'
curl 'localhost:4000/api/analytics/overview'
```

---

## 9. WebSocket

Connect to `ws://localhost:4000/ws`. Every message is `{ "type": ..., "ts": ..., "data": {...} }`.

### Channels

| Type | Fired when |
|---|---|
| `telemetry` | A reading is stored — includes values, `risk_score`, `risk_level`, triggered rule keys |
| `node_status` | A node goes online/offline or its risk changes |
| `gateway_status` | A gateway goes online/offline |
| `event` | Any event is recorded |
| `alert` | Alert created, escalated, acknowledged or resolved (`data.change` says which) |
| `prediction` | An AI prediction or risk assessment arrives |

### Filtering

On connect you receive everything. Narrow it down:

```json
{ "action": "subscribe", "channels": ["telemetry", "alert"], "nodes": ["NODE-001", "NODE-003"] }
```

Use `"channels": "all"` / `"nodes": "all"` to widen again. `{"action":"ping"}` replies `pong`.
The server also sends WebSocket pings every 30 s and drops unresponsive clients.

### Browser client

```javascript
const ws = new WebSocket('ws://localhost:4000/ws');

ws.onopen = () => ws.send(JSON.stringify({
  action: 'subscribe',
  channels: ['telemetry', 'alert', 'node_status'],
  nodes: 'all'
}));

ws.onmessage = (e) => {
  const { type, data } = JSON.parse(e.data);
  if (type === 'telemetry') updateChart(data.node_id, data.values, data.risk_score);
  if (type === 'alert')     showToast(data.severity, data.message, data.change);
  if (type === 'node_status') setNodeStatus(data.node_id, data.status);
};
```

Recommended dashboard pattern: load initial state from
`GET /api/telemetry/latest` + `GET /api/alerts?active=true`, then apply WebSocket deltas.

---

## 10. Rule engine

Rules live in `alert_rules` and are re-read every 60 seconds, so thresholds can change at runtime.

| Rule | Condition | Severity |
|---|---|---|
| `crack_detected` | `crack_detected` is true | critical |
| `crack_sensor_rising` | `crack_sensor_raw > 800` | warning |
| `displacement_high` | `relative_displacement_mm > 15` | warning |
| `displacement_critical` | `relative_displacement_mm > 30` | critical |
| `subsidence_high` | `subsidence_mm > 25` | critical |
| `subsidence_rate_high` | `subsidence_rate_mm_per_day > 10` | critical |
| `vibration_detected` | `vibration_detected` is true | warning |
| `vibration_intensity_high` | `vibration_intensity > 2.5` | warning |
| `tilt_high` | `tilt_deg > 10` | warning |
| `battery_low` / `battery_critical` | `battery_voltage < 3.4` / `< 3.2` | warning / critical |
| `lora_weak_signal` | `lora_rssi < -115` | info |
| `node_offline` | no telemetry for 180 s | warning |
| `gateway_offline` | no traffic for 300 s | warning |

Each rule carries a `risk_weight`; the sum (capped at 100) becomes the node's risk score —
`low` <25, `moderate` <50, `high` <75, `severe` ≥75.

```bash
curl -X PATCH localhost:4000/api/rules/subsidence_high \
     -H 'content-type: application/json' -d '{"threshold": 20}'
```

Per-node overrides go in `node_rule_overrides` (the seed tightens `displacement_high` to 10 mm on
NODE-003, which sits on the active face).

**Alert lifecycle:** `active → acknowledged → resolved`. Only one open alert exists per
`(node, alert_type)` — repeats bump `occurrence_count` and can escalate severity, instead of
flooding the table. Rules with `auto_resolve` close their alert automatically once the value
returns within limits.

---

## 11. AI/ML integration

No models run inside this backend. The boundary is deliberately thin:

**Reading training data**

```bash
curl 'localhost:4000/api/telemetry/history?start=2026-08-01T00:00:00Z&limit=5000&format=csv' \
  -o training.csv
```

Or query PostgreSQL directly — the schema is stable and partition-pruned by time.

**Writing results back**

```bash
curl -X POST localhost:4000/api/predictions -H 'content-type: application/json' -d '{
  "node_id": "NODE-003",
  "model_name": "subsidence-lstm",
  "model_version": "v0.4",
  "prediction_type": "subsidence_forecast",
  "target_time": "2026-09-18T10:00:00Z",
  "horizon_minutes": 1440,
  "predicted_value": 41.2,
  "predicted_label": "increasing",
  "confidence": 0.86,
  "risk_score": 78,
  "severity": "critical",
  "features": { "window_hours": 72 },
  "raw_response": { "mean": 41.2, "p95": 48.9 }
}'
```

A prediction with severity `warning`/`critical` automatically raises an alert (send
`"raise_alert": false` to suppress) and broadcasts over WebSocket, so model output reaches the
dashboard through exactly the same path as rule-based alerts. `POST /api/anomalies` and
`POST /api/risk-assessments` behave the same way; a risk assessment also updates the node's
current risk level.

---

## 12. Tests

```bash
npm test          # 82 tests
```

**Unit** (no database): topic parsing and rejection, payload parsing in grouped and flat forms,
field aliases, boolean/number coercion, unknown-field preservation, future-timestamp clamping,
epoch timestamps, derived metrics, dynamic insert builder.

**Integration** (live PostgreSQL): connection and schema shape, partition verification, API health
and 404 envelope, node auto-registration and idempotency, telemetry ingestion end to end, duplicate
rejection, sparse payloads, `node_state` updates, history ordering and time filtering, CSV export,
aggregation, event insertion, `sensor_failure` handling, the full alert lifecycle with history trail,
dedupe and escalation, rule firing and risk scoring, scoped liveness rules, AI prediction/anomaly
endpoints, analytics, and WebSocket broadcast with channel and node filtering.

Integration tests skip cleanly with a clear message if no database is reachable, so
`npm test` never fails spuriously on a machine without PostgreSQL.

There is also an end-to-end smoke test that publishes to a real broker and asserts the resulting
WebSocket traffic:

```bash
node scripts/e2e-check.js
```

---

## 13. Troubleshooting

| Symptom | Fix |
|---|---|
| `Database schema is missing` | `npm run migrate` |
| `/api/health` returns 503 | Check `database.ok` and `mqtt.connected` in the response body |
| MQTT won't connect | Verify `MQTT_URL` (`mqtt://` vs `mqtts://`) and credentials; check `GET /api/status/mqtt` for `last_error` |
| Messages publish but nothing is stored | Topic must match the prefix exactly. Check `invalid_messages` in `/api/status/mqtt`, then read the backend logs — each rejection logs its reason |
| Nodes flip to offline during a demo | Telemetry interval exceeds `NODE_OFFLINE_AFTER_SECONDS`; raise it or publish faster |
| No subsidence values | The node has no `reference_distance_mm`. Send it in telemetry or `PATCH /api/nodes/:nodeId` |
| Want a clean slate | `npm run db:reset` |

---

## 14. Deliberately out of scope for v1

Authentication, RBAC, OAuth, Kubernetes, microservices, Kafka, Redis, distributed tracing and
elaborate caching are all omitted on purpose. The priority order is: it works, it's understandable,
the frontend can consume it easily, it ingests real hardware data, it stores history, it supports AI
later, and it demonstrates real-time monitoring and alerts.

Before any public deployment, put authentication in front of the write endpoints (`PATCH /api/alerts`,
`POST /api/predictions`, `PATCH /api/rules`) and restrict `CORS_ORIGIN` to the dashboard domain.
