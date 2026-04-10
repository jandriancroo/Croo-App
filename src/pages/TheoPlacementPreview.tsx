import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, LayoutDashboard, MessageSquare, CheckSquare, Calendar, Sparkles, FileText, ChevronLeft } from 'lucide-react';
import theoAvatar from '@/assets/theo-avatar.png';

/* ─── Shared mock content ─── */
const DashContent = () => (
  <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5" style={{ background: 'hsl(40 33% 94%)' }}>
    <div className="bg-white rounded-xl p-3.5 shadow-sm border border-black/5">
      <p className="text-[10px] text-zinc-500 font-medium mb-0.5">Today's Sales</p>
      <p className="text-xl font-bold text-zinc-900">$4,218</p>
      <div className="mt-1.5 h-1.5 rounded-full overflow-hidden" style={{ background: 'hsl(40 33% 88%)' }}>
        <div className="h-full rounded-full" style={{ width: '68%', background: 'hsl(22 84% 58%)' }} />
      </div>
      <p className="text-[9px] text-zinc-400 mt-0.5">68% of $6,200 goal</p>
    </div>
    <div className="bg-white rounded-xl p-3.5 shadow-sm border border-black/5">
      <p className="text-[10px] text-zinc-500 font-medium mb-0.5">Labor</p>
      <p className="text-xl font-bold text-zinc-900">22.1%</p>
      <p className="text-[9px] text-green-600 font-medium">↓ 1.3% vs target</p>
    </div>
    <div className="bg-white rounded-xl p-3.5 shadow-sm border border-black/5">
      <p className="text-[10px] text-zinc-500 font-medium mb-0.5">On the Clock</p>
      <div className="flex gap-0.5 mt-1">
        {[1,2,3,4,5].map(i => (
          <div key={i} className="h-6 w-6 rounded-full bg-zinc-200 border-2 border-white -ml-0.5 first:ml-0" />
        ))}
        <div className="h-6 w-6 rounded-full bg-zinc-300 border-2 border-white -ml-0.5 flex items-center justify-center text-[8px] font-bold text-zinc-600">+3</div>
      </div>
    </div>
    <div className="bg-white rounded-xl p-3.5 shadow-sm border border-black/5">
      <p className="text-[10px] text-zinc-500 font-medium mb-0.5">Upcoming Tasks</p>
      <div className="space-y-1.5 mt-1">
        {['Line check', 'Temp log', 'Cash count'].map(t => (
          <div key={t} className="flex items-center gap-1.5">
            <div className="h-3.5 w-3.5 rounded border border-zinc-300" />
            <span className="text-xs text-zinc-700">{t}</span>
          </div>
        ))}
      </div>
    </div>
  </div>
);

const StatusBar = () => (
  <div className="h-11 bg-white flex items-center justify-between px-5 text-zinc-800 text-[10px] font-semibold">
    <span>9:41</span>
    <div className="w-20 h-5 bg-zinc-900 rounded-full mx-auto" />
    <span>100%</span>
  </div>
);

const AppHeader = () => (
  <div className="bg-white px-3 py-2.5 flex items-center justify-between border-b border-zinc-200/80">
    <div className="flex items-center gap-2">
      <div className="h-7 w-7 rounded-full flex items-center justify-center text-white font-bold text-[10px]" style={{ background: 'hsl(22 84% 58%)' }}>B</div>
      <div>
        <p className="text-xs font-semibold text-zinc-900">Blaze Pizza</p>
        <p className="text-[9px] text-zinc-500">Store #112</p>
      </div>
    </div>
    <div className="h-7 w-7 rounded-full bg-zinc-200" />
  </div>
);

const TheoChatOverlay = ({ onClose }: { onClose: () => void }) => (
  <div className="absolute inset-0 bg-black/40 z-30 flex flex-col justify-end" onClick={onClose}>
    <div className="bg-white rounded-t-2xl h-[65%] flex flex-col animate-in slide-in-from-bottom duration-300" onClick={e => e.stopPropagation()}>
      <div className="flex items-center gap-2.5 p-3 border-b border-zinc-100">
        <img src={theoAvatar} className="h-7 w-7 rounded-full" alt="Theo" />
        <div>
          <p className="text-xs font-semibold text-zinc-900">Theo AI</p>
          <p className="text-[9px] text-green-600">Online</p>
        </div>
        <button onClick={onClose} className="ml-auto text-zinc-400 text-sm">✕</button>
      </div>
      <div className="flex-1 p-3 space-y-2 overflow-y-auto">
        <div className="rounded-xl rounded-tl-sm p-2.5 max-w-[80%]" style={{ background: 'hsl(189 45% 95%)' }}>
          <p className="text-[11px]" style={{ color: 'hsl(189 45% 20%)' }}>Hey! 👋 Sales are up 12% vs last Thursday. Need anything?</p>
        </div>
        <div className="flex flex-wrap gap-1 mt-1.5">
          {['📊 Sales update', '⏰ Late clock-ins', '📋 Schedule'].map(s => (
            <span key={s} className="text-[9px] bg-zinc-100 text-zinc-700 px-2 py-1 rounded-full">{s}</span>
          ))}
        </div>
      </div>
      <div className="p-2.5 border-t border-zinc-100">
        <div className="flex items-center gap-2 bg-zinc-100 rounded-full px-3 py-2">
          <span className="text-[11px] text-zinc-400 flex-1">Ask Theo anything...</span>
          <Sparkles className="h-3.5 w-3.5" style={{ color: 'hsl(189 45% 42%)' }} />
        </div>
      </div>
    </div>
  </div>
);

const ChatMessages = [
  { name: 'Store #112 Team', msg: 'Who can cover tomorrow AM?', time: '2m', unread: 2 },
  { name: 'Area Manager', msg: 'Great numbers today 🔥', time: '15m', unread: 1 },
  { name: 'Sarah K.', msg: 'Shift swap confirmed', time: '1h', unread: 0 },
  { name: 'Announcements', msg: 'New menu items dropping Mon', time: '3h', unread: 0 },
];

/* ─── Option A: Chat = pull-tab, Theo in dock ─── */
function OptionA() {
  const [showChat, setShowChat] = useState(false);
  const [showChatTab, setShowChatTab] = useState(false);
  const [activeTab, setActiveTab] = useState('Dash');

  return (
    <div className="relative w-[170px] h-[340px] rounded-[1.4rem] shadow-xl shadow-black/40 border-[4px] border-zinc-800 overflow-hidden flex flex-col" style={{ background: 'hsl(40 33% 94%)', fontSize: '50%' }}>
      <StatusBar />
      <AppHeader />
      
      <div className="flex-1 relative overflow-hidden">
        <DashContent />

        {/* Chat pull-tab on right edge */}
        {!showChatTab && (
          <button
            onClick={() => setShowChatTab(true)}
            className="absolute right-0 top-1/3 z-10 text-white rounded-l-lg px-1 py-2 shadow-md flex flex-col items-center gap-0.5"
            style={{ background: 'hsl(22 84% 58%)' }}
          >
            <MessageSquare className="h-2.5 w-2.5" />
            <div className="h-2.5 w-2.5 rounded-full bg-red-500 flex items-center justify-center">
              <span className="text-[4px] font-bold text-white">3</span>
            </div>
          </button>
        )}

        {/* Chat slide-over */}
        <div className={`absolute inset-y-0 right-0 w-[85%] bg-white z-20 shadow-xl flex flex-col transition-transform duration-200 ${showChatTab ? 'translate-x-0' : 'translate-x-full'}`} style={{ borderTopLeftRadius: 8 }}>
          <div className="flex items-center gap-1 p-1.5 border-b border-zinc-100">
            <button onClick={() => setShowChatTab(false)} className="p-0.5">
              <ChevronLeft className="h-3 w-3 text-zinc-600" />
            </button>
            <MessageSquare className="h-2.5 w-2.5" style={{ color: 'hsl(22 84% 58%)' }} />
            <p className="text-[7px] font-semibold text-zinc-900 flex-1">Messages</p>
          </div>
          <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
            {ChatMessages.map(chat => (
              <div key={chat.name} className="flex items-center gap-1.5 p-1 rounded-lg">
                <div className="h-4 w-4 rounded-full bg-zinc-200 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className={`text-[5px] ${chat.unread ? 'font-bold' : ''} text-zinc-800 truncate`}>{chat.name}</p>
                  <p className="text-[4px] text-zinc-500 truncate">{chat.msg}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        {showChatTab && <div className="absolute inset-0 bg-black/20 z-10" onClick={() => setShowChatTab(false)} />}
      </div>

      {showChat && <TheoChatOverlay onClose={() => setShowChat(false)} />}

      {/* Dock */}
      <div className="pt-1.5 pb-3 px-1" style={{ background: 'hsl(22 84% 58%)' }}>
        <div className="flex justify-center mb-0.5"><div className="w-5 h-0.5 bg-white/20 rounded-full" /></div>
        <div className="flex items-center justify-evenly">
          {[
            { icon: LayoutDashboard, label: 'Dash', id: 'Dash' },
            { icon: Sparkles, label: 'Theo', id: 'Theo', isTheo: true },
            { icon: CheckSquare, label: 'Tasks', id: 'Tasks' },
            { icon: FileText, label: 'Logs', id: 'Logs' },
            { icon: Calendar, label: 'Schedule', id: 'Sched' },
          ].map(item => (
            <button
              key={item.id}
              onClick={() => item.isTheo ? setShowChat(true) : setActiveTab(item.id)}
              className={`flex-1 flex flex-col items-center gap-0 py-0.5 ${
                item.isTheo ? '' : activeTab === item.id ? 'text-white' : 'text-white/60'
              }`}
            >
              {item.isTheo ? (
                <div className="h-5 w-5 rounded-full flex items-center justify-center shadow-sm" style={{ background: 'linear-gradient(135deg, hsl(189 50% 50%), hsl(189 45% 35%))' }}>
                  <Sparkles className="h-2.5 w-2.5 text-white" />
                </div>
              ) : (
                <item.icon className="h-4 w-4" strokeWidth={1.75} />
              )}
              <span className="text-[5px] font-medium">{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Option B: Chat stays in dock, Theo = popout ─── */
function OptionB() {
  const [showTheo, setShowTheo] = useState(false);
  const [activeTab, setActiveTab] = useState('Dash');

  return (
    <div className="relative w-[170px] h-[340px] rounded-[1.4rem] shadow-xl shadow-black/40 border-[4px] border-zinc-800 overflow-hidden flex flex-col" style={{ background: 'hsl(40 33% 94%)', fontSize: '50%' }}>
      <StatusBar />
      <AppHeader />
      
      <div className="flex-1 relative overflow-hidden">
        <DashContent />

        {/* Theo pull-tab on right edge */}
        <button
          onClick={() => setShowTheo(true)}
          className="absolute right-0 top-1/3 z-10 text-white rounded-l-lg px-1 py-2 shadow-md flex flex-col items-center gap-0.5"
          style={{ background: 'linear-gradient(135deg, hsl(189 50% 50%), hsl(189 45% 35%))' }}
        >
          <Sparkles className="h-2.5 w-2.5" />
        </button>
      </div>

      {showTheo && <TheoChatOverlay onClose={() => setShowTheo(false)} />}

      {/* Dock */}
      <div className="pt-1.5 pb-3 px-1" style={{ background: 'hsl(22 84% 58%)' }}>
        <div className="flex justify-center mb-0.5"><div className="w-5 h-0.5 bg-white/20 rounded-full" /></div>
        <div className="flex items-center justify-evenly">
          {[
            { icon: LayoutDashboard, label: 'Dash', id: 'Dash' },
            { icon: MessageSquare, label: 'Chat', id: 'Chat', hasBadge: true },
            { icon: CheckSquare, label: 'Tasks', id: 'Tasks' },
            { icon: FileText, label: 'Logs', id: 'Logs' },
            { icon: Calendar, label: 'Schedule', id: 'Sched' },
          ].map(item => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`flex-1 flex flex-col items-center gap-0 py-0.5 relative ${
                activeTab === item.id ? 'text-white' : 'text-white/60'
              }`}
            >
              <item.icon className="h-4 w-4" strokeWidth={1.75} />
              <span className="text-[5px] font-medium">{item.label}</span>
              {item.hasBadge && (
                <span className="absolute top-0 right-[20%] h-1.5 w-1.5 bg-red-500 rounded-full" />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Main Preview Page ─── */
export default function TheoPlacementPreview() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-900 to-zinc-950 text-white flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-white/10">
        <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-white/10">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-lg font-bold">Theo Placement — A vs B</h1>
          <p className="text-xs text-white/50">Tap each to interact</p>
        </div>
      </div>

      {/* Two previews side by side */}
      <div className="flex-1 flex items-start justify-center gap-5 p-4 pt-6 overflow-auto">
        {/* Option A */}
        <div className="flex flex-col items-center gap-3">
          <div className="text-center mb-1">
            <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: 'hsl(189 45% 42% / 0.2)', color: 'hsl(189 45% 70%)' }}>Option A</span>
          </div>
          <OptionA />
          <div className="text-center max-w-[170px] space-y-1.5">
            <p className="text-[11px] font-semibold text-white/90">Chat = Side Tab</p>
            <p className="text-[10px] text-white/50 leading-tight">Chat pulls over from right edge. Theo takes a dock slot.</p>
            <div className="flex flex-wrap gap-1 justify-center">
              <span className="text-[8px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded-full">Theo always visible</span>
              <span className="text-[8px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded-full">Chat less prominent</span>
            </div>
          </div>
        </div>

        {/* Option B */}
        <div className="flex flex-col items-center gap-3">
          <div className="text-center mb-1">
            <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: 'hsl(22 84% 58% / 0.2)', color: 'hsl(22 84% 75%)' }}>Option B</span>
          </div>
          <OptionB />
          <div className="text-center max-w-[170px] space-y-1.5">
            <p className="text-[11px] font-semibold text-white/90">Chat = Dock</p>
            <p className="text-[10px] text-white/50 leading-tight">Chat stays in dock as normal. Theo is a floating orb on the screen.</p>
            <div className="flex flex-wrap gap-1 justify-center">
              <span className="text-[8px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded-full">No dock change</span>
              <span className="text-[8px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded-full">Theo can be missed</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
