import { useCallback, useEffect, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";

/**
 * Unlisted review page for the CrooHQ landing concept.
 * Path: /r/satnight-8f3k — noindex, not in the sitemap, not linked from anywhere.
 * Self-contained styles, scoped under .rvw so nothing here touches the app theme.
 * Interactive widgets are self-contained clones of public/demo-page.html — they do
 * NOT import or affect the production dashboard cube / schedule components.
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
.rvw button { font-family: inherit; }
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
.rvw h1 .teal { color: var(--teal); font-style: italic; }
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

/* ---------- INTERACTIVE DEMO BLOCK ---------- */
.rvw .demo-layout { display: grid; grid-template-columns: 250px 1fr; gap: 28px; margin-top: 40px; align-items: start; }
.rvw .demo-nav { display: flex; flex-direction: column; gap: 8px; }
.rvw .dnav {
  display: flex; align-items: center; gap: 10px; padding: 13px 16px;
  border-radius: 12px; border: 1.5px solid transparent; background: transparent;
  cursor: pointer; text-align: left; font-size: 14px; font-weight: 700; color: var(--muted);
  transition: all .15s;
}
.rvw .dnav:hover { background: rgba(65,127,142,.07); color: var(--ink); }
.rvw .dnav.active { background: var(--white); border-color: var(--line); color: var(--ink); box-shadow: 0 8px 22px rgba(65,127,142,.10); }
.rvw .dnav .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--teal); margin-left: auto; opacity: 0; }
.rvw .dnav.active .dot { opacity: 1; }

.rvw .demo-desc { font-size: 14px; color: var(--muted); line-height: 1.6; margin-bottom: 18px; }
.rvw .demo-desc strong { color: var(--ink); font-weight: 800; }
.rvw .demo-window { background: var(--white); border: 1px solid var(--line); border-radius: 16px; overflow: hidden; box-shadow: 0 18px 44px rgba(26,26,26,.10); }
.rvw .demo-chrome { display: flex; align-items: center; gap: 6px; padding: 10px 16px; border-bottom: 1px solid var(--line); background: rgba(26,26,26,.02); }
.rvw .cdot { width: 10px; height: 10px; border-radius: 50%; }
.rvw .chrome-label { margin-left: 10px; font-size: 11px; font-weight: 700; color: var(--muted); }

/* mini schedule */
.rvw .mini-sched { padding: 18px; }
.rvw .mini-head, .rvw .mini-row { display: grid; grid-template-columns: 132px repeat(3, 1fr); }
.rvw .mini-head { border: 1px solid var(--line); border-radius: 10px 10px 0 0; overflow: hidden; background: rgba(26,26,26,.03); }
.rvw .mini-hdr { padding: 8px; text-align: center; font-size: 11px; font-weight: 800; color: var(--muted); border-left: 1px solid var(--line); }
.rvw .mini-hdr:first-child { border-left: none; }
.rvw .mini-hdr.today { color: var(--teal); }
.rvw .mini-body { border: 1px solid var(--line); border-top: none; border-radius: 0 0 10px 10px; overflow: hidden; }
.rvw .mini-row { border-bottom: 1px solid var(--line); min-height: 62px; }
.rvw .mini-row:last-child { border-bottom: none; }
.rvw .mini-emp { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-right: 1px solid var(--line); }
.rvw .mini-av { width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 12px; color: #fff; flex-shrink: 0; }
.rvw .mini-nm { font-size: 12px; font-weight: 800; }
.rvw .mini-hrs { font-size: 10px; color: var(--muted); font-variant-numeric: tabular-nums; }
.rvw .mini-cell { border-left: 1px solid var(--line); cursor: pointer; display: flex; align-items: center; padding: 6px; background: none; width: 100%; transition: background .15s; }
.rvw .mini-cell:hover:not(.filled) { background: rgba(65,127,142,.09); }
.rvw .mini-cell.filled { cursor: default; background: rgba(65,127,142,.05); }
.rvw .mini-pill { width: 100%; display: flex; flex-direction: column; padding: 5px 8px; border-radius: 7px; background: #d7ebe8; border-left: 3px solid var(--teal); animation: rvwPop .2s cubic-bezier(.16,1,.3,1); }
.rvw .mini-pill .t { font-size: 9.5px; font-weight: 800; color: var(--teal-d); white-space: nowrap; }
.rvw .mini-pill .n { font-size: 9.5px; color: var(--muted); font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rvw .mini-hint { text-align: center; font-size: 12px; color: var(--muted); padding: 12px 0 2px; font-weight: 600; }
@keyframes rvwPop { from { opacity: 0; transform: scale(.94); } to { opacity: 1; transform: scale(1); } }

/* picker */
.rvw .pk-overlay { position: fixed; inset: 0; z-index: 900; background: rgba(26,26,26,.35); }
.rvw .pk-card { position: absolute; background: var(--white); border: 1px solid var(--line); border-radius: 14px; padding: 16px; width: min(420px, calc(100vw - 24px)); box-shadow: 0 24px 60px rgba(26,26,26,.28); animation: rvwPop .18s cubic-bezier(.16,1,.3,1); }
.rvw .pk-name { font-size: 14px; font-weight: 800; }
.rvw .pk-sub { font-size: 11px; color: var(--muted); margin-bottom: 12px; font-weight: 600; }
.rvw .pk-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.rvw .pk-col-label { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .1em; color: var(--teal); margin-bottom: 7px; }
.rvw .pk-btn { width: 100%; text-align: left; padding: 7px 9px; border-radius: 8px; border: 1px solid var(--line); background: rgba(26,26,26,.02); cursor: pointer; margin-bottom: 6px; transition: all .15s; }
.rvw .pk-btn:hover { background: rgba(65,127,142,.12); border-color: var(--teal); transform: translateX(2px); }
.rvw .pk-lbl { display: flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 800; }
.rvw .pk-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.rvw .pk-time { font-size: 10.5px; color: var(--muted); padding-left: 13px; font-weight: 600; }
.rvw .pk-cancel { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line); text-align: center; }
.rvw .pk-cancel button { background: none; border: none; color: var(--muted); font-size: 11px; cursor: pointer; font-weight: 700; }

/* cube */
.rvw .cube-scene { padding: 40px 0 28px; display: flex; flex-direction: column; align-items: center; gap: 22px; background: radial-gradient(ellipse at center, rgba(65,127,142,.10) 0%, transparent 70%); }
.rvw .cube-wrap { perspective: 800px; width: 220px; height: 220px; cursor: pointer; user-select: none; background: none; border: none; padding: 0; }
.rvw .cube { width: 220px; height: 220px; position: relative; transform-style: preserve-3d; transition: transform .7s cubic-bezier(.4,0,.2,1); }
.rvw .cube-face { position: absolute; width: 220px; height: 220px; border-radius: 20px; backface-visibility: hidden; display: flex; flex-direction: column; justify-content: center; padding: 22px; box-shadow: 0 14px 34px rgba(26,26,26,.28); text-align: left; }
.rvw .cf-front { transform: rotateY(0deg) translateZ(110px); background: linear-gradient(145deg, #2e6270, #417f8e); }
.rvw .cf-right { transform: rotateY(90deg) translateZ(110px); background: linear-gradient(145deg, #1f4a55, #35707f); }
.rvw .cf-back { transform: rotateY(180deg) translateZ(110px); background: linear-gradient(145deg, #23383f, #3a5f68); }
.rvw .cf-left { transform: rotateY(270deg) translateZ(110px); background: #1a1a1a; }
.rvw .cube-label { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .12em; color: rgba(255,255,255,.72); margin-bottom: 14px; }
.rvw .cube-metric { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
.rvw .cube-metric-val { font-size: 22px; font-weight: 800; color: #fff; line-height: 1; font-variant-numeric: tabular-nums; }
.rvw .cube-metric-label { font-size: 10px; color: rgba(255,255,255,.65); font-weight: 600; }
.rvw .cube-divider { height: 1px; background: rgba(255,255,255,.18); margin: 10px 0; }
.rvw .cube-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
.rvw .cube-cell { background: rgba(0,0,0,.16); border-radius: 8px; padding: 8px 10px; }
.rvw .cube-cell-val { font-size: 16px; font-weight: 800; color: #fff; font-variant-numeric: tabular-nums; }
.rvw .cube-cell-label { font-size: 9px; color: rgba(255,255,255,.62); margin-top: 2px; }
.rvw .cube-bar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 9px; }
.rvw .cube-bar-label { font-size: 10px; color: rgba(255,255,255,.75); width: 58px; flex-shrink: 0; }
.rvw .cube-bar { flex: 1; height: 8px; background: rgba(0,0,0,.22); border-radius: 4px; overflow: hidden; }
.rvw .cube-bar-fill { height: 100%; border-radius: 4px; }
.rvw .cube-bar-pct { font-size: 10px; color: #fff; font-weight: 800; width: 32px; text-align: right; }
.rvw .cube-dots { display: flex; gap: 6px; }
.rvw .cube-dot { width: 7px; height: 7px; border-radius: 50%; background: rgba(26,26,26,.18); }
.rvw .cube-dot.active { background: var(--teal); }
.rvw .cube-controls { display: flex; align-items: center; gap: 12px; }
.rvw .cube-hint { font-size: 12px; color: var(--muted); font-weight: 600; }
.rvw .cube-pause { width: 28px; height: 28px; border-radius: 50%; background: rgba(26,26,26,.05); border: 1px solid var(--line); display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--muted); }
.rvw .cube-pause:hover { color: var(--ink); }

/* theo chat */
.rvw .theo-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: center; }
.rvw .theo-caps { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 24px; }
.rvw .theo-cap { background: var(--white); border: 1px solid var(--line); border-radius: 999px; padding: 9px 15px; font-size: 13px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
.rvw .cap-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--teal); }
.rvw .chat { background: var(--white); border: 1px solid var(--line); border-radius: 18px; overflow: hidden; box-shadow: 0 22px 50px rgba(26,26,26,.14); }
.rvw .chat-header { display: flex; align-items: center; gap: 12px; padding: 16px 18px; background: var(--teal); }
.rvw .chat-avatar { width: 38px; height: 38px; border-radius: 50%; background: #12343c; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 800; }
.rvw .chat-name { font-weight: 800; font-size: 16px; color: #fff; }
.rvw .chat-loc { font-size: 12px; color: rgba(255,255,255,.88); display: flex; align-items: center; gap: 6px; margin-top: 2px; font-weight: 600; }
.rvw .online-dot { width: 7px; height: 7px; border-radius: 50%; background: #4ade80; box-shadow: 0 0 8px #4ade80; }
.rvw .chat-body { padding: 18px; display: flex; flex-direction: column; gap: 13px; max-height: 430px; overflow-y: auto; }
.rvw .chat-msg { animation: rvwChatIn .45s cubic-bezier(.16,1,.3,1) both; }
.rvw .chat-user { align-self: flex-end; background: var(--teal); color: #fff; padding: 10px 16px; border-radius: 18px 18px 4px 18px; font-size: 14px; max-width: 80%; font-weight: 600; }
.rvw .chat-theo { display: flex; gap: 10px; align-items: flex-start; max-width: 92%; }
.rvw .chat-theo-av { width: 28px; height: 28px; border-radius: 50%; background: #12343c; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 11px; flex-shrink: 0; margin-top: 2px; }
.rvw .chat-bubble { background: #ebe5da; padding: 11px 15px; border-radius: 4px 18px 18px 18px; font-size: 14px; line-height: 1.5; }
.rvw .chat-bubble strong { color: var(--teal-d); font-weight: 800; }
.rvw .chat-typing { display: flex; gap: 4px; align-items: center; padding: 14px 16px; }
.rvw .chat-typing span { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); animation: rvwBlink 1.2s infinite; }
.rvw .chat-typing span:nth-child(2) { animation-delay: .2s; }
.rvw .chat-typing span:nth-child(3) { animation-delay: .4s; }
.rvw .chat-input { padding: 12px 18px; border-top: 1px solid var(--line); display: flex; gap: 10px; align-items: center; }
.rvw .chat-input-text { font-size: 13px; color: var(--muted); flex: 1; font-weight: 600; }
.rvw .chat-ask { border: 1px solid var(--line); background: rgba(65,127,142,.08); color: var(--teal-d); border-radius: 999px; padding: 7px 13px; font-size: 12px; font-weight: 800; cursor: pointer; }
.rvw .chat-ask:hover { background: rgba(65,127,142,.18); }
.rvw .chat-asks { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 18px 14px; }
@keyframes rvwChatIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
@keyframes rvwBlink { 0%,60%,100% { opacity: .25; } 30% { opacity: 1; } }

@media (max-width: 900px) {
  .rvw .demo-layout { grid-template-columns: 1fr; }
  .rvw .demo-nav { flex-direction: row; flex-wrap: wrap; }
  .rvw .dnav { flex: 1; min-width: 150px; }
  .rvw .theo-grid { grid-template-columns: 1fr; gap: 32px; }
}
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
  .rvw .mini-head, .rvw .mini-row { grid-template-columns: 96px repeat(3, 1fr); }
  .rvw .pk-cols { grid-template-columns: 1fr; }
}
`;

const MAILTO = "mailto:jordan@croohq.com?subject=CrooHQ%20walkthrough";

/* ------------------------------------------------------------------ */
/* Smart Tap mini-schedule (self-contained clone of the demo widget)    */
/* ------------------------------------------------------------------ */

type Template = { label: string; time: string; dot: string; hrs: number };

const LAST_WEEK: Record<string, Template[]> = {
  dwight: [
    { label: "Mid-Shift", time: "12:00p-8:00p", dot: "#c2410c", hrs: 8 },
    { label: "AM Manager", time: "9:00a-4:00p", dot: "#417f8e", hrs: 7 },
  ],
  jim: [
    { label: "PM Manager", time: "3:30p-11:00p", dot: "#2e6270", hrs: 7.5 },
    { label: "Asst Regional Mgr", time: "10:00a-3:00p", dot: "#c2410c", hrs: 5 },
  ],
  pam: [{ label: "Prep", time: "4:00p-11:00p", dot: "#2e6270", hrs: 7 }],
};

const ALL_TEMPLATES: Template[] = [
  { label: "Asst Regional Mgr", time: "10:00a-3:00p", dot: "#c2410c", hrs: 5 },
  { label: "AM Manager", time: "9:00a-4:00p", dot: "#417f8e", hrs: 7 },
  { label: "Mid-Shift", time: "12:00p-8:00p", dot: "#c2410c", hrs: 8 },
  { label: "PM Manager", time: "3:30p-11:00p", dot: "#2e6270", hrs: 7.5 },
];

const EMPLOYEES = [
  { key: "dwight", name: "Dwight S.", initial: "D", grad: "linear-gradient(135deg,#2e6270,#417f8e)" },
  { key: "jim", name: "Jim H.", initial: "J", grad: "linear-gradient(135deg,#417f8e,#1f4a55)" },
  { key: "pam", name: "Pam B.", initial: "P", grad: "linear-gradient(135deg,#c2410c,#8a2b06)" },
];

function SmartTapDemo() {
  const [filled, setFilled] = useState<Record<string, Template>>({});
  const [picker, setPicker] = useState<{ emp: string; day: number; x: number; y: number } | null>(null);

  const openPicker = (emp: string, day: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const cw = Math.min(420, window.innerWidth - 24);
    const ch = 280;
    const x = Math.max(8, Math.min(r.left + r.width / 2 - cw / 2, window.innerWidth - cw - 8));
    const y = Math.max(8, Math.min(r.top + r.height / 2 - ch / 2, window.innerHeight - ch - 8));
    setPicker({ emp, day, x, y });
  };

  const select = (t: Template) => {
    if (!picker) return;
    setFilled((f) => ({ ...f, [`${picker.emp}-${picker.day}`]: t }));
    setPicker(null);
  };

  const hoursFor = (emp: string) =>
    Object.entries(filled)
      .filter(([k]) => k.startsWith(`${emp}-`))
      .reduce((s, [, t]) => s + t.hrs, 0);

  const empName = picker ? EMPLOYEES.find((e) => e.key === picker.emp)?.name : "";

  return (
    <>
      <div className="mini-sched">
        <div className="mini-head">
          <div className="mini-hdr" />
          <div className="mini-hdr">MON 4/27</div>
          <div className="mini-hdr today">TUE 4/28</div>
          <div className="mini-hdr">WED 4/29</div>
        </div>
        <div className="mini-body">
          {EMPLOYEES.map((emp) => (
            <div className="mini-row" key={emp.key}>
              <div className="mini-emp">
                <div className="mini-av" style={{ background: emp.grad }}>{emp.initial}</div>
                <div>
                  <div className="mini-nm">{emp.name}</div>
                  <div className="mini-hrs">{hoursFor(emp.key).toFixed(1)} hrs</div>
                </div>
              </div>
              {[0, 1, 2].map((day) => {
                const t = filled[`${emp.key}-${day}`];
                return (
                  <button
                    type="button"
                    key={day}
                    className={`mini-cell${t ? " filled" : ""}`}
                    onClick={(e) => !t && openPicker(emp.key, day, e.currentTarget)}
                    aria-label={t ? `${emp.name} ${t.label}` : `Add shift for ${emp.name}`}
                  >
                    {t && (
                      <span className="mini-pill">
                        <span className="t">{t.time}</span>
                        <span className="n">{t.label}</span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="mini-hint">Tap any empty cell to Smart Tap a shift</div>
      </div>

      {picker && (
        <div className="pk-overlay" onClick={(e) => e.target === e.currentTarget && setPicker(null)}>
          <div className="pk-card" style={{ left: picker.x, top: picker.y }}>
            <div className="pk-name">{empName}</div>
            <div className="pk-sub">Pick a shift — one tap fills it</div>
            <div className="pk-cols">
              <div>
                <div className="pk-col-label">Last week</div>
                {(LAST_WEEK[picker.emp] || []).map((t) => (
                  <button className="pk-btn" key={t.label} onClick={() => select(t)}>
                    <span className="pk-lbl">
                      <span className="pk-dot" style={{ background: t.dot }} />
                      {t.label}
                    </span>
                    <span className="pk-time">{t.time}</span>
                  </button>
                ))}
              </div>
              <div>
                <div className="pk-col-label">All templates</div>
                {ALL_TEMPLATES.map((t) => (
                  <button className="pk-btn" key={t.label} onClick={() => select(t)}>
                    <span className="pk-lbl">
                      <span className="pk-dot" style={{ background: t.dot }} />
                      {t.label}
                    </span>
                    <span className="pk-time">{t.time}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="pk-cancel">
              <button onClick={() => setPicker(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Demo data cube — self-contained, NOT the production dashboard cube   */
/* ------------------------------------------------------------------ */

const CUBE_ANGLES = [0, -90, -180];

function CubeDemo({ active }: { active: boolean }) {
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const pressTimer = useRef<number | null>(null);

  const next = useCallback(() => setStep((s) => (s + 1) % CUBE_ANGLES.length), []);

  useEffect(() => {
    if (!active || paused) return;
    const id = window.setInterval(next, 6000);
    return () => window.clearInterval(id);
  }, [active, paused, next]);

  const startPress = () => {
    pressTimer.current = window.setTimeout(() => setPaused((p) => !p), 600);
  };
  const endPress = () => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
  };

  return (
    <div className="cube-scene">
      <button
        type="button"
        className="cube-wrap"
        onClick={next}
        onMouseDown={startPress}
        onMouseUp={endPress}
        onMouseLeave={endPress}
        onTouchStart={startPress}
        onTouchEnd={endPress}
        aria-label="Rotate data cube"
      >
        <div className="cube" style={{ transform: `rotateY(${CUBE_ANGLES[step]}deg)` }}>
          <div className="cube-face cf-front">
            <div className="cube-label">Daily Sales</div>
            <div className="cube-metric"><span className="cube-metric-val">$3,414</span><span className="cube-metric-label">Sales</span></div>
            <div className="cube-metric"><span className="cube-metric-val">$3,419</span><span className="cube-metric-label">Pace</span></div>
            <div className="cube-divider" />
            <div className="cube-row">
              <div className="cube-cell"><div className="cube-cell-val">$23</div><div className="cube-cell-label">Avg Check</div></div>
              <div className="cube-cell"><div className="cube-cell-val">$3,680</div><div className="cube-cell-label">SDLW</div></div>
            </div>
          </div>
          <div className="cube-face cf-right">
            <div className="cube-label">Daily Labor</div>
            <div className="cube-metric"><span className="cube-metric-val">25%</span><span className="cube-metric-label">Labor</span></div>
            <div className="cube-divider" />
            <div className="cube-row">
              <div className="cube-cell"><div className="cube-cell-val">$350</div><div className="cube-cell-label">Paid</div></div>
              <div className="cube-cell"><div className="cube-cell-val">$820</div><div className="cube-cell-label">Budget</div></div>
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={{ height: 6, background: "rgba(0,0,0,.22)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: "42%", height: "100%", background: "#4ade80", borderRadius: 3 }} />
              </div>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,.55)", marginTop: 4 }}>$350 of $820 used</div>
            </div>
          </div>
          <div className="cube-face cf-back">
            <div className="cube-label">Payment Types</div>
            {[
              { l: "Cash", p: 25, c: "#4ade80" },
              { l: "Credit", p: 70, c: "#7fc4d6" },
              { l: "Gift Card", p: 5, c: "#f0a860" },
            ].map((b) => (
              <div className="cube-bar-row" key={b.l}>
                <div className="cube-bar-label">{b.l}</div>
                <div className="cube-bar"><div className="cube-bar-fill" style={{ width: `${b.p}%`, background: b.c }} /></div>
                <div className="cube-bar-pct">{b.p}%</div>
              </div>
            ))}
          </div>
          <div className="cube-face cf-left" />
        </div>
      </button>

      <div className="cube-dots">
        {CUBE_ANGLES.map((_, i) => (
          <div key={i} className={`cube-dot${i === step ? " active" : ""}`} />
        ))}
      </div>
      <div className="cube-controls">
        <span className="cube-hint">Tap to rotate · long press to pause</span>
        <button className="cube-pause" onClick={() => setPaused((p) => !p)} aria-label={paused ? "Resume" : "Pause"}>
          {paused ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
          )}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* THEO chat mock                                                       */
/* ------------------------------------------------------------------ */

type ChatEntry = { q: string; a: JSX.Element };

const CHAT_SCRIPT: ChatEntry[] = [
  {
    q: "how many ones do we have in the safe",
    a: <>The AM Safe Count today, submitted by Kelly Kapoor, shows <strong>47 one-dollar bills.</strong></>,
  },
  {
    q: "who temped the tomatoes today",
    a: (
      <>
        Kelly Kapoor temped the tomatoes during the AM Line Check at <strong>1:43 PM, recording 41.6°F.</strong> Jim
        Halpert also temped them at Shift Change — <strong>4:26 PM, 41°F.</strong>
      </>
    ),
  },
  {
    q: "who closed last night?",
    a: (
      <>
        Last night's close was logged by <strong>Jim Halpert.</strong> Punch out at 11:42 PM. Cash drawer submitted by
        Kelly Kapoor at 11:31 PM — <strong>no variance.</strong>
      </>
    ),
  },
];

function TheoChat() {
  const [shown, setShown] = useState(1);
  const [typing, setTyping] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [shown, typing]);

  const ask = () => {
    if (typing || shown >= CHAT_SCRIPT.length) return;
    setTyping(true);
    window.setTimeout(() => {
      setShown((s) => s + 1);
      setTyping(false);
    }, 900);
  };

  return (
    <div className="chat">
      <div className="chat-header">
        <div className="chat-avatar">T</div>
        <div>
          <div className="chat-name">Theo ✦</div>
          <div className="chat-loc"><span className="online-dot" />Hemet</div>
        </div>
      </div>
      <div className="chat-body" ref={bodyRef}>
        {CHAT_SCRIPT.slice(0, shown).map((m) => (
          <div key={m.q} style={{ display: "contents" }}>
            <div className="chat-msg chat-user">{m.q}</div>
            <div className="chat-msg chat-theo">
              <div className="chat-theo-av">T</div>
              <div className="chat-bubble">{m.a}</div>
            </div>
          </div>
        ))}
        {typing && (
          <div className="chat-msg chat-theo">
            <div className="chat-theo-av">T</div>
            <div className="chat-bubble chat-typing"><span /><span /><span /></div>
          </div>
        )}
      </div>
      <div className="chat-asks">
        {shown < CHAT_SCRIPT.length ? (
          <button className="chat-ask" onClick={ask}>Ask: “{CHAT_SCRIPT[shown].q}”</button>
        ) : (
          <button className="chat-ask" onClick={() => setShown(1)}>Start over</button>
        )}
      </div>
      <div className="chat-input">
        <span className="chat-input-text">Ask Theo anything about your restaurant…</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

const DEMO_TABS = [
  {
    key: "smarttap",
    label: "Smart Tap",
    chrome: "Schedule — Apr 27",
    desc: (
      <>
        <strong>Smart Tap Scheduling</strong> — Tap any empty cell. You see what that person actually worked last week
        plus every store template. One tap fills the shift. 95% of the week scheduled in under three minutes.
      </>
    ),
  },
  {
    key: "cubes",
    label: "Live Data Cubes",
    chrome: "Dash — Live",
    desc: (
      <>
        <strong>Live Data Cubes</strong> — Pin the numbers that matter. Each cube rotates on its own, or tap to spin it.
        Long press to pause mid-rush. Your numbers, your way.
      </>
    ),
  },
  {
    key: "theo",
    label: "Theo AI",
    chrome: "Theo — Hemet",
    desc: (
      <>
        <strong>Theo</strong> — Ask a plain question, get the answer off your own logs. Who closed, who temped it, what
        the safe holds. He flags what needs attention before you ask.
      </>
    ),
  },
] as const;

export default function ReviewLanding() {
  const [tab, setTab] = useState<(typeof DEMO_TABS)[number]["key"]>("smarttap");
  const activeTab = DEMO_TABS.find((t) => t.key === tab)!;

  return (
    <div className="rvw">
      <Helmet>
        <title>CrooHQ — Your restaurant software could never.</title>
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
            <a href="#see">See it work</a>
            <a href="#stack">Replace the stack</a>
            <a href="#how">How it starts</a>
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
              <h1>
                Your restaurant software <span className="teal">could never.</span>
              </h1>
              <p className="lede">
                CrooHQ is the operations command center for franchises that actually run restaurants. Not software
                companies playing dress-up. Built by someone who still closes Saturday night.
              </p>
              <div className="cta-row">
                <a className="btn btn-primary btn-lg" href={MAILTO}>Book a 20-minute walkthrough</a>
                <a className="btn btn-ghost btn-lg" href="#see">See it work</a>
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

        <section id="see">
          <h2>Touch it. It actually works.</h2>
          <p className="lead">
            These are the real screens, running right here on the page. Tap them.
          </p>
          <div className="demo-layout">
            <div className="demo-nav">
              {DEMO_TABS.map((t) => (
                <button
                  key={t.key}
                  className={`dnav${tab === t.key ? " active" : ""}`}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                  <span className="dot" />
                </button>
              ))}
            </div>
            <div>
              <p className="demo-desc">{activeTab.desc}</p>
              <div className="demo-window">
                <div className="demo-chrome">
                  <span className="cdot" style={{ background: "#ef4444" }} />
                  <span className="cdot" style={{ background: "#f59e0b" }} />
                  <span className="cdot" style={{ background: "#22c55e" }} />
                  <span className="chrome-label">{activeTab.chrome}</span>
                </div>
                {tab === "smarttap" && <SmartTapDemo />}
                {tab === "cubes" && <CubeDemo active />}
                {tab === "theo" && (
                  <div style={{ padding: 18 }}>
                    <TheoChat />
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        <section id="stack" style={{ paddingTop: 0 }}>
          <h2>Four tools. None of them talk to each other.</h2>
          <p className="lead">Most multi-unit operators did not choose a stack. They accumulated one — about $500 a month of it.</p>
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

        <section id="theo" style={{ paddingTop: 0 }}>
          <div className="theo-grid">
            <div>
              <p className="eyebrow">Theo, your AI shift partner.</p>
              <h2>He already read every log you did not.</h2>
              <p className="lead">
                Safe counts, line checks, punches, drawer variances. Ask in plain English at 11 PM and get the answer
                without opening four tabs.
              </p>
              <div className="theo-caps">
                <span className="theo-cap"><span className="cap-dot" />Cash & drawer history</span>
                <span className="theo-cap"><span className="cap-dot" />Line checks & temps</span>
                <span className="theo-cap"><span className="cap-dot" />Who worked, who closed</span>
                <span className="theo-cap"><span className="cap-dot" />Sales & labor pace</span>
              </div>
            </div>
            <TheoChat />
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
                I am Jordan Andrian. I run Jo Pizza, a Blaze in Hemet. Before that, Jersey Mike's. I got tired of paying
                a software stack designed by people who do not close Saturday night, so I built CrooHQ and put my own
                stores on it.
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
            I am not looking to hold anyone hostage who does not love the CrooHQ experience. Hiring is already on
            CrooHQ. The jobs board is live.
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
