import { useMemo, useState, type FormEvent } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { SiteFooter } from "@/components/marketing/SiteFooter";

/** Public anon key already shipped in the SupaClose booking page. Not a secret. */
const REQUEST_DEMO_URL = "https://hqadffricxfsbggqdqak.supabase.co/functions/v1/request-demo";
const REQUEST_DEMO_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhxYWRmZnJpY3hmc2JnZ3FkcWFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1NzM4ODQsImV4cCI6MjA5MDE0OTg4NH0.f1wRb9g0RzmmLnDFx1q1b3JaE5uriyZRgHkymtPGojY";

const SLOTS = [
  { label: "9:00 – 10:00 AM", hour: 9 },
  { label: "11:00 AM – 12:00 PM", hour: 11 },
  { label: "1:00 – 2:00 PM", hour: 13 },
  { label: "3:00 – 4:00 PM", hour: 15 },
] as const;

const MAX_SLOTS = 3;
const LEAD_MS = 48 * 60 * 60 * 1000;

export function upcomingWeekdays(now = Date.now()) {
  const earliest = new Date(now + LEAD_MS);
  const cursor = new Date(earliest);
  const days: Date[] = [];
  for (cursor.setHours(0, 0, 0, 0); days.length < 10; cursor.setDate(cursor.getDate() + 1)) {
    const weekday = cursor.getDay();
    if (weekday !== 0 && weekday !== 6) days.push(new Date(cursor));
  }
  return { days, earliest };
}

export function dayLabel(date: Date) {
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function slotStartsTooSoon(day: Date, hour: number, earliest: Date) {
  const start = new Date(day);
  start.setHours(hour, 0, 0, 0);
  return start < earliest;
}

const CSS = `
.bd{min-height:100vh;background:#fbf8f3;color:#1a1a1a;font-family:Manrope,sans-serif;line-height:1.45}
.bd a{color:inherit;text-decoration:none}
.bd-wrap{width:min(1100px,calc(100% - 40px));margin:0 auto}
.bd-hd{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 0}
.bd-logo{height:32px}
.bd-nav{display:flex;gap:22px;align-items:center;font-size:14px;font-weight:700;color:#5c5852}
.bd-login{background:#eb7d3c;color:#fff;border-radius:999px;padding:12px 20px}
.bd-main{padding:24px 0 64px}
.bd-card{overflow:hidden;border-radius:30px;background:#fff;box-shadow:0 2px 24px rgba(20,30,40,.08)}
.bd-band{background:#417f8e;color:#fff;padding:36px 32px}
.bd-kicker{margin:0 0 8px;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.85)}
.bd-band h1{margin:0;font-size:32px;line-height:1.15;font-weight:800}
.bd-band p{margin:10px 0 0;max-width:42ch;color:rgba(255,255,255,.9)}
.bd-form,.bd-done{padding:32px}
.bd-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.bd-field{display:flex;flex-direction:column;gap:6px}
.bd-field.wide{grid-column:1 / -1}
.bd-field span{font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#5c5852}
.bd input,.bd textarea{font:inherit;color:#1a1a1a;background:#fff;border:1px solid rgba(26,26,26,.16);border-radius:12px;padding:12px 14px}
.bd textarea{resize:vertical}
.bd-times{margin-top:28px}
.bd-times-head{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.bd-times-head strong{font-size:15px}
.bd-times-head small{color:#5c5852}
.bd-days{display:flex;gap:8px;overflow-x:auto;padding-bottom:8px}
.bd-day,.bd-slot{font:inherit;font-weight:700;border-radius:12px;border:1px solid #e4dccd;background:#f7f2e6;color:#1a1a1a;cursor:pointer}
.bd-day{flex:none;padding:8px 12px;font-size:12px}
.bd-day[aria-pressed=true],.bd-slot[aria-pressed=true]{background:#417f8e;border-color:#417f8e;color:#fff}
.bd-slots{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}
.bd-slot{text-align:left;padding:12px 14px;font-size:14px;background:#fff}
.bd-slot:disabled{opacity:.4;cursor:not-allowed}
.bd-picked{margin-top:12px;background:#f7f2e6;border-radius:12px;padding:12px}
.bd-picked p{margin:0 0 8px;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#2e6270}
.bd-chip{border:0;background:#fff;border-radius:999px;padding:6px 12px;margin:0 8px 8px 0;font:inherit;font-size:12px;font-weight:700;cursor:pointer}
.bd-notes{margin-top:24px}
.bd-submit{margin-top:24px;width:100%;border:0;border-radius:12px;background:#417f8e;color:#fff;font:inherit;font-weight:800;font-size:16px;padding:14px 20px;cursor:pointer}
.bd-submit:disabled{opacity:.7;cursor:progress}
.bd-fine,.bd-error{font-size:13px;color:#5c5852;text-align:center}
.bd-error{color:#9f2d2d;text-align:left;font-weight:700}
.bd-done{text-align:center;padding:56px 32px}
.bd-done h2{margin:0 0 8px;font-size:24px}
.bd-done p{margin:0 auto;max-width:42ch;color:#5c5852}
.bd-foot{padding-bottom:8px}
@media(max-width:760px){
  .bd-nav a:not(.bd-login){display:none}
  .bd-grid,.bd-slots{grid-template-columns:1fr}
  .bd-band,.bd-form,.bd-done{padding:24px 18px}
  .bd-logo{height:26px}
}
`;

export default function BookDemo() {
  const { days, earliest } = useMemo(() => upcomingWeekdays(), []);
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "", []);
  const [dayIndex, setDayIndex] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [franchise, setFranchise] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const day = days[dayIndex] ?? days[0];

  const toggle = (slot: string) => {
    setNotice("");
    setPicked(current => {
      if (current.includes(slot)) return current.filter(item => item !== slot);
      if (current.length >= MAX_SLOTS) {
        setNotice(`Pick up to ${MAX_SLOTS} times`);
        return current;
      }
      return [...current, slot];
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (picked.length === 0) {
      setError("Please pick at least one time that works for you");
      return;
    }
    setError("");
    setSending(true);
    try {
      const response = await fetch(REQUEST_DEMO_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: REQUEST_DEMO_ANON_KEY,
          Authorization: `Bearer ${REQUEST_DEMO_ANON_KEY}`,
        },
        body: JSON.stringify({
          name,
          email,
          company,
          franchise,
          phone,
          notes,
          timezone,
          preferred_slots: picked,
        }),
      });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok || data?.error) {
        setError(data?.error || "Something went wrong");
        return;
      }
      setSent(true);
    } catch {
      setError("Something went wrong");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bd">
      <Helmet>
        <title>Book a CrooHQ demo</title>
        <meta name="description" content="Tell us about your restaurants and pick a few times. CrooHQ emails you to confirm a walkthrough. Nothing is booked until you confirm." />
        <link rel="canonical" href="https://croohq.com/demo" />
        <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&display=swap" rel="stylesheet" />
      </Helmet>
      <style>{CSS}</style>
      <div className="bd-wrap">
        <header className="bd-hd">
          <Link to="/"><img className="bd-logo" src="/croohq-wordmark.png" alt="CrooHQ" width={136} height={32} /></Link>
          <nav className="bd-nav" aria-label="Main navigation">
            <a href="/blog/">Blog</a>
            <Link to="/jobs">Jobs</Link>
            <Link className="bd-login" to="/auth">App Login</Link>
          </nav>
        </header>
        <main className="bd-main">
          <div className="bd-card">
            <div className="bd-band">
              <p className="bd-kicker">Book a demo</p>
              <h1>See CrooHQ in action</h1>
              <p>Tell us a bit about your operation and pick a few times that work. We'll reach out to confirm your slot as soon as possible.</p>
            </div>
            {sent ? (
              <div className="bd-done">
                <h2>Request sent</h2>
                <p>Nothing is booked yet — we've got your preferred times and we'll email you shortly to confirm. A copy is on its way to {email}.</p>
              </div>
            ) : (
              <form className="bd-form" onSubmit={submit}>
                <div className="bd-grid">
                  <label className="bd-field">
                    <span>Your name *</span>
                    <input required value={name} onChange={event => setName(event.target.value)} placeholder="Jane Smith" autoComplete="name" />
                  </label>
                  <label className="bd-field">
                    <span>Company</span>
                    <input value={company} onChange={event => setCompany(event.target.value)} placeholder="Smith Restaurant Group" autoComplete="organization" />
                  </label>
                  <label className="bd-field">
                    <span>Franchise (if any)</span>
                    <input value={franchise} onChange={event => setFranchise(event.target.value)} placeholder="e.g. Wingstop, Subway" />
                  </label>
                  <label className="bd-field">
                    <span>Phone</span>
                    <input type="tel" value={phone} onChange={event => setPhone(event.target.value)} placeholder="(555) 123-4567" autoComplete="tel" />
                  </label>
                  <label className="bd-field wide">
                    <span>Email *</span>
                    <input required type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@company.com" autoComplete="email" />
                  </label>
                </div>
                <div className="bd-times">
                  <div className="bd-times-head">
                    <strong>Pick a few times that work</strong>
                    <small>Up to {MAX_SLOTS} · {timezone || "your local time"}</small>
                  </div>
                  <div className="bd-days" role="group" aria-label="Days">
                    {days.map((item, index) => (
                      <button type="button" className="bd-day" key={item.toISOString()} aria-pressed={index === dayIndex} onClick={() => setDayIndex(index)}>{dayLabel(item)}</button>
                    ))}
                  </div>
                  <div className="bd-slots">
                    {SLOTS.map(slot => {
                      const id = `${dayLabel(day)} · ${slot.label}`;
                      const selected = picked.includes(id);
                      const disabled = slotStartsTooSoon(day, slot.hour, earliest);
                      return (
                        <button type="button" className="bd-slot" key={slot.hour} disabled={disabled} aria-pressed={selected} onClick={() => toggle(id)}>{slot.label}</button>
                      );
                    })}
                  </div>
                  {picked.length > 0 && (
                    <div className="bd-picked">
                      <p>Your preferred times</p>
                      {picked.map(slot => (
                        <button type="button" className="bd-chip" key={slot} onClick={() => toggle(slot)}>{slot} ✕</button>
                      ))}
                    </div>
                  )}
                  {notice && <p className="bd-fine" role="status">{notice}</p>}
                </div>
                <label className="bd-field bd-notes">
                  <span>Anything we should know?</span>
                  <textarea rows={3} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Number of locations, what you're hoping to solve, etc." />
                </label>
                {error && <p className="bd-error" role="alert">{error}</p>}
                <button className="bd-submit" type="submit" disabled={sending}>{sending ? "Sending…" : "Request my demo"}</button>
                <p className="bd-fine">This doesn't book anything yet — we'll email you to confirm the slot as soon as possible.</p>
              </form>
            )}
          </div>
        </main>
        <div className="bd-foot">
          <SiteFooter>
            <nav aria-label="Footer navigation">
              <Link to="/">Home</Link>
              <a href="/blog/">Blog</a>
              <Link to="/privacy">Privacy Policy</Link>
              <Link to="/terms">Terms</Link>
            </nav>
          </SiteFooter>
        </div>
      </div>
    </div>
  );
}
