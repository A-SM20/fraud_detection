"""
Structured JSON logging for the scoring worker.

All logs are JSON-formatted for easy parsing by log aggregators.
"""

import logging
import json
import os
import sys
from datetime import datetime, timezone


class JSONFormatter(logging.Formatter):
    """Format log records as JSON."""

    def format(self, record):
        log_entry = {
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'level': record.levelname,
            'service': 'fraud-worker',
            'message': record.getMessage(),
        }

        # Add extra fields
        if hasattr(record, 'extra_data'):
            log_entry.update(record.extra_data)

        # Add exception info if present
        if record.exc_info and record.exc_info[0] is not None:
            log_entry['exception'] = self.formatException(record.exc_info)

        return json.dumps(log_entry)


def setup_logger(name='fraud-worker'):
    """
    Create and configure a structured JSON logger.

    Args:
        name: logger name

    Returns:
        logging.Logger instance
    """
    logger = logging.getLogger(name)
    log_level = os.getenv('LOG_LEVEL', 'INFO').upper()
    logger.setLevel(getattr(logging, log_level, logging.INFO))

    # Remove existing handlers
    logger.handlers = []

    # Console handler with JSON formatter
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JSONFormatter())
    logger.addHandler(handler)

    return logger


# Module-level logger instance
worker_logger = setup_logger()


def log_info(message, **kwargs):
    """Log info message with optional structured data."""
    record = worker_logger.makeRecord(
        'fraud-worker', logging.INFO, '', 0, message, (), None
    )
    record.extra_data = kwargs
    worker_logger.handle(record)


def log_warning(message, **kwargs):
    """Log warning message with optional structured data."""
    record = worker_logger.makeRecord(
        'fraud-worker', logging.WARNING, '', 0, message, (), None
    )
    record.extra_data = kwargs
    worker_logger.handle(record)


def log_error(message, **kwargs):
    """Log error message with optional structured data."""
    record = worker_logger.makeRecord(
        'fraud-worker', logging.ERROR, '', 0, message, (), None
    )
    record.extra_data = kwargs
    worker_logger.handle(record)


def log_scoring(txn_id, decision, combined_score, rules_triggered, scoring_time_ms):
    """Log a scoring decision with full structured context."""
    log_info('scoring_complete', **{
        'transaction_id': txn_id,
        'decision': decision,
        'combined_score': combined_score,
        'rules_triggered': rules_triggered,
        'scoring_time_ms': scoring_time_ms,
    })
