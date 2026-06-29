import { useRef } from 'react';
import { Upload, Loader2 } from 'lucide-react';
import { toast } from '../common/Toast';
import { extractPolygons, geojsonAreaSqft } from '../../utils/geoArea';
import { kmlToGeoJson } from '../../utils/kmlToGeoJson';
import { useUploadParcelBoundary } from '../../hooks/useYieldStudio';

// Upload a parcel boundary (.geojson / .kml), parse + validate + compute its
// geodesic area CLIENT-SIDE (no new deps), then persist as JSON. Mirrors
// ZoneGeoJsonImportButton's parse pattern (parse-client-side, POST as JSON —
// not multipart, which is for opaque binaries).
const ACCEPT = '.geojson,.json,.kml,application/geo+json,application/json,application/vnd.google-earth.kml+xml';

export default function BoundaryUploadButton({ propertyId, dealId }) {
  const fileRef = useRef(null);
  const uploadMut = useUploadParcelBoundary();

  const onFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // let the same file re-trigger
    if (!file) return;

    const name = (file.name || '').toLowerCase();
    if (name.endsWith('.kmz')) {
      toast.error('KMZ is zipped — unzip it to a .kml and upload that.');
      return;
    }

    let text;
    try {
      text = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
        reader.readAsText(file);
      });
    } catch (err) {
      toast.error(`Could not read file: ${err.message}`);
      return;
    }

    const isKml = name.endsWith('.kml') || text.trim().startsWith('<');
    let geometry;
    try {
      geometry = isKml ? kmlToGeoJson(text) : JSON.parse(text);
    } catch (err) {
      toast.error(`Could not parse boundary: ${err.message}`);
      return;
    }

    if (!geometry || extractPolygons(geometry).length === 0) {
      toast.error('No polygon boundary found in that file.');
      return;
    }
    const areaSqft = geojsonAreaSqft(geometry);

    try {
      await uploadMut.mutateAsync({
        propertyId,
        deal_id: dealId,
        source: isKml ? 'kml' : 'geojson',
        geometry_geojson: geometry,
        area_sqft: areaSqft,
        crs: 'EPSG:4326',
      });
    } catch {
      /* toast fired in the hook */
    }
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        onChange={onFile}
        className="sr-only"
        aria-label="Parcel boundary file (.geojson or .kml)"
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploadMut.isPending}
        className="inline-flex items-center gap-1.5 rounded-md border border-hairline-strong px-2.5 py-1 text-[11px] font-medium text-content-secondary transition-colors duration-150 hover:bg-bg-secondary hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60"
      >
        {uploadMut.isPending
          ? <Loader2 size={12} className="animate-spin motion-reduce:animate-none" />
          : <Upload size={12} />}
        Upload boundary
      </button>
    </>
  );
}
