//! Independent RB_GIS operator window. No Pip Boy process or location access.
use eframe::egui::{self, Color32, Pos2, Stroke};
use rb_gis_core::{Coordinate, viewport::Viewport, geojson::{parse_geojson, Geometry, Layer}};
use std::path::PathBuf;

struct MapApp { view: Viewport, show_grid: bool, message: String, lat: String, lon: String, file: String, layer: Option<Layer> }
impl Default for MapApp {
 fn default()->Self {
  let center=Coordinate::new(0.0,0.0).expect("valid grid reference");
  Self {view:Viewport::new(center,2.0).expect("valid zoom"), show_grid:true, message:"REFERENCE GRID ONLY — NO GPS FIX".into(), lat:String::new(), lon:String::new(), file:String::new(), layer:None}
 }
}
impl eframe::App for MapApp {
 fn update(&mut self,ctx:&egui::Context,_frame:&mut eframe::Frame) {
  egui::TopBottomPanel::top("toolbar").show(ctx,|ui|{
   ui.horizontal_wrapped(|ui|{
    ui.strong("RB_GIS");
    if ui.button("−").clicked(){self.view.zoom=(self.view.zoom-1.0).max(0.0);}
    if ui.button("+").clicked(){self.view.zoom=(self.view.zoom+1.0).min(19.0);}
    ui.checkbox(&mut self.show_grid,"Grid");
    if ui.button("Fit layer").clicked() {
      if let Some(layer)=&self.layer {
        let mut points=Vec::new();
        for feature in &layer.features {
          match &feature.geometry {
            Geometry::Point(p)=>points.push(*p),
            Geometry::Line(line)=>points.extend(line.iter().copied()),
            Geometry::Polygon(rings)=>for ring in rings {points.extend(ring.iter().copied());},
          }
        }
        match Viewport::fit_points(&points,480.0,240.0,24.0) {
          Ok(view)=>{self.view=view;self.message="FITTED LOCAL LAYER — NO GPS".into();}
          Err(_)=>self.message="FIT FAILED: NO VALID GEOMETRY".into(),
        }
      } else {self.message="NO LAYER LOADED".into();}
    }
    if ui.button("Reset").clicked(){*self=Self::default();}
   });
   ui.horizontal_wrapped(|ui|{
    ui.label("GeoJSON");ui.add(egui::TextEdit::singleline(&mut self.file).desired_width(150.0));
    if ui.button("Open local file").clicked(){
      let path=PathBuf::from(&self.file);
      let result=std::fs::metadata(&path).map_err(|e|e.to_string()).and_then(|m|{
        if m.len()>rb_gis_core::geojson::MAX_BYTES as u64 {return Err("File too large".into());}
        std::fs::read(&path).map_err(|e|e.to_string())
      }).and_then(|data|parse_geojson(&data));
      match result {Ok(layer)=>{self.message=format!("LOADED {} FEATURES",layer.features.len());self.layer=Some(layer);},Err(e)=>self.message=format!("IMPORT FAILED: {e}")}
    }
   });
   ui.horizontal_wrapped(|ui|{
    ui.label("Lat");ui.add(egui::TextEdit::singleline(&mut self.lat).desired_width(80.0));
    ui.label("Lon");ui.add(egui::TextEdit::singleline(&mut self.lon).desired_width(80.0));
    if ui.button("Manual center").clicked(){
      let p=self.lat.parse::<f64>().ok().zip(self.lon.parse::<f64>().ok())
         .and_then(|(a,b)|Coordinate::new(a,b).ok());
      if let Some(p)=p {self.view.center=p;self.message="MANUAL CENTER — NOT GPS".into();}
      else {self.message="INVALID COORDINATES".into();}
    }
   });
  });
  egui::TopBottomPanel::bottom("status").show(ctx,|ui|{
   ui.label(format!("{} | {:.5}, {:.5} | z{:.1} | OFFLINE",self.message,self.view.center.latitude,self.view.center.longitude,self.view.zoom));
  });
  egui::CentralPanel::default().show(ctx,|ui|{
   let size=ui.available_size();
   let (rect,response)=ui.allocate_exact_size(size,egui::Sense::drag());
   let painter=ui.painter_at(rect);
   painter.rect_filled(rect,0.0,Color32::from_rgb(11,20,17));
   let center=rect.center();
   if self.show_grid {
     let grid=Color32::from_rgb(39,79,64);
     for lat in (-80..=80).step_by(20) {
       let mut points=Vec::new();
       for lon in (-180..=180).step_by(2) {
         let p=Coordinate::new(lat as f64,lon as f64).expect("grid coordinate");
         let (x,y)=self.view.screen(p,size.x as f64,size.y as f64);
         points.push(Pos2::new(rect.min.x+x as f32,rect.min.y+y as f32));
       }
       for pair in points.windows(2) {
         if (pair[1].x-pair[0].x).abs()<size.x/2.0 {painter.line_segment([pair[0],pair[1]],Stroke::new(1.0,grid));}
       }
     }
     for lon in (-180..180).step_by(20) {
       let mut points=Vec::new();
       for lat in (-85..=85).step_by(2) {
         let p=Coordinate::new(lat as f64,lon as f64).expect("grid coordinate");
         let (x,y)=self.view.screen(p,size.x as f64,size.y as f64);
         points.push(Pos2::new(rect.min.x+x as f32,rect.min.y+y as f32));
       }
       for pair in points.windows(2) {painter.line_segment([pair[0],pair[1]],Stroke::new(1.0,grid));}
     }
   }
   if let Some(layer)=&self.layer {
     for feature in &layer.features {
       let to_screen=|p: Coordinate| {let (x,y)=self.view.screen(p,size.x as f64,size.y as f64); Pos2::new(rect.min.x+x as f32,rect.min.y+y as f32)};
       match &feature.geometry {
         Geometry::Point(p)=>{painter.circle_filled(to_screen(*p),3.5,Color32::YELLOW);}
         Geometry::Line(line)=>{for w in line.windows(2) {let a=to_screen(w[0]);let b=to_screen(w[1]);if (a.x-b.x).abs()<size.x/2.0 {painter.line_segment([a,b],Stroke::new(1.5,Color32::LIGHT_GREEN));}}}
         Geometry::Polygon(rings)=>{for ring in rings {for w in ring.windows(2){let a=to_screen(w[0]);let b=to_screen(w[1]);if (a.x-b.x).abs()<size.x/2.0 {painter.line_segment([a,b],Stroke::new(1.5,Color32::from_rgb(200,160,70)));}}}}
       }
     }
   }
   painter.line_segment([Pos2::new(center.x-9.0,center.y),Pos2::new(center.x+9.0,center.y)],Stroke::new(1.5,Color32::LIGHT_GREEN));
   painter.line_segment([Pos2::new(center.x,center.y-9.0),Pos2::new(center.x,center.y+9.0)],Stroke::new(1.5,Color32::LIGHT_GREEN));
   if response.dragged(){let d=ctx.input(|i|i.pointer.delta());self.view.pan_pixels(d.x as f64,d.y as f64);}
   if response.hovered() {
    let scroll=ctx.input(|i|i.raw_scroll_delta.y);
    if scroll.abs()>0.0 {self.view.zoom=(self.view.zoom+(scroll as f64/150.0)).clamp(0.0,19.0);}
   }
  });
 }
}
fn main()->eframe::Result<()> {
 let opts=eframe::NativeOptions{viewport:egui::ViewportBuilder::default().with_inner_size([480.0,320.0]).with_min_inner_size([320.0,240.0]),..Default::default()};
 eframe::run_native("RB_GIS",opts,Box::new(|_cc|Ok(Box::new(MapApp::default()))))
}
