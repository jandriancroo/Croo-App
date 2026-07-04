import { useEffect } from 'react';

interface Props {
  images: string[];
  index: number;
  isDay: boolean;
}

export default function RotatingAuthBackground({ images, index, isDay }: Props) {
  const activeIndex = images.length ? index % images.length : 0;

  useEffect(() => {
    if (!images.length) return;
    const next = images[(index + 1) % images.length];
    const img = new Image();
    img.src = next;
  }, [index, images]);

  if (!images.length) {
    return <div data-auth-background className="fixed inset-0 z-0 overflow-hidden bg-background" aria-hidden />;
  }

  return (
    <div data-auth-background className="fixed inset-0 z-0 overflow-hidden bg-background pointer-events-none" aria-hidden>
      {images.map((src, i) => (
        <img
          key={src}
          data-auth-bg-slide
          src={src}
          alt=""
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover transition-opacity duration-[2000ms] ease-in-out"
          style={{ opacity: i === activeIndex ? 1 : 0 }}
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
