import type { CSSProperties, ReactNode } from "react";

/**
 * Static recreations of CrooHQ screens that already ship:
 * checklist run (list, progress, photo / temp-photo types), the punch-clock PIN pad,
 * and a day's schedule. Sample tasks, initials, and shift names are the ones already
 * on this page. Nothing here is interactive.
 */

const TASKS: { title: string; kind: string; who: string; tone: string; time: string; done: boolean }[] = [
  { title: "Products dated, nothing expired", kind: "Checkmark", who: "AL", tone: "orange", time: "6:02 AM", done: true },
  { title: "Patio wiped & swept", kind: "Checkmark", who: "SR", tone: "teal", time: "6:09 AM", done: true },
  { title: "Front door glass", kind: "Photo", who: "SR", tone: "teal", time: "6:11 AM", done: true },
  { title: "Walk-in temp logged", kind: "Temp photo", who: "JM", tone: "plum", time: "6:15 AM", done: true },
  { title: "Restrooms stocked", kind: "Checkmark", who: "AL", tone: "orange", time: "6:18 AM", done: true },
  { title: "Line stocked for open", kind: "Checkmark", who: "", tone: "", time: "", done: false },
];

const SHIFTS: { who: string; tone: string; time: string; role: string }[] = [
  { who: "AL", tone: "orange", time: "6:00a–2:00p", role: "Opener" },
  { who: "SR", tone: "teal", time: "11:00a–7:00p", role: "Mid" },
  { who: "JM", tone: "plum", time: "3:30p–11:00p", role: "Closer" },
];

const DAYS = ["Mon", "Tue", "Wed"];
const PIN_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "Clear", "0", "⌫"];

export const PRODUCT_CSS = `
.hme .pm-device{border-radius:30px;padding:8px;background:linear-gradient(180deg,#2c2c2c 0%,#161616 100%);box-shadow:0 1px 0 rgba(255,255,255,.16) inset,0 28px 50px -22px rgba(10,40,48,.6),0 10px 20px -12px rgba(10,40,48,.45)}
.hme .pm-hardware{background:var(--home-tone-23);border-radius:24px;overflow:hidden;color:var(--ink)}
.hme .pm-bar{position:relative;display:flex;align-items:center;justify-content:center;height:26px;background:var(--home-tone-3);color:var(--muted);font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
.hme .pm-cam{position:absolute;left:12px;top:9px;width:8px;height:8px;border-radius:99px;background:#1a1a1a;box-shadow:0 0 0 3px rgba(26,26,26,.06)}
.hme .pm-home{height:4px;width:64px;border-radius:99px;background:rgba(26,26,26,.16);margin:6px auto 8px}
.hme .pm-check{padding:12px 12px 2px}
.hme .pm-check-top{display:flex;align-items:flex-end;justify-content:space-between;gap:10px}
.hme .pm-check h3{font-family:Manrope,sans-serif;font-weight:800;font-size:20px;line-height:1.15;letter-spacing:0}
.hme .pm-count{font-size:13px;font-weight:800;white-space:nowrap}
.hme .pm-track{height:8px;margin:10px 6px 2px;border-radius:99px;background:var(--art-11);border:1px solid var(--line);overflow:hidden}
.hme .pm-track i{display:block;height:100%;width:83.33%;background:var(--teal);border-radius:99px}
.hme .pm-sec{display:flex;justify-content:space-between;gap:8px;padding:10px 4px 6px;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.hme .pm-row{display:flex;align-items:center;gap:8px;padding:6px 2px;border-top:1px solid var(--art-3)}
.hme .pm-step .pm-row{padding:9px 2px}
.hme .pm-row .ck{width:22px;height:22px}
.hme .pm-row .ck svg{width:12px;height:12px}
.hme .pm-copy{flex:1;min-width:0}
.hme .pm-copy b{display:block;font-size:12.5px;font-weight:800;line-height:1.25}
.hme .pm-copy small{display:block;margin-top:2px;color:var(--muted);font-size:11px;font-weight:700}
.hme .pm-time{width:52px;text-align:right;font-size:10px;font-weight:800;color:var(--art-6);flex:none}
.hme .pm-wait{font-size:10px;font-weight:800;color:var(--muted);flex:none}
.hme .pm-av{width:24px;height:24px;font-size:9px}
.hme .pm-tone-orange{background:var(--art-5)}
.hme .pm-tone-teal{background:var(--art-7)}
.hme .pm-tone-plum{background:var(--art-8)}
.hme .pm-punch{padding:14px 12px 8px;text-align:center}
.hme .pm-clock{font-weight:800;font-size:26px;letter-spacing:-.03em;line-height:1}
.hme .pm-pin-label{margin-top:6px;font-size:12px;font-weight:700;color:var(--muted)}
.hme .pm-dots{display:flex;justify-content:center;gap:6px;margin:10px 0}
.hme .pm-dots span{width:26px;height:32px;border-radius:8px;border:2px solid var(--line);background:var(--home-tone-3)}
.hme .pm-dots span.on{background:var(--teal);border-color:var(--teal);box-shadow:0 6px 12px -6px rgba(46,98,112,.8)}
.hme .pm-keys{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}
.hme .pm-keys span{display:grid;place-items:center;height:32px;border-radius:9px;border:1.5px solid var(--line);background:#fff;font-weight:800;font-size:15px}
.hme .pm-keys span.ghost{background:transparent;border-color:transparent;color:var(--muted);font-size:11px}
.hme .pm-powered{display:flex;justify-content:center;gap:6px;align-items:center;margin-top:8px;color:var(--muted);font-size:10px;font-weight:700}
.hme .pm-powered b{color:var(--teal-d);letter-spacing:.08em}
.hme .pm-sched{padding:12px 12px 6px}
.hme .pm-sched-top{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.hme .pm-sched h3{font-family:Manrope,sans-serif;font-weight:800;font-size:18px;letter-spacing:0}
.hme .pm-days{display:flex;gap:6px}
.hme .pm-days span{font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:4px 7px;border-radius:99px}
.hme .pm-days span.on{background:var(--teal);color:#fff}
.hme .pm-shift{display:flex;align-items:center;gap:8px;margin-top:8px;padding:8px 10px;border-radius:10px;background:var(--art-9);border-left:3px solid var(--orange)}
.hme .pm-shift.teal{border-left-color:var(--teal)}
.hme .pm-shift.plum{border-left-color:var(--art-8)}
.hme .pm-shift b{display:block;font-size:12px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:0}
.hme .pm-shift small{display:block;margin-top:2px;font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--art-10)}
.hme .pm-check-top.is-stack{flex-direction:column;align-items:flex-start;gap:2px}
.hme .pm-stage{position:relative;margin-top:8px}
.hme .pm-labels{position:relative;height:22px;margin:0 0 12px}
.hme .pm-label{position:absolute;left:0;top:0;margin:0;color:var(--orange);font-weight:800;font-size:12px;letter-spacing:.14em;text-transform:uppercase;opacity:0}
.hme .pm-label:first-child{opacity:1}
.hme .pm-stack{position:relative;min-height:468px}
.hme .pm-step{position:absolute;inset:0;opacity:0;background:var(--home-tone-23);display:flex;flex-direction:column;justify-content:center}
.hme .pm-step:first-child{opacity:1}
.hme .pm-stage .pm-device{width:min(100%,420px)}
.hme .pm-step .pm-check h3{font-size:26px}
.hme .pm-step .pm-copy b{font-size:14px}
.hme .pm-step .pm-clock{font-size:40px}
.hme .pm-step .pm-pin-label{font-size:15px;margin-top:10px}
.hme .pm-step .pm-dots span{width:36px;height:42px}
.hme .pm-step .pm-keys span{height:46px;font-size:18px;border-radius:12px}
.hme .pm-step .pm-keys{gap:8px}
.hme .pm-step .pm-punch{padding:22px 18px 12px}
.hme .pm-step .pm-sched h3{font-size:26px}
.hme .pm-step .pm-shift{padding:12px 14px;margin-top:10px}
.hme .pm-step .pm-shift b{font-size:16px}
.hme .pm-step .pm-shift small{font-size:11px}
.hme .pm-step .pm-days span{font-size:12px;padding:6px 10px}
.hme .stage,.hme .pm-stage{pointer-events:none;user-select:none}
@media(min-width:1101px){
  .hme .how-grid{display:grid;grid-template-columns:minmax(0,1.12fr) minmax(300px,430px);gap:28px 36px;align-items:center}
  .hme .how-grid>h2{grid-column:1;grid-row:1}
  .hme .how-rest{grid-column:1;grid-row:2;min-width:0}
  .hme .pm-stage{grid-column:2;grid-row:1 / span 2;margin-top:0}
  .hme .how-grid .st{grid-template-columns:1fr 1fr;margin-top:0}
  .hme .how-grid .st div{min-height:0}
}
@media(max-width:1100px){
  .hme .how.is-animated{height:auto}
  .hme .how .pin{position:static;min-height:0}
  .hme .pm-stage{margin-top:28px}
}
@media(max-width:760px){
  .hme .pm-stack{min-height:430px}
  .hme .pm-step .pm-check h3{font-size:22px}
  .hme .pm-step .pm-clock{font-size:32px}
  .hme .pm-step .pm-keys span{height:40px}
}
@media(min-width:1101px) and (max-height:820px){
  .hme .how{padding:48px 0}
  .hme .pm-stack{min-height:420px}
  .hme .how-grid .st div{padding:18px}
}
@media(prefers-reduced-motion:reduce){
  .hme .pm-labels{height:auto;display:flex;flex-direction:column;gap:18px}
  .hme .pm-label{position:relative;opacity:1!important;transform:none!important}
  .hme .pm-stack{height:auto;min-height:0;display:flex;flex-direction:column;gap:18px}
  .hme .pm-step{position:relative;opacity:1!important;transform:none!important;inset:auto}
}
`;

function Check({ delay }: { delay: string }) {
  return (
    <div className="ck" style={{ "--cd": delay } as CSSProperties}>
      <svg viewBox="0 0 24 24" className="draw" aria-hidden="true">
        <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="var(--art-4)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function ChecklistMock({ detailed = false }: { detailed?: boolean }) {
  return (
    <div className="pm-check" data-product-screen="checklist">
      <div className={`pm-check-top${detailed ? "" : " is-stack"}`}>
        <h3>Morning Line Check</h3>
        <span className="pm-count">5 of 6</span>
      </div>
      <div className="pm-track" aria-hidden="true"><i /></div>
      <div className="pm-sec"><span>Opening · 6:00 AM</span><span>1 left</span></div>
      {TASKS.map((task, index) => (
        <div className="pm-row" key={task.title}>
          {task.done ? <Check delay={`${1 + index * 0.12}s`} /> : <div className="ck o" />}
          <div className="pm-copy">
            <b>{task.title}</b>
            {detailed && <small>{task.kind}</small>}
          </div>
          {task.done ? (
            <>
              <span className="pm-time">{task.time}</span>
              <span className={`av pm-av pm-tone-${task.tone}`}>{task.who}</span>
            </>
          ) : (
            <span className="pm-wait">Tap to complete</span>
          )}
        </div>
      ))}
    </div>
  );
}

export function PunchMock({ detailed = false }: { detailed?: boolean }) {
  return (
    <div className="pm-punch" data-product-screen="punch">
      <div className="pm-clock">6:18 AM</div>
      <div className="pm-pin-label">Enter Your PIN</div>
      <div className="pm-dots" aria-hidden="true">
        <span className="on" />
        <span className="on" />
        <span />
        <span />
      </div>
      <div className="pm-keys">
        {PIN_KEYS.map((key) => (
          <span key={key} className={key === "Clear" || key === "⌫" ? "ghost" : undefined}>{key}</span>
        ))}
      </div>
      {detailed && <div className="pm-powered">Powered by <b>CROO</b></div>}
    </div>
  );
}

export function ScheduleMock() {
  return (
    <div className="pm-sched" data-product-screen="schedule">
      <div className="pm-sched-top">
        <h3>Schedule</h3>
        <div className="pm-days">
          {DAYS.map((day) => <span key={day} className={day === "Mon" ? "on" : undefined}>{day}</span>)}
        </div>
      </div>
      {SHIFTS.map((shift) => (
        <div className={`pm-shift ${shift.tone === "orange" ? "" : shift.tone}`} key={shift.who}>
          <span className={`av pm-av pm-tone-${shift.tone}`}>{shift.who}</span>
          <div>
            <b>{shift.time}</b>
            <small>{shift.role}</small>
          </div>
        </div>
      ))}
    </div>
  );
}

function Device({ children }: { children: ReactNode }) {
  return (
    <div className="pm-device">
      <div className="pm-hardware">
        <div className="pm-bar"><span className="pm-cam" /><span>CrooHQ</span></div>
        {children}
        <div className="pm-home" />
      </div>
    </div>
  );
}

export function HeroStage() {
  return (
    <div className="stage">
      <div className="L" data-z="0.07" style={{ left: "0px", top: "28px", width: "334px", "--r": "-2.5deg", zIndex: 2 } as CSSProperties}>
        <div className="in" style={{ "--d": "0.12s" } as CSSProperties}>
          <Device><ChecklistMock /></Device>
        </div>
      </div>
      <div className="L" data-z="0.16" style={{ left: "286px", top: "0px", width: "auto", "--r": "6deg", zIndex: 4 } as CSSProperties}>
        <div className="in" style={{ "--d": "0.42s" } as CSSProperties}>
          <div className="card" style={{ padding: "12px", borderRadius: "999px" }}>
            <svg viewBox="0 0 120 120" width="108" height="108" aria-hidden="true">
              <circle cx="60" cy="60" r="50" fill="none" stroke="var(--art-11)" strokeWidth="12" />
              <circle className="ringp" cx="60" cy="60" r="50" fill="none" stroke="var(--art-5)" strokeWidth="12" strokeLinecap="round" transform="rotate(-90 60 60)" strokeDasharray="314" strokeDashoffset="52" style={{ animation: "hme-rg 1.6s cubic-bezier(.3,.7,.2,1) both .9s" }} />
              <text x="60" y="58" textAnchor="middle" fontFamily="Fraunces, Georgia, serif" fontWeight="600" fontSize="30" fill="var(--art-12)">5/6</text>
              <text x="60" y="78" textAnchor="middle" fontFamily="Manrope, sans-serif" fontWeight="800" fontSize="11" fill="var(--art-6)">DONE</text>
            </svg>
          </div>
        </div>
      </div>
      <div className="L" data-z="0.26" style={{ left: "348px", top: "148px", width: "196px", "--r": "7deg", zIndex: 5 } as CSSProperties}>
        <div className="in" style={{ "--d": "0.62s" } as CSSProperties}>
          <Device><PunchMock /></Device>
        </div>
      </div>
      <div className="L" data-z="0.34" style={{ left: "300px", top: "392px", width: "246px", "--r": "-5deg", zIndex: 6 } as CSSProperties}>
        <div className="in" style={{ "--d": "0.82s" } as CSSProperties}>
          <Device><ScheduleMock /></Device>
        </div>
      </div>
      <div className="L" data-z="0.42" style={{ left: "6px", top: "548px", width: "auto", "--r": "-2deg", zIndex: 7 } as CSSProperties}>
        <div className="in" style={{ "--d": "1.05s" } as CSSProperties}>
          <div className="card" style={{ padding: "12px 16px", display: "flex", gap: "10px", alignItems: "center", borderRadius: "16px" }}>
            <div className="ck" style={{ background: "var(--art-5)", "--cd": "1.6s" } as CSSProperties}>
              <svg viewBox="0 0 24 24" className="draw" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="var(--art-4)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: "13px" }}>Walk-in temp logged</div>
              <div style={{ fontSize: "11px", color: "var(--art-6)", fontWeight: 700 }}>JM · just now</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const SCREENS: { id: string; label: string; node: ReactNode }[] = [
  { id: "checklists", label: "Checklists", node: <ChecklistMock detailed /> },
  { id: "punch", label: "Punch clock", node: <PunchMock detailed /> },
  { id: "schedule", label: "Scheduling", node: <ScheduleMock /> },
];

export function ProductSequence() {
  return (
    <div className="pm-stage" aria-hidden="true">
      <div className="pm-labels">
        {SCREENS.map((screen) => <p className="pm-label" key={screen.id}>{screen.label}</p>)}
      </div>
      <Device>
        <div className="pm-stack">
          {SCREENS.map((screen) => (
            <div className="pm-step" key={screen.id} data-screen={screen.id}>{screen.node}</div>
          ))}
        </div>
      </Device>
    </div>
  );
}
