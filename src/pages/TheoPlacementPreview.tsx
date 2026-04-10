import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Sparkles, MessageSquare, ClipboardCheck, CalendarCheck, LayoutDashboard, MapPin, ChevronDown, Search } from 'lucide-react';
import theoAvatar from '@/assets/theo-avatar.png';

const CONCEPTS = [
  {
    id: 'header-profile',
    title: '1. Header Companion',
    subtitle: 'Next to user avatar',
    description: 'Theo lives in the mobile header, right beside your profile pic. Always visible, one tap away. Feels like a co-pilot riding shotgun.',
    pros: ['Always visible', 'Zero scroll needed', 'Natural eye-line'],
    cons: ['Header space is tight', 'Competes with location picker'],
  },
  {
    id: 'dock-center',
    title: '2. Dock Center Stage',
    subtitle: 'Embedded in bottom nav',
    description: 'Theo replaces the center dock slot with a glowing orb. Like the Instagram create button — prime real estate, muscle-memory friendly.',
    pros: ['Thumb-native', 'Most discoverable', 'Premium feel'],
    cons: ['Loses a nav slot', 'May feel forced'],
  },
  {
    id: 'compact-dash',
    title: '3. Manager Dash Panel',
    subtitle: 'Inside swipe-up dashboard',
    description: 'Theo gets a dedicated card inside the CompactDashboard (swipe-up). Context-rich — you see sales data, then ask Theo about it.',
    pros: ['Contextual', 'Manager-only space', 'Non-intrusive'],
    cons: ['Hidden behind swipe', 'Extra step to reach'],
  },
  {
    id: 'search-bar',
    title: '4. Smart Search Bar',
    subtitle: 'Unified search + AI input',
    description: 'A persistent search bar at the top of the dashboard that doubles as Theo\'s input. Type a question or search for anything. Think Spotlight meets ChatGPT.',
    pros: ['Dual purpose', 'Modern UX pattern', 'Always accessible'],
    cons: ['Takes vertical space', 'Needs careful empty state'],
  },
  {
    id: 'tab-embed',
    title: '5. Theo Tab',
    subtitle: 'Dedicated dock tab',
    description: 'Theo gets his own tab in the bottom nav (replacing or adding to the 5 slots). Full-screen chat experience, not a modal overlay.',
    pros: ['Full real estate', 'First-class citizen', 'Chat history visible'],
    cons: ['Adds a 6th tab or replaces one', 'Less contextual'],
  },
  {
    id: 'inline-cards',
    title: '6. Inline Dashboard Cards',
    subtitle: 'Contextual nudges in feed',
    description: 'Theo appears as smart insight cards scattered in your dashboard feed. "Sales are 12% above pace — want me to break it down?" Tap to expand into chat.',
    pros: ['Most contextual', 'Proactive insights', 'Non-intrusive'],
    cons: ['Fragmented experience', 'Complex to build'],
  },
];

// Phone frame mockup component
function PhoneMockup({ conceptId, isSelected }: { conceptId: string; isSelected: boolean }) {
  const navItems = [
    { icon: LayoutDashboard, label: 'Dash', active: true },
    { icon: MessageSquare, label: 'Chat' },
    { icon: ClipboardCheck, label: 'Tasks' },
    { icon: CalendarCheck, label: 'Logs' },
    { icon: CalendarCheck, label: 'Schedule' },
  ];

  return (
    <div className={`relative mx-auto w-[200px] h-[380px] rounded-[28px] border-[3px] overflow-hidden transition-all duration-300 ${
      isSelected ? 'border-primary shadow-[0_0_20px_hsl(var(--primary)/0.3)]' : 'border-border/60'
    }`} style={{ background: 'hsl(var(--background))' }}>
      {/* Status bar */}
      <div className="h-5 bg-primary flex items-center justify-center">
        <div className="w-12 h-1.5 bg-black/20 rounded-full" />
      </div>
      
      {/* Header */}
      <div className="h-10 bg-primary flex items-center px-3 justify-between" style={{ borderRadius: '0 0 10px 10px' }}>
        <div className="w-5 h-5 rounded-md bg-white/30" />
        <div className="flex items-center gap-1 text-[8px] text-white/90 font-medium">
          <MapPin className="h-2.5 w-2.5" />
          <span>Hemet</span>
          <ChevronDown className="h-2 w-2" />
        </div>
        
        {/* Concept 1: Theo next to profile */}
        {conceptId === 'header-profile' ? (
          <div className="flex items-center gap-1.5">
            <div className="h-5 w-5 rounded-full overflow-hidden ring-1 ring-amber-400/60 shadow-[0_0_6px_rgba(245,158,11,0.4)]">
              <img src={theoAvatar} alt="" className="h-full w-full object-cover" />
            </div>
            <div className="w-5 h-5 rounded-full bg-white/30" />
          </div>
        ) : (
          <div className="w-5 h-5 rounded-full bg-white/30" />
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 px-2.5 py-2 space-y-1.5 overflow-hidden" style={{ height: 'calc(100% - 105px)' }}>
        {/* Concept 4: Search bar */}
        {conceptId === 'search-bar' && (
          <div className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-2 py-1.5">
            <Search className="h-2.5 w-2.5 text-muted-foreground" />
            <span className="text-[7px] text-muted-foreground flex-1">Ask Theo or search...</span>
            <div className="h-4 w-4 rounded-full overflow-hidden">
              <img src={theoAvatar} alt="" className="h-full w-full object-cover" />
            </div>
          </div>
        )}

        {/* Concept 6: Inline insight card */}
        {conceptId === 'inline-cards' && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 flex items-start gap-1.5">
            <div className="h-4 w-4 rounded-full overflow-hidden shrink-0 mt-0.5">
              <img src={theoAvatar} alt="" className="h-full w-full object-cover" />
            </div>
            <div>
              <p className="text-[7px] font-semibold text-foreground leading-tight">Sales are 12% above pace</p>
              <p className="text-[6px] text-muted-foreground mt-0.5">Tap to ask Theo why →</p>
            </div>
          </div>
        )}

        {/* Sales cubes */}
        <div className="flex gap-1.5">
          <div className="flex-1 h-16 rounded-lg bg-primary/10 border border-primary/20 p-1.5">
            <p className="text-[6px] text-muted-foreground uppercase">Daily Sales</p>
            <p className="text-[10px] font-bold text-foreground mt-0.5">$2,146</p>
          </div>
          <div className="flex-1 h-16 rounded-lg bg-accent/30 border border-accent/20 p-1.5">
            <p className="text-[6px] text-muted-foreground uppercase">Daily</p>
            <p className="text-[10px] font-bold text-foreground mt-0.5">$2,146</p>
          </div>
        </div>
        
        {/* Checklists placeholder */}
        <div className="space-y-1">
          <p className="text-[7px] font-semibold text-foreground">Checklists</p>
          <div className="h-6 rounded-md bg-muted/50 border border-border/40" />
          <div className="h-6 rounded-md bg-muted/50 border border-border/40" />
        </div>

        {/* Concept 6: Another inline card lower */}
        {conceptId === 'inline-cards' && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-1.5">
            <p className="text-[6px] text-muted-foreground">💡 3 tasks overdue — want a summary?</p>
          </div>
        )}
      </div>

      {/* Compact Dashboard overlay for concept 3 */}
      {conceptId === 'compact-dash' && (
        <div className="absolute bottom-[50px] left-0 right-0 bg-card border-t border-border rounded-t-2xl p-2.5 shadow-lg" style={{ height: '130px' }}>
          <div className="w-8 h-1 bg-muted-foreground/30 rounded-full mx-auto mb-2" />
          <div className="flex gap-2 mb-2">
            <div className="flex-1 text-center">
              <p className="text-[6px] text-muted-foreground">Sales</p>
              <p className="text-[9px] font-bold">$2,146</p>
            </div>
            <div className="flex-1 text-center">
              <p className="text-[6px] text-muted-foreground">Labor</p>
              <p className="text-[9px] font-bold">29.2%</p>
            </div>
          </div>
          {/* Theo card inside compact dash */}
          <div className="flex items-center gap-1.5 rounded-lg bg-muted/60 border border-border p-1.5">
            <div className="h-5 w-5 rounded-full overflow-hidden shrink-0 ring-1 ring-amber-400/40">
              <img src={theoAvatar} alt="" className="h-full w-full object-cover" />
            </div>
            <div className="flex-1">
              <p className="text-[7px] font-semibold">Ask Theo</p>
              <p className="text-[5px] text-muted-foreground">Tap to chat about your data</p>
            </div>
            <Sparkles className="h-3 w-3 text-amber-500" />
          </div>
        </div>
      )}

      {/* Bottom dock */}
      <div className="absolute bottom-0 left-0 right-0 h-[50px] bg-primary/90 backdrop-blur flex items-center justify-evenly px-1" style={{ borderRadius: '12px 12px 0 0' }}>
        {conceptId === 'dock-center' ? (
          <>
            {navItems.slice(0, 2).map((item, i) => (
              <div key={i} className="flex flex-col items-center gap-0.5">
                <item.icon className="h-4 w-4 text-white/70" strokeWidth={1.5} />
                <span className="text-[5px] text-white/70">{item.label}</span>
              </div>
            ))}
            {/* Center Theo orb */}
            <div className="relative -mt-5">
              <div className="h-11 w-11 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 shadow-[0_0_16px_rgba(245,158,11,0.5)] flex items-center justify-center border-[3px] border-primary/90">
                <img src={theoAvatar} alt="" className="h-7 w-7 rounded-full object-cover" />
              </div>
              <span className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 text-[5px] text-white/90 font-medium">Theo</span>
            </div>
            {navItems.slice(3, 5).map((item, i) => (
              <div key={i} className="flex flex-col items-center gap-0.5">
                <item.icon className="h-4 w-4 text-white/70" strokeWidth={1.5} />
                <span className="text-[5px] text-white/70">{item.label}</span>
              </div>
            ))}
          </>
        ) : conceptId === 'tab-embed' ? (
          <>
            {navItems.slice(0, 2).map((item, i) => (
              <div key={i} className="flex flex-col items-center gap-0.5">
                <item.icon className="h-4 w-4 text-white/70" strokeWidth={1.5} />
                <span className="text-[5px] text-white/70">{item.label}</span>
              </div>
            ))}
            {/* Theo as a regular tab */}
            <div className="flex flex-col items-center gap-0.5">
              <div className="h-4 w-4 rounded-full overflow-hidden">
                <img src={theoAvatar} alt="" className="h-full w-full object-cover" />
              </div>
              <span className="text-[5px] text-amber-300 font-semibold">Theo</span>
            </div>
            {navItems.slice(3, 5).map((item, i) => (
              <div key={i} className="flex flex-col items-center gap-0.5">
                <item.icon className="h-4 w-4 text-white/70" strokeWidth={1.5} />
                <span className="text-[5px] text-white/70">{item.label}</span>
              </div>
            ))}
          </>
        ) : (
          navItems.map((item, i) => (
            <div key={i} className="flex flex-col items-center gap-0.5">
              <item.icon className={`h-4 w-4 ${item.active ? 'text-white' : 'text-white/70'}`} strokeWidth={1.5} />
              <span className={`text-[5px] ${item.active ? 'text-white font-semibold' : 'text-white/70'}`}>{item.label}</span>
            </div>
          ))
        )}
      </div>

      {/* Floating orb for non-dock concepts (current behavior reference) */}
      {!['dock-center', 'tab-embed', 'header-profile', 'compact-dash'].includes(conceptId) && conceptId !== 'search-bar' && conceptId !== 'inline-cards' && (
        <div className="absolute bottom-[60px] right-3 h-10 w-10 rounded-full bg-card border border-border shadow-lg flex items-center justify-center">
          <Sparkles className="h-4 w-4 text-amber-500" />
        </div>
      )}
    </div>
  );
}

export default function TheoPlacementPreview() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-1.5 rounded-xl hover:bg-muted">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-base font-bold">Theo Placement Options</h1>
            <p className="text-[11px] text-muted-foreground">Tap a concept to see details</p>
          </div>
        </div>
      </div>

      {/* Grid of concepts */}
      <div className="p-4 space-y-6">
        <div className="grid grid-cols-2 gap-4">
          {CONCEPTS.map((concept) => (
            <button
              key={concept.id}
              onClick={() => setSelected(selected === concept.id ? null : concept.id)}
              className="text-left space-y-2"
            >
              <PhoneMockup conceptId={concept.id} isSelected={selected === concept.id} />
              <div className="px-1">
                <p className="text-xs font-bold text-foreground leading-tight">{concept.title}</p>
                <p className="text-[10px] text-primary font-medium">{concept.subtitle}</p>
              </div>
            </button>
          ))}
        </div>

        {/* Selected concept details */}
        {selected && (() => {
          const concept = CONCEPTS.find(c => c.id === selected)!;
          return (
            <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-3 animate-in fade-in slide-in-from-bottom-2">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full overflow-hidden">
                  <img src={theoAvatar} alt="" className="h-full w-full object-cover" />
                </div>
                <div>
                  <p className="text-sm font-bold">{concept.title}</p>
                  <p className="text-xs text-muted-foreground">{concept.subtitle}</p>
                </div>
              </div>
              <p className="text-xs text-foreground/80 leading-relaxed">{concept.description}</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider mb-1">Pros</p>
                  {concept.pros.map((pro, i) => (
                    <p key={i} className="text-[11px] text-foreground/70">✓ {pro}</p>
                  ))}
                </div>
                <div>
                  <p className="text-[10px] font-bold text-amber-500 uppercase tracking-wider mb-1">Trade-offs</p>
                  {concept.cons.map((con, i) => (
                    <p key={i} className="text-[11px] text-foreground/70">• {con}</p>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
