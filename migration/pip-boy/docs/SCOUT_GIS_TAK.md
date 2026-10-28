# Rust-Boy | Reclamation Scout GIS and TAK-on-Pi design

**Implementation status:** Rust-Boy retains offline WGS84 Point GeoJSON tools and adds an independent browser map viewer on `feat/scout-gps-rustgis-map`. It can import RustGIS native map/project/layer data and zipped mobile packages and align browser geolocation on real embedded vector features. It is **not** an embedded upstream RustGIS renderer, physical GNSS receiver, TAK transport or certified navigation device. See [native map/GPS import and online road reference](SCOUT_GPS_MAP.md). Online-reference queries use the same Overpass provider and category taxonomy as RustGIS's `osm.download` but do not embed the native upstream engine.

## Dashboard viewport before navigation

The [local dashboard](DASHBOARD_UI.md) now reserves a dedicated **Scout navigation viewport** and loads the Scout job template and its real offline WGS84 tools from Rust. The original Scout viewport was an empty reference grid. The newer [native RustGIS map/GPS branch](SCOUT_GPS_MAP.md) now draws imported vector geometry under the user's explicitly approved browser GPS fix. No RustGIS application binary, raster tile renderer, physical GNSS or TAK transport is embedded in this pass. The eventual goal is to **launch/embed the actual RustGIS mapping app or reviewed map renderer** behind this viewport, so field operators can navigate from real layers and positions—not from a simulated picture. Support process/IPC or native renderer contracts only after actual RustGIS ARM64 and macOS interoperability tests.

## Why this architecture

| Software | Can it run on Raspberry Pi 5 / 64-bit Pi OS? | Usage decision |
| --- | --- | --- |
| **Rust-Boy** | Rust supports Linux ARM64; our binary still needs an actual Pi build/test | Native Scout workbench client; offline first |
| **RustGIS** | Upstream publishes Linux `aarch64` binaries / CLI; Pi's graphics stack is unverified | Start with independent GeoJSON interchange; benchmark CLI/rendering later |
| **ATAK-CIV** | **Android application**, not a native Raspberry Pi OS program | Use an Android companion; do not claim an ATAK binary is ported |
| **TAKX Linux** | Linux distribution listed by TAK.gov; ARM64/Raspberry Pi certification not established | Research only, no shipped dependency |
| **PiTAK** | Official TAK ecosystem transport product | Specialized communications; not a replacement for ATAK's map UI |
| **OpenTAKServer** | Installer explicitly supports Raspberry Pi OS Bookworm or later | Separately operated LAN TAK service; connect only with user approval |
| **TAK Server** | Official infrastructure product with organization-specific authorization | Optional later connector; never silently installed |

**First-party references:** [RustGIS architecture & Apache-2.0 license](https://github.com/opengeos/RustGIS), [RustGIS ARM64 installation and minimum compiler](https://rustgis.app/installation/), [TAK.gov product descriptions](https://tak.gov/products), [TAK.gov Linux/Android operating systems](https://tak.gov/), and [OpenTAKServer Pi installer documentation](https://docs.opentakserver.io/installation/installation.html). The descriptions are not a guarantee on a particular Pi model or accessory combination.

### RustGIS compiler alignment and integration gate

RustGIS's current workspace requires Rust **1.90 or newer** and uses edition **2024**. Rust-Boy's minimum compiler has been raised to **1.90**, eliminating the earlier compiler-version mismatch. Rust-Boy deliberately retains edition **2021**: Rust dependencies can use edition 2024 without requiring the consuming application to change editions. CI checks both Rust 1.90.0 and current stable.

**This is compiler readiness, not a RustGIS port.** RustGIS crates have not been added, vendored, API-tested or runtime-validated on Raspberry Pi. Its Apache-2.0 license permits appropriately attributed integration, subject to dependency notices and licensing review. Review crate interfaces, build artifacts, source provenance and ARM64 hardware behavior before selecting a direct integration; do not push to the external RustGIS repository.

The current bridge produces **GeoJSON conforming to RFC 7946's longitude, latitude order**, which can be inspected by RustGIS and other tools. Read-only inspection initially accepts only Point geometries in a Geometry, Feature or FeatureCollection (maximum **1 MiB**, **1,000 points**). It rejects polygons/lines rather than silently discarding important geometry. The bounding box is raw min/max, potentially wide when data straddles the antimeridian. Great-circle estimates use a mean-radius sphere: they are not survey-grade ellipsoidal geodesics.

## Use on macOS or ARM64 Raspberry Pi

Build from the Scout development branch with Rust and Cargo installed. Run locally; these commands never discover a LAN, access GNSS, or transmit a location.

```bash
git clone --branch feat/reclamation-scout-gis-tak https://github.com/pskeffington/pip_boy.git
cd pip_boy
cargo build --release --locked -p pipboy

# Select the complete field configuration (does not execute its tools).
./target/release/pipboy workbench use reclamation-scout --replace

# Export a waypoint to standard GeoJSON.
./target/release/pipboy scout geo waypoint "Trailhead" 42.0 -70.75 > trailhead.geojson

# Re-import and inspect its Point geometry without modifying the source.
./target/release/pipboy scout geo inspect trailhead.geojson

# Approximate on-sphere path length between two WGS84 coordinates.
./target/release/pipboy scout geo distance 42.0 -70.75 42.01 -70.76
```

The commands print coordinates only when explicitly invoked. Redirected waypoint output is an operator-controlled plaintext file and should be protected or deleted appropriately; Rust-Boy does not automatically store a map history. The `scout geo inspect` command is read-only.

To trial **RustGIS itself** on Raspberry Pi, choose its published ARM64 package or CLI, verify the upstream SHA-256 and license information, and test its GUI/renderer independently. Aarch64 packaging is **not** evidence of confirmed 4-inch screen, GPU driver or memory performance on the user's Pi. Benchmark before integrating.

## Raspberry Pi + TAK network topology

```text
 Android phone running ATAK-CIV
                |
      User-authorized local LAN
                |
       [OpenTAKServer on Pi]
                |
       (future explicit, TLS-bound
        Cursor-on-Target connector)
                |
      Rust-Boy Reclamation Scout
                |
      Offline GIS: GeoJSON, waypoints,
      distances, eventually offline tiles
```

A device may instead run Rust-Boy Scout and a TAK server on separate hosts; colocating them on one Pi is a resource-budget decision. **Do not** confuse an authorized local server with installing the full ATAK Android app under Raspberry Pi OS. Android-on-Pi attempts depend on a separate compatible Android image and ATAK hardware/software requirements; that path is outside the tested baseline.

The future TAK bridge should parse and serialize only bounded, explicitly approved **Cursor-on-Target (CoT)** event types. Add certificate enrollment, endpoint allowlisting, source/TTL, replay/staleness checking, rate limits, privacy consent, credential-store integration, defensive XML parsing and immediate disconnect on revocation. Do not automatically broadcast all locations or import untrusted identity claims as authenticated personnel. Server installation and camera/radio devices are separate opt-in paths.

## Phased delivery and acceptance

| Gate | Real deliverable | Required evidence |
| --- | --- | --- |
| **S0 – Native offline data** | GIS LAB pinned in Reclamation Scout; waypoint GeoJSON export, bounded Point inspection, approximate distance | Golden WGS84 longitude/latitude, antimeridian, invalid data, no-background-network smoke; stable/Rust 1.90/macOS/Windows CI |
| **S1 – Portable map data** | Optional RustGIS-compatible feature/layer adapter, GPX, manual waypoints, limited tile cache | RustGIS import/export round-trip with fixtures; no compiler/ABI regression; offline rendering in two display sizes |
| **S2 – Raspberry Pi** | ARM64 native build, rustgis-cli compatibility trial, prototype 4-inch map UI | Actual Pi 5 run with RAM, CPU, cold-start, tile-load and power measurements; fallback when no GPU acceleration |
| **S3 – TAK interop** | Non-network CoT fixtures, then secure opted-in client to an independently configured OpenTAKServer | Explicit consent, valid certificates, no implicit multicast, short TTL, revoke/reconnect, multi-client interoperability |
| **S4 – Field release** | Mapping, GNSS permissions, TAK data and (separately) game companion accepted | Disconnected field run; real GPS validity; exact devices/versions and signed release checklist |

**Privacy and licensing:** location history and team positions can be sensitive. The default configuration stores no GPS history, does not connect to a server and does not run network discovery. TAK.gov describes government-specific authorization obligations and separate restrictions for government/military products; restrict initial interoperability to appropriately licensed civilian-compatible tools and services. Rust-Boy is independent and not affiliated with RustGIS maintainers or TAK.gov.

See [role roadmap](ROLE_ROADMAP.md), [security](../SECURITY.md), [literature matrix](VAULT_TEC_LORE_MATRIX.md), [source workbench](../crates/pipboy-core/src/workbench.rs).
