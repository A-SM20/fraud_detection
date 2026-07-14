"""
Feature extraction module.

Extracts features from a raw transaction + Redis velocity/geo state.
These features feed into both the rules engine and the ML models.
"""

import math
import time
import redis as redis_client
from config import REDIS_HOST, REDIS_PORT


# Redis connection for velocity/geo lookups
_redis = redis_client.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)


def haversine_km(lat1, lon1, lat2, lon2):
    """
    Calculate the great-circle distance between two points on Earth (km).
    Uses the Haversine formula.
    """
    if any(v is None for v in [lat1, lon1, lat2, lon2]):
        return 0.0

    R = 6371.0  # Earth's radius in km
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])

    dlat = lat2 - lat1
    dlon = lon2 - lon1

    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return R * c


def update_velocity_state(card_hash, timestamp_epoch):
    """
    Add this transaction's timestamp to the velocity sorted set in Redis.
    Also clean up entries older than 24 hours.

    Args:
        card_hash: string
        timestamp_epoch: float, Unix timestamp
    """
    key = f"velocity:{card_hash}"
    # Add current transaction timestamp
    _redis.zadd(key, {str(timestamp_epoch): timestamp_epoch})
    # Remove entries older than 24h
    cutoff_24h = timestamp_epoch - 86400
    _redis.zremrangebyscore(key, '-inf', cutoff_24h)
    # Set TTL to auto-expire idle keys (25h)
    _redis.expire(key, 90000)


def update_geo_state(card_hash, latitude, longitude):
    """
    Store the latest geo coordinates for a card in Redis.
    """
    if latitude is not None and longitude is not None:
        key = f"geo:{card_hash}"
        _redis.hset(key, mapping={"lat": str(latitude), "lon": str(longitude)})
        _redis.expire(key, 90000)  # 25h TTL


def extract_features(transaction):
    """
    Extract a feature vector from a raw transaction payload.

    Uses Redis for velocity counts and geo-mismatch detection.
    Returns a dict of feature name → float value.

    Args:
        transaction: dict with keys:
            id, card_hash, amount, currency, merchant_id,
            merchant_category, latitude, longitude, country, timestamp

    Returns:
        dict of features
    """
    card_hash = transaction['card_hash']
    amount = float(transaction['amount'])
    lat = transaction.get('latitude')
    lon = transaction.get('longitude')

    # Parse timestamp to epoch
    from datetime import datetime, timezone
    try:
        if isinstance(transaction['timestamp'], str):
            ts = datetime.fromisoformat(transaction['timestamp'].replace('Z', '+00:00'))
        else:
            ts = transaction['timestamp']
        ts_epoch = ts.timestamp()
    except Exception:
        ts_epoch = time.time()

    now = ts_epoch

    # ─── Velocity features (from Redis sorted set) ───────
    velocity_key = f"velocity:{card_hash}"
    cutoff_1h = now - 3600
    cutoff_24h = now - 86400

    velocity_1h = _redis.zcount(velocity_key, cutoff_1h, '+inf')
    velocity_24h = _redis.zcount(velocity_key, cutoff_24h, '+inf')

    # Time since last transaction
    last_txn_scores = _redis.zrevrangebyscore(velocity_key, '+inf', '-inf', start=0, num=1, withscores=True)
    if last_txn_scores:
        last_ts = float(last_txn_scores[0][1])
        time_since_last = max(now - last_ts, 0)
    else:
        time_since_last = 86400  # Default to 24h if no history

    # ─── Geo features (from Redis hash) ──────────────────
    geo_key = f"geo:{card_hash}"
    last_geo = _redis.hgetall(geo_key)

    if last_geo and lat is not None and lon is not None:
        last_lat = float(last_geo.get('lat', 0))
        last_lon = float(last_geo.get('lon', 0))
        geo_distance_km = haversine_km(last_lat, last_lon, lat, lon)
    else:
        geo_distance_km = 0.0

    # Impossible travel speed (km/h)
    if time_since_last > 0 and geo_distance_km > 0:
        speed_kmh = (geo_distance_km / time_since_last) * 3600
    else:
        speed_kmh = 0.0

    # ─── Time-based features ─────────────────────────────
    from datetime import datetime as dt
    try:
        hour = dt.fromtimestamp(ts_epoch).hour
    except Exception:
        hour = 12

    # Cyclical encoding for hour of day
    hour_sin = math.sin(2 * math.pi * hour / 24)
    hour_cos = math.cos(2 * math.pi * hour / 24)

    # ─── Amount features ─────────────────────────────────
    # Normalized log amount (handles the heavy-tailed distribution)
    log_amount = math.log1p(amount)

    # ─── Build feature vector ────────────────────────────
    features = {
        'amount': amount,
        'log_amount': log_amount,
        'velocity_1h': float(velocity_1h),
        'velocity_24h': float(velocity_24h),
        'time_since_last_txn': time_since_last,
        'geo_distance_km': geo_distance_km,
        'speed_kmh': speed_kmh,
        'hour_sin': hour_sin,
        'hour_cos': hour_cos,
        'is_foreign': 1.0 if transaction.get('country') and transaction.get('country') != 'US' else 0.0,
    }

    # Update Redis state AFTER extracting features (so current txn doesn't count itself)
    update_velocity_state(card_hash, ts_epoch)
    update_geo_state(card_hash, lat, lon)

    return features
