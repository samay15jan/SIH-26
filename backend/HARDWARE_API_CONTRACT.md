# Nirmaan — Hardware / Gateway API Contract

This is the single source of truth for the **gateway → backend** interface. The hardware team
only needs this document. The backend ignores everything not described here, but always stores
the complete original payload, so sending extra fields is safe and never breaks ingestion.

**Broker:** `mqtt.samay15jan.com` (already deployed — do not run your own)
**Direction:** gateway publishes, backend subscribes. The backend never publishes commands in v1.
**Encoding:** UTF-8 JSON object. **QoS 1** recommended. Max payload 1 MB.

---

## 1. Topics

All topics are lowercase and use the `nirmaan` prefix.

| Purpose | Topic |
|---|---|
| Node telemetry (periodic) | `nirmaan/gateways/{gatewayId}/nodes/{nodeId}/telemetry` |
| Node status (boot / heartbeat / shutdown) | `nirmaan/gateways/{gatewayId}/nodes/{nodeId}/status` |
| Node discrete event | `nirmaan/gateways/{gatewayId}/nodes/{nodeId}/events` |
| Gateway status / LWT | `nirmaan/gateways/{gatewayId}/status` |

Examples:

```
nirmaan/gateways/GW-001/nodes/NODE-001/telemetry
nirmaan/gateways/GW-002/nodes/NODE-003/events
nirmaan/gateways/GW-001/status
```

### ID rules

- `nodeId` and `gatewayId` must match `^[A-Za-z0-9._:-]{1,64}$` — letters, digits, dot, underscore, colon, hyphen.
- Recommended format: `NODE-001`, `GW-001`. IDs are **case-sensitive**.
- The ID in the topic and the ID in the payload **must be identical**. If they disagree the
  message is rejected and logged (it is treated as a misrouted packet, not a new node).
- IDs are permanent. Do not reuse an ID for different physical hardware.
- An unknown node or gateway is **auto-registered** on first message — no manual provisioning
  needed. It appears immediately in `GET /api/nodes` and a `node_registered` event is emitted.

---

## 2. Telemetry payload

Publish one message per measurement cycle (recommended every 10–60 s per node).

```json
{
  "node_id": "NODE-001",
  "gateway_id": "GW-001",
  "timestamp": "2026-09-17T10:30:00Z",
  "sequence_number": 1001,

  "sensors": {
    "accel_x": 0.12,
    "accel_y": 0.04,
    "accel_z": 9.81,
    "gyro_x": 0.01,
    "gyro_y": 0.04,
    "gyro_z": 0.02,
    "roll": 1.2,
    "pitch": 0.8,
    "relative_yaw": 0.4,

    "vibration_detected": false,
    "vibration_count": 0,
    "vibration_duration_ms": 0,

    "potentiometer_raw": 1820,
    "potentiometer_voltage": 1.4663,
    "relative_displacement_mm": 4.7,

    "crack_sensor_raw": 0,
    "crack_sensor_voltage": 0.0,
    "crack_detected": false,

    "ultrasonic_distance_mm": 2495.3,
    "ultrasonic_echo_time_us": 14549,
    "reference_distance_mm": 2500.0,

    "servo_target_angle": 45,
    "servo_state": "idle"
  },

  "device": {
    "firmware_version": "1.4.2",
    "uptime_s": 86400,
    "reset_reason": "POWERON",
    "battery_voltage": 3.92,
    "supply_voltage": 5.02,
    "sensor_status": { "imu": "ok", "vibration": "ok", "ultrasonic": "ok", "crack": "ok" }
  },

  "comm": {
    "lora_rssi": -92,
    "lora_snr": 7.5,
    "packets_lost": 0,
    "packet_loss_percent": 0.0
  }
}
```

### Required fields

Only three things are genuinely required:

| Field | Notes |
|---|---|
| `node_id` | May be omitted **only** if present in the topic; sending it is strongly preferred. |
| `timestamp` | If omitted or unparseable, backend substitutes its own receive time. |
| at least one recognised measurement | A payload with no known sensor field is rejected. |

Everything else is optional. **Do not send placeholder values for sensors you do not have.**
Omit the key entirely, or send `null` — both are stored as NULL. Never send `0`, `-1` or `999`
to mean "no reading"; that corrupts the historical data the AI models will train on.

### Grouping is flexible

`sensors`, `device`, `comm`, `power`, `lora`, `data`, `measurements`, `meta` are all flattened
by the parser. These three payloads are equivalent:

```json
{ "node_id": "N1", "sensors": { "accel_x": 0.1 }, "device": { "battery_voltage": 3.9 } }
{ "node_id": "N1", "accel_x": 0.1, "battery_voltage": 3.9 }
{ "node_id": "N1", "data":    { "accel_x": 0.1, "battery_voltage": 3.9 } }
```

Use the grouped form in new firmware; the flat form exists so early prototypes work unchanged.

---

## 3. Field reference

`GET /api/telemetry/fields` returns this table live from the running backend.

### MPU6050 (IMU)

| Field | Type | Unit | Notes |
|---|---|---|---|
| `accel_x` `accel_y` `accel_z` | float | m/s² | Aliases: `ax`, `ay`, `az`. Send m/s², not raw LSB. |
| `gyro_x` `gyro_y` `gyro_z` | float | °/s | Aliases: `gx`, `gy`, `gz`. |
| `roll` `pitch` | float | degrees | Absolute inclination. Backend derives `tilt_deg = max(\|roll\|,\|pitch\|)`. |
| `relative_yaw` | float | degrees | Yaw drifts without a magnetometer — send relative only. |

### SW-420 vibration

| Field | Type | Unit | Notes |
|---|---|---|---|
| `vibration_detected` | bool | — | Accepts `true/false`, `1/0`, `"true"`, `"yes"`. |
| `vibration_count` | int | count | Events since last telemetry message. |
| `vibration_duration_ms` | int | ms | Total active duration in the window. |
| `vibration_intensity` | float | g | Optional. If omitted, derived from accelerometer magnitude. |

### Potentiometer (relative displacement)

| Field | Type | Unit | Notes |
|---|---|---|---|
| `potentiometer_raw` | int | ADC counts | ESP32 ADC, 0–4095. |
| `potentiometer_voltage` | float | V | |
| `relative_displacement_mm` | float | mm | Converted by the node. Send this if you can. |

### Crack detection (copper tape)

| Field | Type | Unit | Notes |
|---|---|---|---|
| `crack_sensor_raw` | int | ADC counts | **Convention: 0 = intact, high = broken.** |
| `crack_sensor_voltage` | float | V | |
| `crack_detected` | bool | — | Node's own decision. Drives a **critical** alert immediately. |

The `crack_sensor_rising` rule warns at `crack_sensor_raw > 800` as an early signal before a
full break. Keep the 0-is-healthy convention or that rule inverts.

### Ultrasonic (subsidence / convergence)

| Field | Type | Unit | Notes |
|---|---|---|---|
| `ultrasonic_distance_mm` | float | mm | Current measured distance. |
| `ultrasonic_echo_time_us` | int | µs | Raw echo time, kept for recalibration. |
| `reference_distance_mm` | float | mm | Installation baseline. See below. |
| `displacement_mm` | float | mm | Optional; backend derives it. |
| `subsidence_mm` | float | mm | Optional; backend derives it. |
| `subsidence_rate_mm_per_day` | float | mm/day | Optional; backend derives it. |

**Backend derivation (only when you do not send the value yourself):**

```
displacement_mm = reference_distance_mm - ultrasonic_distance_mm      (signed)
subsidence_mm   = max(0, reference_distance_mm - ultrasonic_distance_mm)
subsidence_rate_mm_per_day = Δsubsidence_mm / Δt in days              (vs previous reading)
```

Distance **shrinking** means the roof is sagging toward the sensor, so subsidence is positive.
If your geometry is inverted, send `subsidence_mm` explicitly and the backend will not override it.

`reference_distance_mm` can come from the payload or from the node record in the database
(`nodes.reference_distance_mm`, settable via `PATCH /api/nodes/:nodeId`). Send it at least once
at commissioning. Without a reference, no subsidence is computed and the subsidence rules stay silent.

### Servo

| Field | Type | Unit | Notes |
|---|---|---|---|
| `servo_target_angle` | float | degrees | Commanded angle. |
| `servo_actual_angle` | float | degrees | **Only if the servo has real position feedback.** Omit for plain SG90. |
| `servo_state` | text | — | Free text, e.g. `idle`, `sweeping`, `error`. |

### Power

| Field | Type | Unit | Notes |
|---|---|---|---|
| `battery_voltage` | float | V | Alias `vbat`. Drives low-battery alerts. |
| `supply_voltage` | float | V | Alias `vin`. |
| `battery_percentage` | float | % | Optional; derived linearly from 3.0 V–4.2 V if omitted. |

### LoRa / link quality

| Field | Type | Unit | Notes |
|---|---|---|---|
| `lora_rssi` | float | dBm | Alias `rssi`. Measured **at the gateway**, added by the gateway. |
| `lora_snr` | float | dB | Alias `snr`. |
| `packets_lost` | int | count | From sequence-number gaps. |
| `packet_loss_percent` | float | % | |

### Device metadata

| Field | Type | Unit | Notes |
|---|---|---|---|
| `firmware_version` | text | — | Alias `fw_version`. Updates the node record. |
| `uptime_s` | int | s | Aliases `uptime`, `uptime_seconds`. |
| `reset_reason` | text | — | e.g. `POWERON`, `WDT`, `BROWNOUT`, `SOFTWARE`. |
| `sensor_status` | object | — | `{"imu":"ok","ultrasonic":"failed"}`. Values `ok`/`degraded`/`failed`/`unknown`. |

---

## 4. Timestamps

- Format: **ISO 8601 with explicit UTC**: `2026-09-17T10:30:00Z`. Unix epoch seconds or
  milliseconds are also accepted.
- Always UTC. Do not send local time without an offset.
- More than **5 minutes in the future** → replaced with the backend receive time (protects
  against unsynced RTCs). More than 5 years in the past → likewise replaced.
- If a node has no RTC, the **gateway** should stamp the message on receipt. That is far better
  than omitting it, because ordering and subsidence rate depend on it.
- The backend records both `measured_at` (yours) and `received_at` (its own), so ingestion lag
  is always measurable via `GET /api/analytics/ingestion`.

## 5. Sequence numbers

- `sequence_number` — monotonically increasing integer per node. Aliases: `seq`, `sequence`, `packet_id`.
- Used for **duplicate suppression**: a repeat of the same `(node_id, sequence_number, timestamp)`
  is silently dropped, so LoRa retransmits and gateway replays are safe.
- Reset to 0 on reboot is fine — pair it with a `node_restarted` event.
- Omitting it is allowed but then duplicates cannot be detected. Please send it.

---

## 6. Event payload

Events are **discrete occurrences**, not periodic readings. Do not send an event every cycle —
send it on the edge (when the condition becomes true).

Topic: `nirmaan/gateways/{gatewayId}/nodes/{nodeId}/events`

```json
{
  "node_id": "NODE-003",
  "gateway_id": "GW-002",
  "timestamp": "2026-09-17T10:31:02Z",
  "event_type": "crack_detected",
  "severity": "critical",
  "message": "Crack sensor circuit broken",
  "details": { "crack_sensor_raw": 2100, "consecutive_readings": 3 }
}
```

| Field | Required | Notes |
|---|---|---|
| `event_type` | **yes** | Aliases `event`, `type`. |
| `severity` | no | `info` \| `warning` \| `critical`. Anything else becomes `info`. |
| `timestamp` | no | Same rules as telemetry. |
| `message` | no | Human-readable one-liner. |
| `details` | no | Any JSON object; stored verbatim as JSONB. |

### Recognised event types

`node_started`, `node_restarted`, `vibration_detected`, `crack_detected`, `sensor_failure`,
`battery_low`, `manual_test`, `manual_reset`, `communication_lost`, `communication_restored`,
`gateway_offline`, `anomaly_detected`

Unknown types are stored too — they just don't get special handling.

Two types trigger extra backend behaviour:

- `sensor_failure` — include `"details": {"sensor": "ultrasonic"}`. Marks that sensor `failed`
  in `node_sensors` and raises a warning alert.
- `node_started` / `node_restarted` — auto-resolves any open `node_offline` alert.

`details.sensor_status` (an object) updates per-sensor health on any event type.

---

## 7. Status payload

### Node status

Topic: `nirmaan/gateways/{gatewayId}/nodes/{nodeId}/status`

```json
{
  "node_id": "NODE-001",
  "gateway_id": "GW-001",
  "timestamp": "2026-09-17T10:29:00Z",
  "status": "online",
  "firmware_version": "1.4.2",
  "uptime_s": 86400,
  "battery_voltage": 3.92,
  "reset_reason": "POWERON",
  "sensor_status": { "imu": "ok", "ultrasonic": "ok" }
}
```

`status` must be `online`, `offline` or `maintenance` (unrecognised values default to `online`).
Publish on boot, and optionally as a heartbeat when a node has nothing to report.

### Gateway status

Topic: `nirmaan/gateways/{gatewayId}/status`

```json
{
  "gateway_id": "GW-001",
  "timestamp": "2026-09-17T10:29:00Z",
  "status": "online",
  "firmware_version": "1.2.0",
  "uptime_s": 259200,
  "connected_nodes": 3
}
```

Set this topic as the MQTT **Last Will and Testament** with `{"gateway_id":"GW-001","status":"offline"}`
so the broker announces gateway death automatically.

---

## 8. Liveness

You do not need to send "I am alive" messages beyond normal telemetry.

- A node with no traffic for **180 s** is marked `offline` → `communication_lost` event + warning alert.
- A gateway with no traffic for **300 s** is marked `offline` → `gateway_offline` event + warning alert.
- Both auto-recover and auto-resolve their alerts on the next message received.

Thresholds are configurable (`NODE_OFFLINE_AFTER_SECONDS`, `GATEWAY_OFFLINE_AFTER_SECONDS`).
Keep your telemetry interval comfortably under them.

---

## 9. Error handling

The backend never disconnects you and never NACKs. Bad messages are counted and logged, visible at
`GET /api/status/mqtt` under `ingest`:

| Situation | Result |
|---|---|
| Invalid JSON | Counted in `invalid_messages`, dropped |
| Payload is an array or a scalar | Rejected — must be a JSON object |
| No recognised measurement | Rejected |
| `node_id` in payload ≠ `node_id` in topic | Rejected (misrouted packet) |
| Invalid ID characters | Rejected |
| Unknown topic shape | Rejected |
| Unknown extra sensor fields | **Accepted** — ignored for columns, preserved in `raw_payload` |
| Duplicate sequence number | Accepted and silently skipped |

If `invalid_messages` climbs during integration, check `docker compose logs backend` — each
rejection logs the exact reason and a sample of the payload.

---

## 10. Quick checklist for firmware/gateway integration

1. Pick permanent IDs (`GW-001`, `NODE-001`, …).
2. Publish to the four topics above, QoS 1.
3. Send `node_id` + `gateway_id` + `timestamp` (UTC) + `sequence_number` in every message.
4. Omit sensors you don't have — never send fake values.
5. Send `reference_distance_mm` at least once per node at commissioning.
6. Keep `crack_sensor_raw` at 0 when intact.
7. Add `lora_rssi` / `lora_snr` at the gateway.
8. Configure the gateway LWT on `nirmaan/gateways/{gatewayId}/status`.
9. Send events on edges only, not every cycle.
10. Verify with `GET /api/nodes/{nodeId}/telemetry/latest` and watch `GET /api/status/mqtt`.
