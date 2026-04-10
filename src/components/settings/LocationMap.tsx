interface LocationMapProps {
  lat: number;
  lng: number;
  locationName?: string;
}

export const LocationMap = ({ lat, lng, locationName }: LocationMapProps) => {
  // Use OpenStreetMap tile layer to compose a static-like map image
  // This is a single tile centered on the location — zero JS, zero interactivity
  const zoom = 15;
  const tileX = Math.floor(((lng + 180) / 360) * Math.pow(2, zoom));
  const latRad = (lat * Math.PI) / 180;
  const tileY = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      Math.pow(2, zoom)
  );

  const tileUrl = `https://tile.openstreetmap.org/${zoom}/${tileX}/${tileY}.png`;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        borderRadius: '0.375rem',
        overflow: 'hidden',
        backgroundColor: 'hsl(var(--muted))',
      }}
    >
      <img
        src={tileUrl}
        alt={locationName || 'Location Map'}
        loading="lazy"
        decoding="async"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
        }}
      />
      {/* Pin marker overlay */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -100%)',
          fontSize: '24px',
          filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))',
          pointerEvents: 'none',
        }}
      >
        📍
      </div>
    </div>
  );
};
