'use strict';

class HttpError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

const notFound = (msg) => new HttpError(404, msg || 'Not found');
const badRequest = (msg, details) => new HttpError(400, msg || 'Bad request', details);

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toInt(value) {
  const n = toNumber(value);
  return n === null ? null : Math.round(n);
}

function toBool(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const s = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on', 'detected', 'high'].includes(s)) return true;
  if (['false', '0', 'no', 'off', 'clear', 'low', 'none'].includes(s)) return false;
  return null;
}

function toText(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return JSON.stringify(value);
  const s = String(value).trim();
  return s === '' ? null : s.slice(0, 255);
}

function parseTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const ms = value > 1e12 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = String(value).trim();
  if (/^\d+$/.test(s)) return parseTimestamp(Number(s));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function clampLimit(value, fallback, max) {
  const n = toInt(value);
  if (n === null || n <= 0) return fallback;
  return Math.min(n, max);
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (obj && obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

module.exports = {
  HttpError,
  notFound,
  badRequest,
  toNumber,
  toInt,
  toBool,
  toText,
  parseTimestamp,
  clampLimit,
  pick,
  isPlainObject
};
