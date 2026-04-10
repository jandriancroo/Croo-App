interface LocationMapProps {
  lat: number;
  lng: number;
  locationName?: string;
}

export const LocationMap = ({ lat, lng, locationName }: LocationMapProps) => {
  // Google Maps embed — free, no API key, accurate street data
  const query = encodeURIComponent(`${lat},${lng}`);
  const mapUrl = `https://www.google.com/maps/embed?pb=!1m14!1m12!1m3!1d1500!2d${lng}!3d${lat}!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!5e0!3m2!1sen!2sus`;

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
