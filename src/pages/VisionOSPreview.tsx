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
  Bookmark
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
  const [toggleValue, setToggleValue] = useState('left');

  return (
    <div 
      className="min-h-screen p-4 pb-32"
      style={{
        background: 'linear-gradient(135deg, hsl(var(--background)) 0%, hsl(var(--muted)) 50%, hsl(var(--background)) 100%)'
      }}
    >
      <div className="max-w-lg mx-auto space-y-8">
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
          Exploring frosted glass UI inspired by Apple visionOS. Same colors, new depth.
        </p>

        {/* Section: Primary Buttons */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Buttons</h2>
          <div className="vision-glass-card p-4 rounded-2xl space-y-4">
            <div className="flex flex-wrap gap-3">
              <button className="vision-glass-button px-4 py-2 rounded-full text-sm font-medium">
                Default
              </button>
              <button className="vision-glass-button-primary px-4 py-2 rounded-full text-sm font-medium">
                Primary
              </button>
              <button className="vision-glass-button px-4 py-2 rounded-full text-sm font-medium flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Add New
              </button>
            </div>
            <div className="flex flex-wrap gap-3">
              <button className="vision-glass-button p-2.5 rounded-full">
                <Settings className="h-5 w-5" />
              </button>
              <button className="vision-glass-button p-2.5 rounded-full">
                <Bell className="h-5 w-5" />
              </button>
              <button className="vision-glass-button p-2.5 rounded-full">
                <Search className="h-5 w-5" />
              </button>
              <button className="vision-glass-button p-2.5 rounded-full">
                <Filter className="h-5 w-5" />
              </button>
              <button className="vision-glass-button p-2.5 rounded-full">
                <MoreHorizontal className="h-5 w-5" />
              </button>
            </div>
          </div>
        </section>

        {/* Section: Toggle / Segmented Control */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Segmented Controls</h2>
          <div className="vision-glass-card p-4 rounded-2xl space-y-4">
            {/* Pill toggle */}
            <div className="vision-glass-segmented p-1 rounded-full inline-flex">
              <button 
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                  toggleValue === 'left' 
                    ? 'bg-white/90 dark:bg-white/20 shadow-sm' 
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setToggleValue('left')}
              >
                Today
              </button>
              <button 
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                  toggleValue === 'right' 
                    ? 'bg-white/90 dark:bg-white/20 shadow-sm' 
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setToggleValue('right')}
              >
                This Week
              </button>
            </div>

            {/* Filter chips */}
            <div className="flex flex-wrap gap-2">
              {['All', 'Active', 'Completed', 'Pending'].map((filter) => (
                <button
                  key={filter}
                  className={`vision-glass-chip px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    selectedFilter === filter.toLowerCase()
                      ? 'bg-white/90 dark:bg-white/25 shadow-sm'
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
              <button className="vision-glass-chip px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-green-500" />
                Approve
              </button>
              <button className="vision-glass-chip px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5">
                <X className="h-3.5 w-3.5 text-red-500" />
                Reject
              </button>
              <button className="vision-glass-chip px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5">
                <Star className="h-3.5 w-3.5 text-amber-500" />
                Favorite
              </button>
              <button className="vision-glass-chip px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5">
                <Heart className="h-3.5 w-3.5 text-pink-500" />
                Like
              </button>
              <button className="vision-glass-chip px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5">
                <Bookmark className="h-3.5 w-3.5 text-blue-500" />
                Save
              </button>
            </div>
          </div>
        </section>

        {/* Section: Sample Cards */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Content Cards</h2>
          <div className="space-y-3">
            <div className="vision-glass-card p-4 rounded-2xl">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Today's Tasks</h3>
                <span className="vision-glass-badge px-2 py-0.5 rounded-full text-xs">4 pending</span>
              </div>
              <div className="space-y-2">
                {['Open store', 'Check inventory', 'Staff meeting', 'Close registers'].map((task, i) => (
                  <div key={i} className="vision-glass-item p-3 rounded-xl flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full border-2 border-primary/50 flex items-center justify-center">
                      {i < 2 && <Check className="h-3 w-3 text-primary" />}
                    </div>
                    <span className={`text-sm ${i < 2 ? 'line-through text-muted-foreground' : ''}`}>{task}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="vision-glass-card p-4 rounded-2xl">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Sales Summary</h3>
                <span className="text-green-500 text-sm font-medium">+12.5%</span>
              </div>
              <div className="text-3xl font-bold mb-1">$4,285</div>
              <div className="text-sm text-muted-foreground">vs $3,809 last week</div>
            </div>
          </div>
        </section>

        {/* Floating Toolbar (like visionOS) */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Floating Toolbar</h2>
          <div className="flex justify-center">
            <div className="vision-glass-toolbar px-2 py-2 rounded-2xl inline-flex items-center gap-1">
              <button className="p-2.5 rounded-xl hover:bg-white/20 transition-colors">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <button className="p-2.5 rounded-xl hover:bg-white/20 transition-colors">
                <ArrowLeft className="h-5 w-5 rotate-180" />
              </button>
              <div className="w-px h-6 bg-white/20 mx-1" />
              <button className="p-2.5 rounded-xl hover:bg-white/20 transition-colors text-sm font-medium px-3">
                Aa
              </button>
              <button className="p-2.5 rounded-xl hover:bg-white/20 transition-colors">
                <Filter className="h-5 w-5" />
              </button>
              <button className="p-2.5 rounded-xl hover:bg-white/20 transition-colors">
                <MoreHorizontal className="h-5 w-5" />
              </button>
              <button className="p-2.5 rounded-xl hover:bg-white/20 transition-colors">
                <Search className="h-5 w-5" />
              </button>
            </div>
          </div>
        </section>

        {/* visionOS Style Dock */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Navigation Dock</h2>
        </section>
      </div>

      {/* Fixed visionOS Dock at bottom */}
      <div className="fixed bottom-0 left-0 right-0 p-4 flex justify-center">
        <div className="vision-glass-dock px-3 py-3 rounded-[28px] inline-flex items-center gap-1">
          {mockNavItems.map((item, idx) => {
            const Icon = item.icon;
            const isActive = idx === activeTab;
            
            return (
              <button
                key={item.label}
                onClick={() => setActiveTab(idx)}
                className={`flex flex-col items-center gap-1 px-4 py-2 rounded-2xl transition-all ${
                  isActive 
                    ? 'bg-white/30 dark:bg-white/15' 
                    : 'hover:bg-white/15'
                }`}
              >
                <Icon 
                  className="h-6 w-6" 
                  strokeWidth={isActive ? 2 : 1.5} 
                />
                <span className={`text-[10px] ${isActive ? 'font-semibold' : 'font-medium text-foreground/70'}`}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
