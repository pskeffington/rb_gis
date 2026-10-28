//! Portable, offline-first WGS84 primitives. No networking, UI, or receiver I/O.
pub mod viewport;
pub mod geojson;
pub mod layers;
use std::fmt;

const EARTH_RADIUS_METERS: f64 = 6_371_008.8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GeoError {
    InvalidCoordinate,
    InvalidAccuracy,
    InvalidTimestamp,
}
impl fmt::Display for GeoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for GeoError {}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Coordinate {
    pub latitude: f64,
    pub longitude: f64,
}
impl Coordinate {
    pub fn new(latitude: f64, longitude: f64) -> Result<Self, GeoError> {
        if !latitude.is_finite() || !longitude.is_finite()
            || !(-90.0..=90.0).contains(&latitude)
            || !(-180.0..=180.0).contains(&longitude) {
            return Err(GeoError::InvalidCoordinate);
        }
        Ok(Self { latitude, longitude })
    }
    /// GeoJSON (RFC 7946) coordinates use [longitude, latitude].
    pub fn geojson_position(self) -> [f64; 2] {
        [self.longitude, self.latitude]
    }
    /// Approximate spherical distance, not survey-grade ellipsoidal distance.
    pub fn distance_meters(self, other: Self) -> f64 {
        let a = self.latitude.to_radians();
        let b = other.latitude.to_radians();
        let delta_lat = (other.latitude - self.latitude).to_radians();
        let delta_lon = (other.longitude - self.longitude).to_radians();
        let h = (delta_lat / 2.0).sin().powi(2)
            + a.cos() * b.cos() * (delta_lon / 2.0).sin().powi(2);
        2.0 * EARTH_RADIUS_METERS * h.clamp(0.0, 1.0).sqrt().asin()
    }
}

/// Position freshness is evaluated by the caller against an explicit clock.
/// No last-known fix is ever automatically promoted to a live fix.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PositionFix {
    pub coordinate: Coordinate,
    pub observed_at_unix_ms: u64,
    pub horizontal_accuracy_m: f64,
}
impl PositionFix {
    pub fn new(coordinate: Coordinate, observed_at_unix_ms: u64, horizontal_accuracy_m: f64)
        -> Result<Self, GeoError> {
        if observed_at_unix_ms == 0 { return Err(GeoError::InvalidTimestamp); }
        if !horizontal_accuracy_m.is_finite() || horizontal_accuracy_m < 0.0 {
            return Err(GeoError::InvalidAccuracy);
        }
        Ok(Self { coordinate, observed_at_unix_ms, horizontal_accuracy_m })
    }
    pub fn is_fresh(self, now_unix_ms: u64, max_age_ms: u64) -> bool {
        now_unix_ms >= self.observed_at_unix_ms
            && now_unix_ms - self.observed_at_unix_ms <= max_age_ms
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn coordinates_validate_and_export_lon_first() {
        assert_eq!(Coordinate::new(42.0, -70.75).unwrap().geojson_position(), [-70.75, 42.0]);
        assert!(Coordinate::new(91.0, 0.0).is_err());
        assert!(Coordinate::new(f64::NAN, 0.0).is_err());
    }
    #[test]
    fn dateline_distance_is_short_way() {
        let a = Coordinate::new(0.0, 179.9).unwrap();
        let b = Coordinate::new(0.0, -179.9).unwrap();
        assert!((a.distance_meters(b) - 22_239.0).abs() < 5.0);
    }
    #[test]
    fn stale_and_future_fixes_are_not_live() {
        let p = Coordinate::new(42.0, -70.0).unwrap();
        let f = PositionFix::new(p, 1_000, 10.0).unwrap();
        assert!(f.is_fresh(2_000, 2_000));
        assert!(!f.is_fresh(4_000, 2_000));
        assert!(!f.is_fresh(900, 2_000));
        assert!(PositionFix::new(p, 1, f64::NAN).is_err());
    }
}
