import { ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Home, ClipboardCheck, Users, Calendar, MessageSquare, Menu, Clock, CalendarCheck, DollarSign, Settings as SettingsIcon, ChevronDown, Scroll, DoorOpen } from 'lucide-react';
import { useUserRole } from '@/hooks/useUserRole';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useState } from 'react';
import crooLogo from '@/assets/croo-logo.png';
import { LocationSelector } from '@/components/LocationSelector';
import { useUnreadMessages } from '@/hooks/useUnreadMessages';
import { Badge } from '@/components/ui/badge';

interface LayoutProps {
  children: ReactNode;
}
export const Layout = ({
  children
}: LayoutProps) => {
  const {
    signOut
  } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    isAdmin
  } = useUserRole();
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const { unreadCount } = useUnreadMessages();
  const mainNavItems = [{
    path: '/',
    label: 'Dash',
    icon: Home
  }, {
    path: '/tasks',
    label: 'Tasks',
    icon: ClipboardCheck
  }, {
    path: '/logbook',
    label: 'Logs',
    icon: Scroll
  }, {
    path: '/schedule',
    label: 'Schedule',
    icon: Calendar
  }, {
    path: '/messages',
    label: 'Chat',
    icon: MessageSquare
  }];
  const timeMenuItems = [{
    path: '/availability',
    label: 'Availability',
    icon: CalendarCheck
  }, ...(isAdmin ? [{
    path: '/punch-clock',
    label: 'Punch Clock',
    icon: Clock
  }, {
    path: '/payroll-review',
    label: 'Payroll Review',
    icon: DollarSign
  }] : [])];
  const mobileMainNavItems = [{
    path: '/',
    label: 'Dash',
    icon: Home
  }, {
    path: '/tasks',
    label: 'Tasks',
    icon: ClipboardCheck
  }, {
    path: '/schedule',
    label: 'Schedule',
    icon: Calendar
  }, {
    path: '/messages',
    label: 'Chat',
    icon: MessageSquare
  }];
  const mobileMenuItems = [{
    path: '/logbook',
    label: 'Logs',
    icon: Scroll
  }, {
    path: '/availability',
    label: 'Availability',
    icon: CalendarCheck
  }, ...(isAdmin ? [{
    path: '/punch-clock',
    label: 'Punch Clock',
    icon: Clock
  }, {
    path: '/payroll-review',
    label: 'Payroll Review',
    icon: DollarSign
  }, {
    path: '/users',
    label: 'Users',
    icon: Users
  }] : []), {
    path: '/settings',
    label: 'Settings',
    icon: SettingsIcon
  }];
  return <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className={`container flex items-center ${isMobile ? 'h-16' : 'h-24'}`}>
          <button onClick={() => navigate('/')} className="flex items-center gap-2 hover:opacity-80 transition-opacity mr-8 flex-shrink-0 min-w-[120px]">
            <img src={crooLogo} alt="Croo" className={`${isMobile ? 'h-16' : 'h-20'} w-auto`} />
          </button>
          <nav className="hidden items-center gap-1 md:flex flex-1">
            {mainNavItems.map(item => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            const showBadge = item.path === '/messages' && unreadCount > 0;
            return <Button key={item.path} variant={isActive ? 'secondary' : 'ghost'} onClick={() => navigate(item.path)} className="gap-2 relative">
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  <span className="hidden lg:inline">{item.label}</span>
                  {showBadge && (
                    <Badge variant="destructive" className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center p-0 text-[10px] rounded-full">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </Badge>
                  )}
                </Button>;
          })}
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant={['/availability', '/punch-clock', '/payroll-review'].includes(location.pathname) ? 'secondary' : 'ghost'} className="gap-2">
                  <Clock className="h-4 w-4 flex-shrink-0" />
                  <span className="hidden lg:inline">Time</span>
                  <ChevronDown className="h-3 w-3 flex-shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="bg-background">
                {timeMenuItems.map(item => {
                const Icon = item.icon;
                return <DropdownMenuItem key={item.path} onClick={() => navigate(item.path)} className="gap-2 cursor-pointer">
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </DropdownMenuItem>;
              })}
              </DropdownMenuContent>
            </DropdownMenu>
            
            <Button variant="ghost" size="icon" onClick={() => navigate('/alerts')} title="Live Alerts" className="relative hover:bg-muted ml-1 rounded-none font-extrabold">
              <div className="relative flex items-center justify-center h-5 w-5">
                <div className="absolute h-5 w-5 bg-destructive rounded-full opacity-75"></div>
                <div className="absolute h-5 w-5 bg-destructive rounded-full animate-ping"></div>
                <div className="absolute h-3 w-3 bg-destructive rounded-full"></div>
              </div>
            </Button>
          </nav>
          
          {/* Mobile Alerts Button */}
          <Button variant="ghost" size="icon" onClick={() => navigate('/alerts')} title="Live Alerts" className="md:hidden relative hover:bg-muted rounded-none font-extrabold ml-auto">
            <div className="relative flex items-center justify-center h-5 w-5">
              <div className="absolute h-5 w-5 bg-destructive rounded-full opacity-75"></div>
              <div className="absolute h-5 w-5 bg-destructive rounded-full animate-ping"></div>
              <div className="absolute h-3 w-3 bg-destructive rounded-full"></div>
            </div>
          </Button>
          
          <div className="hidden md:flex items-center gap-2">
            {isAdmin && <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant={['/settings', '/users'].includes(location.pathname) ? 'secondary' : 'ghost'} size="icon" title="Settings">
                    <SettingsIcon className="h-4 w-4 flex-shrink-0" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-background">
                  <DropdownMenuItem onClick={() => navigate('/users')} className="gap-2 cursor-pointer">
                    <Users className="h-4 w-4" />
                    Users
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/settings')} className="gap-2 cursor-pointer">
                    <SettingsIcon className="h-4 w-4" />
                    Preferences
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>}
            
            <Button variant="outline" onClick={signOut} size="icon" title="Sign Out" className="text-destructive hover:text-destructive">
              <DoorOpen className="h-4 w-4 flex-shrink-0" />
            </Button>
          </div>

        </div>
      </header>
      <main className="container flex-1 py-8">{children}</main>
      <nav className="sticky bottom-0 border-t border-border/40 bg-background/95 backdrop-blur md:hidden">
        <div className="flex items-center justify-around py-1.5 px-1">
          {mobileMainNavItems.map(item => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          const showBadge = item.path === '/messages' && unreadCount > 0;
          return <Button key={item.path} variant={isActive ? 'secondary' : 'ghost'} size="sm" onClick={() => navigate(item.path)} className="flex-col gap-0.5 h-auto py-1.5 px-2 min-w-0 relative">
                <Icon className="h-4 w-4 flex-shrink-0" />
                <span className="text-[10px] truncate max-w-[60px]">{item.label}</span>
                {showBadge && (
                  <Badge variant="destructive" className="absolute -top-0.5 -right-0.5 h-4 min-w-4 flex items-center justify-center p-0 text-[8px] rounded-full">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </Badge>
                )}
              </Button>;
        })}
          
          {/* Hamburger Menu for Additional Items */}
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="sm" className="flex-col gap-0.5 h-auto py-1.5 px-2 min-w-0">
                <Menu className="h-4 w-4 flex-shrink-0" />
                <span className="text-[10px] truncate max-w-[60px]">More</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="h-auto">
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
              </SheetHeader>
              <div className="grid gap-2 py-4">
                {mobileMenuItems.map(item => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                return <Button key={item.path} variant={isActive ? 'secondary' : 'outline'} onClick={() => {
                  navigate(item.path);
                  setMenuOpen(false);
                }} className="justify-start gap-3 h-12">
                      <Icon className="h-5 w-5" />
                      <span className="text-base">{item.label}</span>
                    </Button>;
              })}
                <Button variant="outline" onClick={() => {
                signOut();
                setMenuOpen(false);
              }} className="justify-start gap-3 h-12 text-destructive hover:text-destructive">
                  <DoorOpen className="h-5 w-5" />
                  <span className="text-base">Sign Out</span>
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </div>;
};