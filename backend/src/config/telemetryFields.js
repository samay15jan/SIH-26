'use strict';

const FIELDS = [
  { column: 'accel_x', type: 'float', group: 'imu', unit: 'm/s2', aliases: ['ax', 'acceleration_x'] },
  { column: 'accel_y', type: 'float', group: 'imu', unit: 'm/s2', aliases: ['ay', 'acceleration_y'] },
  { column: 'accel_z', type: 'float', group: 'imu', unit: 'm/s2', aliases: ['az', 'acceleration_z'] },
  { column: 'gyro_x', type: 'float', group: 'imu', unit: 'deg/s', aliases: ['gx'] },
  { column: 'gyro_y', type: 'float', group: 'imu', unit: 'deg/s', aliases: ['gy'] },
  { column: 'gyro_z', type: 'float', group: 'imu', unit: 'deg/s', aliases: ['gz'] },
  { column: 'roll', type: 'float', group: 'imu', unit: 'deg', aliases: [] },
  { column: 'pitch', type: 'float', group: 'imu', unit: 'deg', aliases: [] },
  { column: 'relative_yaw', type: 'float', group: 'imu', unit: 'deg', aliases: ['yaw', 'yaw_relative'] },

  { column: 'vibration_detected', type: 'bool', group: 'vibration', unit: 'bool', aliases: ['vibration'] },
  { column: 'vibration_count', type: 'int', group: 'vibration', unit: 'count', aliases: ['vibration_events'] },
  { column: 'vibration_duration_ms', type: 'int', group: 'vibration', unit: 'ms', aliases: ['vibration_duration'] },
  { column: 'vibration_intensity', type: 'float', group: 'vibration', unit: 'g', aliases: [] },

  { column: 'potentiometer_raw', type: 'int', group: 'displacement', unit: 'adc', aliases: ['pot_raw'] },
  { column: 'potentiometer_voltage', type: 'float', group: 'displacement', unit: 'V', aliases: ['pot_voltage'] },
  { column: 'relative_displacement_mm', type: 'float', group: 'displacement', unit: 'mm', aliases: ['relative_displacement'] },

  { column: 'crack_sensor_raw', type: 'int', group: 'crack', unit: 'adc', aliases: ['crack_raw'] },
  { column: 'crack_sensor_voltage', type: 'float', group: 'crack', unit: 'V', aliases: ['crack_voltage'] },
  { column: 'crack_detected', type: 'bool', group: 'crack', unit: 'bool', aliases: ['crack'] },

  { column: 'ultrasonic_distance_mm', type: 'float', group: 'ultrasonic', unit: 'mm', aliases: ['ultrasonic_distance', 'distance_mm'] },
  { column: 'ultrasonic_echo_time_us', type: 'int', group: 'ultrasonic', unit: 'us', aliases: ['echo_time_us'] },
  { column: 'reference_distance_mm', type: 'float', group: 'ultrasonic', unit: 'mm', aliases: ['baseline_distance_mm'] },
  { column: 'displacement_mm', type: 'float', group: 'ultrasonic', unit: 'mm', aliases: [] },
  { column: 'subsidence_mm', type: 'float', group: 'ultrasonic', unit: 'mm', aliases: [] },
  { column: 'subsidence_rate_mm_per_day', type: 'float', group: 'ultrasonic', unit: 'mm/day', aliases: ['subsidence_rate'] },

  { column: 'servo_target_angle', type: 'float', group: 'servo', unit: 'deg', aliases: ['servo_angle'] },
  { column: 'servo_actual_angle', type: 'float', group: 'servo', unit: 'deg', aliases: [] },
  { column: 'servo_state', type: 'text', group: 'servo', unit: 'enum', aliases: [] },

  { column: 'battery_voltage', type: 'float', group: 'power', unit: 'V', aliases: ['vbat'] },
  { column: 'supply_voltage', type: 'float', group: 'power', unit: 'V', aliases: ['vin'] },
  { column: 'battery_percentage', type: 'float', group: 'power', unit: '%', aliases: ['battery_percent'] },

  { column: 'lora_rssi', type: 'float', group: 'comm', unit: 'dBm', aliases: ['rssi'] },
  { column: 'lora_snr', type: 'float', group: 'comm', unit: 'dB', aliases: ['snr'] },
  { column: 'packets_lost', type: 'int', group: 'comm', unit: 'count', aliases: ['lost_packets'] },
  { column: 'packet_loss_percent', type: 'float', group: 'comm', unit: '%', aliases: ['packet_loss'] },

  { column: 'firmware_version', type: 'text', group: 'device', unit: 'text', aliases: ['fw_version', 'firmware'] },
  { column: 'uptime_s', type: 'int', group: 'device', unit: 's', aliases: ['uptime', 'uptime_seconds'] },
  { column: 'reset_reason', type: 'text', group: 'device', unit: 'text', aliases: ['boot_reason'] },
  { column: 'sensor_status', type: 'jsonb', group: 'device', unit: 'object', aliases: ['sensors_status', 'sensor_health'] }
];

const FIELD_BY_COLUMN = new Map(FIELDS.map((f) => [f.column, f]));

const FIELD_BY_KEY = new Map();
for (const field of FIELDS) {
  FIELD_BY_KEY.set(field.column, field);
  for (const alias of field.aliases) FIELD_BY_KEY.set(alias, field);
}

const NUMERIC_METRICS = FIELDS.filter((f) => f.type === 'float' || f.type === 'int').map((f) => f.column);

module.exports = { FIELDS, FIELD_BY_COLUMN, FIELD_BY_KEY, NUMERIC_METRICS };
