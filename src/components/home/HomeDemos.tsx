import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

const CSS = `
.hme .hd-see,.hme .hd-theo{--hd-soft:var(--art-9);--hd-flag:var(--art-10);--hd-shade:var(--home-tone-15)}
.hme .hd-workspace{display:grid;grid-template-columns:260px minmax(0,1fr);gap:28px;margin-top:44px;align-items:start}
.hme .hd-tabs{display:flex;flex-direction:column;gap:10px}
.hme .hd-tab,.hme .hd-option,.hme .hd-location,.hme .hd-question,.hme .hd-cell,.hme .hd-dot,.hme .hd-cube,.hme .hd-close{font:inherit;cursor:pointer;color:var(--ink)}
.hme .hd-tab{border:1px solid var(--line);border-radius:999px;background:var(--white);padding:15px 20px;text-align:left;font-size:15px;font-weight:800;min-height:48px}
.hme .hd-tab[aria-selected=true]{background:var(--teal-d);color:var(--white);border-color:var(--teal-d)}
.hme .hd-see button:focus-visible,.hme .hd-theo button:focus-visible{outline:3px solid var(--orange);outline-offset:3px}
.hme .hd-panel{min-width:0;background:var(--teal);padding:30px;border-radius:28px;min-height:410px}
.hme .hd-copy{color:var(--white);font-size:16px;line-height:1.6;margin-bottom:24px;max-width:54ch}
.hme .hd-card{background:var(--white);border-radius:22px;padding:24px;color:var(--ink);min-width:0}
.hme .hd-card h3{font-size:17px;font-weight:800;margin-bottom:20px}
.hme .hd-grid{display:grid;grid-template-columns:140px repeat(3,minmax(0,1fr));gap:7px;align-items:center}
.hme .hd-day{text-align:center;color:var(--muted);font-size:11px;font-weight:800;padding:8px 0}
.hme .hd-person{display:flex;gap:9px;align-items:center;font-size:12px;font-weight:800;min-width:0}
.hme .hd-person small{display:block;font-size:11px;color:var(--muted);font-weight:600;margin-top:3px}
.hme .hd-avatar{width:28px;height:28px;display:grid;place-items:center;border-radius:50%;color:var(--white);background:var(--teal-d);flex-shrink:0;font-size:10px}
.hme .hd-avatar-1{background:var(--hd-flag)}.hme .hd-avatar-2{background:var(--art-8)}
.hme .hd-cell-wrap{position:relative;min-width:0}
.hme .hd-cell{width:100%;height:66px;background:transparent;border:1px dashed var(--line);border-radius:8px;font-size:22px;color:var(--teal-d);display:flex;flex-direction:column;align-items:flex-start;justify-content:center;padding:7px}
.hme .hd-cell-empty{align-items:center}
.hme .hd-cell-filled{border:1px solid var(--hd-soft);border-left:3px solid var(--orange);background:var(--hd-soft);color:var(--ink);font-size:10px;font-weight:800}
.hme .hd-cell-filled small{font-size:10px;font-weight:600;color:var(--hd-flag);margin-top:4px}
.hme .hd-picker{position:absolute;top:calc(100% + 8px);right:0;width:268px;background:var(--white);border:1px solid var(--line);border-radius:22px;padding:18px;z-index:51;box-shadow:0 12px 40px var(--hd-shade);animation:hd-pop .18s ease-out}
.hme .hd-picker-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px;font-size:13px;font-weight:800}
.hme .hd-close{background:transparent;border:0;width:44px;height:44px;font-size:24px;flex-shrink:0}
.hme .hd-picker-label{font-size:11px;font-weight:800;color:var(--muted);margin:12px 0 6px}
.hme .hd-option{display:flex;flex-direction:column;gap:3px;text-align:left;border:1px solid var(--line);background:var(--white);padding:10px 12px;min-height:44px;width:100%;border-radius:8px;margin-top:6px;font-size:13px;font-weight:800}
.hme .hd-option:hover{background:var(--hd-soft)}.hme .hd-option small{font-size:11px;color:var(--muted);font-weight:500}
.hme .hd-backdrop{display:none}
.hme .hd-cube-stage{perspective:1000px;width:250px;height:250px;margin:10px auto 24px}
.hme .hd-cube{display:block;width:100%;height:100%;position:relative;transform-style:preserve-3d;transition:transform .8s ease;border:0;background:transparent;border-radius:22px}
.hme .hd-cube-0{transform:rotateY(0deg)}.hme .hd-cube-1{transform:rotateY(-90deg)}.hme .hd-cube-2{transform:rotateY(-180deg)}
.hme .hd-face{position:absolute;inset:0;background:var(--white);border:1px solid var(--line);border-radius:22px;backface-visibility:hidden;padding:24px;display:flex;flex-direction:column;justify-content:center;text-align:left;gap:12px;color:var(--ink)}
.hme .hd-face-0{transform:rotateY(0deg) translateZ(125px)}.hme .hd-face-1{transform:rotateY(90deg) translateZ(125px)}.hme .hd-face-2{transform:rotateY(180deg) translateZ(125px)}
.hme .hd-metric-label{font-size:14px;font-weight:800;color:var(--teal-d)}.hme .hd-number{font-family:Fraunces,serif;font-size:52px;line-height:1.1;font-weight:600}
.hme .hd-metric-detail{font-size:12px;color:var(--muted);line-height:1.7}.hme .hd-bar{display:block;height:8px;background:var(--line);border-radius:99px;overflow:hidden}.hme .hd-bar-fill{display:block;height:100%;width:43%;background:var(--orange)}
.hme .hd-dots{display:flex;justify-content:center;gap:6px}.hme .hd-dot{width:44px;height:44px;background:transparent;border:0;display:grid;place-items:center;border-radius:50%}.hme .hd-dot::after{content:'';width:10px;height:10px;border:1px solid var(--white);border-radius:50%}.hme .hd-dot[aria-pressed=true]::after{background:var(--white)}
.hme .hd-cash-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:17px 0;border-top:1px solid var(--line);font-size:13px}.hme .hd-cash-row small{display:block;color:var(--muted);font-size:11px;margin-top:5px}.hme .hd-cash-value{white-space:nowrap;color:var(--teal-d);font-weight:800}.hme .hd-flag{color:var(--hd-flag)}
.hme .hd-location-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.hme .hd-location{background:var(--white);border:1px solid var(--line);border-radius:16px;padding:18px;text-align:left;font-size:13px;min-width:0}.hme .hd-location strong{display:block;font-family:Fraunces,serif;font-size:27px;margin-top:10px}.hme .hd-location[aria-pressed=true]{border:2px solid var(--orange);background:var(--hd-soft);padding:17px}
.hme .hd-theo{display:grid;grid-template-columns:1fr 1fr;gap:64px;align-items:center;padding:20px 0 110px}.hme .hd-theo h2{margin-top:18px;font-size:64px}.hme .hd-chat{background:var(--white);border:1px solid var(--line);border-radius:22px;padding:26px;min-width:0}.hme .hd-chat-title{font-size:18px;font-weight:800;display:flex;align-items:center;gap:10px;padding-bottom:20px;border-bottom:1px solid var(--line)}
.hme .hd-messages{height:275px;overflow-y:auto;display:flex;flex-direction:column;gap:12px;padding:22px 2px;overscroll-behavior:contain}.hme .hd-bubble{background:var(--art-1);color:var(--ink);border-radius:16px 16px 16px 4px;padding:14px 16px;font-size:14px;line-height:1.6;max-width:94%;align-self:flex-start;flex-shrink:0;overflow-wrap:anywhere}.hme .hd-user{background:var(--teal-d);color:var(--white);border-radius:16px 16px 4px 16px;align-self:flex-end}.hme .hd-questions{display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:18px}.hme .hd-question.chip{margin:0;text-align:left;min-height:44px;font-size:12px;white-space:normal}.hme .hd-question:hover{border-color:var(--teal)}
.hme .hd-typing{display:flex;gap:5px;align-items:center;min-height:44px}.hme .hd-typing span{width:6px;height:6px;background:var(--teal-d);border-radius:50%;animation:hd-type .7s ease-in-out infinite alternate}.hme .hd-typing span:nth-child(2){animation-delay:.15s}.hme .hd-typing span:nth-child(3){animation-delay:.3s}
@keyframes hd-pop{from{opacity:0;translate:0 8px}to{opacity:1;translate:0 0}}@keyframes hd-slide{from{translate:0 100%}to{translate:0 0}}@keyframes hd-type{to{opacity:.3;translate:0 -3px}}
@media(max-width:760px){.hme .hd-workspace{grid-template-columns:minmax(0,1fr);gap:20px;margin-top:28px}.hme .hd-tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px}.hme .hd-tab{padding:12px 14px;font-size:12px;text-align:center;white-space:normal}.hme .hd-panel{padding:18px 12px;min-height:400px}.hme .hd-copy{font-size:14px;padding:0 6px}.hme .hd-card{padding:16px 10px}.hme .hd-card h3{font-size:15px}.hme .hd-grid{grid-template-columns:86px repeat(3,minmax(0,1fr));gap:4px}.hme .hd-avatar{display:none}.hme .hd-person{font-size:11px}.hme .hd-cell{height:64px;padding:4px}.hme .hd-cell-filled{font-size:9px;overflow-wrap:anywhere;line-height:1.5}.hme .hd-cell-filled small{font-size:9px}.hme .hd-picker{position:fixed;top:auto;bottom:0;left:0;right:0;width:100%;max-height:85svh;overflow-y:auto;border-radius:22px 22px 0 0;padding:20px 24px calc(20px + env(safe-area-inset-bottom));z-index:101;animation:hd-slide .22s ease-out}.hme .hd-backdrop{display:block;position:fixed;inset:0;background:var(--ink);opacity:.45;z-index:100}.hme .hd-cube-stage{width:230px;height:230px;margin:18px auto 24px}.hme .hd-face-0{transform:rotateY(0deg) translateZ(115px)}.hme .hd-face-1{transform:rotateY(90deg) translateZ(115px)}.hme .hd-face-2{transform:rotateY(180deg) translateZ(115px)}.hme .hd-face{padding:20px}.hme .hd-cash-row{font-size:12px}.hme .hd-location{padding:14px}.hme .hd-location[aria-pressed=true]{padding:13px}.hme .hd-theo{grid-template-columns:minmax(0,1fr);gap:28px;padding:0 0 64px}.hme .hd-theo h2{font-size:44px}.hme .hd-chat{padding:20px}.hme .hd-number{font-size:48px}}
.hme .hd-count-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}.hme .hd-count-head h3{margin-bottom:0}.hme .hd-drawers{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.hme .hd-drawer{border:1px solid var(--line);background:var(--white);border-radius:999px;padding:8px 12px;font-size:12px;font-weight:800;min-height:36px}.hme .hd-drawer[aria-selected=true]{background:var(--teal-d);color:var(--white);border-color:var(--teal-d)}.hme .hd-drawer-pair{display:inline-flex;align-items:center;gap:4px}.hme .hd-drawer-x{min-width:32px;padding:8px}.hme .hd-count-note{margin:8px 0 0;font-size:12px;color:var(--muted);font-weight:600}.hme .hd-count-summary{display:flex;justify-content:space-between;gap:12px;margin-top:14px;padding:14px 16px;border-radius:16px;background:var(--art-1)}.hme .hd-count-summary span{display:block;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}.hme .hd-count-summary strong{display:block;margin-top:4px;font-family:Fraunces,serif;font-size:28px;font-weight:600;line-height:1}.hme .hd-count-summary em{display:block;margin-top:4px;font-style:normal;font-size:13px;font-weight:800}.hme .hd-count-summary .ok,.hme .hd-combined .ok{color:var(--teal-d)}.hme .hd-count-summary .over,.hme .hd-combined .over{color:var(--orange)}.hme .hd-count-summary .short,.hme .hd-combined .short{color:var(--hd-flag)}.hme .hd-denom-head h4{font-size:13px;font-weight:800;letter-spacing:0}.hme .hd-count-scroll{max-height:340px;overflow:auto;overscroll-behavior:contain;margin-top:14px}.hme .hd-count-cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}.hme .hd-denom-head{display:flex;justify-content:space-between;align-items:baseline;font-size:13px;font-weight:800;margin:0 0 6px}.hme .hd-denom-head span{color:var(--muted);font-weight:700}.hme .hd-denom{display:grid;grid-template-columns:minmax(0,1fr) auto 72px;gap:8px;align-items:center;padding:6px 0;border-top:1px solid var(--line)}.hme .hd-denom b{font-size:13px}.hme .hd-denom .sub{text-align:right;font-size:12px;font-weight:700;color:var(--muted);font-variant-numeric:tabular-nums}.hme .hd-stepper{display:flex;align-items:center;gap:4px}.hme .hd-step{width:32px;height:32px;border-radius:8px;border:1px solid var(--line);background:var(--white);font-weight:800;font-size:16px}.hme .hd-stepper output{min-width:22px;text-align:center;font-weight:800;font-variant-numeric:tabular-nums;font-size:13px}.hme .hd-count-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:12px}.hme .hd-text-btn{border:0;background:transparent;color:var(--teal-d);font-weight:800;font-size:12px;min-height:36px;padding:6px 8px}.hme .hd-combined{margin-top:12px;padding-top:12px;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:12px;align-items:baseline}.hme .hd-combined strong{font-family:Fraunces,serif;font-size:22px;font-weight:600}.hme .hd-filters{display:flex;gap:8px;flex-wrap:wrap;margin:-8px 0 14px}.hme .hd-filter{border:1px solid var(--line);background:var(--white);border-radius:999px;padding:8px 12px;font-size:12px;font-weight:800;min-height:36px}.hme .hd-filter[aria-pressed=true]{background:var(--teal-d);color:var(--white);border-color:var(--teal-d)}.hme .hd-loc{width:100%;text-align:left;border:1px solid var(--line);background:var(--white);border-radius:16px;padding:12px 14px;margin-top:8px}.hme .hd-loc[aria-expanded=true]{border-color:var(--orange);background:var(--hd-soft)}.hme .hd-loc-top{display:flex;justify-content:space-between;gap:8px;align-items:center;font-weight:800}.hme .hd-pill{font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--teal-d);background:var(--art-1);border-radius:999px;padding:4px 8px}.hme .hd-pill.bad{color:var(--hd-flag);background:var(--art-9)}.hme .hd-loc-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px}.hme .hd-loc-metrics small{display:block;color:var(--muted);font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}.hme .hd-loc-metrics b{display:block;margin-top:2px;font-size:14px;font-variant-numeric:tabular-nums}.hme .hd-loc-detail{padding:12px 4px 4px}.hme .hd-meter{margin-top:10px}.hme .hd-meter span{font-size:12px;font-weight:700}.hme .hd-meter i{display:block;height:8px;border-radius:99px;background:var(--line);margin-top:6px;overflow:hidden}.hme .hd-meter i::after{content:'';display:block;height:100%;width:var(--w);background:var(--teal);border-radius:99px;transition:width .6s cubic-bezier(.16,.84,.24,1)}.hme .hd-meter.over i::after{background:var(--orange)}.hme .hd-alert{margin-top:10px;font-size:13px;font-weight:700}.hme .hd-alert b{display:block}.hme .hd-loc-empty{color:var(--muted);font-size:13px;font-weight:700}
@keyframes hd-rise{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:none}}.hme .hd-rise{animation:hd-rise .7s cubic-bezier(.16,.84,.24,1) both}
@media(max-width:760px){.hme .hd-count-cols{grid-template-columns:1fr}.hme .hd-count-summary strong{font-size:24px}.hme .hd-count-scroll{max-height:46svh}.hme .hd-loc-metrics b{font-size:13px}.hme .hd-step{width:36px;height:36px}}
@media(prefers-reduced-motion:reduce){.hme .hd-cube,.hme .hd-picker,.hme .hd-typing span,.hme .hd-rise{animation:none;transition:none}.hme .hd-meter i::after{transition:none}}
`;
const PEOPLE = ['Marisol R.', 'Devon K.', 'Priya T.'];
const DAYS = ['MON', 'TUE', 'WED'];
const TEMPLATES = [
  { name: 'Opener', time: '6:00a–2:00p', hours: 8 },
  { name: 'Mid', time: '11:00a–7:00p', hours: 8 },
  { name: 'Closer', time: '3:30p–11:00p', hours: 7.5 },
];
const TABS = ['Smart Tap scheduling', 'Live data cube', 'Cash logs', 'Every location'];
const COPY = [
  'Tap an empty shift. CrooHQ suggests what that person worked last week, plus your store templates. One tap and the shift is filled.',
  'Pin the numbers you care about. The cube turns every 10 seconds. Tap it to turn it yourself.',
  'Count each bill and coin. The running total and over or short update as you tap. Calculator only, same as in the app.',
  'One login for every store. Filter the rollup, then tap a store for sales, labor, and checklists.',
];
function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return reduced;
}
function ShiftPicker({ person, onChoose, onClose }: { person: number; onChoose: (index: number) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = dialog.current;
    node?.querySelector<HTMLButtonElement>('.hd-option')?.focus();
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'Tab' && node) {
        const buttons = Array.from(node.querySelectorAll<HTMLButtonElement>('button'));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        event.preventDefault();
        buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      }
    };
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !node?.contains(event.target)) onClose(); };
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', outside); };
  }, [onClose]);
  const suggested = [0, 2, 1][person];
  const option = (index: number, key: string) => <button type="button" className="hd-option" key={key} onClick={() => onChoose(index)}><span>{TEMPLATES[index].name}</span><small>{TEMPLATES[index].time} · {TEMPLATES[index].hours}h</small></button>;
  return <><div className="hd-backdrop" aria-hidden="true" /><div className="hd-picker" ref={dialog} role="dialog" aria-modal="true" aria-label={`Add shift for ${PEOPLE[person]}`}><div className="hd-picker-head"><span>{PEOPLE[person]}</span><button type="button" className="hd-close" aria-label="Close shift picker" onClick={onClose}>×</button></div><p className="hd-picker-label">Suggested from last week</p>{option(suggested, 'suggested')}<p className="hd-picker-label">All templates</p>{TEMPLATES.map((_, index) => option(index, String(index)))}</div></>;
}
function ScheduleDemo() {
  const [shifts, setShifts] = useState<Record<string, number>>({});
  const [picker, setPicker] = useState<{ person: number; day: number } | null>(null);
  const cells = useRef<Record<string, HTMLButtonElement | null>>({});
  const key = picker ? `${picker.person}-${picker.day}` : '';
  const close = () => { setPicker(null); cells.current[key]?.focus(); };
  return <div className="hd-card"><h3>Schedule · week of 4/27</h3><div className="hd-grid"><span />{DAYS.map(day => <div className="hd-day" key={day}>{day}</div>)}{PEOPLE.map((name, person) => {
    const hours = DAYS.reduce((sum, _, day) => { const shift = shifts[`${person}-${day}`]; return sum + (shift === undefined ? 0 : TEMPLATES[shift].hours); }, 0);
    return [<div className="hd-person" key={name}><span className={`hd-avatar hd-avatar-${person}`} aria-hidden="true">{name.split(' ').map(part => part[0]).join('')}</span><div>{name}<small>{hours.toFixed(1)} hrs</small></div></div>, ...DAYS.map((day, dayIndex) => {
      const cellKey = `${person}-${dayIndex}`;
      const shift = shifts[cellKey];
      return <div className="hd-cell-wrap" key={cellKey}><button type="button" ref={node => { cells.current[cellKey] = node; }} className={`hd-cell ${shift === undefined ? 'hd-cell-empty' : 'hd-cell-filled'}`} aria-label={shift === undefined ? `Add shift for ${name}, ${day}` : `${name}, ${day}: ${TEMPLATES[shift].name}, ${TEMPLATES[shift].time}. Change shift`} aria-haspopup="dialog" aria-expanded={key === cellKey} onClick={() => setPicker({ person, day: dayIndex })}>{shift === undefined ? <span aria-hidden="true">+</span> : <><span>{TEMPLATES[shift].time}</span><small>{TEMPLATES[shift].name}</small></>}</button>{key === cellKey && <ShiftPicker person={person} onClose={close} onChoose={index => { setShifts(prev => ({ ...prev, [cellKey]: index })); close(); }} />}</div>;
    })];
  })}</div></div>;
}
function CubeDemo({ active, onScreen, reduced }: { active: boolean; onScreen: boolean; reduced: boolean }) {
  const [face, setFace] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => { const update = () => setVisible(!document.hidden); document.addEventListener('visibilitychange', update); return () => document.removeEventListener('visibilitychange', update); }, []);
  useEffect(() => {
    if (!active || !onScreen || !visible || reduced || hovered || focused) return;
    const interval = window.setInterval(() => setFace(prev => (prev + 1) % 3), 10000);
    return () => window.clearInterval(interval);
  }, [active, onScreen, visible, reduced, hovered, focused]);
  return <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}><div className="hd-cube-stage"><button type="button" className={`hd-cube hd-cube-${face}`} aria-label="Show next metric" onClick={() => setFace(prev => (prev + 1) % 3)}><span className="hd-face hd-face-0" aria-hidden={face !== 0}><span className="hd-metric-label">Daily sales</span><span className="hd-number">$3,414</span><span className="hd-metric-detail">Pace $3,419<br />Same day last week $3,680</span></span><span className="hd-face hd-face-1" aria-hidden={face !== 1}><span className="hd-metric-label">Daily labor</span><span className="hd-number">25%</span><span className="hd-bar"><span className="hd-bar-fill" /></span><span className="hd-metric-detail">43% · $350 of $820 budget used</span></span><span className="hd-face hd-face-2" aria-hidden={face !== 2}><span className="hd-metric-label">Payment types</span><span className="hd-number">70%</span><span className="hd-metric-detail">Credit 70%<br />Cash 25%</span></span></button></div><div className="hd-dots">{['Daily sales', 'Daily labor', 'Payment types'].map((label, index) => <button type="button" className="hd-dot" key={label} aria-label={`Show ${label}`} aria-pressed={face === index} onClick={() => setFace(index)} />)}</div></div>;
}
const EXPECTED_BANK = 200;
const DENOMS: { key: string; label: string; group: 'Bills' | 'Loose coins' | 'Rolled coins'; cents: number }[] = [
  { key: 'b100', label: '$100', group: 'Bills', cents: 10000 },
  { key: 'b50', label: '$50', group: 'Bills', cents: 5000 },
  { key: 'b20', label: '$20', group: 'Bills', cents: 2000 },
  { key: 'b10', label: '$10', group: 'Bills', cents: 1000 },
  { key: 'b5', label: '$5', group: 'Bills', cents: 500 },
  { key: 'b2', label: '$2', group: 'Bills', cents: 200 },
  { key: 'b1', label: '$1', group: 'Bills', cents: 100 },
  { key: 'cDollar', label: '$1 coin', group: 'Loose coins', cents: 100 },
  { key: 'cHalf', label: 'Half ($0.50)', group: 'Loose coins', cents: 50 },
  { key: 'cQuarter', label: 'Quarter ($0.25)', group: 'Loose coins', cents: 25 },
  { key: 'cDime', label: 'Dime ($0.10)', group: 'Loose coins', cents: 10 },
  { key: 'cNickel', label: 'Nickel ($0.05)', group: 'Loose coins', cents: 5 },
  { key: 'cPenny', label: 'Penny ($0.01)', group: 'Loose coins', cents: 1 },
  { key: 'rQuarter', label: 'Quarter roll ($10)', group: 'Rolled coins', cents: 1000 },
  { key: 'rDime', label: 'Dime roll ($5)', group: 'Rolled coins', cents: 500 },
  { key: 'rNickel', label: 'Nickel roll ($2)', group: 'Rolled coins', cents: 200 },
  { key: 'rPenny', label: 'Penny roll ($0.50)', group: 'Rolled coins', cents: 50 },
];
const GROUPS = ['Bills', 'Loose coins', 'Rolled coins'] as const;
type Counts = Record<string, number>;
const emptyCounts = (): Counts => Object.fromEntries(DENOMS.map(denom => [denom.key, 0]));
const seedCounts = (): Counts => ({ ...emptyCounts(), b20: 8, b5: 4, b1: 6, cQuarter: 8 });
const money = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const countCents = (counts: Counts) => DENOMS.reduce((sum, denom) => sum + denom.cents * (counts[denom.key] || 0), 0);
function varianceCopy(cents: number) {
  if (Math.abs(cents) < 1) return { label: 'Balanced', tone: 'ok' };
  return cents > 0 ? { label: `Over ${money(cents)}`, tone: 'over' } : { label: `Short ${money(Math.abs(cents))}`, tone: 'short' };
}
function CashDemo({ shown, reduced }: { shown: boolean; reduced: boolean }) {
  const [drawers, setDrawers] = useState<{ id: string; name: string; counts: Counts }[]>([{ id: 'd1', name: 'Drawer 1', counts: seedCounts() }]);
  const [active, setActive] = useState('d1');
  const [rise, setRise] = useState(false);
  const nextDrawer = useRef(2);
  useEffect(() => { if (shown) setRise(true); }, [shown]);
  const drawer = drawers.find(item => item.id === active) ?? drawers[0];
  const total = countCents(drawer.counts);
  const variance = varianceCopy(total - EXPECTED_BANK * 100);
  const combined = drawers.reduce((sum, item) => sum + countCents(item.counts), 0);
  const combinedVariance = varianceCopy(combined - drawers.length * EXPECTED_BANK * 100);
  const setCount = (key: string, next: number) => setDrawers(prev => prev.map(item => item.id === drawer.id ? { ...item, counts: { ...item.counts, [key]: Math.max(0, next) } } : item));
  const addDrawer = () => {
    const id = `d${nextDrawer.current++}`;
    setDrawers(prev => [...prev, { id, name: `Drawer ${prev.length + 1}`, counts: emptyCounts() }]);
    setActive(id);
  };
  const removeDrawer = (id: string) => {
    if (drawers.length === 1) return;
    const next = drawers.filter(item => item.id !== id);
    setDrawers(next);
    if (active === id) setActive(next[0].id);
  };
  const groupTotal = (group: typeof GROUPS[number]) => DENOMS.filter(denom => denom.group === group).reduce((sum, denom) => sum + denom.cents * (drawer.counts[denom.key] || 0), 0);
  return <div className={`hd-card hd-count${rise && !reduced ? ' hd-rise' : ''}`}><div className="hd-count-head"><h3>Cash count</h3><div className="hd-drawers" role="tablist" aria-label="Drawers">{drawers.map(item => <span className="hd-drawer-pair" key={item.id}><button type="button" className="hd-drawer" role="tab" aria-selected={item.id === drawer.id} onClick={() => setActive(item.id)}>{item.name}</button>{drawers.length > 1 && <button type="button" className="hd-drawer hd-drawer-x" aria-label={`Remove ${item.name}`} onClick={() => removeDrawer(item.id)}>×</button>}</span>)}<button type="button" className="hd-drawer" onClick={addDrawer}>+ Drawer</button></div></div><p className="hd-count-note">Calculator only. Nothing is saved — use Drawer Count in the app to record one.</p><div className="hd-count-summary" aria-live="polite"><div><span>Counted total</span><strong>{money(total)}</strong></div><div><span>Expected bank</span><strong>{money(EXPECTED_BANK * 100)}</strong><em className={variance.tone}>{variance.label}</em></div></div><div className="hd-count-scroll"><div className="hd-count-cols"><section>{GROUPS.slice(0, 1).map(group => <DenomGroup key={group} group={group} total={groupTotal(group)} counts={drawer.counts} onChange={setCount} />)}</section><div>{GROUPS.slice(1).map(group => <DenomGroup key={group} group={group} total={groupTotal(group)} counts={drawer.counts} onChange={setCount} />)}</div></div></div>{drawers.length > 1 && <div className="hd-combined"><div><span>Combined ({drawers.length} drawers)</span><strong>{money(combined)}</strong></div><em className={combinedVariance.tone}>{combinedVariance.label}</em></div>}<div className="hd-count-actions"><button type="button" className="hd-text-btn" onClick={() => setDrawers(prev => prev.map(item => item.id === drawer.id ? { ...item, counts: emptyCounts() } : item))}>Clear this drawer</button><button type="button" className="hd-text-btn" onClick={() => { setDrawers([{ id: 'd1', name: 'Drawer 1', counts: emptyCounts() }]); setActive('d1'); }}>Reset all drawers</button></div></div>;
}
function DenomGroup({ group, total, counts, onChange }: { group: typeof GROUPS[number]; total: number; counts: Counts; onChange: (key: string, next: number) => void }) {
  return <div style={group === 'Rolled coins' ? { marginTop: 16 } : undefined}><div className="hd-denom-head"><h4>{group}</h4><span>{money(total)}</span></div>{DENOMS.filter(denom => denom.group === group).map(denom => {
    const count = counts[denom.key] || 0;
    return <div className="hd-denom" key={denom.key}><b>{denom.label}</b><div className="hd-stepper"><button type="button" className="hd-step" aria-label={`Remove one ${denom.label}`} onClick={() => onChange(denom.key, count - 1)}>−</button><output>{count}</output><button type="button" className="hd-step" aria-label={`Add one ${denom.label}`} onClick={() => onChange(denom.key, count + 1)}>+</button></div><span className="sub">{money(denom.cents * count)}</span></div>;
  })}</div>;
}
const STORES: { name: string; sales: number; labor: number; budget: number; done: number; total: number; alerts: { title: string; status: string }[] }[] = [
  { name: 'Harbor Blvd', sales: 3847, labor: 24.8, budget: 26, done: 5, total: 6, alerts: [] },
  { name: 'Main St', sales: 2210, labor: 28.4, budget: 26, done: 3, total: 6, alerts: [{ title: 'Morning line check', status: '50% Complete' }] },
  { name: 'Oak Plaza', sales: 1988, labor: 22.1, budget: 26, done: 6, total: 6, alerts: [] },
  { name: 'Westfield', sales: 2650, labor: 31.2, budget: 26, done: 0, total: 6, alerts: [{ title: 'Opening checklist', status: 'Not Started' }] },
];
const STORE_FILTERS = [
  { id: 'all', label: 'All stores' },
  { id: 'labor', label: 'Labor over budget' },
  { id: 'lists', label: 'Open checklists' },
] as const;
function LocationDemo({ shown, reduced }: { shown: boolean; reduced: boolean }) {
  const [filter, setFilter] = useState<(typeof STORE_FILTERS)[number]['id']>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [rise, setRise] = useState(0);
  useEffect(() => { if (shown) setRise(count => count + 1); }, [shown, filter]);
  const shownStores = STORES.filter(store => filter === 'all' || (filter === 'labor' ? store.labor > store.budget : store.done < store.total));
  const sales = (amount: number) => amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  return <div className="hd-card hd-locs"><h3>Every location</h3><div className="hd-filters" role="group" aria-label="Filter stores">{STORE_FILTERS.map(item => <button type="button" className="hd-filter" key={item.id} aria-pressed={filter === item.id} onClick={() => { setFilter(item.id); setOpen(null); }}>{item.label}</button>)}</div><div className="hd-loc-list">{shownStores.length === 0 && <p className="hd-loc-empty">No stores match.</p>}{shownStores.map((store, index) => {
    const selected = open === store.name;
    const checkPct = Math.round((store.done / store.total) * 100);
    const laborPct = Math.min(100, Math.round((store.labor / store.budget) * 100));
    return <div key={`${store.name}-${rise}`} className={rise && !reduced ? 'hd-rise' : undefined} style={rise && !reduced ? { animationDelay: `${index * 70}ms` } : undefined}><button type="button" className="hd-loc" aria-expanded={selected} onClick={() => setOpen(selected ? null : store.name)}><span className="hd-loc-top"><span>{store.name}</span><span className={store.labor > store.budget ? 'hd-pill bad' : 'hd-pill'}>{store.labor > store.budget ? 'Behind' : 'On track'}</span></span><span className="hd-loc-metrics"><span><small>Sales</small><b>{sales(store.sales)}</b></span><span><small>Labor</small><b>{store.labor.toFixed(1)}%</b></span><span><small>Checklists</small><b>{store.done} of {store.total}</b></span></span></button>{selected && <div className="hd-loc-detail"><div className={`hd-meter${store.labor > store.budget ? ' over' : ''}`}><span>Labor {store.labor.toFixed(1)}% · budget {store.budget}%</span><i style={{ ['--w' as string]: `${laborPct}%` }} /></div><div className="hd-meter"><span>Checklists {store.done} of {store.total}</span><i style={{ ['--w' as string]: `${checkPct}%` }} /></div>{store.alerts.length === 0 ? <p className="hd-loc-empty">No open checklist alerts.</p> : store.alerts.map(alert => <p className="hd-alert" key={alert.title}><b>{alert.title}</b>{alert.status}</p>)}</div>}</div>;
  })}</div></div>;
}
const QUESTIONS = [
  { question: 'Who temped the tomatoes today?', answer: <>Marisol R. logged them at <strong>41.6°F</strong> on the AM line check, <strong>1:43 PM</strong>. In range.</> },
  { question: 'What was labor yesterday?', answer: <>Labor was <strong>24.8%</strong> against a <strong>26%</strong> budget.</> },
  { question: 'Any cash variances this week?', answer: <>One. Tuesday PM, <strong>−$12.00</strong>, logged by Devon K. Everything else is clean.</> },
  { question: 'Who has the most hours?', answer: <>Priya T. has <strong>38.5 hrs</strong> this week. Devon K. has <strong>34</strong>. Marisol R. has <strong>29</strong>.</> },
];
function TheoDemo({ reduced }: { reduced: boolean }) {
  const [messages, setMessages] = useState<{ user: boolean; text: ReactNode }[]>([{ user: false, text: 'Hi, I’m Theo. Pick a question below.' }]);
  const [typing, setTyping] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const area = useRef<HTMLDivElement>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => { if (area.current) area.current.scrollTop = area.current.scrollHeight; }, [messages, typing]);
  const ask = (index: number) => {
    if (timer.current) clearTimeout(timer.current);
    const { question, answer } = QUESTIONS[index];
    setMessages(prev => [...prev, { user: true, text: question }]);
    if (reduced) { setMessages(prev => [...prev, { user: false, text: answer }]); setTyping(false); return; }
    setTyping(true);
    timer.current = setTimeout(() => { setMessages(prev => [...prev, { user: false, text: answer }]); setTyping(false); timer.current = null; }, 700);
  };
  return <section className="hd-theo" id="theo" aria-labelledby="theo-h"><div className="hd-intro rv"><p className="eyebrow">Meet Theo</p><h2 id="theo-h">Ask your store anything.</h2><p className="big">Theo reads your checklists, cash logs and schedules. Ask in plain words, get a straight answer.</p></div><div className="hd-chat rv"><div className="hd-chat-title"><span className="hd-avatar" aria-hidden="true">T</span>Theo</div><div className="hd-messages" ref={area} aria-live="polite" aria-relevant="additions" aria-busy={typing}>{messages.map((message, index) => <p key={index} className={`hd-bubble ${message.user ? 'hd-user' : ''}`}>{message.text}</p>)}{typing && <div className="hd-bubble hd-typing" role="status" aria-label="Theo is typing"><span /><span /><span /></div>}</div><div className="hd-questions">{QUESTIONS.map(({ question }, index) => <button type="button" className="hd-question chip" key={question} onClick={() => ask(index)}>{question}</button>)}</div></div></section>;
}
export default function HomeDemos() {
  const [tab, setTab] = useState(0);
  const [onScreen, setOnScreen] = useState(false);
  const section = useRef<HTMLElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const reduced = useReducedMotion();
  useEffect(() => {
    const observer = new IntersectionObserver(entries => { for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add('in'); observer.unobserve(entry.target); } }, { threshold: .1 });
    root.current?.querySelectorAll('.rv').forEach(node => observer.observe(node));
    const visibility = new IntersectionObserver(entries => setOnScreen(entries.some(entry => entry.isIntersecting)));
    if (section.current) visibility.observe(section.current);
    return () => { observer.disconnect(); visibility.disconnect(); };
  }, []);
  const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = 3;
    else if (['ArrowRight', 'ArrowDown'].includes(event.key)) next = (index + 1) % 4;
    else if (['ArrowLeft', 'ArrowUp'].includes(event.key)) next = (index + 3) % 4;
    else return;
    event.preventDefault(); setTab(next); tabs.current[next]?.focus();
  };
  return <div ref={root} className="hd-root"><style>{CSS}</style><section className="sec hd-see" id="see-it" aria-labelledby="see-h" ref={section}><p className="eyebrow rv">See it work</p><h2 id="see-h" className="rv">Tap it.<br />Don’t take our word.</h2><p className="big rv">These are live demos. Click around. The real thing works the same way on the iPad at the store.</p><div className="hd-workspace"><div className="hd-tabs" role="tablist" aria-label="CrooHQ live demos">{TABS.map((title, index) => <button type="button" className="hd-tab" id={`hd-tab-${index}`} key={title} role="tab" aria-selected={tab === index} aria-controls={`hd-panel-${index}`} tabIndex={tab === index ? 0 : -1} ref={node => { tabs.current[index] = node; }} onClick={() => setTab(index)} onKeyDown={event => navigate(event, index)}>{title}</button>)}</div><div className="hd-panels">{TABS.map((title, index) => <div className="hd-panel" role="tabpanel" key={title} id={`hd-panel-${index}`} aria-labelledby={`hd-tab-${index}`} hidden={tab !== index} tabIndex={0}><p className="hd-copy">{COPY[index]}</p>{index === 0 ? <ScheduleDemo /> : index === 1 ? <CubeDemo active={tab === 1} onScreen={onScreen} reduced={reduced} /> : index === 2 ? <CashDemo shown={tab === 2} reduced={reduced} /> : <LocationDemo shown={tab === 3} reduced={reduced} />}</div>)}</div></div></section><TheoDemo reduced={reduced} /></div>;
}
