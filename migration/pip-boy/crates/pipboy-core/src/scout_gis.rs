//! Reclamation Scout GIS bridge: read-only, offline GeoJSON Point inspection
//! and explicit waypoint/distance calculations. Independent code; no RustGIS
//! source vendoring, sockets, location sampling or data persistence.
use serde::Serialize;
use serde_json::{json, Value};
use std::io;

pub const MAX_GEOJSON_BYTES: usize = 1024 * 1024;
pub const MAX_POINTS: usize = 1000;
const MEAN_EARTH_RADIUS_M: f64 = 6_371_008.8;

fn invalid(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Point {
    pub latitude: f64,
    pub longitude: f64,
}

impl Point {
    pub fn new(latitude: f64, longitude: f64) -> io::Result<Self> {
        if !latitude.is_finite() || !longitude.is_finite() {
            return Err(invalid("coordinates must be finite numbers"));
        }
        if !(-90.0..=90.0).contains(&latitude) {
            return Err(invalid("latitude must be in -90..=90"));
        }
        if !(-180.0..=180.0).contains(&longitude) {
            return Err(invalid("longitude must be in -180..=180"));
        }
        Ok(Self {
            latitude,
            longitude,
        })
    }

    pub fn from_text(lat: &str, lon: &str) -> io::Result<Self> {
        let lat = lat
            .parse::<f64>()
            .map_err(|_| invalid("latitude is not a number"))?;
        let lon = lon
            .parse::<f64>()
            .map_err(|_| invalid("longitude is not a number"))?;
        Self::new(lat, lon)
    }
}

/// Spherical great-circle distance, not an ellipsoidal survey-grade geodesic.
/// The longitude difference handles crossing the antimeridian automatically.
pub fn distance_meters(a: Point, b: Point) -> f64 {
    let dlat = (b.latitude - a.latitude).to_radians();
    let dlon = (b.longitude - a.longitude).to_radians();
    let lat_a = a.latitude.to_radians();
    let lat_b = b.latitude.to_radians();
    let h = (dlat / 2.0).sin().powi(2) + lat_a.cos() * lat_b.cos() * (dlon / 2.0).sin().powi(2);
    MEAN_EARTH_RADIUS_M * 2.0 * h.clamp(0.0, 1.0).sqrt().asin()
}

/// WGS84 GeoJSON per RFC 7946: positions are [longitude, latitude].
/// User-supplied name is JSON escaped; never interpolated as source text.
pub fn waypoint(name: &str, point: Point) -> io::Result<Value> {
    if name.is_empty()
        || name.trim() != name
        || name.chars().count() > 64
        || name.chars().any(char::is_control)
    {
        return Err(invalid("waypoint name must be 1..64 printable characters"));
    }
    Ok(json!({
        "type": "Feature",
        "geometry": {
            "type": "Point",
            "coordinates": [point.longitude, point.latitude]
        },
        "properties": {
            "name": name
        }
    }))
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct GeoJsonSummary {
    pub format: &'static str,
    pub geometry: &'static str,
    pub features: usize,
    /// [west, south, east, north]; raw min/max, no antimeridian unwrapping.
    pub bbox: [f64; 4],
    pub coordinate_order: &'static str,
    pub antimeridian_note: &'static str,
    pub network_used: bool,
}

fn point_geometry(value: &Value) -> io::Result<Point> {
    if value.get("type").and_then(Value::as_str) != Some("Point") {
        return Err(invalid(
            "only GeoJSON Point geometries are currently supported",
        ));
    }
    let coordinates = value
        .get("coordinates")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("GeoJSON Point coordinates must be an array"))?;
    if coordinates.len() != 2 {
        return Err(invalid("GeoJSON Point must have exactly two coordinates"));
    }
    let lon = coordinates[0]
        .as_f64()
        .ok_or_else(|| invalid("longitude must be numeric"))?;
    let lat = coordinates[1]
        .as_f64()
        .ok_or_else(|| invalid("latitude must be numeric"))?;
    Point::new(lat, lon)
}

fn feature_geometry(value: &Value) -> io::Result<Point> {
    if value.get("type").and_then(Value::as_str) != Some("Feature") {
        return Err(invalid(
            "GeoJSON FeatureCollection entries must be Features",
        ));
    }
    point_geometry(
        value
            .get("geometry")
            .ok_or_else(|| invalid("GeoJSON Feature requires non-null Point geometry"))?,
    )
}

/// Bounded read-only interoperability with RustGIS and other RFC 7946 tools.
/// Reject non-Point data instead of silently omitting geometry.
pub fn inspect_geojson(bytes: &[u8]) -> io::Result<GeoJsonSummary> {
    if bytes.is_empty() || bytes.len() > MAX_GEOJSON_BYTES {
        return Err(invalid("GeoJSON must be 1 byte to 1 MiB"));
    }
    let root: Value =
        serde_json::from_slice(bytes).map_err(|_| invalid("invalid GeoJSON JSON document"))?;
    let points: Vec<Point> = match root.get("type").and_then(Value::as_str) {
        Some("Point") => vec![point_geometry(&root)?],
        Some("Feature") => vec![feature_geometry(&root)?],
        Some("FeatureCollection") => {
            let features = root
                .get("features")
                .and_then(Value::as_array)
                .ok_or_else(|| invalid("FeatureCollection requires a features array"))?;
            if features.is_empty() || features.len() > MAX_POINTS {
                return Err(invalid("FeatureCollection must contain 1..1000 Points"));
            }
            features
                .iter()
                .map(feature_geometry)
                .collect::<io::Result<Vec<_>>>()?
        }
        _ => {
            return Err(invalid(
                "expected GeoJSON Point, Feature or FeatureCollection of Points",
            ))
        }
    };
    let initial = points[0];
    let mut west = initial.longitude;
    let mut east = initial.longitude;
    let mut south = initial.latitude;
    let mut north = initial.latitude;
    for point in points.iter().skip(1) {
        west = west.min(point.longitude);
        east = east.max(point.longitude);
        south = south.min(point.latitude);
        north = north.max(point.latitude);
    }
    Ok(GeoJsonSummary {
        format: "GeoJSON (RFC 7946)",
        geometry: "Point",
        features: points.len(),
        bbox: [west, south, east, north],
        coordinate_order: "longitude,latitude",
        antimeridian_note: "Raw min/max bbox; crossing the antimeridian may create a wide extent",
        network_used: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn geojson_coordinates_are_longitude_then_latitude() {
        let point = Point::new(42.0, -70.75).unwrap();
        let json = waypoint("Scout Camp", point).unwrap();
        assert_eq!(json["geometry"]["coordinates"], json!([-70.75, 42.0]));
        assert_eq!(json["properties"]["name"], "Scout Camp");
        let summary = inspect_geojson(json.to_string().as_bytes()).unwrap();
        assert_eq!(summary.features, 1);
        assert_eq!(summary.bbox, [-70.75, 42.0, -70.75, 42.0]);
        assert!(!summary.network_used);
    }

    #[test]
    fn distance_is_bounded_and_antimeridian_safe() {
        let a = Point::new(0.0, 0.0).unwrap();
        let b = Point::new(0.0, 1.0).unwrap();
        assert!((distance_meters(a, b) - 111_195.08).abs() < 1.0);
        assert_eq!(distance_meters(a, a), 0.0);
        let near_dateline = distance_meters(
            Point::new(0.0, 179.9).unwrap(),
            Point::new(0.0, -179.9).unwrap(),
        );
        assert!((near_dateline - 22_239.0).abs() < 5.0);
        let antipodes = distance_meters(a, Point::new(0.0, 180.0).unwrap());
        assert!(antipodes.is_finite() && antipodes > 20_000_000.0);
    }

    #[test]
    fn invalid_inputs_fail_closed_without_storage() {
        for (lat, lon) in [
            (91.0, 0.0),
            (-91.0, 0.0),
            (0.0, -181.0),
            (0.0, 181.0),
            (f64::NAN, 0.0),
            (f64::INFINITY, 0.0),
        ] {
            assert!(Point::new(lat, lon).is_err());
        }
        for name in ["", " bad", "bad ", "a\nb"] {
            assert!(waypoint(name, Point::new(0.0, 0.0).unwrap()).is_err());
        }
        assert!(waypoint(&"x".repeat(65), Point::new(0.0, 0.0).unwrap()).is_err());
        for invalid in [
            r#"{}"#,
            r#"{"type":"FeatureCollection","features":[]}"#,
            r#"{"type":"Point","coordinates":[0]}"#,
            r#"{"type":"Point","coordinates":[0,91]}"#,
            r#"{"type":"Point","coordinates":[null,1]}"#,
            r#"{"type":"Point","coordinates":[1,1,9]}"#,
            r#"{"type":"LineString","coordinates":[[0,0],[1,1]]}"#,
            r#"{"type":"Feature","geometry":null,"properties":{}}"#,
            r#"{"type":"FeatureCollection","features":[{"type":"Point","coordinates":[1,2]}]}"#,
        ] {
            assert!(inspect_geojson(invalid.as_bytes()).is_err(), "{invalid}");
        }
        assert!(inspect_geojson(&vec![b' '; MAX_GEOJSON_BYTES + 1]).is_err());
    }

    #[test]
    fn feature_collection_counts_and_bounds_are_reproducible() {
        let payload = json!({"type":"FeatureCollection","features":[
            waypoint("East", Point::new(40.0,-70.0).unwrap()).unwrap(),
            waypoint("West", Point::new(41.0,-72.0).unwrap()).unwrap()
        ]});
        let summary = inspect_geojson(payload.to_string().as_bytes()).unwrap();
        assert_eq!(summary.features, 2);
        assert_eq!(summary.bbox, [-72.0, 40.0, -70.0, 41.0]);
        assert_eq!(summary.coordinate_order, "longitude,latitude");
    }

    #[test]
    fn geojson_export_escapes_untrusted_waypoint_text() {
        let p = Point::new(10.0, 20.0).unwrap();
        let feature = waypoint(r#"<script>&"hello"#, p).unwrap();
        let encoded = feature.to_string();
        let reparsed: Value = serde_json::from_str(&encoded).unwrap();
        assert_eq!(reparsed["properties"]["name"], r#"<script>&"hello"#);
        assert_eq!(inspect_geojson(encoded.as_bytes()).unwrap().features, 1);
    }
}
