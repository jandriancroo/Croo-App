import { useState } from "react";
import { Layout } from "@/components/Layout";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  MessageCircle, Megaphone, ArrowLeftRight, Briefcase, Headphones,
  Plus, Pin, Users, Search, ChevronRight, AlertCircle, Star
} from "lucide-react";

// Mock data
const mockChats = [
  { id: "1", name: "Manager Chat 🔑", type: "group", pinned: true, unread: 2, preview: "If you need him to print labels or fi...", time: "Feb 12", avatar: "MC" },
  { id: "2", name: "Hemet Chat", type: "group", pinned: true, unread: 0, preview: "Keep up the good work guys!!! W...", time: "Feb 11", avatar: "HC" },
  { id: "3", name: "Training Group", type: "group", pinned: false, unread: 0, preview: "Yes", time: "Jan 31", avatar: "TG" },
  { id: "4", name: "Diego Martinez", type: "dm", pinned: false, unread: 0, preview: "Thanks!", time: "Feb 8", avatar: "DM" },
  { id: "5", name: "Andrea Gonzalez", type: "dm", pinned: false, unread: 1, preview: "okay just testing", time: "Jan 21", avatar: "AG" },
  { id: "6", name: "Shift Marketplace", type: "marketplace", pinned: false, unread: 0, preview: "New shift available", time: "Feb 10", avatar: "SM" },
];

const mockAnnouncements = [
  { id: "a1", name: "Team Updates", unread: 1, preview: "New policy effective March 1st", time: "Feb 13", avatar: "TU" },
  { id: "a2", name: "Safety Bulletin", unread: 0, preview: "Monthly safety reminder", time: "Feb 5", avatar: "SB" },
];

const mockSupport = [
  { id: "s1", name: "Ticket #1042 - Login issue", status: "open", preview: "User can't reset password", time: "2h ago" },
  { id: "s2", name: "Ticket #1039 - Schedule bug", status: "open", preview: "Shifts not showing for Wed", time: "5h ago" },
  { id: "s3", name: "Ticket #1035 - Feature req", status: "closed", preview: "Add dark mode to reports", time: "2d ago" },
];

const mockHiring = [
  { id: "h1", name: "Sarah Chen", position: "Line Cook", preview: "Thanks for the opportunity!", time: "1h ago" },
  { id: "h2", name: "Mike Johnson", position: "Cashier", preview: "When can I start?", time: "3h ago" },
];

// ─── Option 1: Priority Inbox ───
function Option1() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-3 pb-2">
        <h2 className="text-lg font-bold">Chat</h2>
        <div className="flex gap-1.5">
          <Button size="icon" variant="outline" className="h-8 w-8"><Megaphone className="h-4 w-4" /></Button>
          <Button size="icon" className="h-8 w-8"><Plus className="h-4 w-4" /></Button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search all chats..." className="pl-9 h-9" />
        </div>
      </div>

      <ScrollArea className="flex-1">
        {/* Priority Section - Support */}
        <div className="px-3 py-1.5">
          <div className="flex items-center gap-2 mb-2">
            <Headphones className="h-3.5 w-3.5 text-destructive" />
            <span className="text-xs font-semibold uppercase tracking-wider text-destructive">Support Tickets</span>
            <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">2</Badge>
          </div>
          {mockSupport.filter(s => s.status === "open").map(ticket => (
            <div key={ticket.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-destructive/5 border border-destructive/20 mb-1.5 cursor-pointer hover:bg-destructive/10 transition-colors">
              <div className="h-9 w-9 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                <AlertCircle className="h-4 w-4 text-destructive" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-semibold truncate">{ticket.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0 ml-2">{ticket.time}</span>
                </div>
                <p className="text-xs text-muted-foreground truncate">{ticket.preview}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Pinned */}
        <div className="px-3 py-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pinned</span>
          {mockChats.filter(c => c.pinned).map(chat => (
            <ChatRow key={chat.id} chat={chat} />
          ))}
        </div>

        <div className="mx-3 border-t border-border" />

        {/* Recent */}
        <div className="px-3 py-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent</span>
          {mockChats.filter(c => !c.pinned).map(chat => (
            <ChatRow key={chat.id} chat={chat} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Option 2: Smart Filter Chips ───
function Option2() {
  const [filter, setFilter] = useState("all");
  const filters = [
    { id: "all", label: "All", icon: MessageCircle },
    { id: "support", label: "Support", icon: Headphones, badge: 2 },
    { id: "dms", label: "DMs", icon: MessageCircle },
    { id: "groups", label: "Groups", icon: Users },
    { id: "announcements", label: "Announce", icon: Megaphone },
    { id: "hiring", label: "Hiring", icon: Briefcase },
  ];

  const getFilteredChats = () => {
    switch (filter) {
      case "support": return [];
      case "announcements": return [];
      case "groups": {
        const marketplace = mockChats.filter(c => c.type === "marketplace");
        const groups = mockChats.filter(c => c.type === "group");
        return [...marketplace, ...groups];
      }
      case "dms": return mockChats.filter(c => c.type === "dm");
      case "hiring": return [];
      default: return mockChats;
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-3 pb-2">
        <h2 className="text-lg font-bold">Chat</h2>
        <div className="flex gap-1.5">
          <Button size="icon" variant="outline" className="h-8 w-8"><Megaphone className="h-4 w-4" /></Button>
          <Button size="icon" className="h-8 w-8"><Plus className="h-4 w-4" /></Button>
        </div>
      </div>

      {/* Horizontal scroll chip bar */}
      <div className="px-3 pb-2 overflow-x-auto scrollbar-hide">
        <div className="flex gap-1.5 min-w-max">
          {filters.map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
                filter === f.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              <f.icon className="h-3.5 w-3.5" />
              {f.label}
              {f.badge && (
                <span className="ml-0.5 bg-destructive text-destructive-foreground rounded-full px-1.5 text-[10px] font-bold">{f.badge}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search..." className="pl-9 h-9" />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-3">
          {filter === "support" ? (
            mockSupport.map(ticket => (
              <div key={ticket.id} className="flex items-center gap-3 p-2.5 rounded-lg mb-1 cursor-pointer hover:bg-muted transition-colors">
                <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${ticket.status === "open" ? "bg-destructive/10" : "bg-muted"}`}>
                  <Headphones className={`h-4 w-4 ${ticket.status === "open" ? "text-destructive" : "text-muted-foreground"}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium truncate">{ticket.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0 ml-2">{ticket.time}</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{ticket.preview}</p>
                </div>
              </div>
            ))
          ) : filter === "announcements" ? (
            mockAnnouncements.map(a => (
              <ChatRow key={a.id} chat={{ ...a, type: "announcement", pinned: false }} />
            ))
          ) : filter === "hiring" ? (
            mockHiring.map(h => (
              <div key={h.id} className="flex items-center gap-3 p-2.5 rounded-lg mb-1 cursor-pointer hover:bg-muted transition-colors">
                <Avatar className="h-10 w-10">
                  <AvatarFallback className="text-xs">{h.name.split(" ").map(n => n[0]).join("")}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium truncate">{h.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0 ml-2">{h.time}</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{h.position} — {h.preview}</p>
                </div>
              </div>
            ))
          ) : (
            getFilteredChats().map(chat => (
              <ChatRow key={chat.id} chat={chat} />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Option 3: Unified List with Section Headers ───
function Option3() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-3 pb-2">
        <h2 className="text-lg font-bold">Chat</h2>
        <div className="flex gap-1.5">
          <Button size="icon" variant="outline" className="h-8 w-8"><Megaphone className="h-4 w-4" /></Button>
          <Button size="icon" className="h-8 w-8"><Plus className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search all chats..." className="pl-9 h-9" />
        </div>
      </div>

      <ScrollArea className="flex-1">
        {/* Support - always on top */}
        <SectionHeader icon={Headphones} label="Support" badge={2} color="destructive" />
        {mockSupport.filter(s => s.status === "open").map(t => (
          <div key={t.id} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
              <AlertCircle className="h-4 w-4 text-destructive" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold truncate">{t.name}</span>
                <span className="text-xs text-muted-foreground shrink-0 ml-2">{t.time}</span>
              </div>
              <p className="text-xs text-muted-foreground truncate">{t.preview}</p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          </div>
        ))}

        {/* Pinned */}
        <SectionHeader icon={Pin} label="Pinned" />
        {mockChats.filter(c => c.pinned).map(chat => (
          <ChatRow key={chat.id} chat={chat} variant="full-width" />
        ))}

        {/* Announcements inline */}
        <SectionHeader icon={Megaphone} label="Announcements" badge={1} />
        {mockAnnouncements.map(a => (
          <ChatRow key={a.id} chat={{ ...a, type: "announcement", pinned: false }} variant="full-width" />
        ))}

        {/* Recent */}
        <SectionHeader icon={MessageCircle} label="Recent" />
        {mockChats.filter(c => !c.pinned).map(chat => (
          <ChatRow key={chat.id} chat={chat} variant="full-width" />
        ))}

        {/* Marketplace */}
        <SectionHeader icon={ArrowLeftRight} label="Marketplace" />
        <div className="px-3 py-2">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 cursor-pointer hover:bg-muted transition-colors">
            <ArrowLeftRight className="h-5 w-5 text-primary" />
            <div>
              <span className="text-sm font-medium">Shift Marketplace</span>
              <p className="text-xs text-muted-foreground">Browse available shifts</p>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Option 4: Compact Tabs (Single Row) ───
function Option4() {
  const [tab, setTab] = useState("chats");
  const tabs = [
    { id: "chats", icon: MessageCircle, label: "Chats" },
    { id: "support", icon: Headphones, label: "Support", badge: 2 },
    { id: "announce", icon: Megaphone, label: "News" },
    { id: "market", icon: ArrowLeftRight, label: "Market" },
    { id: "hiring", icon: Briefcase, label: "Hiring" },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-3 pb-2">
        <h2 className="text-lg font-bold">Chat</h2>
        <div className="flex gap-1.5">
          <Button size="icon" variant="outline" className="h-8 w-8"><Megaphone className="h-4 w-4" /></Button>
          <Button size="icon" className="h-8 w-8"><Plus className="h-4 w-4" /></Button>
        </div>
      </div>

      {/* Single row of compact tabs */}
      <div className="px-3 pb-2">
        <div className="flex bg-muted rounded-lg p-0.5 gap-0.5">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-xs font-medium transition-colors relative ${
                tab === t.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.badge && (
                <span className="absolute -top-0.5 -right-0.5 bg-destructive text-destructive-foreground rounded-full w-4 h-4 text-[9px] flex items-center justify-center font-bold">{t.badge}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search..." className="pl-9 h-9" />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-3">
          {tab === "chats" && mockChats.map(chat => <ChatRow key={chat.id} chat={chat} />)}
          {tab === "support" && mockSupport.map(t => (
            <div key={t.id} className="flex items-center gap-3 p-2.5 rounded-lg mb-1 cursor-pointer hover:bg-muted transition-colors">
              <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${t.status === "open" ? "bg-destructive/10" : "bg-muted"}`}>
                <Headphones className={`h-4 w-4 ${t.status === "open" ? "text-destructive" : "text-muted-foreground"}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium truncate">{t.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0 ml-2">{t.time}</span>
                </div>
                <p className="text-xs text-muted-foreground truncate">{t.preview}</p>
              </div>
            </div>
          ))}
          {tab === "announce" && mockAnnouncements.map(a => (
            <ChatRow key={a.id} chat={{ ...a, type: "announcement", pinned: false }} />
          ))}
          {tab === "market" && (
            <div className="text-center py-8 text-muted-foreground text-sm">Shift Marketplace view</div>
          )}
          {tab === "hiring" && mockHiring.map(h => (
            <div key={h.id} className="flex items-center gap-3 p-2.5 rounded-lg mb-1 cursor-pointer hover:bg-muted transition-colors">
              <Avatar className="h-10 w-10"><AvatarFallback className="text-xs">{h.name.split(" ").map(n => n[0]).join("")}</AvatarFallback></Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium truncate">{h.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0 ml-2">{h.time}</span>
                </div>
                <p className="text-xs text-muted-foreground truncate">{h.position}</p>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Option 5: Cards + Floating Support FAB ───
function Option5() {
  const [tab, setTab] = useState<"chats" | "announce">("chats");
  
  return (
    <div className="flex flex-col h-full relative">
      <div className="flex items-center justify-between p-3 pb-2">
        <h2 className="text-lg font-bold">Chat</h2>
        <div className="flex gap-1.5">
          <Button size="icon" variant="outline" className="h-8 w-8"><Megaphone className="h-4 w-4" /></Button>
          <Button size="icon" className="h-8 w-8"><Plus className="h-4 w-4" /></Button>
        </div>
      </div>

      {/* Minimal 2-tab toggle */}
      <div className="px-3 pb-2 flex gap-2">
        <button
          onClick={() => setTab("chats")}
          className={`text-sm font-medium pb-1 border-b-2 transition-colors ${tab === "chats" ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}
        >
          Chats
        </button>
        <button
          onClick={() => setTab("announce")}
          className={`text-sm font-medium pb-1 border-b-2 transition-colors ${tab === "announce" ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}
        >
          Announcements
        </button>
      </div>

      {/* Quick access cards */}
      <div className="px-3 pb-2 flex gap-2">
        <div className="flex-1 bg-muted/50 rounded-lg p-2.5 cursor-pointer hover:bg-muted transition-colors">
          <div className="flex items-center gap-2 mb-1">
            <ArrowLeftRight className="h-4 w-4 text-primary" />
            <span className="text-xs font-medium">Marketplace</span>
          </div>
          <p className="text-[11px] text-muted-foreground">Browse shifts</p>
        </div>
        <div className="flex-1 bg-muted/50 rounded-lg p-2.5 cursor-pointer hover:bg-muted transition-colors">
          <div className="flex items-center gap-2 mb-1">
            <Briefcase className="h-4 w-4 text-primary" />
            <span className="text-xs font-medium">Hiring</span>
          </div>
          <p className="text-[11px] text-muted-foreground">2 applicants</p>
        </div>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search..." className="pl-9 h-9" />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-3">
          {tab === "chats" ? (
            mockChats.map(chat => <ChatRow key={chat.id} chat={chat} />)
          ) : (
            mockAnnouncements.map(a => <ChatRow key={a.id} chat={{ ...a, type: "announcement", pinned: false }} />)
          )}
        </div>
      </ScrollArea>

      {/* Floating Support FAB */}
      <div className="absolute bottom-4 right-4">
        <button className="relative bg-destructive text-destructive-foreground rounded-full p-3 shadow-lg hover:bg-destructive/90 transition-colors">
          <Headphones className="h-5 w-5" />
          <span className="absolute -top-1 -right-1 bg-background text-destructive rounded-full w-5 h-5 text-[10px] font-bold flex items-center justify-center border-2 border-destructive">2</span>
        </button>
      </div>
    </div>
  );
}

// ─── Shared Components ───
function ChatRow({ chat, variant }: { chat: any; variant?: "full-width" }) {
  const px = variant === "full-width" ? "px-3" : "";
  return (
    <div className={`flex items-center gap-3 p-2.5 ${px} rounded-lg mb-0.5 cursor-pointer hover:bg-muted/50 transition-colors ${chat.type === "marketplace" ? "bg-accent/20" : chat.pinned ? "bg-primary/15" : ""}`}>
      <Avatar className="h-10 w-10 shrink-0">
        <AvatarFallback className={`text-xs font-medium ${chat.type === "announcement" ? "bg-primary/10" : chat.type === "marketplace" ? "bg-accent/15" : ""}`}>
          {chat.type === "announcement" ? <Megaphone className="h-4 w-4 text-primary" /> : chat.type === "marketplace" ? <ArrowLeftRight className="h-4 w-4 text-accent" /> : chat.avatar}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`flex-1 text-sm truncate ${chat.unread ? "font-bold" : "font-medium"}`}>{chat.name}</span>
          <div className="flex items-center gap-1.5 shrink-0">
            {chat.pinned && <Pin className="h-3 w-3 text-primary" />}
            {chat.unread ? (
              <span className="flex items-center justify-center min-w-[20px] h-5 px-1.5 text-xs font-bold bg-primary text-primary-foreground rounded-full">{chat.unread}</span>
            ) : (
              <span className="text-xs text-muted-foreground">{chat.time}</span>
            )}
          </div>
        </div>
        <p className={`text-xs truncate mt-0.5 ${chat.unread ? "text-foreground font-medium" : "text-muted-foreground"}`}>{chat.preview}</p>
      </div>
    </div>
  );
}

function SectionHeader({ icon: Icon, label, badge, color }: { icon: any; label: string; badge?: number; color?: string }) {
  return (
    <div className="flex items-center gap-2 px-3 pt-3 pb-1">
      <Icon className={`h-3.5 w-3.5 ${color === "destructive" ? "text-destructive" : "text-muted-foreground"}`} />
      <span className={`text-xs font-semibold uppercase tracking-wider ${color === "destructive" ? "text-destructive" : "text-muted-foreground"}`}>{label}</span>
      {badge !== undefined && (
        <Badge variant={color === "destructive" ? "destructive" : "secondary"} className="h-4 px-1.5 text-[10px]">{badge}</Badge>
      )}
    </div>
  );
}

// ─── Main Preview Page ───
export default function ChatListPreview() {
  const [selected, setSelected] = useState(0);

  const options = [
    { name: "Priority Inbox", desc: "Support always on top, sectioned list", component: <Option1 /> },
    { name: "Smart Filter Chips", desc: "Horizontal scrollable filter bar", component: <Option2 /> },
    { name: "Unified Sections", desc: "Single list with section headers", component: <Option3 /> },
    { name: "Compact 5-Tab", desc: "All tabs in one row, no second row", component: <Option4 /> },
    { name: "Cards + Support FAB", desc: "Minimal tabs, floating support button", component: <Option5 /> },
  ];

  return (
    <Layout>
      <div className="max-w-lg mx-auto">
        <h1 className="text-2xl font-bold mb-2">Chat List Redesign</h1>
        <p className="text-sm text-muted-foreground mb-4">Tap each option to preview. All show support tickets prominently.</p>

        {/* Option selector */}
        <div className="flex gap-1.5 overflow-x-auto pb-3 scrollbar-hide mb-4">
          {options.map((opt, i) => (
            <button
              key={i}
              onClick={() => setSelected(i)}
              className={`shrink-0 px-3 py-2 rounded-lg text-left transition-colors ${
                selected === i
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              <div className="text-sm font-medium">{i + 1}. {opt.name}</div>
              <div className={`text-[11px] ${selected === i ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{opt.desc}</div>
            </button>
          ))}
        </div>

        {/* Preview frame */}
        <div className="border border-border rounded-xl bg-card overflow-hidden" style={{ height: "70vh" }}>
          {options[selected].component}
        </div>
      </div>
    </Layout>
  );
}
