'use strict';

const db = require('../db');
const config = require('../config');
const logger = require('../utils/logger');
const { toNumber } = require('../utils/helpers');

let cache = { rules: [], overrides: new Map(), loadedAt: 0 };

const OPERATORS = {
  gt: (value, threshold) => value > threshold,
  gte: (value, threshold) => value >= threshold,
  lt: (value, threshold) => value < threshold,
  lte: (value, threshold) => value <= threshold,
  eq: (value, threshold) => value === threshold,
  neq: (value, threshold) => value !== threshold,
  is_true: (value) => value === true,
  is_false: (value) => value === false
};

async function load(force = false) {
  const age = Date.now() - cache.loadedAt;
  if (!force && cache.loadedAt && age < config.rules.refreshSeconds * 1000) return cache;

  const [rules, overrides] = await Promise.all([
    db.many('SELECT * FROM alert_rules WHERE enabled = true ORDER BY rule_key'),
    db.many('SELECT * FROM node_rule_overrides')
  ]);

  const overrideMap = new Map();
  for (const o of overrides) {
    if (!overrideMap.has(o.node_id)) overrideMap.set(o.node_id, new Map());
    overrideMap.get(o.node_id).set(o.rule_key, o);
  }

  cache = { rules, overrides: overrideMap, loadedAt: Date.now() };
  return cache;
}

function effectiveRule(rule, nodeId) {
  const override = cache.overrides.get(nodeId) && cache.overrides.get(nodeId).get(rule.rule_key);
  if (!override) return rule;
  return {
    ...rule,
    threshold: override.threshold !== null && override.threshold !== undefined ? override.threshold : rule.threshold,
    severity: override.severity || rule.severity,
    enabled: override.enabled !== null && override.enabled !== undefined ? override.enabled : rule.enabled
  };
}

function describe(rule, value) {
  const unit = rule.metric && rule.metric.endsWith('_mm') ? ' mm'
    : rule.metric === 'battery_voltage' ? ' V'
      : rule.metric === 'lora_rssi' ? ' dBm'
        : rule.metric === 'tilt_deg' ? '°'
          : '';
  if (rule.operator === 'is_true') return `${rule.name}`;
  if (rule.operator === 'is_false') return `${rule.name}`;
  const symbol = { gt: '>', gte: '>=', lt: '<', lte: '<=', eq: '=', neq: '!=' }[rule.operator] || rule.operator;
  return `${rule.name}: ${value}${unit} ${symbol} ${rule.threshold}${unit}`;
}

function evaluateScope(scope, metrics, nodeId, ruleKeys = null) {
  const triggered = [];
  const cleared = [];

  for (const baseRule of cache.rules) {
    if (baseRule.scope !== scope) continue;
    if (ruleKeys && !ruleKeys.includes(baseRule.rule_key)) continue;
    const rule = effectiveRule(baseRule, nodeId);
    if (!rule.enabled) continue;
    if (!rule.metric) continue;

    const rawValue = metrics[rule.metric];
    if (rawValue === undefined || rawValue === null) continue;

    const operator = OPERATORS[rule.operator];
    if (!operator) continue;

    const value = rule.operator === 'is_true' || rule.operator === 'is_false'
      ? Boolean(rawValue)
      : toNumber(rawValue);
    if (value === null) continue;

    const threshold = toNumber(rule.threshold);
    const hit = operator(value, threshold);

    const item = {
      rule_key: rule.rule_key,
      alert_type: rule.alert_type,
      event_type: rule.event_type,
      severity: rule.severity,
      metric: rule.metric,
      value,
      threshold,
      risk_weight: Number(rule.risk_weight),
      auto_resolve: rule.auto_resolve,
      message: describe(rule, value)
    };

    if (hit) triggered.push(item);
    else if (rule.auto_resolve) cleared.push(item);
  }

  return { triggered, cleared };
}

function riskFromTriggers(triggered) {
  let score = 0;
  const factors = {};
  for (const t of triggered) {
    score += t.risk_weight;
    factors[t.rule_key] = t.risk_weight;
  }
  score = Math.min(100, Math.round(score * 10) / 10);
  const level = score >= 75 ? 'severe' : score >= 50 ? 'high' : score >= 25 ? 'moderate' : 'low';
  return { score, level, factors };
}

async function evaluateTelemetry(nodeId, metrics) {
  await load();
  const { triggered, cleared } = evaluateScope('telemetry', metrics, nodeId);
  return { triggered, cleared, risk: riskFromTriggers(triggered) };
}

async function evaluateLiveness(nodeId, secondsSinceSeen, ruleKeys = ['node_offline']) {
  await load();
  const { triggered } = evaluateScope('liveness', { seconds_since_seen: secondsSinceSeen }, nodeId, ruleKeys);
  return triggered;
}

async function getRule(ruleKey) {
  await load();
  return cache.rules.find((r) => r.rule_key === ruleKey) || null;
}

async function listRules() {
  await load(true);
  return cache.rules;
}

async function updateRule(ruleKey, patch) {
  const allowed = ['name', 'description', 'metric', 'operator', 'threshold', 'severity', 'alert_type',
    'event_type', 'risk_weight', 'enabled', 'auto_resolve', 'config'];
  const sets = [];
  const params = [ruleKey];
  for (const key of allowed) {
    if (patch[key] !== undefined) {
      params.push(key === 'config' ? JSON.stringify(patch[key]) : patch[key]);
      sets.push(`${key} = $${params.length}${key === 'config' ? '::jsonb' : ''}`);
    }
  }
  if (!sets.length) return getRule(ruleKey);
  const row = await db.one(`UPDATE alert_rules SET ${sets.join(', ')} WHERE rule_key = $1 RETURNING *`, params);
  await load(true);
  logger.info('alert rule updated', { rule_key: ruleKey });
  return row;
}

function reset() {
  cache = { rules: [], overrides: new Map(), loadedAt: 0 };
}

module.exports = {
  OPERATORS,
  load,
  evaluateTelemetry,
  evaluateLiveness,
  riskFromTriggers,
  getRule,
  listRules,
  updateRule,
  reset
};
