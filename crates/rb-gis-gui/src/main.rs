//! Standalone field GIS GUI. No Pip Boy runtime, automatic network access or GPS tracking.
mod map_view;

use eframe::egui;
use rb_gis_core::layers::{
    load_manifest, local_geojson, visible_coordinates, LayerKind, MapLayer, Provenance, MAX_LAYERS,
    MAX_PACKAGE_VERTICES,
};
use rb_gis_core::{viewport::Viewport, Coordinate};
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Page {
    Map,
    Layers,
    Sources,
    Gps,
    Settings,
}

struct MapApp {
    page: Page,
    view: Viewport,
    map_size: egui::Vec2,
    layers: Vec<MapLayer>,
    pending_fit: bool,
    show_grid: bool,
    show_labels: bool,
    status: String,
    geojson_path: String,
    manifest_path: String,
    selected_kind: LayerKind,
    declared_source: String,
    vintage: String,
    attribution: String,
    lat: String,
    lon: String,
    manual_center: bool,
}
impl Default for MapApp {
    fn default() -> Self {
        let center = Coordinate::new(0.0, 0.0).expect("reference coordinate");
        Self {
            page: Page::Map,
            view: Viewport::new(center, 2.0).expect("reference zoom"),
            map_size: egui::vec2(480.0, 240.0),
            layers: Vec::new(),
            pending_fit: false,
            show_grid: true,
            show_labels: true,
            status: "CENTER UNSET / GRID ONLY".to_string(),
            geojson_path: String::new(),
            manifest_path: String::new(),
            selected_kind: LayerKind::Other,
            declared_source: "Operator-supplied local file".to_string(),
            vintage: "Unspecified".to_string(),
            attribution: "Source license not independently verified".to_string(),
            lat: String::new(),
            lon: String::new(),
            manual_center: false,
        }
    }
}
impl MapApp {
    fn fit_visible(&mut self) {
        let points = visible_coordinates(&self.layers);
        match Viewport::fit_points(
            &points,
            self.map_size.x as f64,
            self.map_size.y as f64,
            18.0,
        ) {
            Ok(view) => {
                self.view = view;
                self.status = format!(
                    "FITTED {} VISIBLE LAYER(S) / NO GPS",
                    self.layers.iter().filter(|l| l.visible).count()
                );
            }
            Err(_) => self.status = "NO VISIBLE GEOMETRY TO FIT".into(),
        }
    }
    fn import_geojson(&mut self, path: &Path) {
        let source =
            Provenance::unverified(&self.declared_source, &self.vintage, &self.attribution);
        let result = source.and_then(|p| local_geojson(path, self.selected_kind, p));
        match result {
            Ok(layer) => {
                let old = self
                    .layers
                    .iter()
                    .position(|l| l.filename == layer.filename && l.kind == layer.kind);
                if old.is_none() && self.layers.len() >= MAX_LAYERS {
                    self.status = "LAYER LIMIT REACHED".into();
                    return;
                }
                let total: usize = self
                    .layers
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| Some(*i) != old)
                    .map(|(_, l)| l.vertices())
                    .sum::<usize>()
                    + layer.vertices();
                if total > MAX_PACKAGE_VERTICES {
                    self.status = "TOTAL VERTEX BUDGET EXCEEDED / OLD MAP KEPT".into();
                    return;
                }
                let name = layer.name.clone();
                if let Some(i) = old {
                    self.layers[i] = layer;
                } else {
                    self.layers.push(layer);
                }
                self.status = format!("LOCAL LAYER LOADED: {name} / SOURCE UNVERIFIED");
                self.page = Page::Map;
                self.pending_fit = true;
            }
            Err(e) => self.status = format!("IMPORT REJECTED / OLD MAP KEPT: {e}"),
        }
    }
    fn import_package(&mut self, path: &Path) {
        match load_manifest(path) {
            Ok(layers) => {
                let count = layers.len();
                // The old map stays intact until every package layer is valid.
                self.layers = layers;
                self.status = format!("{count} LOCAL PACKAGE LAYER(S) / PROVENANCE DECLARED");
                self.page = Page::Map;
                self.pending_fit = true;
            }
            Err(e) => self.status = format!("PACKAGE REJECTED / OLD MAP KEPT: {e}"),
        }
    }
    fn dropped_files(&mut self, ctx: &egui::Context) {
        let files = ctx.input(|input| input.raw.dropped_files.clone());
        for file in files {
            let Some(path) = file.path else {
                self.status = "DROP REJECTED: LOCAL FILE PATH REQUIRED".into();
                continue;
            };
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            match ext.as_str() {
                "geojson" => self.import_geojson(&path),
                "json" => self.import_package(&path),
                _ => self.status = "DROP .geojson OR PACKAGE .json MANIFEST".into(),
            }
        }
    }
    fn navigation(&mut self, ctx: &egui::Context) {
        egui::TopBottomPanel::top("navigation").show(ctx, |ui| {
            ui.horizontal_wrapped(|ui| {
                ui.strong("RB_GIS");
                ui.separator();
                ui.selectable_value(&mut self.page, Page::Map, "MAP");
                ui.selectable_value(&mut self.page, Page::Layers, "LYR");
                ui.selectable_value(&mut self.page, Page::Sources, "SRC");
                ui.selectable_value(&mut self.page, Page::Gps, "GPS");
                ui.selectable_value(&mut self.page, Page::Settings, "SET");
            });
        });
    }
    fn map_page(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            if ui.small_button("-").clicked() {
                self.view.zoom = (self.view.zoom - 1.0).max(0.0);
            }
            if ui.small_button("+").clicked() {
                self.view.zoom = (self.view.zoom + 1.0).min(19.0);
            }
            if ui.small_button("FIT").clicked() {
                self.pending_fit = true;
            }
            if ui.small_button("GRID").clicked() {
                self.show_grid = !self.show_grid;
            }
            if ui.small_button("LAYERS").clicked() {
                self.page = Page::Layers;
            }
        });
        self.map_size = ui.available_size();
        if self.pending_fit {
            self.pending_fit = false;
            self.fit_visible();
        }
        map_view::paint(
            ui,
            &mut self.view,
            &self.layers,
            self.show_grid,
            self.show_labels,
        );
    }
    fn layers_page(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            ui.heading("LAYERS");
            if ui.button("Fit visible").clicked() {
                self.pending_fit = true;
                self.page = Page::Map;
            }
            if ui.button("Clear").clicked() {
                self.layers.clear();
                self.status = "LOCAL LAYERS CLEARED / NO GPS".into();
            }
        });
        ui.label("Toggle display only; the map files are not modified.");
        let mut remove = None;
        let mut fit = None;
        egui::ScrollArea::vertical().show(ui, |ui| {
            if self.layers.is_empty() {
                ui.label("No local map sources. Open SRC to import.");
            }
            for (i, layer) in self.layers.iter_mut().enumerate() {
                ui.horizontal(|ui| {
                    ui.checkbox(&mut layer.visible, "");
                    ui.label(format!(
                        "{} / {} ({})",
                        layer.kind.label(),
                        layer.name,
                        layer.content.features.len()
                    ));
                    if ui.small_button("FIT").clicked() {
                        fit = Some(i);
                    }
                    if ui.small_button("X").clicked() {
                        remove = Some(i);
                    }
                });
                ui.small(format!(
                    "Declared: {} | {} | {}",
                    layer.provenance.declared_source,
                    layer.provenance.vintage,
                    layer.provenance.attribution
                ));
                ui.separator();
            }
        });
        if let Some(i) = fit {
            let coords: Vec<_> = self.layers[i].points().collect();
            match Viewport::fit_points(
                &coords,
                self.map_size.x as f64,
                self.map_size.y as f64,
                18.0,
            ) {
                Ok(view) => {
                    self.view = view;
                    self.page = Page::Map;
                    self.status = "FITTED SELECTED LAYER / NOT GPS".into();
                }
                Err(_) => self.status = "LAYER FIT FAILED".into(),
            }
        }
        if let Some(i) = remove {
            let name = self.layers.remove(i).name;
            self.status = format!("REMOVED IN-MEMORY LAYER: {name}");
        }
    }
    fn sources_page(&mut self, ui: &mut egui::Ui) {
        egui::ScrollArea::vertical().show(ui, |ui| {
            ui.heading("LOCAL MAP SOURCES");
            ui.label("Load real GeoJSON or a local RB_GIS package manifest.");
            ui.label("Drag a .geojson or package .json onto the window, or enter its path.");
            ui.separator();
            ui.horizontal(|ui| {
                ui.label("GeoJSON");
                ui.add(egui::TextEdit::singleline(&mut self.geojson_path).desired_width(230.0));
            });
            ui.horizontal(|ui| {
                ui.label("Role");
                egui::ComboBox::from_id_salt("layer_role")
                    .selected_text(self.selected_kind.label())
                    .show_ui(ui, |ui| {
                        for role in LayerKind::ALL {
                            ui.selectable_value(&mut self.selected_kind, role, role.label());
                        }
                    });
                if ui.button("IMPORT LAYER").clicked() {
                    let path = PathBuf::from(self.geojson_path.trim());
                    self.import_geojson(&path);
                }
            });
            ui.horizontal(|ui| {
                ui.label("Source");
                ui.add(egui::TextEdit::singleline(&mut self.declared_source).desired_width(230.0));
            });
            ui.horizontal(|ui| {
                ui.label("Vintage");
                ui.add(egui::TextEdit::singleline(&mut self.vintage).desired_width(120.0));
            });
            ui.horizontal(|ui| {
                ui.label("Credit");
                ui.add(egui::TextEdit::singleline(&mut self.attribution).desired_width(230.0));
            });
            ui.separator();
            ui.horizontal(|ui| {
                ui.label("Package");
                ui.add(egui::TextEdit::singleline(&mut self.manifest_path).desired_width(210.0));
                if ui.button("OPEN").clicked() {
                    let path = PathBuf::from(self.manifest_path.trim());
                    self.import_package(&path);
                }
            });
            ui.label("Package import is atomic: failed replacement keeps prior geometry.");
            ui.label("Source declarations are displayed as supplied, not verified.");
        });
    }
    fn gps_page(&mut self, ui: &mut egui::Ui) {
        ui.heading("POSITION / NO LIVE GPS");
        ui.label("GNSS receiver integration is not enabled in this build.");
        ui.label("Manual center does not represent a GPS fix.");
        ui.horizontal(|ui| {
            ui.label("LAT");
            ui.add(egui::TextEdit::singleline(&mut self.lat).desired_width(95.0));
            ui.label("LON");
            ui.add(egui::TextEdit::singleline(&mut self.lon).desired_width(95.0));
        });
        if ui.button("SET MANUAL CENTER").clicked() {
            let point = self
                .lat
                .trim()
                .parse::<f64>()
                .ok()
                .zip(self.lon.trim().parse::<f64>().ok())
                .and_then(|(lat, lon)| Coordinate::new(lat, lon).ok());
            match point {
                Some(point) => {
                    self.view.center = point;
                    self.manual_center = true;
                    self.status = "MANUAL CENTER SET / NOT A GPS READING".into();
                    self.page = Page::Map;
                }
                None => self.status = "INVALID MANUAL WGS84 POSITION".into(),
            }
        }
        ui.label("Live GPS permission, accuracy, age and follow mode: future M3 gate.");
    }
    fn settings_page(&mut self, ui: &mut egui::Ui) {
        ui.heading("RB_GIS SETTINGS");
        ui.checkbox(&mut self.show_grid, "Reference grid");
        ui.checkbox(&mut self.show_labels, "Feature labels (limited)");
        ui.label("Offline operation: enforced. Network calls: none.");
        ui.label("Position history: not collected or persisted.");
        ui.label("Window target: 480x320; minimum 320x240.");
        ui.label("Input: local GeoJSON or RB_GIS manifest.");
        if ui.button("RESET VIEW (KEEP SOURCES)").clicked() {
            let center = Coordinate::new(0.0, 0.0).expect("reference grid coordinate");
            self.view = Viewport::new(center, 2.0).expect("reference zoom");
            self.manual_center = false;
            self.status = "VIEW RESET / LOCAL LAYERS PRESERVED".into();
            self.page = Page::Map;
        }
    }
}
impl eframe::App for MapApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.dropped_files(ctx);
        self.navigation(ctx);
        egui::TopBottomPanel::bottom("operator_status").show(ctx, |ui| {
            let compact: String = self.status.chars().take(27).collect();
            ui.horizontal(|ui| {
                ui.label(compact).on_hover_text(&self.status);
                ui.separator();
                ui.label(format!("{}L z{:.1} OFF", self.layers.len(), self.view.zoom))
                    .on_hover_text(format!(
                        "{} center: {:.5}, {:.5} / No live GPS",
                        if self.manual_center {
                            "Manual"
                        } else {
                            "Unlocated"
                        },
                        self.view.center.latitude,
                        self.view.center.longitude
                    ));
            });
        });
        egui::CentralPanel::default().show(ctx, |ui| match self.page {
            Page::Map => self.map_page(ui),
            Page::Layers => self.layers_page(ui),
            Page::Sources => self.sources_page(ui),
            Page::Gps => self.gps_page(ui),
            Page::Settings => self.settings_page(ui),
        });
    }
}
fn main() -> eframe::Result<()> {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([480.0, 320.0])
            .with_min_inner_size([320.0, 240.0]),
        ..Default::default()
    };
    eframe::run_native(
        "RB_GIS / Standalone",
        options,
        Box::new(|_| Ok(Box::new(MapApp::default()))),
    )
}
