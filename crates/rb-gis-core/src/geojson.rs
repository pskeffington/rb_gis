//! Bounded RFC 7946 geometry loader. No I/O or network.
use crate::Coordinate;
use serde_json::Value;

pub const MAX_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_FEATURES: usize = 2_000;
pub const MAX_VERTICES: usize = 30_000;

#[derive(Debug, Clone, PartialEq)]
pub enum Geometry {
    Point(Coordinate),
    Line(Vec<Coordinate>),
    Polygon(Vec<Vec<Coordinate>>),
}
#[derive(Debug, Clone, PartialEq)]
pub struct Feature { pub label: Option<String>, pub geometry: Geometry }
#[derive(Debug, Clone, PartialEq)]
pub struct Layer { pub features: Vec<Feature> }
fn err() -> String { "Unsupported or invalid bounded GeoJSON".into() }
fn position(v:&Value, count:&mut usize)->Result<Coordinate,String> {
    let a=v.as_array().ok_or_else(err)?;
    if a.len()<2 || a.len()>3 { return Err(err()); }
    let lon=a[0].as_f64().ok_or_else(err)?;
    let lat=a[1].as_f64().ok_or_else(err)?;
    if a.len()==3 && !a[2].as_f64().is_some_and(f64::is_finite) { return Err(err()); }
    *count+=1;
    if *count>MAX_VERTICES { return Err(err()); }
    Coordinate::new(lat,lon).map_err(|_|err())
}
fn line(v:&Value, count:&mut usize, minimum:usize)->Result<Vec<Coordinate>,String>{
    let a=v.as_array().ok_or_else(err)?;
    if a.len()<minimum || a.len()>MAX_VERTICES {return Err(err());}
    a.iter().map(|p|position(p,count)).collect()
}
fn polygon(v:&Value,count:&mut usize)->Result<Vec<Vec<Coordinate>>,String>{
    let rings=v.as_array().ok_or_else(err)?;
    if rings.is_empty() || rings.len()>MAX_VERTICES {return Err(err());}
    let mut result=Vec::new();
    for r in rings {
        let path=line(r,count,4)?;
        if path.first()!=path.last(){return Err(err());}
        result.push(path);
    }
    Ok(result)
}
fn geometry(v:&Value,count:&mut usize)->Result<Vec<Geometry>,String>{
    let typ=v.get("type").and_then(Value::as_str).ok_or_else(err)?;
    let coords=v.get("coordinates").ok_or_else(err)?;
    match typ {
        "Point"=>Ok(vec![Geometry::Point(position(coords,count)?)]),
        "LineString"=>Ok(vec![Geometry::Line(line(coords,count,2)?)]),
        "Polygon"=>Ok(vec![Geometry::Polygon(polygon(coords,count)?)]),
        "MultiPoint"=>Ok(line(coords,count,1)?.into_iter().map(Geometry::Point).collect()),
        "MultiLineString"=>{
            let seq=coords.as_array().ok_or_else(err)?;
            if seq.is_empty() || seq.len()>MAX_FEATURES { return Err(err());}
            seq.iter().map(|x|line(x,count,2).map(Geometry::Line)).collect()
        },
        "MultiPolygon"=>{
            let seq=coords.as_array().ok_or_else(err)?;
            if seq.is_empty() || seq.len()>MAX_FEATURES {return Err(err());}
            seq.iter().map(|x|polygon(x,count).map(Geometry::Polygon)).collect()
        },
        _=>Err(err())
    }
}
pub fn parse_geojson(bytes:&[u8])->Result<Layer,String>{
    if bytes.is_empty() || bytes.len()>MAX_BYTES {return Err(err());}
    let root:Value=serde_json::from_slice(bytes).map_err(|_|err())?;
    if root.get("crs").is_some(){return Err(err());}
    let mut count=0;
    let raw:Vec<&Value>=match root.get("type").and_then(Value::as_str) {
        Some("FeatureCollection")=>root.get("features").and_then(Value::as_array)
            .ok_or_else(err)?.iter().collect(),
        Some("Feature")=>vec![&root],
        _=>return Err(err())
    };
    if raw.is_empty() || raw.len()>MAX_FEATURES {return Err(err());}
    let mut features=Vec::new();
    for item in raw {
        if item.get("type").and_then(Value::as_str)!=Some("Feature"){return Err(err());}
        let v=item.get("geometry").ok_or_else(err)?;
        let label=item.get("properties").and_then(|p|p.get("name")).and_then(Value::as_str)
            .filter(|s|s.chars().count()<=64 && !s.chars().any(char::is_control)).map(str::to_string);
        for g in geometry(v,&mut count)? {
            if features.len()>=MAX_FEATURES {return Err(err());}
            features.push(Feature{label:label.clone(),geometry:g});
        }
    }
    Ok(Layer{features})
}
#[cfg(test)]
mod tests {
 use super::*;
 #[test] fn accepts_real_types(){
    let s=br#"{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[-70.75,42]},"properties":{"name":"Waypoint"}},{"type":"Feature","geometry":{"type":"LineString","coordinates":[[0,0],[1,1]]},"properties":{}}]}"#;
    let l=parse_geojson(s).unwrap();
    assert_eq!(l.features.len(),2);
    assert_eq!(l.features[0].label.as_deref(),Some("Waypoint"));
 }
 #[test] fn rejects_invalid_and_unclosed(){
    assert!(parse_geojson(br#"{"type":"Feature","geometry":{"type":"Point","coordinates":[0,91]}}"#).is_err());
    assert!(parse_geojson(br#"{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,1]]]}}"#).is_err());
    assert!(parse_geojson(&vec![b' ';MAX_BYTES+1]).is_err());
 }
}
