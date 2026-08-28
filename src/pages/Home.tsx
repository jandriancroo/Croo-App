import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";

/**
 * Public marketing homepage at `/` (unauthenticated only).
 * Self-contained styles scoped under `.hme` so nothing here touches the app theme.
 */
const MAILTO = "mailto:jordan@croohq.com";

const CSS = `
.hme {
  --paper: #f3eee6;
  --ink: #1a1a1a;
  --muted: #5c5852;
  --teal: #417f8e;
  --teal-d: #2e6270;
  --white: #fffcf7;
  --line: rgba(26,26,26,.12);
  --orange: #eb7d3c;
  --orange-d: #d66b2c;
  background: var(--paper);
  color: var(--ink);
  min-height: 100vh;
  font-family: Manrope, "Liberation Sans", system-ui, sans-serif;
  font-weight: 500;
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
}
.hme * { box-sizing: border-box; margin: 0; padding: 0; }
.hme a { color: inherit; text-decoration: none; }
.hme .wrap { width: min(1120px, calc(100% - 48px)); margin: 0 auto; }

.hme header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 0 18px; flex-wrap: wrap; }
.hme .logo { height: 34px; width: auto; display: block; }
.hme nav { display: flex; align-items: center; gap: 26px; font-size: 14px; font-weight: 600; color: var(--muted); flex-wrap: wrap; }
.hme nav a:hover { color: var(--ink); }
.hme .actions { display: flex; align-items: center; gap: 10px; }

.hme .btn { display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; padding: 12px 20px; font-weight: 700; font-size: 14px; border: 1.5px solid transparent; cursor: pointer; }
.hme .btn-primary { background: var(--teal); color: #fff; }
.hme .btn-primary:hover { background: var(--teal-d); }
.hme .btn-app { background: var(--orange); color: #fff; }
.hme .btn-app:hover { background: var(--orange-d); }
.hme .btn-ghost { background: transparent; border-color: var(--line); color: var(--ink); }
.hme .btn-lg { padding: 16px 26px; font-size: 16px; }

.hme h1 { font-family: Fraunces, "DejaVu Serif", Georgia, serif; font-weight: 500; font-size: clamp(38px, 6vw, 72px); line-height: 1.03; letter-spacing: -0.03em; }
.hme h2 { font-family: Fraunces, "DejaVu Serif", Georgia, serif; font-weight: 500; font-size: clamp(28px, 4vw, 46px); letter-spacing: -0.03em; line-height: 1.1; max-width: 20ch; }
.hme h3 { font-size: 16px; font-weight: 800; }

.hme .hero { padding: 26px 0 10px; }
.hme .hero-grid { display: grid; grid-template-columns: 1.05fr .95fr; gap: 52px; align-items: center; }
.hme .pairline { font-family: Fraunces, Georgia, serif; font-size: clamp(20px, 2.4vw, 27px); color: var(--teal); font-style: italic; margin-bottom: 10px; letter-spacing: -0.02em; }
.hme .sub { font-size: 19px; color: var(--ink); max-width: 46ch; margin: 20px 0 14px; }
.hme .stackline { font-size: 17px; color: var(--muted); max-width: 48ch; margin-bottom: 26px; }
.hme .cta-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
.hme .fine { margin-top: 14px; font-size: 13px; color: var(--muted); }
.hme .shot { width: 100%; height: auto; display: block; border-radius: 20px; border: 1px solid var(--line); box-shadow: 0 24px 50px rgba(65,127,142,.18); }

.hme .proof { margin: 46px 0 8px; padding: 20px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); display: flex; gap: 18px; align-items: baseline; justify-content: space-between; flex-wrap: wrap; }
.hme .proof strong { font-size: 15px; }
.hme .proof span { font-size: 14px; color: var(--muted); font-weight: 600; }

.hme section.blk { padding: 68px 0; }
.hme .lead { font-size: 18px; color: var(--muted); max-width: 56ch; margin-top: 16px; }

.hme table.stack { width: 100%; border-collapse: collapse; margin-top: 30px; background: var(--white); border: 1px solid var(--line); border-radius: 16px; overflow: hidden; }
.hme table.stack th { text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); padding: 14px 18px; border-bottom: 1px solid var(--line); }
.hme table.stack td { padding: 14px 18px; border-top: 1px solid var(--line); font-size: 15px; vertical-align: top; }
.hme table.stack td:last-child { color: var(--teal-d); font-weight: 700; }
.hme .note { margin-top: 16px; font-size: 14px; color: var(--muted); }

.hme ol.steps { margin-top: 28px; display: grid; gap: 14px; list-style: none; counter-reset: s; }
.hme ol.steps li { counter-increment: s; background: var(--white); border: 1px solid var(--line); border-radius: 14px; padding: 16px 18px 16px 56px; position: relative; font-size: 16px; }
.hme ol.steps li::before { content: counter(s); position: absolute; left: 16px; top: 14px; width: 26px; height: 26px; border-radius: 999px; background: var(--teal); color: #fff; font-size: 13px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
.hme .chips { margin-top: 26px; display: flex; gap: 10px; flex-wrap: wrap; }
.hme .chip { border: 1px solid var(--line); border-radius: 999px; padding: 8px 14px; font-size: 13px; font-weight: 700; color: var(--muted); background: var(--white); }

.hme .eyebrow { color: var(--teal); font-weight: 700; font-size: 13px; letter-spacing: .1em; text-transform: uppercase; margin-bottom: 12px; }
.hme .band { background: var(--white); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.hme .body-copy { font-size: 18px; color: var(--muted); max-width: 54ch; margin-top: 18px; }
.hme .body-copy + .body-copy { margin-top: 12px; }

.hme footer { border-top: 1px solid var(--line); padding: 30px 0 44px; font-size: 14px; color: var(--muted); display: flex; justify-content: space-between; gap: 18px; flex-wrap: wrap; }
.hme footer nav { gap: 20px; }

.hme .jobs-band { background: var(--teal); color: #fff; }
.hme .jobs-band .eyebrow { color: rgba(255,255,255,.88); }
.hme .jobs-band h2 { color: #fff; }
.hme .jobs-band .body-copy { color: rgba(255,252,247,.9); }
.hme .jobs-band .btn-primary { background: #fff; color: var(--teal-d); }
.hme .jobs-band .btn-primary:hover { background: var(--white); }

.hme .hero-visual { display: flex; flex-direction: column; gap: 14px; }
.hme .jefe { display: block; background: var(--white); border: 1px solid rgba(65,127,142,.28); border-radius: 18px; padding: 20px; color: inherit; transition: transform .15s ease, box-shadow .15s ease, border-color .15s ease; }
.hme .jefe:hover { border-color: var(--teal); box-shadow: 0 8px 24px rgba(65,127,142,.16); transform: translateY(-1px); }
.hme .jefe-quote { font-family: Fraunces, Georgia, serif; font-style: italic; font-weight: 500; font-size: 15px; line-height: 1.4; }
.hme .jefe-byline { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
.hme .jefe-photo { width: 40px; height: 40px; border-radius: 999px; object-fit: cover; flex-shrink: 0; }
.hme .jefe-id { display: flex; flex-direction: column; gap: 1px; font-size: 11px; color: var(--muted); font-weight: 500; }
.hme .jefe-id strong { font-size: 12px; font-weight: 700; color: var(--ink); }
.hme .jefe-ask { margin-top: 2px; display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: var(--teal-d); flex-wrap: wrap; }
.hme .jefe-stamp { height: 36px; width: auto; display: block; }

@media (max-width: 900px) {
  .hme .hero-grid { grid-template-columns: 1fr; gap: 30px; }
  .hme .wrap { width: calc(100% - 32px); }
  .hme section.blk { padding: 52px 0; }
  .hme h2 { max-width: none; }
}
`;

const STACK_ROWS: [string, string][] = [
  ["Scheduling software", "Scheduling"],
  ["Checklist / audit app", "Checklists, tasks, manager logs"],
  ["Hiring software", "Hiring"],
  ["Inventory and labor tools", "Inventory, labor, USAGE"],
  ["Punch clock, paper, group text", "Punch clock, time, team chat, recipes"],
];

const STEPS = [
  "Checklists and recipes in one store.",
  "Punch clock, cash, inventory in a workshop. Weeks, not a self-serve login.",
  "Scheduling and labor once the team is actually using it.",
  "Next location when the first one is real.",
];

const CHIPS = [
  "Checklists, recipes, manager logs",
  "Scheduling and labor %",
  "Punch clock (PIN, tablet, PWA)",
  "Team chat",
  "Hiring / jobs board",
  "Sales / labor dashboard",
  "Inventory and COGS",
];

const Home = () => {
  return (
    <div className="hme">
      <Helmet>
        <title>CrooHQ — Restaurant operation system, built by an operator</title>
        <meta
          name="description"
          content="Replace the $600 tool stack. Scheduling, punch clock, checklists, hiring, labor, and inventory. Built by an operator."
        />
        <link rel="canonical" href="https://croohq.com/" />
        <meta property="og:title" content="CrooHQ — Restaurant operation system, built by an operator" />
        <meta
          property="og:description"
          content="Replace the $600 tool stack. Scheduling, punch clock, checklists, hiring, labor, and inventory. Built by an operator."
        />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://croohq.com/" />
        <meta property="og:image" content="https://croohq.com/croohq-ipad-punch.png" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:image" content="https://croohq.com/croohq-ipad-punch.png" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Manrope:wght@500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <style type="text/css">{CSS}</style>
      </Helmet>

      <div className="wrap">
        <header>
          <img src="/croohq-logo.png" alt="CrooHQ" className="logo" width={140} height={34} />
          <nav>
            <a href="#how">How it works</a>
            <a href="#stack">Replace the stack</a>
            <Link to="/jobs">Jobs</Link>
          </nav>
          <div className="actions">
            <Link className="btn btn-app" to="/auth">App Login</Link>
            <a className="btn btn-primary" href={MAILTO}>Book a walkthrough</a>
          </div>
        </header>

        <section className="hero">
          <div className="hero-grid">
            <div>
              <p className="pairline">Built for operators, by operators.</p>
              <h1>Your crew’s HQ.</h1>
              <p className="sub">
                Operators buy it. The crew actually runs it. Meet them on the floor, on an iPad, not on a desktop.
              </p>
              <p className="stackline">
                You're paying $600 a month for scheduling, checklists, hiring, inventory, a punch clock, and a group
                chat. CrooHQ replaces that stack.
              </p>
              <div className="cta-row">
                <a className="btn btn-primary btn-lg" href={MAILTO}>Book a 20-minute walkthrough</a>
              </div>
              <p className="fine">14-day trial. No hostage contract. Sold per location.</p>
            </div>
            <div className="hero-visual">
              <a
                className="jefe"
                href="https://eljefe-enterprises.com"
                target="_blank"
                rel="noopener noreferrer"
              >
                <p className="jefe-quote">
                  “I have seen a lot of restaurant software. Some of it is useful. None of it combined ease of use with an operations perspective the way CrooHQ does.”
                </p>
                <div className="jefe-byline">
                  <img className="jefe-photo" src="/johnny-headshot.jpg" alt="Johnny Tellez" width={40} height={40} />
                  <div className="jefe-id">
                    <strong>Johnny Tellez</strong>
                    <span>20+ Year Restaurant Exec</span>
                    <span>El Jefe Enterprises</span>
                  </div>
                </div>
                <p className="jefe-ask">
                  Ask me how I can help your business through
                  <img className="jefe-stamp" src="/eljefe-stamp.png" alt="El Jefe Enterprises" />
                </p>
              </a>
              <img
                className="shot"
                src="/croohq-ipad-punch.png"
                alt="CrooHQ punch clock PIN screen on an iPad on a restaurant counter"
                width={1536}
                height={1024}
              />
            </div>
          </div>
        </section>

        <div className="proof">
          <strong>Live in real QSR kitchens.</strong>
          <span>Punch clock · Checklists · Scheduling · Hiring · Inventory</span>
        </div>

        <section className="blk" id="stack">
          <h2>A pile of tools. None of them talk to each other.</h2>
          <p className="lead">Most multi-unit operators did not choose a stack. They accumulated one.</p>
          <table className="stack">
            <thead>
              <tr>
                <th>What you already pay for</th>
                <th>What CrooHQ covers</th>
              </tr>
            </thead>
            <tbody>
              {STACK_ROWS.map(([a, b]) => (
                <tr key={a}>
                  <td>{a}</td>
                  <td>{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note">One system. Per location. Price comes on a walkthrough, not a grid.</p>
        </section>
      </div>

      <div className="band">
        <div className="wrap">
          <section className="blk" id="how">
            <h2>We do not rip out the restaurant on day one.</h2>
            <ol className="steps">
              {STEPS.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <div className="chips">
              {CHIPS.map((c) => (
                <span className="chip" key={c}>{c}</span>
              ))}
            </div>
          </section>
        </div>
      </div>

      <div className="wrap">
        <section className="blk">
          <p className="eyebrow">Operators</p>
          <h2>Built by operators. For the people on the floor.</h2>
          <p className="body-copy">The founders wanted a system that actually connected with restaurant staff.</p>
          <p className="body-copy">
            The features exist because real operators and their crews thought them up, then had to run them.
          </p>
          <div className="cta-row" style={{ marginTop: 26 }}>
            <a className="btn btn-primary btn-lg" href={MAILTO}>Talk to an operator, not a sales pod.</a>
          </div>
        </section>

        <section className="blk" style={{ paddingTop: 0 }}>
          <h2>Less than half your current stack. One bill, one system.</h2>
        </section>
      </div>

      <div className="wrap">
        <section className="blk">
          <h2>If you do not love it, you are not stuck.</h2>
          <p className="body-copy">
            I am not looking to hold anyone hostage who does not love the CrooHQ experience.
          </p>
          <div className="cta-row" style={{ marginTop: 26 }}>
            <a className="btn btn-primary btn-lg" href={MAILTO}>Book a walkthrough</a>
          </div>
        </section>
      </div>

      <div className="jobs-band">
        <div className="wrap">
          <section className="blk" id="jobs">
            <p className="eyebrow">Looking for a job?</p>
            <h2>Restaurant roles are already posted.</h2>
            <p className="body-copy">
              Open crew and manager roles in Southern California. Apply on the jobs board.
            </p>
            <div className="cta-row" style={{ marginTop: 26 }}>
              <Link className="btn btn-primary btn-lg" to="/jobs">See open jobs</Link>
            </div>
          </section>
        </div>
      </div>

      <div className="wrap">
        <footer>
          <span>croohq.com · Built for operators, by operators.</span>
          <nav>
            <Link to="/jobs">Jobs</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
            <Link to="/auth">Log in</Link>
          </nav>
        </footer>
      </div>
    </div>
  );
};

export default Home;
