/**
 * Structured JSON Logger using Winston.
 * 
 * All logs are JSON-formatted for easy parsing by log aggregators
 * (DataDog, ELK, CloudWatch, etc.)
 */

const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: {
    service: 'fraud-api',
    version: process.env.MODEL_VERSION || 'v1.0.0',
  },
  transports: [
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'production'
        ? winston.format.json()
        : winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ timestamp, level, message, ...meta }) => {
              const metaStr = Object.keys(meta).length > 2
                ? ` ${JSON.stringify(meta)}`
                : '';
              return `${timestamp} [${level}] ${message}${metaStr}`;
            })
          ),
    }),
  ],
});

module.exports = logger;
