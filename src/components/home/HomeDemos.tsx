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
@media(prefers-reduced-motion:reduce){.hme .hd-cube,.hme .hd-picker,.hme .hd-typing span{animation:none;transition:none}}
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
  'Every drawer count is logged as it happens. A short drawer gets flagged right away. Close goes from 35 minutes to 4.',
  'One login for every store. Tap a location to switch.',
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
function CashDemo() {
  return <div className="hd-card"><h3>Cash logs</h3>{[['AM opening count', 'Marisol R. · 9:02 AM', '$300.00'], ['Mid-shift drop', 'Devon K. · 3:15 PM', '$847.50'], ['PM recount', 'Priya T. · 7:41 PM', '−$12.00']].map(([title, by, value], index) => <div className="hd-cash-row" key={title}><div><strong>{title}</strong><small>{by}</small></div><div className={`hd-cash-value ${index === 2 ? 'hd-flag' : ''}`}>{value}{index === 2 ? <small className="hd-flag">Flagged</small> : <span aria-label="Balanced"> ✓</span>}</div></div>)}</div>;
}
function LocationDemo() {
  const [selected, setSelected] = useState(0);
  const locations = [['Harbor Blvd', '$3,847'], ['Main St', '$2,210'], ['Oak Plaza', '$1,988'], ['Westfield', '$2,650']];
  return <div className="hd-card"><h3 aria-live="polite">Sales today: {locations[selected][1]}</h3><div className="hd-location-grid">{locations.map(([name, value], index) => <button type="button" className="hd-location" key={name} aria-pressed={index === selected} onClick={() => setSelected(index)}>{name}<strong>{value}</strong></button>)}</div></div>;
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
  return <div ref={root} className="hd-root"><style>{CSS}</style><section className="sec hd-see" id="see-it" aria-labelledby="see-h" ref={section}><p className="eyebrow rv">See it work</p><h2 id="see-h" className="rv">Tap it.<br />Don’t take our word.</h2><p className="big rv">These are live demos. Click around. The real thing works the same way on the iPad at the store.</p><div className="hd-workspace"><div className="hd-tabs" role="tablist" aria-label="CrooHQ live demos">{TABS.map((title, index) => <button type="button" className="hd-tab" id={`hd-tab-${index}`} key={title} role="tab" aria-selected={tab === index} aria-controls={`hd-panel-${index}`} tabIndex={tab === index ? 0 : -1} ref={node => { tabs.current[index] = node; }} onClick={() => setTab(index)} onKeyDown={event => navigate(event, index)}>{title}</button>)}</div><div className="hd-panels">{TABS.map((title, index) => <div className="hd-panel" role="tabpanel" key={title} id={`hd-panel-${index}`} aria-labelledby={`hd-tab-${index}`} hidden={tab !== index} tabIndex={0}><p className="hd-copy">{COPY[index]}</p>{index === 0 ? <ScheduleDemo /> : index === 1 ? <CubeDemo active={tab === 1} onScreen={onScreen} reduced={reduced} /> : index === 2 ? <CashDemo /> : <LocationDemo />}</div>)}</div></div></section><TheoDemo reduced={reduced} /></div>;
}
