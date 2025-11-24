import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';

// You can get a free Mapbox token at https://account.mapbox.com/
mapboxgl.accessToken = 'pk.eyJ1IjoibG92YWJsZS1kZXYiLCJhIjoiY20zODZ6ZDZ5MGYydjJqczhybmo5YjBnbCJ9.6_KlNjM0EfVaEq2pjPmYRg';

interface LocationMapProps {
  lat: number;
  lng: number;
}

export const LocationMap = ({ lat, lng }: LocationMapProps) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [lng, lat],
      zoom: 14,
    });

    new mapboxgl.Marker({ color: '#ef4444' })
      .setLngLat([lng, lat])
      .addTo(map.current);

    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

    return () => {
      map.current?.remove();
    };
  }, [lat, lng]);

  return <div ref={mapContainer} className="w-full h-full" />;
};
