import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";

/**
 * Unlisted review page for the CrooHQ landing concept.
 * Path: /r/satnight-8f3k — noindex, not in the sitemap, not linked from anywhere.
 * Self-contained styles, scoped under .rvw so nothing here touches the app theme.
 */
const CSS = `
.rvw {
  --paper: #f3eee6;
  --ink: #1a1a1a;
  --muted: #5c5852;
  --teal: #417f8e;
  --teal-d: #2e6270;
  --white: #fffcf7;
  --line: rgba(26,26,26,.12);
  background: var(--paper);
  color: var(--ink);
  min-height: 100vh;
  font-family: Manrope, "Liberation Sans", system-ui, sans-serif;
  font-weight: 500;
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
}
.rvw * { box-sizing: border-box; margin: 0; padding: 0; }
.rvw a { color: inherit; text-decoration: none; }
.rvw .wrap { width: min(1120px, calc(100% - 48px)); margin: 0 auto; }

.rvw header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 0 18px; flex-wrap: wrap; }
.rvw .logo { height: 34px; width: auto; display: block; }
.rvw nav { display: flex; align-items: center; gap: 28px; font-size: 14px; font-weight: 600; color: var(--muted); }
.rvw nav a:hover { color: var(--ink); }
.rvw .actions { display: flex; align-items: center; gap: 10px; }

.rvw .btn { display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; padding: 12px 20px; font-weight: 700; font-size: 14px; border: 1.5px solid transparent; cursor: pointer; }
.rvw .btn-primary { background: var(--teal); color: #fff; }
.rvw .btn-primary:hover { background: var(--teal-d); }
.rvw .btn-ghost { background: transparent; border-color: var(--line); color: var(--ink); }
.rvw .btn-lg { padding: 16px 26px; font-size: 16px; }

.rvw .hero { padding: 28px 0 8px; }
.rvw .eyebrow { color: var(--teal); font-style: italic; font-weight: 600; font-size: 15px; margin-bottom: 18px; }
.rvw h1 { font-family: Fraunces, "DejaVu Serif", Georgia, serif; font-weight: 500; font-size: clamp(34px, 5.4vw, 68px); line-height: 1.05; letter-spacing: -0.03em; max-width: 15ch; }
.rvw .hero-grid { display: grid; grid-template-columns: 1.15fr .85fr; gap: 56px; align-items: end; margin-top: 8px; }
.rvw .lede { font-size: 18px; color: var(--muted); max-width: 42ch; margin: 22px 0 28px; }
.rvw .cta-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
.rvw .fine { margin-top: 14px; font-size: 13px; color: var(--muted); }

.rvw .product-card { background: var(--white); border: 1px solid var(--line); border-radius: 18px; padding: 18px 18px 14px; box-shadow: 0 18px 40px rgba(65,127,142,.12); }
.rvw .product-card .bar { display: flex; justify-content: space-between; align-items: center; font-size: 12px; font-weight: 700; color: var(--muted); margin-bottom: 14px; }
.rvw .labor { font-variant-numeric: tabular-nums; color: var(--teal); }
.rvw table.sched { width: 100%; border-collapse: collapse; font-size: 13px; }
.rvw table.sched th { text-align: left; font-size: 11px; color: var(--muted); font-weight: 700; padding: 0 8px 8px; }
.rvw table.sched td { padding: 8px; border-top: 1px solid var(--line); }
.rvw .chip { display: inline-block; background: #d7ebe8; color: var(--teal-d); border-radius: 6px; padding: 4px 8px; font-weight: 700; font-size: 12px; }
.rvw .chip.open { background: #efe8d8; color: #6a5a32; }
.rvw .name { font-weight: 700; }

.rvw .proof { display: flex; gap: 28px; flex-wrap: wrap; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: 18px 0; margin: 36px 0 0; font-size: 14px; font-weight: 600; color: var(--muted); }
.rvw .proof b { color: var(--ink); font-weight: 800; }

.rvw section { padding: 88px 0; }
.rvw h2 { font-family: Fraunces, "DejaVu Serif", Georgia, serif; font-weight: 500; font-size: clamp(28px, 4vw, 48px); letter-spacing: -0.03em; line-height: 1.1; max-width: 18ch; }
.rvw .lead { margin-top: 14px; color: var(--muted); max-width: 52ch; font-size: 17px; }

.rvw .stack-table { width: 100%; border-collapse: collapse; margin-top: 36px; background: var(--white); border-radius: 16px; overflow: hidden; border: 1px solid var(--line); }
.rvw .stack-table th, .rvw .stack-table td { text-align: left; padding: 16px 22px; border-bottom: 1px solid var(--line); font-size: 15px; }
.rvw .stack-table th { background: #1a1a1a; color: #fff; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; }
.rvw .stack-table tr:last-child td { border-bottom: 0; }
.rvw .stack-table td:first-child { font-weight: 700; }
.rvw .note { margin-top: 16px; font-size: 15px; color: var(--muted); }

.rvw .steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-top: 36px; }
.rvw .step { background: var(--white); border: 1px solid var(--line); border-radius: 16px; padding: 22px 20px 24px; min-height: 180px; }
.rvw .num { color: var(--teal); font-weight: 800; font-size: 13px; letter-spacing: .08em; margin-bottom: 10px; }
.rvw .step p { font-size: 15px; font-weight: 600; }

.rvw .feats { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 28px; }
.rvw .feat { background: var(--white); border: 1px solid var(--line); border-radius: 999px; padding: 10px 16px; font-size: 14px; font-weight: 600; }

.rvw .founder { display: grid; grid-template-columns: 1.1fr .9fr; gap: 40px; align-items: center; background: #1a1a1a; color: #f3eee6; border-radius: 24px; padding: 56px; }
.rvw .founder h2 { color: #fff; }
.rvw .founder .lead { color: #cfc8bc; }
.rvw .founder .eyebrow { color: #8ec3cf; }

.rvw .close { text-align: center; padding-bottom: 40px; }
.rvw .close h2 { margin: 0 auto 14px; }
.rvw .close .lead { margin: 0 auto 28px; }

.rvw footer { border-top: 1px solid var(--line); padding: 28px 0 48px; display: flex; justify-content: space-between; gap: 20px; flex-wrap: wrap; color: var(--muted); font-size: 13px; font-weight: 600; }
.rvw footer .links { display: flex; gap: 18px; }

@media (max-width: 860px) {
  .rvw .hero-grid { grid-template-columns: 1fr; gap: 32px; align-items: start; }
  .rvw .steps { grid-template-columns: 1fr 1fr; }
  .rvw .founder { grid-template-columns: 1fr; padding: 32px; gap: 24px; }
  .rvw section { padding: 56px 0; }
  .rvw nav { display: none; }
}
@media (max-width: 520px) {
  .rvw .steps { grid-template-columns: 1fr; }
  .rvw .step { min-height: 0; }
}
`;

const MAILTO = "mailto:jordan@croohq.com?subject=CrooHQ%20walkthrough";

export default function ReviewLanding() {
  return (
    <div className="rvw">
      <Helmet>
        <title>CrooHQ — Restaurant operation system, built by an operator</title>
        <meta name="robots" content="noindex, nofollow, noarchive" />
        <meta name="googlebot" content="noindex, nofollow" />
        <meta
          name="description"
          content="CrooHQ replaces the restaurant software stack. Checklists and recipes first, then scheduling, punch, labor, inventory, hiring."
        />
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
            <a href="#jobs">Jobs</a>
          </nav>
          <div className="actions">
            <Link className="btn btn-ghost" to="/auth">Log in</Link>
            <a className="btn btn-primary" href={MAILTO}>Book a walkthrough</a>
          </div>
        </header>

        <section className="hero">
          <p className="eyebrow">Built for operators, by operators.</p>
          <div className="hero-grid">
            <div>
              <h1>The restaurant operation system built by someone who still closes Saturday night.</h1>
              <p className="lede">
                You are paying about $500 a month for Harri, Rizepoint, Workstream, R365, and a group chat.
                CrooHQ replaces that stack. Checklists and recipes first. Then scheduling, punch, labor,
                inventory, hiring.
              </p>
              <div className="cta-row">
                <a className="btn btn-primary btn-lg" href={MAILTO}>Book a 20-minute walkthrough</a>
                <Link className="btn btn-ghost btn-lg" to="/auth">Log in</Link>
              </div>
              <p className="fine">14-day trial. No hostage contract. Sold per location.</p>
            </div>
            <div className="product-card" aria-hidden="true">
              <div className="bar"><span>Tonight · Hemet</span><span className="labor">Labor 18.4%</span></div>
              <table className="sched">
                <thead>
                  <tr><th>Station</th><th>Name</th><th>Shift</th></tr>
                </thead>
                <tbody>
                  <tr><td>BOH</td><td className="name">Maria</td><td><span className="chip">10a–6p</span></td></tr>
                  <tr><td>Oven</td><td className="name">Luis</td><td><span className="chip">11a–7p</span></td></tr>
                  <tr><td>FOH</td><td className="name">Ava</td><td><span className="chip">4p–close</span></td></tr>
                  <tr><td>Shift lead</td><td className="name">Jordan</td><td><span className="chip open">On</span></td></tr>
                </tbody>
              </table>
            </div>
          </div>
          <div className="proof">
            <span>Live in real QSR kitchens. <b>Including stores I still run.</b></span>
            <span>Punch clock · Checklists · Scheduling · Hiring · Inventory</span>
          </div>
        </section>

        <section id="stack">
          <h2>Four tools. None of them talk to each other.</h2>
          <p className="lead">Most multi-unit operators did not choose a stack. They accumulated one.</p>
          <table className="stack-table">
            <thead>
              <tr><th>What you have</th><th>What CrooHQ covers</th></tr>
            </thead>
            <tbody>
              <tr><td>Harri</td><td>Scheduling, hiring</td></tr>
              <tr><td>Rizepoint</td><td>Checklists, tasks, manager logs</td></tr>
              <tr><td>Workstream</td><td>Hiring</td></tr>
              <tr><td>R365</td><td>Inventory, labor, USAGE</td></tr>
              <tr><td>Teamworks / paper / group text</td><td>Punch clock, time, team chat, recipes</td></tr>
            </tbody>
          </table>
          <p className="note">One system. Per location. Price comes on a walkthrough, not a grid.</p>
        </section>

        <section id="how" style={{ paddingTop: 0 }}>
          <h2>We do not rip out the restaurant on day one.</h2>
          <p className="lead">Start in one store. Expand when it is actually being used.</p>
          <div className="steps">
            <div className="step"><div className="num">01</div><p>Checklists and recipes in one store.</p></div>
            <div className="step"><div className="num">02</div><p>Punch clock, cash, inventory in a workshop. Weeks, not a login and a prayer.</p></div>
            <div className="step"><div className="num">03</div><p>Scheduling and labor once the team is actually using it.</p></div>
            <div className="step"><div className="num">04</div><p>Next location when the first one is real.</p></div>
          </div>
          <div className="feats">
            <span className="feat">Checklists, recipes, manager logs</span>
            <span className="feat">Scheduling and labor %</span>
            <span className="feat">Punch clock (PIN, tablet, PWA)</span>
            <span className="feat">Team chat</span>
            <span className="feat">Hiring / jobs board</span>
            <span className="feat">Sales / labor dashboard</span>
            <span className="feat">Inventory and COGS</span>
          </div>
        </section>

        <section style={{ paddingTop: 20 }}>
          <div className="founder">
            <div>
              <p className="eyebrow">Founder</p>
              <h2>I built this because I had to run it.</h2>
            </div>
            <div>
              <p className="lead" style={{ margin: "0 0 22px" }}>
                I am Jordan Andrian. I run Jo Pizza, a Blaze in Hemet. Before that, Jersey Mike's. I got tired
                of paying a software stack designed by people who do not close Saturday night, so I built
                CrooHQ and put my own stores on it.
              </p>
              <p className="lead" style={{ margin: "0 0 28px" }}>
                Other operators asked. Now it is in more kitchens than mine. Still not a corporate IT project.
              </p>
              <a className="btn btn-primary" href={MAILTO}>Talk to me, not a sales pod</a>
            </div>
          </div>
        </section>

        <section id="talk" style={{ paddingTop: 20 }}>
          <h2>Per location. Price on a walkthrough.</h2>
          <p className="lead">
            Sold by an operator, on a term, not a public grid. 14-day trial. No hostage contract.
          </p>
        </section>

        <section id="jobs" className="close" style={{ paddingTop: 10 }}>
          <h2>If you do not love it, you are not stuck.</h2>
          <p className="lead">
            I am not looking to hold anyone hostage who does not love the CrooHQ experience. Hiring is already
            on CrooHQ. The jobs board is live.
          </p>
          <div className="cta-row" style={{ justifyContent: "center" }}>
            <a className="btn btn-primary btn-lg" href={MAILTO}>Book a walkthrough</a>
            <Link className="btn btn-ghost btn-lg" to="/jobs">See open jobs</Link>
          </div>
        </section>

        <footer>
          <div>croohq.com · jordan@croohq.com · Built for operators, by operators.</div>
          <div className="links">
            <Link to="/jobs">Jobs</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
            <Link to="/auth">Log in</Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
