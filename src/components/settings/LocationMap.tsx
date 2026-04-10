interface LocationMapProps {
  lat: number;
  lng: number;
  locationName?: string;
}

export const LocationMap = ({ lat, lng, locationName }: LocationMapProps) => {
  // Lightweight static snapshot via iframe with interaction disabled via CSS pointer-events
  // This loads the map tiles once and renders at the exact lat/lng — no zoom/pan allowed
  const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.005},${lat - 0.003},${lng + 0.005},${lat + 0.003}&layer=mapnik&marker=${lat},${lng}`;

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
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          pointerEvents: 'none', // Disables all interaction — acts like a static image
        }}
      />
    </div>
  );
};
