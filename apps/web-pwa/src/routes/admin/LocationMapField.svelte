<script lang="ts">
  import { onMount } from 'svelte';
  import * as L from 'leaflet';
  import 'leaflet/dist/leaflet.css';
  // Leaflet's default marker images are resolved via a runtime path that breaks
  // under a bundler, so we import the asset URLs explicitly and build an icon.
  import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
  import markerIcon from 'leaflet/dist/images/marker-icon.png';
  import markerShadow from 'leaflet/dist/images/marker-shadow.png';

  // A small interactive map for the home-location picker (issue #382). Shows a
  // single draggable pin at [latitude, longitude]; dragging the pin or clicking
  // the map reports the new coordinates via `onChange` so the parent can refine
  // the chosen location. Keyless OpenStreetMap raster tiles — no API key. This is
  // an admin-only, app-specific control, so it lives in `web-pwa` rather than
  // `@salt/ui-components` (which is shadcn/tailwind primitives only).
  interface Props {
    latitude: number;
    longitude: number;
    onChange: (latitude: number, longitude: number) => void;
    testid?: string;
  }
  let { latitude, longitude, onChange, testid }: Props = $props();

  const icon = L.icon({
    iconUrl: markerIcon,
    iconRetinaUrl: markerIcon2x,
    shadowUrl: markerShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
  });

  // Round to ~0.1m so the readout and saved doc stay tidy (6 dp is plenty).
  const round = (n: number): number => Math.round(n * 1e6) / 1e6;

  let container: HTMLDivElement;
  let map: L.Map | undefined;
  let marker: L.Marker | undefined;

  onMount(() => {
    map = L.map(container).setView([latitude, longitude], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    marker = L.marker([latitude, longitude], { draggable: true, icon }).addTo(map);
    marker.on('dragend', () => {
      const { lat, lng } = marker!.getLatLng();
      onChange(round(lat), round(lng));
    });
    map.on('click', (e: L.LeafletMouseEvent) => {
      onChange(round(e.latlng.lat), round(e.latlng.lng));
    });

    // The map is mounted inside a flex column; nudge Leaflet to measure its real
    // size once layout settles, otherwise tiles render into a 0-height box.
    requestAnimationFrame(() => map?.invalidateSize());

    return () => {
      map?.remove();
      map = undefined;
      marker = undefined;
    };
  });

  // Re-centre + move the pin when the parent changes the coordinates (a search
  // pick or manual entry). Moving the marker to its current spot is a no-op, so
  // this never echoes back through `onChange` / loops with a drag.
  $effect(() => {
    const lat = latitude;
    const lng = longitude;
    if (map && marker) {
      marker.setLatLng([lat, lng]);
      map.setView([lat, lng], map.getZoom());
    }
  });
</script>

<div
  bind:this={container}
  class="h-64 w-full overflow-hidden rounded-md border"
  data-testid={testid}
></div>
