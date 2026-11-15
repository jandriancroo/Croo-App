import { useEffect, useState, type ImgHTMLAttributes } from "react";

const PHOTOS = [
  { src: "/hero/kitchen-line.webp", mobile: "/hero/kitchen-line-800.webp" },
  { src: "/hero/manager-opening.webp", mobile: "/hero/manager-opening-800.webp" },
  { src: "/hero/pizza-oven.webp", mobile: "/hero/pizza-oven-800.webp" },
] as const;

const INTERVAL_MS = 6000;

export default function HeroBackground() {
  const [active, setActive] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) return;
    setReady(true);
    const timer = window.setInterval(() => {
      setActive(current => (current + 1) % PHOTOS.length);
    }, INTERVAL_MS);
    const onChange = () => {
      if (!media.matches) return;
      window.clearInterval(timer);
      setActive(0);
    };
    media.addEventListener("change", onChange);
    return () => {
      window.clearInterval(timer);
      media.removeEventListener("change", onChange);
    };
  }, []);

  return (
    <div className="hero-bg" aria-hidden="true">
      {PHOTOS.map((photo, index) => {
        if (index > 0 && !ready) return null;
        return (
          <picture key={photo.src} className={index === active ? "is-active" : undefined}>
            <source media="(max-width: 760px)" srcSet={photo.mobile} />
            <img
              {...({
                src: photo.src,
                alt: "",
                width: 1280,
                height: 720,
                decoding: index === 0 ? "sync" : "async",
                fetchpriority: index === 0 ? "high" : "low",
                loading: index === 0 ? "eager" : "lazy",
              } as ImgHTMLAttributes<HTMLImageElement>)}
            />
          </picture>
        );
      })}
      <div className="hero-shade" />
    </div>
  );
}
