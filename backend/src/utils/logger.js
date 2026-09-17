'use strict';

const config = require('../config');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[config.logLevel] || LEVELS.info;

function write(level, msg, extra) {
  if (LEVELS[level] < threshold) return;
  const line = {
    time: new Date().toISOString(),
    level,
    msg,
    ...(extra && typeof extra === 'object' ? { ...extra } : extra !== undefined ? { detail: extra } : {})
  };
  const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  out.write(`${JSON.stringify(line)}\n`);
}

const logger = {
  debug: (msg, extra) => write('debug', msg, extra),
  info: (msg, extra) => write('info', msg, extra),
  warn: (msg, extra) => write('warn', msg, extra),
  error: (msg, extra) => {
    if (extra instanceof Error) {
      write('error', msg, { error: extra.message, stack: extra.stack });
    } else {
      write('error', msg, extra);
    }
  },
  child: (bindings) => ({
    debug: (msg, extra) => write('debug', msg, { ...bindings, ...extra }),
    info: (msg, extra) => write('info', msg, { ...bindings, ...extra }),
    warn: (msg, extra) => write('warn', msg, { ...bindings, ...extra }),
    error: (msg, extra) => write('error', msg, extra instanceof Error
      ? { ...bindings, error: extra.message }
      : { ...bindings, ...extra })
  })
};

module.exports = logger;
