interface LocationMapProps {
  lat: number;
  lng: number;
  locationName?: string;
}

export const LocationMap = ({ lat, lng, locationName }: LocationMapProps) => {
  // Static tile snapshot from OSM — no JS, no interactivity, no wasted resources
  const zoom = 15;
  const width = 400;
  const height = 200;
  const tileUrl = `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=${zoom}&size=${width}x${height}&markers=${lat},${lng},red-pushpin`;

  return (
    <img
      src={tileUrl}
      alt={locationName || 'Location Map'}
      loading="lazy"
      decoding="async"
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        borderRadius: '0.375rem',
      }}
    />
  );
};
