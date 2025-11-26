interface LocationMapProps {
  lat: number;
  lng: number;
  locationName?: string;
}

export const LocationMap = ({ lat, lng, locationName }: LocationMapProps) => {
  const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.01},${lat - 0.01},${lng + 0.01},${lat + 0.01}&layer=mapnik&marker=${lat},${lng}`;
  
  return (
    <iframe
      src={mapUrl}
      style={{ 
        width: '100%', 
        height: '100%', 
        border: 'none',
        borderRadius: '0.375rem'
      }}
      title={locationName || 'Location Map'}
    />
  );
};
