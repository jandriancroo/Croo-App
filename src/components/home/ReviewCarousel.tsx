import { useEffect, useRef, useState } from "react";
import { fetchPublicReviews, type PublicReview } from "@/lib/customerReviewsApi";

export const JOHNNY_QUOTE = "“I have seen a lot of restaurant software. Some of it is useful. None of it combined ease of use with an operations perspective the way CrooHQ does.”";
const INTERVAL_MS = 7000;

type Slide = {
  id: string;
  text: string;
  name: string;
  detail?: string;
  photo?: string;
  href?: string;
  ask?: boolean;
};

const JOHNNY: Slide = {
  id: "johnny",
  text: JOHNNY_QUOTE,
  name: "Johnny Tellez",
  detail: "20+ Year Restaurant Exec · El Jefe Enterprises",
  photo: "/johnny-headshot.jpg",
  href: "https://eljefe-enterprises.com",
  ask: true,
};

const CSS = `
.hme .review-rotator{min-width:0}
.hme .review-stage{display:grid;flex:1}
.hme .review-slide{grid-area:1/1;display:flex;opacity:0;visibility:hidden;pointer-events:none;transition:opacity .6s ease}
.hme .review-slide.is-active{opacity:1;visibility:visible;pointer-events:auto;z-index:1}
.hme .review-slide a,.hme .review-copy{display:flex;flex-direction:column;justify-content:space-between;gap:24px;width:100%;color:inherit;text-decoration:none}
.hme .review-dots{display:flex;gap:2px;align-items:center;margin-top:8px}
.hme .review-dots button{width:44px;height:44px;border:0;background:transparent;cursor:pointer;padding:0}
.hme .review-dots button{display:grid;place-items:center}
.hme .review-dots button i{display:block;width:10px;height:10px;border-radius:99px;background:rgba(255,255,255,.45)}
.hme .review-dots button[aria-selected="true"] i{background:#fff}
.hme .review-dots button:focus-visible{outline:3px solid var(--orange);outline-offset:2px;border-radius:12px}
@media (prefers-reduced-motion: reduce){.hme .review-slide{transition:none}}
`;

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function toSlides(reviews: PublicReview[]): Slide[] {
  const extras = [...reviews]
    .filter(review => review.text.trim() && review.attribution.trim())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(review => ({ id: review.id, text: review.text, name: review.attribution }));
  return [JOHNNY, ...extras];
}

export default function ReviewCarousel({ load = fetchPublicReviews }: { load?: () => Promise<PublicReview[]> }) {
  const loadRef = useRef(load);
  const [reviews, setReviews] = useState<PublicReview[]>([]);
  const [index, setIndex] = useState(0);
  const [hovering, setHovering] = useState(false);
  const [focused, setFocused] = useState(false);
  const [reduced, setReduced] = useState(prefersReducedMotion);
  const slides = toSlides(reviews);
  const paused = hovering || focused || reduced || slides.length < 2;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener?.("change", sync);
    return () => media.removeEventListener?.("change", sync);
  }, []);

  useEffect(() => {
    let cancel = false;
    loadRef.current()
      .then(rows => { if (!cancel && rows.length) setReviews(rows); })
      .catch(() => { if (!cancel) setReviews([]); });
    return () => { cancel = true; };
  }, []);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => setIndex(current => (current + 1) % slides.length), INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [paused, slides.length]);

  const active = Math.min(index, slides.length - 1);

  return (
    <section
      className="tile t1 rv review-rotator"
      aria-roledescription="carousel"
      aria-label="What operators say"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocus={() => setFocused(true)}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    >
      <style>{CSS}</style>
      <div className="review-stage">
        {slides.map((slide, slideIndex) => {
          const on = slideIndex === active;
          const body = (
            <>
              <p className="quote">{slide.text}</p>
              <div className="testimonial-foot">
                <div className="by">
                  {slide.photo ? <img className="ph" src={slide.photo} alt={slide.name} width={48} height={48} loading="lazy" /> : null}
                  <div><b>{slide.name}</b>{slide.detail ? <small>{slide.detail}</small> : null}</div>
                </div>
                {slide.ask ? <p className="ask">Ask me how I can help your business through <img src="/eljefe-stamp.png" alt="El Jefe Enterprises" loading="lazy" /></p> : null}
              </div>
            </>
          );
          return (
            <div key={slide.id} className={on ? "review-slide is-active" : "review-slide"} aria-hidden={!on} {...(on ? {} : { inert: "" })}>
              {slide.href ? (
                <a href={slide.href} target="_blank" rel="noopener noreferrer" tabIndex={on ? 0 : -1}>{body}</a>
              ) : (
                <div className="review-copy">{body}</div>
              )}
            </div>
          );
        })}
      </div>
      <div className="review-dots" role="tablist" aria-label="Reviews">
        {slides.map((slide, slideIndex) => (
          <button
            key={slide.id}
            type="button"
            role="tab"
            aria-selected={slideIndex === active}
            aria-label={`Show review ${slideIndex + 1} of ${slides.length}, ${slide.name}`}
            onClick={() => setIndex(slideIndex)}
          >
            <i />
          </button>
        ))}
      </div>
    </section>
  );
}
