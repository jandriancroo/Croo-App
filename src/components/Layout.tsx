import { ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { CheckSquare, Home, ClipboardList, History, LogOut, Plus, Users, Calendar, CalendarCheck, DollarSign, MessageSquare, Menu } from 'lucide-react';
import { useUserRole } from '@/hooks/useUserRole';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useState } from 'react';

interface LayoutProps {
  children: ReactNode;
}

export const Layout = ({ children }: LayoutProps) => {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin } = useUserRole();
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);

  const navItems = [
    { path: '/', label: 'Dashboard', icon: Home },
    { path: '/create', label: 'Tasks', icon: ClipboardList },
    { path: '/schedule', label: 'Schedule', icon: Calendar },
    { path: '/availability', label: 'Availability', icon: CalendarCheck },
    ...(isAdmin ? [{ path: '/users', label: 'Users', icon: Users }] : []),
    { path: '/messages', label: 'Messages', icon: MessageSquare },
  ];

  // Mobile bottom nav shows only main items
  const mobileMainNavItems = [
    { path: '/', label: 'Dashboard', icon: Home },
    { path: '/schedule', label: 'Schedule', icon: Calendar },
    { path: '/create', label: 'Tasks', icon: ClipboardList },
    { path: '/messages', label: 'Messages', icon: MessageSquare },
  ];

  // Items that go in the hamburger menu on mobile
  const mobileMenuItems = [
    { path: '/availability', label: 'Availability', icon: CalendarCheck },
    ...(isAdmin ? [{ path: '/users', label: 'Users', icon: Users }] : []),
  ];

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-background via-primary/5 to-accent/10">
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className={`container flex items-center justify-between ${isMobile ? 'h-12' : 'h-16'}`}>
          <div className="flex items-center gap-2">
            <CheckSquare className={`${isMobile ? 'h-4 w-4' : 'h-6 w-6'} text-primary`} />
            <h1 className={`${isMobile ? 'text-sm' : 'text-xl'} font-semibold`}>
              {isMobile ? 'Checks' : 'Line Checks'}
            </h1>
          </div>
          <nav className="hidden items-center gap-1 md:flex">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <Button
                  key={item.path}
                  variant={isActive ? 'secondary' : 'ghost'}
                  onClick={() => navigate(item.path)}
                  className="gap-2"
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Button>
              );
            })}
          </nav>
          <Button 
            variant="outline" 
            onClick={signOut} 
            size={isMobile ? "sm" : "default"}
            className={`gap-2 ${isMobile ? 'px-2' : ''}`}
          >
            <LogOut className={`${isMobile ? 'h-3.5 w-3.5' : 'h-4 w-4'}`} />
            {!isMobile && 'Sign Out'}
          </Button>
        </div>
      </header>
      <main className="container flex-1 py-8">{children}</main>
      <nav className="sticky bottom-0 border-t border-border/40 bg-background/95 backdrop-blur md:hidden">
        <div className="flex items-center justify-around py-1.5 px-1">
          {mobileMainNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Button
                key={item.path}
                variant={isActive ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => navigate(item.path)}
                className="flex-col gap-0.5 h-auto py-1.5 px-2 min-w-0"
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                <span className="text-[10px] truncate max-w-[60px]">{item.label}</span>
              </Button>
            );
          })}
          
          {/* Hamburger Menu for Additional Items */}
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="flex-col gap-0.5 h-auto py-1.5 px-2 min-w-0"
              >
                <Menu className="h-4 w-4 flex-shrink-0" />
                <span className="text-[10px] truncate max-w-[60px]">More</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="h-auto">
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
              </SheetHeader>
              <div className="grid gap-2 py-4">
                {mobileMenuItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = location.pathname === item.path;
                  return (
                    <Button
                      key={item.path}
                      variant={isActive ? 'secondary' : 'outline'}
                      onClick={() => {
                        navigate(item.path);
                        setMenuOpen(false);
                      }}
                      className="justify-start gap-3 h-12"
                    >
                      <Icon className="h-5 w-5" />
                      <span className="text-base">{item.label}</span>
                    </Button>
                  );
                })}
                <Button
                  variant="outline"
                  onClick={() => {
                    signOut();
                    setMenuOpen(false);
                  }}
                  className="justify-start gap-3 h-12 text-destructive hover:text-destructive"
                >
                  <LogOut className="h-5 w-5" />
                  <span className="text-base">Sign Out</span>
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </div>
  );
};
