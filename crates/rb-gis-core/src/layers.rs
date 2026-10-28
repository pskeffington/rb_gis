//! Operator-selected local layers and bounded offline manifest ingestion.
//! No web requests, implicit location sampling, or persistent tracking.
use crate::geojson::{parse_geojson, Geometry, Layer, MAX_BYTES, MAX_FEATURES};
use crate::Coordinate;
use serde_json::Value;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Component, Path};

pub const MAX_LAYERS: usize = 12;
pub const MAX_PACKAGE_MANIFEST_BYTES: u64 = 64 * 1024;
pub const MAX_PACKAGE_VERTICES: usize = 120_000;
pub const MAX_PACKAGE_FEATURES: usize = 8_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LayerKind { Roads, Water, Boundary, Landmarks, Other }
impl LayerKind {
    pub const ALL: [Self; 5] = [Self::Roads, Self::Water, Self::Boundary, Self::Landmarks, Self::Other];
    pub fn label(self) -> &'static str {
        match self {
            Self::Roads => "Roads", Self::Water => "Water",
            Self::Boundary => "Boundaries", Self::Landmarks => "Landmarks",
            Self::Other => "Other",
        }
    }
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "roads" => Ok(Self::Roads), "water" => Ok(Self::Water),
            "boundary" => Ok(Self::Boundary), "landmarks" => Ok(Self::Landmarks),
            "other" => Ok(Self::Other),
            _ => Err(format!("Unsupported layer role: {value}"))
        }
    }
}
#[derive(Debug, Clone)]
pub struct Provenance {
    /// A declaration supplied by the imported file/manifest or operator,
    /// not an independently verified governmental source claim.
    pub declared_source: String,
    pub vintage: String,
    pub attribution: String,
}
impl Provenance {
    pub fn unverified(source: &str, vintage: &str, attribution: &str) -> Result<Self, String> {
        Ok(Self {
            declared_source: checked_text(source, 120)?,
            vintage: checked_optional_text(vintage, 40)?,
            attribution: checked_text(attribution, 200)?,
        })
    }
}
#[derive(Debug, Clone)]
pub struct MapLayer {
    pub name: String,
    pub kind: LayerKind,
    pub visible: bool,
    pub content: Layer,
    pub provenance: Provenance,
    pub filename: String,
}
impl MapLayer {
    pub fn vertices(&self) -> usize {
        self.content.features.iter().map(|f|match &f.geometry {
            Geometry::Point(_) => 1,
            Geometry::Line(path) => path.len(),
            Geometry::Polygon(rings) => rings.iter().map(Vec::len).sum(),
        }).sum()
    }
    pub fn points(&self) -> impl Iterator<Item = Coordinate> + '_ {
        self.content.features.iter().flat_map(|f| {
            let coords: Vec<Coordinate> = match &f.geometry {
                Geometry::Point(p) => vec![*p],
                Geometry::Line(path) => path.clone(),
                Geometry::Polygon(rings) => rings.iter().flatten().copied().collect(),
            };
            coords
        })
    }
}
fn checked_text(s: &str, limit: usize) -> Result<String, String> {
    let s = s.trim();
    if s.is_empty() || s.chars().count() > limit || s.chars().any(char::is_control) {
        Err("Invalid layer/source metadata".into())
    } else {
        Ok(s.to_string())
    }
}
fn checked_optional_text(s: &str, limit: usize) -> Result<String, String> {
    if s.trim().is_empty() { Ok("Unspecified".into()) } else { checked_text(s, limit) }
}
fn limited_read(path: &Path, cap: u64) -> Result<Vec<u8>, String> {
    let meta = fs::metadata(path).map_err(|e| format!("Cannot inspect file: {e}"))?;
    if !meta.is_file() || meta.len() == 0 || meta.len() > cap {
        return Err("Empty or oversized file".into());
    }
    let mut bytes = Vec::with_capacity(meta.len() as usize);
    File::open(path).map_err(|e| format!("Cannot open file: {e}"))?
        .take(cap + 1).read_to_end(&mut bytes)
        .map_err(|e| format!("Cannot read file: {e}"))?;
    if bytes.is_empty() || bytes.len() as u64 > cap { return Err("File exceeds size limit".into()); }
    Ok(bytes)
}
pub fn local_geojson(path: &Path, kind: LayerKind, source: Provenance) -> Result<MapLayer, String> {
    let bytes = limited_read(path, MAX_BYTES as u64)?;
    let content = parse_geojson(&bytes)?;
    if content.features.len() > MAX_FEATURES { return Err("Feature budget exceeded".into()); }
    let filename = path.file_name().and_then(|n| n.to_str())
        .ok_or("Invalid local filename")?.to_string();
    let name = checked_text(&filename, 120)?;
    Ok(MapLayer { name, kind, visible: true, content, provenance: source, filename })
}
fn required_str<'a>(item: &'a Value, field: &str) -> Result<&'a str, String> {
    item.get(field).and_then(Value::as_str)
        .ok_or_else(|| format!("Missing manifest field: {field}"))
}
fn safe_filename(s: &str) -> Result<(), String> {
    let p = Path::new(s);
    if s.len() > 128 || s.is_empty() ||
        !s.as_bytes()[0].is_ascii_alphanumeric() ||
        !s.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-')) ||
        p.components().count() != 1 ||
        !matches!(p.components().next(), Some(Component::Normal(_))) ||
        p.extension().and_then(|v| v.to_str()).is_none_or(|v| !v.eq_ignore_ascii_case("geojson")) {
        return Err("Manifest layer paths must be simple .geojson filenames".into());
    }
    Ok(())
}
/// An atomic *read* of a local directory package: on any failed entry no
/// partial layer vector is returned. The GUI swaps only after success.
/// Schema: {"schema":"rb-gis-package/v1","layers":[
/// {"file":"roads.geojson","name":"Roads","role":"roads",
///  "source":"Declared provider","vintage":"2025","attribution":"Source notice"}]}
pub fn load_manifest(path: &Path) -> Result<Vec<MapLayer>, String> {
    let manifest = limited_read(path, MAX_PACKAGE_MANIFEST_BYTES)?;
    let root: Value = serde_json::from_slice(&manifest)
        .map_err(|_| "Invalid package manifest JSON")?;
    if root.get("schema").and_then(Value::as_str) != Some("rb-gis-package/v1") {
        return Err("Unsupported package schema".into());
    }
    let list = root.get("layers").and_then(Value::as_array)
        .ok_or("Package requires a layers array")?;
    if list.is_empty() || list.len() > MAX_LAYERS { return Err("Package layer count out of bounds".into()); }
    let parent = path.parent().ok_or("Manifest has no parent directory")?
        .canonicalize().map_err(|_| "Cannot resolve manifest directory")?;
    let mut output = Vec::with_capacity(list.len());
    let mut total_features = 0usize;
    let mut total_vertices = 0usize;
    let mut names = std::collections::HashSet::new();
    for entry in list {
        let file = required_str(entry, "file")?;
        safe_filename(file)?;
        if !names.insert(file.to_ascii_lowercase()) {
            return Err("Duplicate package layer filename".into());
        }
        let name = checked_text(required_str(entry, "name")?, 120)?;
        let kind = LayerKind::parse(required_str(entry, "role")?)?;
        let source = Provenance::unverified(
            required_str(entry, "source")?,
            entry.get("vintage").and_then(Value::as_str).unwrap_or("Unspecified"),
            required_str(entry, "attribution")?
        )?;
        let target = parent.join(file).canonicalize().map_err(|_| "Missing package layer")?;
        if target.parent() != Some(parent.as_path()) {
            return Err("Package layer path escapes manifest directory".into());
        }
        let mut layer = local_geojson(&target, kind, source)?;
        layer.name = name;
        layer.filename = file.to_string();
        total_features += layer.content.features.len();
        total_vertices += layer.vertices();
        if total_features > MAX_PACKAGE_FEATURES || total_vertices > MAX_PACKAGE_VERTICES {
            return Err("Package exceeds aggregate geometry limits".into());
        }
        output.push(layer);
    }
    Ok(output)
}
pub fn visible_coordinates(layers: &[MapLayer]) -> Vec<Coordinate> {
    layers.iter().filter(|l| l.visible).flat_map(|layer| layer.points()).collect()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn roles_and_metadata_are_explicit() {
        assert!(LayerKind::parse("roads").is_ok());
        assert!(LayerKind::parse("tiger-roads").is_err());
        assert!(Provenance::unverified("County","2025","US Census, declared").is_ok());
        assert!(Provenance::unverified("","2025","A").is_err());
        assert!(safe_filename("../roads.geojson").is_err());
        assert!(safe_filename("roads.geojson").is_ok());
        assert!(safe_filename("sub/roads.geojson").is_err());
        assert!(safe_filename("with space.geojson").is_err());
        assert!(safe_filename(".hidden.geojson").is_err());
    }
    #[test] fn package_fixture_loads_real_geometry_types_without_network() {
        let manifest = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/synthetic-package/manifest.json");
        let layers = load_manifest(&manifest).unwrap();
        assert_eq!(layers.len(), 4);
        assert_eq!(layers[0].kind, LayerKind::Roads);
        assert_eq!(layers[1].kind, LayerKind::Water);
        assert_eq!(layers[2].kind, LayerKind::Boundary);
        assert_eq!(layers[3].kind, LayerKind::Landmarks);
        assert!(layers.iter().all(|l|l.visible));
        assert!(layers.iter().all(|l|l.vertices()>0));
        assert!(layers.iter().all(|l| l.provenance.declared_source.contains("Synthetic")));
        let mut toggled = layers.clone();
        toggled[0].visible = false;
        assert!(visible_coordinates(&toggled).len() < visible_coordinates(&layers).len());
    }
    #[test] fn rejects_invalid_schema_without_loading_layers() {
        let file = std::env::temp_dir().join(format!("rb_gis_bad_manifest_{}.json", std::process::id()));
        std::fs::write(&file, br#"{"schema":"wrong","layers":[]}"#).unwrap();
        assert!(load_manifest(&file).is_err());
        std::fs::remove_file(file).unwrap();
    }
}
