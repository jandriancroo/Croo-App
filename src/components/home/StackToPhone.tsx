import { useEffect, useRef } from "react";
import { useReducedMotion, useScroll } from "framer-motion";
import { STACK_TOOLS, stackFrame, writeStackFrame } from "./stackFrames";

const CHECKS: { title: string; done: number; total: number }[] = [
  { title: "Opening", done: 4, total: 6 },
  { title: "Mid-shift", done: 2, total: 5 },
  { title: "Closing", done: 0, total: 6 },
];

function Ring({ done, total }: { done: number; total: number }) {
  const rate = total > 0 ? done / total : 0;
  const c = 2 * Math.PI * 16;
  return (
    <span className="stack-ring" aria-hidden="true">
      <svg viewBox="0 0 40 40">
        <circle cx="20" cy="20" r="16" fill="none" stroke="hsl(220 18% 90%)" strokeWidth="3" />
        <circle
          cx="20" cy="20" r="16" fill="none" stroke="hsl(190 54% 40%)" strokeWidth="3" strokeLinecap="round"
          strokeDasharray={`${c}`} strokeDashoffset={`${c - c * rate}`} transform="rotate(-90 20 20)"
        />
      </svg>
      <b>{Math.round(rate * 100)}%</b>
    </span>
  );
}

function DashboardScreen() {
  return (
    <div className="stack-screen stack-screen-dash">
      <div className="stack-sales">
        <div className="stack-sales-nav"><span>Today</span></div>
        <div className="stack-sales-hero">
          <p>Today's sales</p>
          <strong>$4,812</strong>
          <em className="stack-example">Example</em>
          <div className="stack-sales-grid">
            <span><small>Last year</small>$4,390</span>
            <span><small>Goal</small>$5,000</span>
            <span><small>Pace</small>$5,240</span>
          </div>
        </div>
      </div>
      <section className="stack-block" aria-label="Quick Tasks">
        <header>Quick Tasks</header>
        <div className="stack-row"><i /><span>Restock the line</span><small>Today</small></div>
        <div className="stack-row"><i /><span>Log the cooler temp</span><small>Today</small></div>
      </section>
      <section className="stack-block" aria-label="Checklists">
        <header>Checklists</header>
        {CHECKS.map(item => (
          <div className="stack-check" key={item.title}>
            <Ring done={item.done} total={item.total} />
            <span>
              <b>{item.title}</b>
              <small>{item.done}/{item.total}</small>
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}

function Phone() {
  return (
    <div className="stack-phone-slot">
      <div className="stack-phone-motion">
        <div className="pm-device pm-phone stack-device">
          <div className="pm-hardware">
            <span className="pm-island" aria-hidden="true" />
            <div className="stack-screens">
              <div className="stack-screen stack-screen-brand">
                <img src="/croohq-wordmark.png" alt="CrooHQ" width={168} height={40} />
              </div>
              <DashboardScreen />
            </div>
            <div className="pm-home" />
          </div>
        </div>
      </div>
    </div>
  );
}

export const STACK_SCROLL_CSS = `
.hme .stack-scroll{position:relative;z-index:auto;height:420vh}
.hme .stack-sticky{position:sticky;top:0;height:100vh;display:flex;align-items:flex-end;padding-bottom:16px;overflow:hidden}
.hme .stack-stage{position:relative;width:100%;height:auto;max-height:calc(100vh - 32px);display:grid;grid-template-columns:minmax(260px,480px) 1fr minmax(260px,320px);grid-template-rows:auto auto;align-items:end}
.hme .stack-copy{grid-column:1;grid-row:2;position:relative}
.hme .stack-head{grid-column:1 / -1;opacity:var(--head,1);max-height:calc(var(--head,1) * 190px);overflow:hidden;margin:0 0 calc(var(--head,1) * 18px);font-size:clamp(40px,5vw,68px)}
.hme .stack-swap{position:relative;min-height:240px}
.hme .stack-tools{list-style:none;display:flex;flex-direction:column;opacity:var(--list,1)}
.hme .stack-tools li{font-size:clamp(22px,2.6vw,34px);font-weight:800;line-height:1.2;padding:11px 0;border-bottom:1px solid var(--line)}
.hme .stack-allin{position:absolute;left:0;right:0;top:0;margin:0;opacity:var(--all,0);font-size:clamp(40px,5vw,72px);font-weight:800;line-height:.96;letter-spacing:0}
.hme .stack-phone-slot{grid-column:3;grid-row:2;opacity:var(--phone,1);z-index:2}
.hme .stack-phone-motion{transform:translate3d(calc(var(--x,0) * 1%), 0, 0) scale(1);transform-origin:center center}
.hme .stack-device{width:min(300px,100%);height:min(640px,74vh);aspect-ratio:auto}
.hme .stack-screens{position:relative;flex:1;min-height:0;background:#fbf8f3}
.hme .stack-screen{position:absolute;inset:0}
.hme .stack-screen-brand{display:flex;align-items:center;justify-content:center;padding:36px 18px 18px;background:#fbf8f3;opacity:calc(1 - var(--dash,0))}
.hme .stack-screen-brand img{width:min(168px,78%);height:auto}
.hme .stack-screen-dash{display:flex;flex-direction:column;gap:8px;padding:28px 8px 8px;overflow:hidden;background:hsl(38 38% 93%);opacity:var(--dash,0)}
.hme .stack-example{display:block;margin-top:5px;font-style:normal;font-size:11px;font-weight:600;letter-spacing:.02em;text-transform:none;color:rgba(255,255,255,.78)}
.hme .stack-sales{border-radius:14px;overflow:hidden}
.hme .stack-sales-nav{background:hsl(190 54% 40%);color:#fff;text-align:center;font-weight:800;font-size:13px;padding:6px 8px}
.hme .stack-sales-hero{background:hsl(22 80% 56%);color:#fff;text-align:center;padding:8px 8px 10px}
.hme .stack-sales-hero p{font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.hme .stack-sales-hero strong{display:block;margin-top:2px;font-size:28px;font-weight:800;letter-spacing:-.03em;line-height:1}
.hme .stack-sales-hero em{display:inline-block;margin-top:6px;font-style:normal;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;background:rgba(255,255,255,.2);border-radius:99px;padding:3px 8px}
.hme .stack-sales-grid{display:grid;grid-template-columns:1fr 1fr 1fr;margin-top:8px;background:rgba(0,0,0,.12);border-radius:10px;padding:6px 0}
.hme .stack-sales-grid span{display:flex;flex-direction:column;gap:2px;font-size:11px;font-weight:800;font-variant-numeric:tabular-nums}
.hme .stack-sales-grid span + span{border-left:1px solid rgba(255,255,255,.22)}
.hme .stack-sales-grid small{font-size:9px;font-weight:700}
.hme .stack-block{background:#fff;border-radius:12px;padding:6px 8px 4px}
.hme .stack-block header{font-size:12px;font-weight:800;color:hsl(22 80% 46%);padding:2px 0 4px}
.hme .stack-row,.hme .stack-check{display:flex;align-items:center;gap:8px;padding:5px 0;border-top:1px solid rgba(26,26,26,.08);font-size:12px;font-weight:700}
.hme .stack-row i{width:16px;height:16px;border-radius:99px;border:2px solid hsl(220 25% 78%);flex:none}
.hme .stack-row span,.hme .stack-check span{flex:1;min-width:0;display:flex;flex-direction:column}
.hme .stack-row small,.hme .stack-check small{color:hsl(220 20% 35%);font-size:10px;font-weight:700}
.hme .stack-ring{position:relative;width:28px;height:28px;flex:none}
.hme .stack-ring svg{width:28px;height:28px;display:block}
.hme .stack-ring b{position:absolute;inset:0;display:grid;place-items:center;font-size:7px;color:hsl(190 54% 40%)}
.hme .stack-scroll + .price{position:relative;z-index:auto;margin-top:64px;box-shadow:none}
@media(max-width:767px){
  .hme .stack-scroll{height:380vh}
  .hme .stack-stage{display:flex;flex-direction:column;justify-content:flex-end;gap:18px;height:auto;max-height:none}
  .hme .stack-copy{min-height:0;width:100%}
  .hme .stack-swap{min-height:0}
  .hme .stack-tools{overflow:hidden;max-height:calc(var(--list,1) * 460px)}
  .hme .stack-allin{position:relative;opacity:var(--all,0);margin-top:8px}
  .hme .stack-phone-slot{width:min(280px,86vw);opacity:var(--phone,0);align-self:center}
  .hme .stack-device{height:min(540px,62vh)}
  .hme .stack-scroll + .price{margin-top:40px}
}
@media(prefers-reduced-motion:reduce){
  .hme .stack-scroll{height:auto!important}
  .hme .stack-sticky{position:static!important;height:auto!important;overflow:visible!important;padding:48px 0 12px}
  .hme .stack-stage{display:flex!important;flex-direction:column;align-items:flex-start;gap:28px;height:auto!important}
  .hme .stack-head,.hme .stack-tools,.hme .stack-allin,.hme .stack-phone-slot,.hme .stack-screen-dash{opacity:1!important}
  .hme .stack-head{max-height:none!important}
  .hme .stack-tools{max-height:none!important}
  .hme .stack-allin{position:relative!important;margin-top:8px}
  .hme .stack-phone-slot{width:min(300px,100%)}
  .hme .stack-phone-motion{transform:none!important}
  .hme .stack-screen-brand{display:none!important}
  .hme .stack-screen-dash{position:relative!important}
  .hme .stack-scroll + .price{margin-top:64px!important;box-shadow:none}
}
`;

const compactQuery = () => window.matchMedia("(max-width: 767px)").matches;

export default function StackToPhone() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: scrollRef,
    offset: ["start start", "end end"],
  });

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || reduced) {
      stage?.removeAttribute("style");
      return;
    }
    const paint = (value: number) => {
      const node = stageRef.current;
      if (!node) return;
      writeStackFrame(node, stackFrame(value, compactQuery()));
      node.dataset.progress = value.toFixed(3);
    };
    paint(scrollYProgress.get());
    return scrollYProgress.on("change", paint);
  }, [reduced, scrollYProgress]);

  return (
    <div className="stack-scroll" ref={scrollRef} data-stack-scroll="" data-reduced={reduced ? "true" : "false"} style={{ position: "relative" }}>
      <div className="stack-sticky">
        <div className="stack-stage" ref={stageRef}>
          <h2 className="rv stack-head">Seven apps out.<br />One app in.</h2>
          <div className="stack-copy">
            <div className="stack-swap">
              <ul className="stack-tools">
                {STACK_TOOLS.map(tool => <li key={tool}>{tool}</li>)}
              </ul>
              <p className="stack-allin">One app. Every store.</p>
            </div>
          </div>
          <Phone />
        </div>
      </div>
    </div>
  );
}
