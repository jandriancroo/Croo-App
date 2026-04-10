interface LocationMapProps {
  lat: number;
  lng: number;
  locationName?: string;
  address?: string;
}

export const LocationMap = ({ lat, lng, locationName, address }: LocationMapProps) => {
  // Use address for accuracy, fall back to coordinates
  const query = address
    ? encodeURIComponent(address)
    : encodeURIComponent(`${lat},${lng}`);
  const mapUrl = `https://www.google.com/maps/embed/v1/place?key=AIzaSyBFw0Qbyq9zTFTd-tUY6dZWTgaQzuU17R8&q=${query}`;

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
