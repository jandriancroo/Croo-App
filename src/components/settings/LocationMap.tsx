interface LocationMapProps {
  lat: number;
  lng: number;
  locationName?: string;
  address?: string;
}

/**
 * Renders a static, non-interactive map preview.
 *
 * The Google Maps Embed key is read from VITE_GOOGLE_MAPS_EMBED_KEY so it is never
 * hardcoded in source control. When that variable is not configured we fall back to
 * an OpenStreetMap embed, which needs no key at all — so the map always renders.
 */
export const LocationMap = ({ lat, lng, locationName, address }: LocationMapProps) => {
  const embedKey = import.meta.env.VITE_GOOGLE_MAPS_EMBED_KEY as string | undefined;

  let mapUrl: string;

  if (embedKey) {
    // Prefer the address for accuracy, fall back to coordinates
    const query = address
      ? encodeURIComponent(address)
      : encodeURIComponent(`${lat},${lng}`);
    mapUrl = `https://www.google.com/maps/embed/v1/place?key=${embedKey}&q=${query}`;
  } else {
    // Keyless fallback: OpenStreetMap static embed around the coordinates
    const delta = 0.004;
    const bbox = [lng - delta, lat - delta, lng + delta, lat + delta]
      .map((n) => n.toFixed(6))
      .join('%2C');
    mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat.toFixed(6)}%2C${lng.toFixed(6)}`;
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        borderRadius: '0.375rem',
        overflow: 'hidden',
      }}
    >
      <iframe
        src={mapUrl}
        title={locationName || 'Location Map'}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        allowFullScreen={false}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
};
