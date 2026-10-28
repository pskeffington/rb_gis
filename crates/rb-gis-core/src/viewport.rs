//! Screen-independent Web Mercator navigation. No network or device access.
use crate::{Coordinate, GeoError};
const MAX_LAT: f64 = 85.051_128_78;
#[derive(Debug, Clone, Copy)]
pub struct Viewport { pub center: Coordinate, pub zoom: f64 }
impl Viewport {
    pub fn new(center: Coordinate, zoom: f64) -> Result<Self, GeoError> {
        if !zoom.is_finite() || !(0.0..=19.0).contains(&zoom) { return Err(GeoError::InvalidCoordinate); }
        Ok(Self { center, zoom })
    }
    fn project(p: Coordinate) -> (f64,f64) {
        let lat=p.latitude.clamp(-MAX_LAT, MAX_LAT).to_radians();
        ((p.longitude+180.0)/360.0, (1.0-(lat.tan().asinh()/std::f64::consts::PI))/2.0)
    }
    pub fn screen(&self, p: Coordinate, width: f64, height: f64) -> (f64,f64) {
        let (x,y)=Self::project(p);
        let (cx,cy)=Self::project(self.center);
        let scale=256.0*2_f64.powf(self.zoom);
        let dx=((x-cx+0.5).rem_euclid(1.0)-0.5)*scale;
        (width/2.0+dx,height/2.0+(y-cy)*scale)
    }

    /// Fit actual coordinates into a viewport with padding. Antimeridian is handled
    /// using the shortest longitude arc, not a naive [-180, 180] bbox.
    pub fn fit_points(points: &[Coordinate], width: f64, height: f64, padding: f64)
        -> Result<Self, GeoError> {
        if points.is_empty() || !width.is_finite() || !height.is_finite()
            || !padding.is_finite() || width <= 2.0 * padding
            || height <= 2.0 * padding || padding < 0.0 {
            return Err(GeoError::InvalidCoordinate);
        }
        let mut xs: Vec<f64> = points.iter().map(|p| Self::project(*p).0).collect();
        xs.sort_by(|a,b| a.total_cmp(b));
        let mut largest_gap = -1.0f64;
        let mut gap_idx = 0usize;
        for i in 0..xs.len() {
            let next = if i+1 == xs.len() { xs[0] + 1.0 } else { xs[i+1] };
            let gap = next - xs[i];
            if gap > largest_gap { largest_gap = gap; gap_idx = i; }
        }
        let begin = xs[(gap_idx+1) % xs.len()];
        let span_x = 1.0 - largest_gap;
        let mid_x = (begin + span_x / 2.0).rem_euclid(1.0);
        let mut min_y = f64::INFINITY;
        let mut max_y = f64::NEG_INFINITY;
        for p in points {
            let y = Self::project(*p).1;
            min_y = min_y.min(y);
            max_y = max_y.max(y);
        }
        let span_y = max_y - min_y;
        let zoom_x = if span_x == 0.0 {19.0} else {
            ((width - 2.0 * padding) / (256.0 * span_x)).log2()
        };
        let zoom_y = if span_y == 0.0 {19.0} else {
            ((height - 2.0 * padding) / (256.0 * span_y)).log2()
        };
        let zoom = zoom_x.min(zoom_y).clamp(0.0,19.0);
        let lat = (std::f64::consts::PI * (1.0 - 2.0 * ((min_y+max_y)/2.0)))
            .sinh().atan().to_degrees();
        let center=Coordinate::new(lat, mid_x*360.0-180.0)?;
        Self::new(center, zoom)
    }
    pub fn pan_pixels(&mut self, dx: f64, dy: f64) {
        if !dx.is_finite() || !dy.is_finite() { return; }
        let (x,y)=Self::project(self.center);
        let scale=256.0*2_f64.powf(self.zoom);
        let nx=(x-dx/scale).rem_euclid(1.0);
        let ny=(y-dy/scale).clamp(0.0,1.0);
        let lat=(std::f64::consts::PI*(1.0-2.0*ny)).sinh().atan().to_degrees();
        let lon=nx*360.0-180.0;
        if let Ok(center)=Coordinate::new(lat,lon) {self.center=center;}
    }
}
#[cfg(test)]
mod tests {
 use super::*;
 #[test] fn center_is_middle() {
  let p=Coordinate::new(42.0,-70.75).unwrap();
  let v=Viewport::new(p,6.0).unwrap();
  assert_eq!(v.screen(p,480.0,320.0),(240.0,160.0));
 }
 #[test] fn dateline_is_wrapped() {
  let a=Coordinate::new(0.0,179.9).unwrap();
  let b=Coordinate::new(0.0,-179.9).unwrap();
  let v=Viewport::new(a,4.0).unwrap();
  assert!((v.screen(b,480.0,320.0).0-240.0).abs()<5.0);
 }
 #[test] fn fit_dateline_short_arc() {
  let a=Coordinate::new(10.0,179.9).unwrap();
  let b=Coordinate::new(10.0,-179.9).unwrap();
  let v=Viewport::fit_points(&[a,b],480.0,320.0,20.0).unwrap();
  assert!(v.zoom>5.0);
  assert!((v.screen(a,480.0,320.0).0-v.screen(b,480.0,320.0).0).abs()<440.0);
 }
 #[test] fn fit_rejects_empty_and_invalid_canvas() {
  assert!(Viewport::fit_points(&[],480.0,320.0,20.0).is_err());
  let p=Coordinate::new(0.0,0.0).unwrap();
  assert!(Viewport::fit_points(&[p],20.0,20.0,20.0).is_err());
 }
 #[test] fn pan_is_finite_at_pole() {
  let mut v=Viewport::new(Coordinate::new(85.0,0.0).unwrap(),1.0).unwrap();
  v.pan_pixels(0.0,-100000.0);
  assert!(v.center.latitude.is_finite());
 }
}
