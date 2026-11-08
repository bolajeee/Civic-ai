import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './map.css';
import type { GovernmentApi } from './api';
import type { MapFeature, MapLayer, MapSnapshot } from './types';
import { geographicBounds } from './map-utils';

const fmt = {
  date: (value: string) => new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos',
  }).format(new Date(value)),
  status: (value: string) => value.toLowerCase().replaceAll('_', ' '),
};

// ---------------------------------------------------------------------------
// Custom Leaflet markers
// Reports → small teal dot.  Clusters → dark-green pill badge with label.
// Both use divIcon so the DOM is styled with CSS rather than canvas/SVG.
// ---------------------------------------------------------------------------
function reportIcon() {
  return L.divIcon({
    className: '',
    html: '<span class="map-marker-report" aria-hidden="true"></span>',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}

function clusterIcon(publicId: string, reportCount: number) {
  const label = `${publicId} · ${reportCount}`;
  return L.divIcon({
    className: '',
    html: `<span class="map-marker-cluster" aria-hidden="true">${label}</span>`,
    // Width is variable; Leaflet will use the rendered element's natural size.
    // iconAnchor centres the pill on the coordinate.
    iconSize: undefined,
    iconAnchor: undefined,
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function MapView({ api }: { api: GovernmentApi }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const points = useRef<L.LayerGroup | null>(null);

  // Viewport and filter state
  const [bounds, setBounds] = useState<[number, number, number, number] | null>(null);
  const [layer, setLayer] = useState<MapLayer>('all');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState<MapSnapshot['categories']>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Data state
  const [snapshot, setSnapshot] = useState<{ key: string; data: MapSnapshot } | null>(null);
  const [selection, setSelection] = useState<MapFeature | null>(null);
  const [resultsOpen, setResultsOpen] = useState(true);
  const [error, setError] = useState('');
  const [tileError, setTileError] = useState(false);
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);

  // Client-side search over the results panel only (API /map has no q param)
  const [search, setSearch] = useState('');

  const key = JSON.stringify([bounds, layer, status, category]);
  const data = snapshot?.key === key ? snapshot.data : null;

  // -------------------------------------------------------------------------
  // Initialise Leaflet once
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!container.current) return;
    const instance = L.map(container.current, {
      minZoom: 3, maxZoom: 18,
      maxBounds: [[-85, -180], [85, 180]],
      maxBoundsViscosity: 1,
      zoomControl: true,
    }).setView([9.08, 8.67], 6);

    map.current = instance;
    points.current = L.layerGroup().addTo(instance);

    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, noWrap: true,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(instance);
    tiles.on('tileerror', () => setTileError(true));

    const update = () => {
      const b = instance.getBounds();
      setBounds(geographicBounds(b.getWest(), b.getSouth(), b.getEast(), b.getNorth()));
    };
    instance.on('moveend', update);

    const resize = new ResizeObserver(() => instance.invalidateSize());
    resize.observe(container.current);
    update();

    return () => { resize.disconnect(); instance.remove(); map.current = null; points.current = null; };
  }, []);

  // -------------------------------------------------------------------------
  // Fetch map data on viewport / filter change (debounced 250 ms)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!bounds) return;
    let active = true;
    setBusy(true); setError(''); setSelection(null);
    const timer = window.setTimeout(() => {
      api.map({ bbox: bounds, layer, status, category }).then(result => {
        if (active) { setSnapshot({ key, data: result }); setCategories(result.categories); }
      }).catch(err => {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load map data.');
      }).finally(() => { if (active) setBusy(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [api, bounds, layer, status, category, revision, key]);

  // -------------------------------------------------------------------------
  // Place / refresh markers whenever loaded data changes
  // -------------------------------------------------------------------------
  useEffect(() => {
    const group = points.current;
    if (!group) return;
    group.clearLayers();
    for (const feature of [
      ...(data?.reports.features ?? []),
      ...(data?.clusters.features ?? []),
    ]) {
      const [lng, lat] = feature.geometry.coordinates;
      const isCluster = feature.properties.kind === 'cluster';
      const marker = isCluster
        ? L.marker([lat, lng], {
            icon: clusterIcon(
              feature.properties.publicId,
              feature.properties.reportCount ?? 0,
            ),
          })
        : L.marker([lat, lng], { icon: reportIcon() });

      const tooltipEl = document.createElement('span');
      tooltipEl.textContent = isCluster
        ? `${feature.properties.publicId} · ${feature.properties.category}`
        : `${feature.properties.publicId} · ${feature.properties.category}`;
      marker.bindTooltip(tooltipEl).on('click', () => setSelection(feature)).addTo(group);
    }
  }, [data]);

  // -------------------------------------------------------------------------
  // Derived values
  // -------------------------------------------------------------------------
  const allFeatures = [...(data?.clusters.features ?? []), ...(data?.reports.features ?? [])];
  const truncated = data && (
    data.reports.total > data.reports.features.length ||
    data.clusters.total > data.clusters.features.length
  );

  const searchTerm = search.trim().toLowerCase();
  const visibleFeatures = searchTerm
    ? allFeatures.filter(f =>
        f.properties.publicId.toLowerCase().includes(searchTerm) ||
        f.properties.category.toLowerCase().includes(searchTerm) ||
        (f.properties.address ?? '').toLowerCase().includes(searchTerm),
      )
    : allFeatures;

  function select(feature: MapFeature) {
    setSelection(feature);
    const [lng, lat] = feature.geometry.coordinates;
    map.current?.panInside([lat, lng], { padding: [25, 25] });
  }

  const reportsWithGps = data?.reports.features.length ?? 0;
  const reportsWithoutGps = data?.reports.withoutGeometry ?? 0;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="dashboard map-page">
      {/* ── Page heading ── */}
      <div className="page-title map-page-heading">
        <div>
          <p className="eyebrow">SPATIAL OPERATIONS</p>
          <h1>Issue map</h1>
          <p className="muted">Explore citizen GPS observations and confirmed issue-cluster centroids across Nigeria.</p>
        </div>
        <div className="map-heading-actions">
          <span className="map-live-state">
            <span aria-hidden="true" />
            {busy ? 'Updating map…' : 'Live viewport'}
          </span>
          <button className="refresh" disabled={busy} onClick={() => setRevision(v => v + 1)}>
            {busy ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* ── Search bar ── */}
      <div className="map-search-row">
        <label className="map-search-label" htmlFor="map-search">
          <span className="map-search-icon" aria-hidden="true">⌕</span>
          <input
            id="map-search"
            className="map-search-input"
            type="search"
            placeholder="Search loaded results by reference, category or address…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Search map results"
          />
        </label>
        {search && (
          <button className="map-search-clear refresh" onClick={() => setSearch('')} aria-label="Clear search">
            ✕
          </button>
        )}
        {search && (
          <span className="map-search-note" role="status">
            {visibleFeatures.length} of {allFeatures.length} loaded results match
          </span>
        )}
      </div>

      {/* ── Toolbar: layer selector + filter chips ── */}
      <div className="map-toolbar">
        {/* Layer segmented control */}
        <div className="map-layer-chips" role="group" aria-label="Map layer">
          {([ ['all', '⊕ All'], ['reports', '● Reports'], ['clusters', '▰ Clusters'] ] as const).map(
            ([value, label]) => (
              <button
                key={value}
                type="button"
                className={`map-layer-chip ${layer === value ? 'chip-active' : ''}`}
                aria-pressed={layer === value}
                onClick={() => setLayer(value)}
              >
                {label}
                {value !== 'all' && data && (
                  <span className="chip-count">
                    {value === 'reports' ? data.reports.features.length : data.clusters.features.length}
                  </span>
                )}
              </button>
            )
          )}
        </div>

        {/* Reset viewport */}
        <button className="refresh map-reset" onClick={() => map.current?.setView([9.08, 8.67], 6)}>
          Nigeria view
        </button>

        {/* Mobile filter toggle */}
        <button
          type="button"
          className="refresh mobile-filter-toggle"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen(v => !v)}
        >
          {filtersOpen ? 'Hide filters' : '⊟ Filters'}
        </button>

        {/* Filter form */}
        <form
          className={`map-filters panel ${filtersOpen ? 'filters-open' : ''}`}
          onSubmit={e => e.preventDefault()}
        >
          <label>
            Status
            <select aria-label="Status filter" value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {['PENDING', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'].map(v => (
                <option key={v} value={v}>{fmt.status(v)}</option>
              ))}
            </select>
          </label>
          <label>
            Category
            <select aria-label="Category filter" value={category} onChange={e => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {categories.map(v => (
                <option key={v.slug} value={v.slug}>{v.label}</option>
              ))}
            </select>
          </label>
          {(status || category) && (
            <button
              type="button"
              className="map-filter-clear refresh"
              onClick={() => { setStatus(''); setCategory(''); }}
            >
              Clear filters
            </button>
          )}
        </form>
      </div>

      {/* ── Alerts ── */}
      {error && (
        <p className="error" role="alert">
          {error}{data ? ' Showing the previous snapshot.' : ' Try Refresh to reload this area.'}
        </p>
      )}
      {tileError && (
        <p className="notice" role="status">
          The street map tiles could not fully load. Report and cluster coordinates are still available. Check your internet connection.
        </p>
      )}

      {/* ── Map legend ── */}
      <p className="map-legend">
        <span className="legend-report" />Report GPS
        <span className="legend-cluster" />Cluster centroid
        <span className="map-legend-note">Centroids are approximate, not confirmed hazard boundaries.</span>
      </p>

      {/* ── Main workspace: map canvas + results panel ── */}
      <div className="map-workspace">
        {/* Map canvas */}
        <section className="map-canvas-panel" aria-label="Issue map and report locations">
          <div className="map-canvas-toolbar">
            <div className="map-layer-key">
              <span aria-hidden="true">◉</span>{' '}
              {layer === 'all' ? 'Reports + clusters' : layer === 'reports' ? 'Individual reports' : 'Issue clusters'}
            </div>
            {data && (
              <span className="map-viewport-count">
                {data.reports.features.length} reports
                <span>·</span>
                {data.clusters.features.length} clusters plotted
              </span>
            )}
          </div>

          <div
            ref={container}
            className="issue-map"
            role="region"
            aria-label="Interactive issue map; use arrow keys to pan and plus or minus to zoom"
          />

          <div className="map-footer-legend">
            <span><i className="legend-report" />Citizen GPS point</span>
            <span><i className="legend-cluster" />Approximate cluster centroid</span>
            <span>OpenStreetMap contributors</span>
          </div>
        </section>

        {/* Results panel */}
        <section
          className={`panel map-results ${resultsOpen ? 'results-open' : 'results-closed'}`}
          aria-label="Map results"
          aria-busy={busy}
        >
          <div className="map-results-heading">
            <div>
              <h2>Map results</h2>
              <p>
                {data
                  ? `${data.reports.total} reports · ${data.clusters.total} clusters in viewport`
                  : 'Current viewport'}
              </p>
            </div>
            <button
              type="button"
              className="results-toggle"
              aria-expanded={resultsOpen}
              onClick={() => setResultsOpen(v => !v)}
            >
              {resultsOpen ? 'Hide' : 'Show'}{' '}
              <span aria-hidden="true">{resultsOpen ? '−' : '+'}</span>
            </button>
          </div>

          {resultsOpen && (
            <>
              {busy && <p className="muted map-loading" role="status">Loading map observations…</p>}
              {data && (
                <>
                  <p className="updated map-snapshot">
                    Snapshot: {fmt.date(data.generatedAt)} WAT
                  </p>
                  {truncated && (
                    <p className="notice map-cap-notice">
                      Showing up to {data.limit} newest points per layer.
                      Viewport totals include all matching entities in this area.
                    </p>
                  )}
                  {!allFeatures.length && (
                    <p className="empty muted">No mapped observations match this area and these filters.</p>
                  )}
                  {allFeatures.length > 0 && searchTerm && !visibleFeatures.length && (
                    <p className="empty muted">No loaded results match "{search}".</p>
                  )}
                  <div className="map-result-list">
                    {visibleFeatures.map(feature => (
                      <MapResultCard
                        key={`${feature.properties.kind}-${feature.id}`}
                        feature={feature}
                        selected={
                          selection?.id === feature.id &&
                          selection.properties.kind === feature.properties.kind
                        }
                        onClick={() => select(feature)}
                      />
                    ))}
                  </div>
                  <p className="map-missing muted">
                    {reportsWithoutGps > 0 && (
                      <>
                        <strong>{reportsWithoutGps}</strong> report{reportsWithoutGps === 1 ? '' : 's'} and{' '}
                      </>
                    )}
                    {data.clusters.withoutGeometry > 0 && (
                      <><strong>{data.clusters.withoutGeometry}</strong> cluster{data.clusters.withoutGeometry === 1 ? '' : 's'} have</>
                    )}
                    {reportsWithoutGps === 0 && data.clusters.withoutGeometry === 0
                      ? 'All loaded observations have mappable coordinates.'
                      : ' no mappable coordinates and are not plotted.'}
                  </p>
                </>
              )}
            </>
          )}
        </section>
      </div>

      {/* ── Density heatmap — awaiting backend support ── */}
      <section
        className="panel density-pending"
        aria-label="Report Density status"
      >
        <div className="density-pending-heading">
          <span className="density-icon" aria-hidden="true">▦</span>
          <div>
            <h2>Report Density</h2>
            <p>Heatmap requires complete geographic aggregation from the server.</p>
          </div>
          <span className="badge disabled">Pending backend</span>
        </div>
        <details>
          <summary>Why density is unavailable</summary>
          <div className="density-detail">
            <p>
              The current map API returns at most {data?.limit ?? 250} newest observations per viewport
              request. A capped, newest-first point set cannot produce authoritative report counts
              for geographic areas — the same GPS cell can be under-counted or omitted entirely.
            </p>
            <p>
              Density will require a dedicated API endpoint that aggregates all matching reports
              into geographic bins (e.g. H3 hexagons or a PostGIS grid) server-side, returning
              complete counts per cell regardless of recency. Until that endpoint exists,
              plotting misleading density values is worse than showing nothing.
            </p>
            <p className="density-thresholds-label">Proposed operational thresholds once available:</p>
            <div className="density-thresholds" aria-label="Proposed density classification thresholds">
              <span><i className="density-swatch very-low" />1–25 Very low</span>
              <span><i className="density-swatch low" />26–50 Low</span>
              <span><i className="density-swatch moderate" />51–100 Moderate</span>
              <span><i className="density-swatch high" />101–200 High</span>
              <span><i className="density-swatch very-high" />201–400 Very high</span>
              <span><i className="density-swatch critical" />401+ Critical</span>
            </div>
            <small>
              Thresholds are fixed regardless of zoom level. Density represents report concentration,
              not AI severity or government priority.
            </small>
          </div>
        </details>
      </section>

      {/* ── Selected feature detail ── */}
      {selection && (
        <MapDetailPanel feature={selection} onClose={() => setSelection(null)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Map result card — one loaded feature in the results panel
// ---------------------------------------------------------------------------
function MapResultCard({
  feature, selected, onClick,
}: {
  feature: MapFeature;
  selected: boolean;
  onClick: () => void;
}) {
  const { properties: p } = feature;
  const isCluster = p.kind === 'cluster';
  return (
    <button
      className={`map-result ${selected ? 'map-result-selected' : ''}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      <span className={`map-result-icon ${isCluster ? 'cluster' : 'report'}`} aria-hidden="true">
        {isCluster ? '▰' : '●'}
      </span>
      <span className="map-result-copy">
        <span className="map-result-top">
          <strong>{p.publicId}</strong>
          <span className={`badge ${p.status.toLowerCase()}`}>{fmt.status(p.status)}</span>
        </span>
        <span className="map-result-category">{p.category}</span>
        {isCluster ? (
          <span className="map-result-meta">
            {p.reportCount} supporting report{p.reportCount === 1 ? '' : 's'} · approximate centroid
          </span>
        ) : (
          <span className="map-result-meta">
            {p.address || 'Citizen GPS observation'}
          </span>
        )}
      </span>
      <span className="map-result-arrow" aria-hidden="true">›</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Selected feature detail panel
// ---------------------------------------------------------------------------
function MapDetailPanel({
  feature, onClose,
}: {
  feature: MapFeature;
  onClose: () => void;
}) {
  const { properties: p, geometry: g } = feature;
  const isCluster = p.kind === 'cluster';
  const [lng, lat] = g.coordinates;

  return (
    <section className="panel map-detail" aria-label="Selected map observation">
      <div className="map-detail-heading">
        <div>
          <p className="eyebrow">
            SELECTED {isCluster ? 'ISSUE CLUSTER' : 'CITIZEN REPORT'}
          </p>
          <h2>{p.publicId}</h2>
          <p className="map-detail-category">{p.category}</p>
        </div>
        <button className="refresh" onClick={onClose}>Close</button>
      </div>

      <div className="map-detail-facts">
        <span className={`badge ${p.status.toLowerCase()}`}>{fmt.status(p.status)}</span>
        {isCluster && p.reportCount != null && (
          <span className="map-detail-count">
            {p.reportCount} supporting report{p.reportCount === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <dl className="map-detail-fields">
        <div>
          <dt>Coordinates</dt>
          <dd>{lat.toFixed(6)}, {lng.toFixed(6)}</dd>
        </div>
        {!isCluster && p.address && (
          <div>
            <dt>Address</dt>
            <dd>{p.address}</dd>
          </div>
        )}
        {!isCluster && p.accuracy != null && (
          <div>
            <dt>GPS accuracy</dt>
            <dd>±{p.accuracy} metres</dd>
          </div>
        )}
        {!isCluster && p.clusterPublicId && (
          <div>
            <dt>Issue cluster</dt>
            <dd>{p.clusterPublicId}</dd>
          </div>
        )}
        {!isCluster && !p.clusterPublicId && (
          <div>
            <dt>Issue cluster</dt>
            <dd className="muted">Unassigned</dd>
          </div>
        )}
        {!isCluster && p.submittedAt && (
          <div>
            <dt>Submitted (WAT)</dt>
            <dd>{new Intl.DateTimeFormat('en-NG', {
              dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos',
            }).format(new Date(p.submittedAt))}</dd>
          </div>
        )}
        {isCluster && (
          <div className="map-detail-centroid-note" aria-live="polite">
            <dt>Location note</dt>
            <dd>This centroid is the geometric mean of available GPS observations and is not a confirmed hazard boundary.</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
