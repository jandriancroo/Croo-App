import { useEffect, useMemo, useState } from 'react';
import day1 from '@/assets/auth-bg/day-1.jpg';
import day2 from '@/assets/auth-bg/day-2.jpg';
import day3 from '@/assets/auth-bg/day-3.jpg';
import night1 from '@/assets/auth-bg/night-1.jpg';
import night2 from '@/assets/auth-bg/night-2.jpg';
import night3 from '@/assets/auth-bg/night-3.jpg';

const DAY_IMAGES = [day1, day2, day3];
const NIGHT_IMAGES = [night1, night2, night3];

const ROTATE_MS = 60_000;

function isDaytime(d = new Date()) {
  const h = d.getHours();
  return h >= 6 && h < 19; // 6am - 7pm local
}

export default function RotatingAuthBackground() {
  const [isDay, setIsDay] = useState(isDaytime());
  const images = useMemo(() => (isDay ? DAY_IMAGES : NIGHT_IMAGES), [isDay]);
  const [index, setIndex] = useState(() => Math.floor(Math.random() * 3));

  // Re-evaluate day/night every 5 min
  useEffect(() => {
    const id = setInterval(() => setIsDay(isDaytime()), 5 * 60_000);
    return () => clearInterval(id);
  }, []);

  // Rotate every minute
  useEffect(() => {
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % images.length);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [images.length]);

  // Preload next image
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
      {/* Tonal overlay for legibility — lighter for day, darker for night */}
      <div
        className="absolute inset-0 transition-colors duration-1000"
        style={{
          background: isDay
            ? 'linear-gradient(135deg, hsl(var(--background) / 0.55), hsl(var(--primary) / 0.25))'
            : 'linear-gradient(135deg, hsl(0 0% 0% / 0.65), hsl(var(--primary) / 0.35))',
        }}
      />
    </div>
  );
}
