import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './map.css';
import type { GovernmentApi } from './api';
import type { MapFeature, MapLayer, MapSnapshot } from './types';
import { geographicBounds } from './map-utils';

const date = (value: string) => new Intl.DateTimeFormat('en-NG', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos',
}).format(new Date(value));
const statusLabel = (value: string) => value.toLowerCase().replaceAll('_', ' ');

export function MapView({ api }: { api: GovernmentApi }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const points = useRef<L.LayerGroup | null>(null);
  const [bounds, setBounds] = useState<[number, number, number, number] | null>(null);
  const [layer, setLayer] = useState<MapLayer>('all');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState<MapSnapshot['categories']>([]);
  const [snapshot, setSnapshot] = useState<{ key: string; data: MapSnapshot } | null>(null);
  const [selection, setSelection] = useState<MapFeature | null>(null);
  const [error, setError] = useState('');
  const [tileError, setTileError] = useState(false);
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify([bounds, layer, status, category]);
  const data = snapshot?.key === key ? snapshot.data : null;

  useEffect(() => {
    if (!container.current) return;
    const instance = L.map(container.current, { minZoom: 3, maxZoom: 18,
      maxBounds: [[-85, -180], [85, 180]], maxBoundsViscosity: 1 }).setView([9.08, 8.67], 6);
    map.current = instance;
    points.current = L.layerGroup().addTo(instance);
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, noWrap: true, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
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

  useEffect(() => {
    if (!bounds) return;
    let active = true;
    setBusy(true); setError(''); setSelection(null);
    // Debounce pan/zoom and filter changes; late responses cannot replace a newer viewport.
    const timer = window.setTimeout(() => {
      api.map({ bbox: bounds, layer, status, category }).then(result => {
        if (active) { setSnapshot({ key, data: result }); setCategories(result.categories); }
      }).catch(error => {
        if (active) setError(error instanceof Error ? error.message : 'Unable to load map data.');
      }).finally(() => { if (active) setBusy(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [api, bounds, layer, status, category, revision, key]);

  useEffect(() => {
    const group = points.current;
    if (!group) return;
    group.clearLayers();
    for (const feature of [...(data?.reports.features ?? []), ...(data?.clusters.features ?? [])]) {
      const [lng, lat] = feature.geometry.coordinates;
      const cluster = feature.properties.kind === 'cluster';
      const marker = L.circleMarker([lat, lng], { radius: cluster ? 10 : 5, weight: cluster ? 3 : 1,
        color: cluster ? '#123f32' : '#a56823', fillColor: cluster ? '#d9e9a4' : '#e3a74d', fillOpacity: 0.85 });
      const text = document.createElement('span');
      text.textContent = `${feature.properties.publicId} · ${feature.properties.category}`;
      marker.bindTooltip(text).on('click', () => setSelection(feature)).addTo(group);
    }
  }, [data]);

  const features = [...(data?.clusters.features ?? []), ...(data?.reports.features ?? [])];
  const truncated = data && (data.reports.total > data.reports.features.length || data.clusters.total > data.clusters.features.length);
  function select(feature: MapFeature) {
    setSelection(feature);
    const [lng, lat] = feature.geometry.coordinates;
    // Keep viewport and list stable when inspecting a result.
    map.current?.panInside([lat, lng], { padding: [25, 25] });
  }
  return <div className="dashboard map-page">
    <div className="page-title"><div><p className="eyebrow">ISSUES IN YOUR COMMUNITY</p><h1>Issue map</h1><p className="muted">Explore citizen observations and grouped issues. Pan or zoom to load an area.</p></div>
      <button className="refresh" disabled={busy} onClick={() => setRevision(value => value + 1)}>{busy ? 'Loading…' : 'Refresh'}</button></div>
    <div className="map-filters panel">
      <label>Layers<select aria-label="Layers" value={layer} onChange={event => setLayer(event.target.value as MapLayer)}><option value="all">Reports and clusters</option><option value="clusters">Issue clusters</option><option value="reports">Citizen reports</option></select></label>
      <label>Status<select aria-label="Status" value={status} onChange={event => setStatus(event.target.value)}><option value="">All statuses</option>{['PENDING', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'].map(value => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label>
      <label>Category<select aria-label="Category" value={category} onChange={event => setCategory(event.target.value)}><option value="">All categories</option>{categories.map(value => <option key={value.slug} value={value.slug}>{value.label}</option>)}</select></label>
      <button className="refresh" onClick={() => map.current?.setView([9.08, 8.67], 6)}>Nigeria view</button>
    </div>
    {error && <p className="error" role="alert">{error} {data ? 'Showing the previous snapshot for these filters and this area.' : 'Try Refresh to load this area.'}</p>}
    {tileError && <p className="notice" role="status">The street map could not fully load. Report and cluster coordinates are still available below. Check your internet connection.</p>}
    <p className="map-legend"><span className="legend-cluster" />Issue cluster centroid <span className="legend-report" />Citizen GPS observation</p>
    <div className="map-layout">
      <div ref={container} className="issue-map" role="region" aria-label="Interactive issue map; use arrow keys to pan and plus or minus to zoom" />
      <section className="panel map-results" aria-label="Map results" aria-busy={busy}>
        <h2>In this area</h2>
        {busy && <p className="muted" role="status">Loading map observations…</p>}
        {data && <><p className="muted">{data.clusters.features.length} / {data.clusters.total} clusters · {data.reports.features.length} / {data.reports.total} reports</p>
          <p className="updated">Snapshot: {date(data.generatedAt)} WAT</p>
          {truncated && <p className="notice">Showing up to {data.limit} newest points per layer. Zoom in or narrow the filters to see more.</p>}
          {!features.length && <p className="empty muted">No mapped observations match this area and these filters.</p>}
          <div className="map-result-list">{features.map(feature => <button key={`${feature.properties.kind}-${feature.id}`} className="map-result" aria-pressed={selection?.id === feature.id && selection.properties.kind === feature.properties.kind} onClick={() => select(feature)}>
            <strong>{feature.properties.publicId}</strong><span>{feature.properties.category}</span><small>{feature.properties.kind === 'cluster' ? `${feature.properties.reportCount} supporting reports` : 'Citizen observation'} · {statusLabel(feature.properties.status)}</small>
          </button>)}</div>
          <p className="map-missing muted">Across all areas with these filters: {data.reports.withoutGeometry} reports and {data.clusters.withoutGeometry} non-empty clusters have no mappable coordinates.</p>
        </>}
      </section>
    </div>
    {selection && <section className="panel map-detail" aria-label="Selected map observation"><div className="page-title"><h2>{selection.properties.publicId} · {selection.properties.category}</h2><button className="refresh" onClick={() => setSelection(null)}>Close</button></div>
      <p><span className={`badge ${selection.properties.status.toLowerCase()}`}>{statusLabel(selection.properties.status)}</span></p>
      <p>Coordinates: {selection.geometry.coordinates[1].toFixed(6)}, {selection.geometry.coordinates[0].toFixed(6)}</p>
      {selection.properties.kind === 'report' ? <>
        <p>{selection.properties.address || 'Address unavailable'}</p>
        <p>GPS accuracy: {selection.properties.accuracy == null ? 'Unknown' : `±${selection.properties.accuracy} metres`}</p>
        <p>Cluster: {selection.properties.clusterPublicId || 'Unassigned'}</p>
        <p>Submitted: {date(selection.properties.submittedAt!)} WAT</p>
      </> : <><p>{selection.properties.reportCount} supporting reports</p><p className="muted">This point is the centroid of available supporting GPS observations. It is not a confirmed hazard boundary.</p></>}
    </section>}
  </div>;
}
