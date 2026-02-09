import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, 
  Calendar, 
  CheckSquare, 
  LayoutDashboard, 
  MessageSquare, 
  Scroll,
  ChevronLeft,
  ChevronRight,
  Plus,
  Settings,
  Bell,
  Search,
  Filter,
  MoreHorizontal,
  Check,
  X,
  Star,
  Heart,
  Bookmark,
  Clock,
  Users,
  TrendingUp,
  Coffee
} from 'lucide-react';
import { format, addDays, subDays } from 'date-fns';

const mockNavItems = [
  { label: 'Dash', icon: LayoutDashboard },
  { label: 'Tasks', icon: CheckSquare },
  { label: 'Sched', icon: Calendar },
  { label: 'Msgs', icon: MessageSquare },
  { label: 'Logs', icon: Scroll },
];

export default function VisionOSPreview() {
  const navigate = useNavigate();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [activeTab, setActiveTab] = useState(0);
  const [selectedFilter, setSelectedFilter] = useState('all');
  const [toggleValue, setToggleValue] = useState('today');
  const [previewPage, setPreviewPage] = useState<'dashboard' | 'tasks' | 'schedule'>('dashboard');

  return (
    <div 
      className="min-h-screen p-4 pb-40"
      style={{
        background: 'linear-gradient(135deg, hsl(var(--background)) 0%, hsl(var(--muted)) 50%, hsl(var(--background)) 100%)'
      }}
    >
      <div className="max-w-lg mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button 
            onClick={() => navigate(-1)}
            className="vision-glass-button p-2 rounded-full"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-bold">visionOS Style Preview</h1>
        </div>

        <p className="text-sm text-muted-foreground">
          Frosted glass UI with your system colors. Same brand, new depth.
        </p>

        {/* Page Selector */}
        <div className="flex gap-2">
          {(['dashboard', 'tasks', 'schedule'] as const).map((page) => (
            <button
              key={page}
              onClick={() => setPreviewPage(page)}
              className={`vision-glass-chip px-4 py-2 rounded-full text-sm font-medium capitalize transition-all ${
                previewPage === page ? 'bg-primary/20 text-primary border-primary/30' : ''
              }`}
            >
              {page}
            </button>
          ))}
        </div>

        {/* Section: Buttons with System Colors */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Buttons</h2>
          <div className="vision-glass-card p-4 rounded-2xl space-y-4">
            <div className="flex flex-wrap gap-3">
              <button className="vision-glass-button px-4 py-2 rounded-full text-sm font-medium">
                Secondary
              </button>
              <button className="vision-glass-button-primary px-4 py-2 rounded-full text-sm font-medium">
                Primary
              </button>
              <button className="vision-glass-button-accent px-4 py-2 rounded-full text-sm font-medium">
                <Plus className="h-4 w-4 mr-1 inline" />
                Add New
              </button>
            </div>
            <div className="flex flex-wrap gap-3">
              <button className="vision-glass-button-destructive px-4 py-2 rounded-full text-sm font-medium">
                Delete
              </button>
              <button className="vision-glass-button px-4 py-2 rounded-full text-sm font-medium opacity-50 cursor-not-allowed">
                Disabled
              </button>
            </div>
            {/* Icon buttons */}
            <div className="flex flex-wrap gap-3">
              <button className="vision-glass-button p-2.5 rounded-full">
                <Settings className="h-5 w-5" />
              </button>
              <button className="vision-glass-button p-2.5 rounded-full">
                <Bell className="h-5 w-5 text-accent" />
              </button>
              <button className="vision-glass-button p-2.5 rounded-full">
                <Search className="h-5 w-5" />
              </button>
              <button className="vision-glass-button-primary p-2.5 rounded-full">
                <Plus className="h-5 w-5" />
              </button>
              <button className="vision-glass-button-accent p-2.5 rounded-full">
                <Filter className="h-5 w-5" />
              </button>
            </div>
          </div>
        </section>

        {/* Section: Toggle / Segmented Control */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Segmented Controls</h2>
          <div className="vision-glass-card p-4 rounded-2xl space-y-4">
            {/* Primary colored toggle */}
            <div className="vision-glass-segmented p-1 rounded-full inline-flex">
              <button 
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                  toggleValue === 'today' 
                    ? 'bg-primary text-primary-foreground shadow-sm' 
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setToggleValue('today')}
              >
                Today
              </button>
              <button 
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                  toggleValue === 'week' 
                    ? 'bg-primary text-primary-foreground shadow-sm' 
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setToggleValue('week')}
              >
                This Week
              </button>
            </div>

            {/* Filter chips with accent color */}
            <div className="flex flex-wrap gap-2">
              {['All', 'Active', 'Completed', 'Pending'].map((filter) => (
                <button
                  key={filter}
                  className={`vision-glass-chip px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    selectedFilter === filter.toLowerCase()
                      ? 'bg-accent/20 text-accent border-accent/40'
                      : ''
                  }`}
                  onClick={() => setSelectedFilter(filter.toLowerCase())}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Section: Date Navigator */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Date Selector</h2>
          <div className="vision-glass-card p-4 rounded-2xl">
            <div className="vision-glass-date-nav p-1 rounded-full inline-flex items-center gap-1">
              <button 
                className="vision-glass-button p-2 rounded-full"
                onClick={() => setSelectedDate(subDays(selectedDate, 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="px-4 py-1.5 min-w-[140px] text-center">
                <span className="text-sm font-medium">{format(selectedDate, 'EEE, MMM d')}</span>
              </div>
              <button 
                className="vision-glass-button p-2 rounded-full"
                onClick={() => setSelectedDate(addDays(selectedDate, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </section>

        {/* Section: Action Chips */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Action Chips</h2>
          <div className="vision-glass-card p-4 rounded-2xl">
            <div className="flex flex-wrap gap-2">
              <button className="vision-glass-chip px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5 bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30">
                <Check className="h-3.5 w-3.5" />
                Approve
              </button>
              <button className="vision-glass-chip px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5 bg-destructive/15 text-destructive border-destructive/30">
                <X className="h-3.5 w-3.5" />
                Reject
              </button>
              <button className="vision-glass-chip px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5 bg-accent/15 text-accent border-accent/30">
                <Star className="h-3.5 w-3.5" />
                Favorite
              </button>
              <button className="vision-glass-chip px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5 bg-pink-500/15 text-pink-600 dark:text-pink-400 border-pink-500/30">
                <Heart className="h-3.5 w-3.5" />
                Like
              </button>
              <button className="vision-glass-chip px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5 bg-primary/15 text-primary border-primary/30">
                <Bookmark className="h-3.5 w-3.5" />
                Save
              </button>
            </div>
          </div>
        </section>

        {/* Page Preview Sections */}
        {previewPage === 'dashboard' && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Dashboard Preview</h2>
            <div className="space-y-3">
              {/* Sales Summary Card */}
              <div className="vision-glass-card p-4 rounded-2xl">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    Today's Sales
                  </h3>
                  <span className="vision-glass-badge-success px-2 py-0.5 rounded-full text-xs font-medium">
                    +12.5%
                  </span>
                </div>
                <div className="text-3xl font-bold text-foreground mb-1">$4,285</div>
                <div className="text-sm text-muted-foreground">vs $3,809 by 9pm last Sat</div>
                
                {/* Progress bar */}
                <div className="mt-4 space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Daily Goal</span>
                    <span className="font-medium text-primary">78%</span>
                  </div>
                  <div className="h-2 bg-muted/50 rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: '78%' }} />
                  </div>
                </div>
              </div>

              {/* Quick Stats */}
              <div className="grid grid-cols-2 gap-3">
                <div className="vision-glass-card p-3 rounded-xl">
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="h-4 w-4 text-accent" />
                    <span className="text-xs text-muted-foreground">On Clock</span>
                  </div>
                  <div className="text-2xl font-bold">6</div>
                </div>
                <div className="vision-glass-card p-3 rounded-xl">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="h-4 w-4 text-primary" />
                    <span className="text-xs text-muted-foreground">Labor %</span>
                  </div>
                  <div className="text-2xl font-bold">24.2%</div>
                </div>
              </div>
            </div>
          </section>
        )}

        {previewPage === 'tasks' && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Tasks Preview</h2>
            <div className="vision-glass-card p-4 rounded-2xl">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Today's Tasks</h3>
                <span className="vision-glass-badge-accent px-2 py-0.5 rounded-full text-xs">4 pending</span>
              </div>
              <div className="space-y-2">
                {[
                  { task: 'Opening Checklist', done: true, time: '6:00 AM' },
                  { task: 'Check inventory levels', done: true, time: '10:00 AM' },
                  { task: 'Team huddle', done: false, time: '2:00 PM' },
                  { task: 'Closing Checklist', done: false, time: '10:00 PM' }
                ].map((item, i) => (
                  <div key={i} className="vision-glass-item p-3 rounded-xl flex items-center gap-3">
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      item.done ? 'border-primary bg-primary/20' : 'border-muted-foreground/50'
                    }`}>
                      {item.done && <Check className="h-3 w-3 text-primary" />}
                    </div>
                    <div className="flex-1">
                      <span className={`text-sm ${item.done ? 'line-through text-muted-foreground' : ''}`}>
                        {item.task}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">{item.time}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {previewPage === 'schedule' && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Schedule Preview</h2>
            <div className="vision-glass-card p-4 rounded-2xl">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Today's Shifts</h3>
                <span className="text-xs text-muted-foreground">{format(new Date(), 'EEEE, MMM d')}</span>
              </div>
              <div className="space-y-2">
                {[
                  { name: 'Alex M.', role: 'Manager', time: '6:00a - 2:00p', status: 'clocked-in' },
                  { name: 'Jordan K.', role: 'Team Member', time: '10:00a - 6:00p', status: 'on-break' },
                  { name: 'Sam L.', role: 'Team Member', time: '2:00p - 10:00p', status: 'upcoming' },
                  { name: 'Taylor R.', role: 'Closer', time: '4:00p - 12:00a', status: 'upcoming' }
                ].map((shift, i) => (
                  <div key={i} className="vision-glass-item p-3 rounded-xl flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-semibold text-sm">
                      {shift.name.split(' ').map(n => n[0]).join('')}
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium">{shift.name}</div>
                      <div className="text-xs text-muted-foreground">{shift.role} • {shift.time}</div>
                    </div>
                    {shift.status === 'clocked-in' && (
                      <span className="vision-glass-badge-success px-2 py-0.5 rounded-full text-[10px]">In</span>
                    )}
                    {shift.status === 'on-break' && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30 flex items-center gap-1">
                        <Coffee className="h-3 w-3" /> Break
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Floating Toolbar (like visionOS) */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Floating Toolbar</h2>
          <div className="flex justify-center">
            <div className="vision-glass-toolbar px-2 py-2 rounded-2xl inline-flex items-center gap-1">
              <button className="p-2.5 rounded-xl hover:bg-primary/20 transition-colors">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <button className="p-2.5 rounded-xl hover:bg-primary/20 transition-colors">
                <ArrowLeft className="h-5 w-5 rotate-180" />
              </button>
              <div className="w-px h-6 bg-border/50 mx-1" />
              <button className="p-2.5 rounded-xl hover:bg-primary/20 transition-colors text-sm font-medium px-3">
                Aa
              </button>
              <button className="p-2.5 rounded-xl hover:bg-primary/20 transition-colors">
                <Filter className="h-5 w-5" />
              </button>
              <button className="p-2.5 rounded-xl bg-accent/20 text-accent rounded-xl">
                <MoreHorizontal className="h-5 w-5" />
              </button>
              <button className="p-2.5 rounded-xl hover:bg-primary/20 transition-colors">
                <Search className="h-5 w-5" />
              </button>
            </div>
          </div>
        </section>

        {/* Dock Label */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Navigation Dock</h2>
        </section>
      </div>

      {/* Fixed visionOS Dock at bottom - matching current dock but frosted */}
      <div className="fixed bottom-0 left-0 right-0 flex justify-center pointer-events-none">
        <div className="vision-glass-dock-current overflow-hidden pointer-events-auto">
          {/* Swipe handle */}
          <div className="flex justify-center pt-2 pb-1">
            <div className="w-10 h-1 bg-accent-foreground/20 rounded-full" />
          </div>
          <div className="flex items-center justify-evenly px-2 pt-1 pb-0">
            {mockNavItems.map((item, idx) => {
              const Icon = item.icon;
              const isActive = idx === activeTab;
              
              return (
                <button
                  key={item.label}
                  onClick={() => setActiveTab(idx)}
                  className={`flex-1 flex flex-col items-center gap-0.5 py-1 rounded-xl transition-colors ${
                    isActive 
                      ? 'bg-white/20 text-accent-foreground' 
                      : 'text-accent-foreground/70 hover:text-accent-foreground'
                  }`}
                >
                  <Icon className="h-8 w-8" strokeWidth={1.75} />
                  <span className={`text-[10px] ${isActive ? 'font-semibold' : 'font-medium'}`}>
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>
          {/* Safe area spacer */}
          <div style={{ height: 'max(8px, calc(env(safe-area-inset-bottom, 0px) * 0.5))' }} />
        </div>
      </div>
    </div>
  );
}
