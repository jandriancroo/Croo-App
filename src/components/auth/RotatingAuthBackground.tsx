import { useEffect, useMemo, useState } from 'react';
import beachDay from '@/assets/auth-bg/beach-day.jpg.asset.json';
import cityDay from '@/assets/auth-bg/city-day.jpg.asset.json';
import desDay from '@/assets/auth-bg/des-day.jpg.asset.json';
import mtnDay from '@/assets/auth-bg/mtn-day.jpg.asset.json';
import townDay from '@/assets/auth-bg/town-day.jpg.asset.json';
import beachNight from '@/assets/auth-bg/beach-night.jpg.asset.json';
import cityNight from '@/assets/auth-bg/city-night.jpg.asset.json';
import desNight from '@/assets/auth-bg/des-night.jpg.asset.json';
import mtnNight from '@/assets/auth-bg/mtn-night.jpg.asset.json';
import townNight from '@/assets/auth-bg/town-night.jpg.asset.json';

const DAY_IMAGES = [beachDay.url, cityDay.url, desDay.url, mtnDay.url, townDay.url];
const NIGHT_IMAGES = [beachNight.url, cityNight.url, desNight.url, mtnNight.url, townNight.url];

const ROTATE_MS = 60_000;

function isDaytime(d = new Date()) {
  const h = d.getHours();
  return h >= 6 && h < 19; // 6am - 7pm local
}

export default function RotatingAuthBackground() {
  const [isDay, setIsDay] = useState(isDaytime());
  const images = useMemo(() => (isDay ? DAY_IMAGES : NIGHT_IMAGES), [isDay]);
  const [index, setIndex] = useState(() => Math.floor(Math.random() * 5));

  useEffect(() => {
    const id = setInterval(() => setIsDay(isDaytime()), 5 * 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % images.length);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [images.length]);

  useEffect(() => {
    const next = images[(index + 1) % images.length];
    const img = new Image();
    img.src = next;
  }, [index, images]);

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-background">
      {images.map((src, i) => (
        <div
          key={src}
          aria-hidden
          className="absolute inset-0 transition-opacity duration-[2000ms] ease-in-out bg-cover bg-center"
          style={{
            backgroundImage: `url(${src})`,
            opacity: i === index ? 1 : 0,
          }}
        />
      ))}
      <div
        className="absolute inset-0 transition-colors duration-1000"
        style={{
          background: isDay
            ? 'linear-gradient(135deg, hsl(var(--background) / 0.35), hsl(var(--primary) / 0.15))'
            : 'linear-gradient(135deg, hsl(0 0% 0% / 0.55), hsl(var(--primary) / 0.25))',
        }}
      />
    </div>
  );
}
