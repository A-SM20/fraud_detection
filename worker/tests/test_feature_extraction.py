"""
Unit tests for the feature extraction module.

Tests haversine distance calculation and feature vector construction.
Redis-dependent tests are skipped if Redis is not available.
"""

import sys
import os
import math
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from feature_extraction import haversine_km


class TestHaversine:
    """Test the haversine distance calculation."""

    def test_same_point_returns_zero(self):
        assert haversine_km(40.7128, -74.0060, 40.7128, -74.0060) == 0.0

    def test_known_distance_ny_to_la(self):
        """New York to Los Angeles is approximately 3,944 km."""
        dist = haversine_km(40.7128, -74.0060, 34.0522, -118.2437)
        assert 3900 < dist < 4000

    def test_known_distance_london_to_paris(self):
        """London to Paris is approximately 343 km."""
        dist = haversine_km(51.5074, -0.1278, 48.8566, 2.3522)
        assert 330 < dist < 360

    def test_known_distance_ny_to_tokyo(self):
        """New York to Tokyo is approximately 10,838 km."""
        dist = haversine_km(40.7128, -74.0060, 35.6762, 139.6503)
        assert 10700 < dist < 11000

    def test_none_values_return_zero(self):
        assert haversine_km(None, -74.0, 34.0, -118.0) == 0.0
        assert haversine_km(40.7, None, 34.0, -118.0) == 0.0
        assert haversine_km(40.7, -74.0, None, -118.0) == 0.0
        assert haversine_km(40.7, -74.0, 34.0, None) == 0.0

    def test_antipodal_points(self):
        """Opposite sides of Earth should be ~20,000 km."""
        dist = haversine_km(0, 0, 0, 180)
        assert 20000 < dist < 20100

    def test_equator_distance(self):
        """1 degree of longitude at equator ≈ 111.32 km."""
        dist = haversine_km(0, 0, 0, 1)
        assert 110 < dist < 112

    def test_symmetry(self):
        """Distance A→B should equal B→A."""
        d1 = haversine_km(40.7, -74.0, 34.0, -118.0)
        d2 = haversine_km(34.0, -118.0, 40.7, -74.0)
        assert abs(d1 - d2) < 0.001
