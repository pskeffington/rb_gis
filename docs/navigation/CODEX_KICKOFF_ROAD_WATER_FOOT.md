# CODEX KICKOFF — deterministic road + waterfront foot navigation

Status: tasking and acceptance specification; not an implementation or test result.
Owner: rb_gis. Host: Rust Boy 2000 (typed module adapter only).
First action: read AGENTS.md, docs/navigation/ROADMAP.md, docs/navigation/LITERATURE_MATRIX.md, and .agents/skills/offline-navigation/SKILL.md on this branch.

## Mission
Build a small, independent, offline Rust routing core with two user-selectable foot navigation profiles in New England (CT, RI, MA, VT, NH, ME):
1. `FOOT_STANDARD`: legal pedestrian routes on streets, sidewalks, trails, footways, and verified crossings.
2. `FOOT_WATERFRONT`: prefer *legally walkable, mapped* routes alongside ocean shoreline, tidal inlets, rivers and long continuous river corridors, with inland connectors where necessary.

A water centerline, coastline vector, beach polygon, riverbank, tidal flat, navigable channel, or offshore geometry is NEVER automatically a foot-traversable edge. This is **land-based walking near water**, not boating. Do not implement water crossings by straight-line interpolation. Bridges/verified ferries (with pedestrian access) are explicit graph edges only; fords default excluded until a separate safety review.

## Immediate tasks (run in dependency order)
- WF-00 Inventory current map/road/boundary loading, original Rust Boy paths, existing Cargo layout and tests. Record actual file paths and SHA. Do not duplicate or replace working renderer.
- WF-01 Define stable, versioned data structures and importer for foot-eligible ways and water reference layers. Preserve OSM IDs, access, surfaces, barriers, bridge/tunnel/layer, restriction provenance, timestamp, extract bounds, source license/attribution. Validate coordinate range and topology.
- WF-02 Construct a *directed pedestrian graph* G=(V,E), splitting at real pedestrian junctions, not merely intersecting 2D lines. Enforce foot=no/private/closed rules, barrier restrictions, incomplete crossing data and unknown access using conservative explicit policy; document default assumptions. Add deterministic ID assignment and stable adjacency order.
- WF-03 Implement Dijkstra as correctness oracle, A* with admissible nonnegative lower bound (straight-line metric distance scaled by minimum allowed per-meter cost), integer fixed-point cost accumulation, stable tie-break (total cost, length, edge ID sequence). Never rely on hashmap iteration order.
- WF-04 Build waterfront reference index: coasts and hydrographic river/stream centerlines (OSM + USGS 3DHP where available; legacy NHD/NHDPlus HR only with explicit dataset vintage). Compute geodesic distance of each eligible pedestrian edge to nearest coastline / river corridor; use a projected metric local CRS or accurate geodesic distances, never degrees as meters. Water features must be at least a configurable **continuous reference reach length** (initial default 5 km) to count as river corridors; record chosen threshold and segmentation policy. Exclude intermittent/underground reaches by default for preferred-river classification unless validated locally. Coastlines have no arbitrary minimum length.
- WF-05 Assign `FOOT_WATERFRONT` edge preference without ever inventing traversal: eligible near-water edges gain a bounded, nonnegative cost discount. Initial corridor radius 250 m, verified near-water edge discount capped at 20%; exact threshold defaults must be configurable and documented. Penalize transitions that unnecessarily leave a continuous accessible corridor, but never prefer illegal crossings. Use integer weights for reproducibility.
- WF-06 Return route geometry, distance_m, modeled_cost, estimated_duration_s (clearly not live traffic), profile, route quality, water proximity fraction, data vintage and warning flags. If no legal connected path: NO_ROUTE. If only incomplete coverage: COVERAGE_GAP, not a fabricated straight-line pedestrian route.
- WF-07 Add optional GPS trace playback and route progress with confidence/staleness handling. Do not solicit device location or remote network without consent.
- WF-08 Add standalone GUI route overlay and Rust Boy socket integration only after routing and migration parity gate passes. Maintain a terminal CLI for repeatable fixture testing.

## Fully specified deterministic algorithm (first version)
Inputs: graph version, dataset hash, start and goal coordinates, foot mode, profile parameters, waterfront reference hash.
Preprocess:
1. Canonicalize all coordinates to explicit WGS84 with validated latitude/longitude; calculate length in integer millimeters and distance-to-water in integer meters (document rounding).
2. Restrict graph construction to legal pedestrian edges and explicit connectors. Record water lines separately.
3. Compute continuous water feature chains by hydrologic connectivity and stable feature IDs; do not join disconnected reaches simply because geometries are visually close. Use a 5,000 m minimum chain length for rivers. Allow configurable threshold; test 4,999 / 5,000 / 5,001 m.
4. For each pedestrian edge compute deterministic sampled distance-to-water (e.g., endpoints + midpoint at fixed arclength; improve via fixed spacing if long). Record nearest eligible continuous water chain ID and proximity; no distance-to-water inference across missing data.
5. Define base edge weight as distance_mm adjusted by deterministic integer profile penalties for surface/grade/accessibility; prohibit edges outside foot policy.
6. For waterfront profile apply bounded discount to each eligible edge within 250 m of qualifying water: discounted_cost = ceil(base_cost * (100 - min(20, proximity_discount_percent)) / 100); proximity_discount_percent = floor(20 * max(0, 250 - distance_m) / 250). All resulting weights remain >0.
7. Route by Dijkstra oracle, compare A* using heuristic h(v)=floor(0.8 * straight_line_mm(v,goal)) for either profile ONLY when base weights are guaranteed >= metric distance_mm and all modifiers nonnegative before discount; otherwise use zero heuristic. This is a lower bound under the declared 20% maximum discount. Restrict to 64-bit checked integer arithmetic, saturating/explicit error on overflow.
8. Sort graph vertices/adjacency, queue tie-break and route candidates by canonical stable IDs; output reproducible route for identical inputs/datasets/toolchain, with versioned fixed rounding.
9. Distinguish objective vs explanation: preferred water proximity may add route distance; return both full distance and proximity fraction and a warning for major detours (initial flag when route >1.5x standard-foot route distance). Avoid imposing a hard detour limit until user-configurable.
10. Reproducibility header: input params, graph/dataset/water hash, algorithm version, selected IDs, total cost.

## Mandatory synthetic fixtures
- Simple 4-node roads; A* matches Dijkstra cost and canonical tie-break.
- One-way road permitted on foot only if foot policy permits (do not inherit vehicle direction blindly).
- Two streets crossing on a bridge are NOT connected absent mapped foot junction.
- Waterfront path vs shorter inland street: controlled preference with same access.
- No waterfront trail: route inland with explicit low-water-access flag, not along coastline linework.
- Cliff/private waterfront edge, marsh, railway, bridge without pedestrian access: excluded.
- River reaches 4,999, 5,000, 5,001 meters; disconnected rivers not concatenated.
- Same seed/input hash yields byte-identical route output 100 times across randomized ingest order.
- No route, out-of-coverage, missing access data, overflow and bad coordinates return typed errors.
- Crossing river: explicit permitted bridge yes; imaginary crossing no.
- Low GPS accuracy and stale trace do not cause false reroutes.
- Coastal islands / tidal estuaries do not create accidental graph connections.

## Definition of done per phase
- Add test before feature. Run cargo fmt --check, cargo check, cargo test, cargo clippy -- -D warnings where supported. Do not report pass unless run.
- Write machine-readable fixture manifest (JSON) with dataset provenance and expected outputs.
- Log actual CPU/OS/Rust version, reproducible timings and peak memory for handheld performance evaluation.
- Preserve existing road/boundary/map behavior; no hidden dependency on pip_boy or online mapping.
- Every PR reports exact changed files, commands, pass/fail evidence, blocked conditions, and next task. Keep design docs/fixtures separate from runtime feature commits.
- Do not promote to outdoor field-ready without real access verification, current trail closure checks where available, tides/flooding warning UX, and hardware field validation.

## Current hard boundaries
Do NOT treat water geometry as pedestrian infrastructure. Do NOT infer beach walkability from imagery. Do NOT imply shoreline public access from public hydrography data. Do NOT route through protected wetlands, private properties, tidal flats, or across rivers absent independently verified accessible paths. Clearly distinguish no data from confirmed inaccessibility.

## Sources to consult / verify
- OSM foot access: https://wiki.openstreetmap.org/wiki/Key:foot
- OSM roads and fords: https://wiki.openstreetmap.org/wiki/Roads and https://wiki.openstreetmap.org/wiki/Ford
- USGS Hydrography (NHD retired Oct 2023, replaced by 3DHP): https://www.usgs.gov/national-hydrography/national-hydrography-dataset
- USGS data distribution: https://www.usgs.gov/national-hydrography/access-national-hydrography-products
- USGS NHDPlus HR guide: https://pubs.usgs.gov/publication/sir20255031/full
- OSM attribution: https://www.openstreetmap.org/copyright
