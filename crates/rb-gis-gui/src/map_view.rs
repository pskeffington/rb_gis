//! Native map painter: data stays in Rust and no browser/Pip Boy runtime is used.
use eframe::egui::{self, Align2, Color32, FontId, Pos2, Stroke};
use rb_gis_core::geojson::Geometry;
use rb_gis_core::layers::{LayerKind, MapLayer};
use rb_gis_core::{viewport::Viewport, Coordinate};

fn palette(kind: LayerKind) -> (Color32, f32) {
    match kind {
        LayerKind::Roads => (Color32::from_rgb(164, 215, 165), 1.3),
        LayerKind::Water => (Color32::from_rgb(106, 181, 202), 1.6),
        LayerKind::Boundary => (Color32::from_rgb(242, 203, 122), 2.0),
        LayerKind::Landmarks => (Color32::from_rgb(235, 221, 120), 1.5),
        LayerKind::Other => (Color32::from_rgb(184, 193, 174), 1.2),
    }
}
fn grid(painter: &egui::Painter, rect: egui::Rect, view: &Viewport) {
    let ink = Color32::from_rgb(34, 60, 50);
    for latitude in (-80..=80).step_by(20) {
        let mut last: Option<Pos2> = None;
        for longitude in (-180..=180).step_by(4) {
            let p = Coordinate::new(latitude as f64, longitude as f64).expect("grid values");
            let (x, y) = view.screen(p, rect.width() as f64, rect.height() as f64);
            let next = rect.min + egui::vec2(x as f32, y as f32);
            if let Some(prev) = last {
                if (next.x - prev.x).abs() <= rect.width() / 2.0 {
                    painter.line_segment([prev, next], Stroke::new(0.7_f32, ink));
                }
            }
            last = Some(next);
        }
    }
    for longitude in (-180..180).step_by(20) {
        let mut last: Option<Pos2> = None;
        for latitude in (-84..=84).step_by(4) {
            let p = Coordinate::new(latitude as f64, longitude as f64).expect("grid values");
            let (x, y) = view.screen(p, rect.width() as f64, rect.height() as f64);
            let next = rect.min + egui::vec2(x as f32, y as f32);
            if let Some(prev) = last {
                painter.line_segment([prev, next], Stroke::new(0.7_f32, ink));
            }
            last = Some(next);
        }
    }
}
fn polyline(
    painter: &egui::Painter,
    points: &[Coordinate],
    rect: egui::Rect,
    view: &Viewport,
    stroke: Stroke,
) {
    let world_width = 256.0 * 2_f64.powf(view.zoom);
    let mut last: Option<Pos2> = None;
    for coordinate in points {
        let (x, y) = view.screen(*coordinate, rect.width() as f64, rect.height() as f64);
        let next = rect.min + egui::vec2(x as f32, y as f32);
        if let Some(previous) = last {
            // Do not draw a spurious line across a wrapped map seam.
            if ((next.x - previous.x).abs() as f64) < world_width / 2.0 {
                painter.line_segment([previous, next], stroke);
            }
        }
        last = Some(next);
    }
}
pub fn paint(
    ui: &mut egui::Ui,
    view: &mut Viewport,
    layers: &[MapLayer],
    show_grid: bool,
    show_labels: bool,
) {
    let size = ui.available_size();
    let (rect, response) = ui.allocate_exact_size(size, egui::Sense::drag());
    let painter = ui.painter_at(rect);
    painter.rect_filled(rect, 0.0, Color32::from_rgb(10, 22, 18));
    if show_grid {
        grid(&painter, rect, view);
    }

    let mut labels = 0usize;
    for layer in layers.iter().filter(|l| l.visible) {
        let (ink, width) = palette(layer.kind);
        for feature in &layer.content.features {
            match &feature.geometry {
                Geometry::Point(p) => {
                    let (x, y) = view.screen(*p, rect.width() as f64, rect.height() as f64);
                    let at = rect.min + egui::vec2(x as f32, y as f32);
                    if rect.expand(4.0).contains(at) {
                        painter.circle_filled(at, 3.2, ink);
                        if show_labels && labels < 20 {
                            if let Some(name) = feature.label.as_deref() {
                                painter.text(
                                    at + egui::vec2(4.0, -8.0),
                                    Align2::LEFT_TOP,
                                    name,
                                    FontId::monospace(9.0),
                                    ink,
                                );
                                labels += 1;
                            }
                        }
                    }
                }
                Geometry::Line(line) => {
                    polyline(&painter, line, rect, view, Stroke::new(width, ink));
                    if show_labels && view.zoom >= 12.5 && labels < 20 {
                        if let (Some(name), Some(p)) =
                            (feature.label.as_deref(), line.get(line.len() / 2))
                        {
                            let (x, y) = view.screen(*p, rect.width() as f64, rect.height() as f64);
                            let at = rect.min + egui::vec2(x as f32, y as f32);
                            if rect.contains(at) {
                                painter.text(
                                    at,
                                    Align2::LEFT_TOP,
                                    name,
                                    FontId::monospace(9.0),
                                    ink,
                                );
                                labels += 1;
                            }
                        }
                    }
                }
                Geometry::Polygon(rings) => {
                    // Keep geometry truthful: polygon holes are not filled until
                    // an even-odd tessellator and robust viewport clipping ship.
                    for ring in rings {
                        polyline(&painter, ring, rect, view, Stroke::new(width, ink));
                    }
                }
            }
        }
    }
    let center = rect.center();
    painter.line_segment(
        [
            center + egui::vec2(-7.0, 0.0),
            center + egui::vec2(7.0, 0.0),
        ],
        Stroke::new(1.3_f32, Color32::LIGHT_GREEN),
    );
    painter.line_segment(
        [
            center + egui::vec2(0.0, -7.0),
            center + egui::vec2(0.0, 7.0),
        ],
        Stroke::new(1.3_f32, Color32::LIGHT_GREEN),
    );

    if !layers.iter().any(|layer| layer.visible) {
        painter.text(
            rect.center() + egui::vec2(0.0, 20.0),
            Align2::CENTER_TOP,
            "NO LOCAL MAP LAYERS",
            FontId::monospace(11.0),
            Color32::from_rgb(194, 199, 155),
        );
    }
    if response.dragged() {
        let delta = ui.ctx().input(|input| input.pointer.delta());
        view.pan_pixels(delta.x as f64, delta.y as f64);
    }
    if response.hovered() {
        let scroll = ui.ctx().input(|input| input.raw_scroll_delta.y);
        if scroll.abs() > 0.0 {
            if let Some(pointer) = response.hover_pos() {
                let local = pointer - rect.min;
                view.zoom_at(
                    scroll as f64 / 150.0,
                    local.x as f64,
                    local.y as f64,
                    rect.width() as f64,
                    rect.height() as f64,
                );
            }
        }
    }
}
