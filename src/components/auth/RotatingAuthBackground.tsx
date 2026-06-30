import { useEffect } from 'react';

interface Props {
  images: string[];
  index: number;
  isDay: boolean;
}

export default function RotatingAuthBackground({ images, index, isDay }: Props) {
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
