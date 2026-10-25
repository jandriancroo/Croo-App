import { Children, cloneElement, isValidElement, useEffect, useRef, useState, type ReactNode } from 'react';
import { DateTime } from 'luxon';
import { Button } from '@/components/ui/button';
import './duo-dash.css';
import { DuoDashContext } from './DuoDashContext';

function emphasizeNumbers(node: ReactNode): ReactNode {
  if (typeof node === 'string') return node.split(/(\$[\d,]+|\d+(?:\.\d+)?%)/g).map((part, i) => /^\$|%$/.test(part) ? <b key={i}>{part}</b> : part);
  if (isValidElement<{ children?: ReactNode }>(node)) return cloneElement(node, {}, emphasizeNumbers(node.props.children));
  return Children.map(node, child => typeof child === 'string' || isValidElement(child) ? emphasizeNumbers(child) : child);
}

export function DuoDash({ sentence, timezone, quickTasks, dashboard, onEdit }: {
  sentence: ReactNode; timezone: string; quickTasks: ReactNode; dashboard: ReactNode; onEdit: () => void;
}) {
  const [theme, setTheme] = useState<'paper' | 'oled'>(() => matchMedia('(prefers-color-scheme: dark)').matches ? 'oled' : 'paper');
  useEffect(() => {
    // The Duo dock's "Edit layout" button asks the Dash to open its editor.
    const edit = () => onEdit();
    window.addEventListener('open-edit-layout', edit);
    return () => window.removeEventListener('open-edit-layout', edit);
  }, [onEdit]);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Open mode: the checklists pane starts where the intro + Quick Tasks end (each side scrolls on its own).
    const root = rootRef.current;
    if (!root) return;
    const place = () => {
      const q = root.querySelector<HTMLElement>('.duo-quick');
      const bottom = q ? q.getBoundingClientRect().bottom : 0;
      document.documentElement.style.setProperty('--duo-left-top', `${Math.round(bottom)}px`);
    };
    place();
    const ro = new ResizeObserver(place);
    root.querySelectorAll('.duo-dash-intro, .duo-quick').forEach(el => ro.observe(el));
    window.addEventListener('resize', place);
    return () => { ro.disconnect(); window.removeEventListener('resize', place); document.documentElement.style.removeProperty('--duo-left-top'); };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.duoTheme = theme;
  }, [theme]);
  return <div ref={rootRef} className="duo-dash" data-duo-theme={theme}>
    <div className="duo-dash-grid">
      <div className="duo-dash-intro"><Button variant="ghost" className="duo-date" onClick={() => setTheme(t => t === 'paper' ? 'oled' : 'paper')}>
        <b>{DateTime.now().setZone(timezone).toFormat('cccc')}</b><span>{DateTime.now().setZone(timezone).toFormat('MMM d')}</span></Button>
        {sentence && <div className="duo-theo"><i aria-hidden /> <div>{emphasizeNumbers(sentence)}</div></div>}
      </div>
      <div className="duo-quick">{quickTasks}</div>
      <div className="duo-widgets"><DuoDashContext.Provider value>{dashboard}</DuoDashContext.Provider></div>
    </div>
  </div>;
}