import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, LayoutDashboard, MessageSquare, CheckSquare, Calendar, Sparkles, ChevronLeft } from 'lucide-react';
import theoAvatar from '@/assets/theo-avatar.png';

export default function TheoPlacementPreview() {
  const navigate = useNavigate();
  const [showChat, setShowChat] = useState(false);
  const [showChatTab, setShowChatTab] = useState(false);
  const [activeTab, setActiveTab] = useState('Dash');

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-900 to-zinc-950 text-white flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-white/10">
        <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-white/10">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-lg font-bold">Chat Tab + Theo Dock — Preview</h1>
          <p className="text-xs text-white/50">Chat pulls over from right · Theo lives in the dock</p>
        </div>
      </div>

      {/* Phone Frame */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="relative w-[375px] h-[720px] bg-zinc-100 rounded-[3rem] shadow-2xl shadow-black/50 border-[8px] border-zinc-800 overflow-hidden flex flex-col">
          {/* Status bar */}
          <div className="h-12 bg-white flex items-center justify-between px-6 text-zinc-800 text-xs font-semibold">
            <span>9:41</span>
            <div className="w-24 h-6 bg-zinc-900 rounded-full mx-auto" />
            <span>100%</span>
          </div>

          {/* App header */}
          <div className="bg-white px-4 py-3 flex items-center justify-between border-b border-zinc-200">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-orange-500 flex items-center justify-center text-white font-bold text-sm">B</div>
              <div>
                <p className="text-sm font-semibold text-zinc-900">Blaze Pizza</p>
                <p className="text-[10px] text-zinc-500">Store #112</p>
              </div>
            </div>
            <div className="h-8 w-8 rounded-full bg-zinc-200" />
          </div>

          {/* Scrollable content area */}
          <div className="flex-1 bg-zinc-50 overflow-y-auto px-4 py-3 space-y-3 relative">
            <div className="bg-white rounded-xl p-4 shadow-sm border border-zinc-100">
              <p className="text-xs text-zinc-500 font-medium mb-1">Today's Sales</p>
              <p className="text-2xl font-bold text-zinc-900">$4,218</p>
              <div className="mt-2 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                <div className="h-full bg-orange-500 rounded-full" style={{ width: '68%' }} />
              </div>
              <p className="text-[10px] text-zinc-400 mt-1">68% of $6,200 goal</p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-zinc-100">
              <p className="text-xs text-zinc-500 font-medium mb-1">Labor</p>
              <p className="text-2xl font-bold text-zinc-900">22.1%</p>
              <p className="text-[10px] text-green-600">↓ 1.3% vs target</p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-zinc-100">
              <p className="text-xs text-zinc-500 font-medium mb-1">On the Clock</p>
              <div className="flex gap-1 mt-1">
                {[1,2,3,4,5].map(i => (
                  <div key={i} className="h-7 w-7 rounded-full bg-zinc-200 border-2 border-white -ml-1 first:ml-0" />
                ))}
                <div className="h-7 w-7 rounded-full bg-zinc-300 border-2 border-white -ml-1 flex items-center justify-center text-[9px] font-bold text-zinc-600">+3</div>
              </div>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-zinc-100">
              <p className="text-xs text-zinc-500 font-medium mb-1">Upcoming Tasks</p>
              <div className="space-y-2 mt-1">
                {['Line check', 'Temp log', 'Cash count'].map(t => (
                  <div key={t} className="flex items-center gap-2">
                    <div className="h-4 w-4 rounded border border-zinc-300" />
                    <span className="text-sm text-zinc-700">{t}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Chat pull-tab on right edge */}
            {!showChatTab && (
              <button
                onClick={() => setShowChatTab(true)}
                className="absolute right-0 top-1/3 z-10 bg-orange-500 text-white rounded-l-xl px-1.5 py-4 shadow-lg flex flex-col items-center gap-1"
              >
                <MessageSquare className="h-4 w-4" />
                <span className="text-[8px] font-bold writing-mode-vertical" style={{ writingMode: 'vertical-rl' }}>CHAT</span>
                <div className="h-4 w-4 rounded-full bg-red-500 flex items-center justify-center mt-1">
                  <span className="text-[8px] font-bold text-white">3</span>
                </div>
              </button>
            )}
          </div>

          {/* Chat Slide-over Panel */}
          <div 
            className={`absolute inset-y-0 right-0 w-[85%] bg-white z-20 shadow-2xl shadow-black/30 flex flex-col transition-transform duration-300 ease-out ${showChatTab ? 'translate-x-0' : 'translate-x-full'}`}
            style={{ top: 48, borderTopLeftRadius: 16, borderBottomLeftRadius: 0 }}
          >
            <div className="flex items-center gap-2 p-3 border-b border-zinc-100">
              <button onClick={() => setShowChatTab(false)} className="p-1 rounded-lg hover:bg-zinc-100">
                <ChevronLeft className="h-5 w-5 text-zinc-600" />
              </button>
              <MessageSquare className="h-4 w-4 text-orange-500" />
              <p className="text-sm font-semibold text-zinc-900 flex-1">Messages</p>
              <div className="h-5 w-5 rounded-full bg-red-500 flex items-center justify-center">
                <span className="text-[9px] font-bold text-white">3</span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {[
                { name: 'Store #112 Team', msg: 'Who can cover tomorrow AM?', time: '2m', unread: 2 },
                { name: 'Area Manager', msg: 'Great numbers today 🔥', time: '15m', unread: 1 },
                { name: 'Sarah K.', msg: 'Shift swap confirmed', time: '1h', unread: 0 },
                { name: 'Announcements', msg: 'New menu items dropping Monday', time: '3h', unread: 0 },
              ].map(chat => (
                <div key={chat.name} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-zinc-50 cursor-pointer">
                  <div className="h-9 w-9 rounded-full bg-zinc-200 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className={`text-xs ${chat.unread ? 'font-bold text-zinc-900' : 'font-medium text-zinc-700'} truncate`}>{chat.name}</p>
                      <span className="text-[9px] text-zinc-400 flex-shrink-0">{chat.time}</span>
                    </div>
                    <p className={`text-[11px] ${chat.unread ? 'text-zinc-700 font-medium' : 'text-zinc-500'} truncate`}>{chat.msg}</p>
                  </div>
                  {chat.unread > 0 && (
                    <div className="h-4 w-4 rounded-full bg-orange-500 flex items-center justify-center flex-shrink-0">
                      <span className="text-[8px] font-bold text-white">{chat.unread}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Backdrop when chat is open */}
          {showChatTab && (
            <div 
              className="absolute inset-0 bg-black/20 z-10 transition-opacity"
              style={{ top: 48 }}
              onClick={() => setShowChatTab(false)} 
            />
          )}

          {/* Theo Chat Overlay */}
          {showChat && (
            <div className="absolute inset-0 bg-black/40 z-30 flex flex-col justify-end" onClick={() => setShowChat(false)}>
              <div 
                className="bg-white rounded-t-2xl h-[70%] flex flex-col animate-in slide-in-from-bottom duration-300"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center gap-3 p-4 border-b border-zinc-100">
                  <img src={theoAvatar} className="h-8 w-8 rounded-full" alt="Theo" />
                  <div>
                    <p className="text-sm font-semibold text-zinc-900">Theo AI</p>
                    <p className="text-[10px] text-green-600">Online</p>
                  </div>
                  <button onClick={() => setShowChat(false)} className="ml-auto text-zinc-400 text-lg">✕</button>
                </div>
                <div className="flex-1 p-4 space-y-3 overflow-y-auto">
                  <div className="bg-teal-50 rounded-xl rounded-tl-sm p-3 max-w-[80%]">
                    <p className="text-sm text-teal-900">Hey! 👋 Sales are up 12% vs last Thursday. Need anything?</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {['📊 Sales update', '⏰ Late clock-ins', '📋 Schedule'].map(s => (
                      <span key={s} className="text-[11px] bg-zinc-100 text-zinc-700 px-2.5 py-1.5 rounded-full">{s}</span>
                    ))}
                  </div>
                </div>
                <div className="p-3 border-t border-zinc-100">
                  <div className="flex items-center gap-2 bg-zinc-100 rounded-full px-4 py-2.5">
                    <span className="text-sm text-zinc-400 flex-1">Ask Theo anything...</span>
                    <Sparkles className="h-4 w-4 text-teal-600" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ===== THE DOCK ===== */}
          <div className="bg-orange-500 pt-3 pb-6 px-2">
            {/* Swipe handle */}
            <div className="flex justify-center mb-2">
              <div className="w-10 h-1 bg-white/20 rounded-full" />
            </div>
            <div className="flex items-center justify-evenly">
              <button 
                onClick={() => setActiveTab('Dash')}
                className={`flex-1 flex flex-col items-center gap-0.5 py-1 ${activeTab === 'Dash' ? 'text-white' : 'text-white/60'}`}
              >
                <LayoutDashboard className="h-7 w-7" strokeWidth={1.75} />
                <span className="text-[10px] font-medium">Dash</span>
              </button>

              {/* Theo takes Chat's old spot */}
              <button 
                onClick={() => setShowChat(true)}
                className={`flex-1 flex flex-col items-center gap-0.5 py-1 text-white/90`}
              >
                <div className="h-8 w-8 rounded-full bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center shadow-md shadow-teal-500/30">
                  <Sparkles className="h-4.5 w-4.5 text-white" />
                </div>
                <span className="text-[10px] font-medium">Theo</span>
              </button>

              <button 
                onClick={() => setActiveTab('Tasks')}
                className={`flex-1 flex flex-col items-center gap-0.5 py-1 ${activeTab === 'Tasks' ? 'text-white' : 'text-white/60'}`}
              >
                <CheckSquare className="h-7 w-7" strokeWidth={1.75} />
                <span className="text-[10px] font-medium">Tasks</span>
              </button>
              <button 
                onClick={() => setActiveTab('Schedule')}
                className={`flex-1 flex flex-col items-center gap-0.5 py-1 ${activeTab === 'Schedule' ? 'text-white' : 'text-white/60'}`}
              >
                <Calendar className="h-7 w-7" strokeWidth={1.75} />
                <span className="text-[10px] font-medium">Schedule</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Info panel */}
      <div className="p-6 max-w-lg mx-auto text-center space-y-3 pb-10">
        <h2 className="text-lg font-semibold">Chat Tab + Theo in Dock</h2>
        <p className="text-sm text-white/60">
          Chat becomes a pull-over tab on the right edge — always accessible with a swipe or tap, 
          with an unread badge. Theo takes Chat's old dock slot as a standard icon.
        </p>
        <div className="flex gap-3 justify-center text-xs flex-wrap">
          <div className="bg-green-500/20 text-green-400 px-3 py-1.5 rounded-full">✓ Chat still 1-tap away</div>
          <div className="bg-green-500/20 text-green-400 px-3 py-1.5 rounded-full">✓ Theo in dock naturally</div>
          <div className="bg-green-500/20 text-green-400 px-3 py-1.5 rounded-full">✓ Unread badge visible</div>
          <div className="bg-yellow-500/20 text-yellow-400 px-3 py-1.5 rounded-full">⚡ Frees a dock slot</div>
        </div>
      </div>
    </div>
  );
}