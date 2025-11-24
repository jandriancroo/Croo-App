import { ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { CheckSquare, Home, ClipboardList, History, LogOut, Plus, Users, Calendar, CalendarCheck, DollarSign, MessageSquare } from 'lucide-react';
import { useUserRole } from '@/hooks/useUserRole';
import { useIsMobile } from '@/hooks/use-mobile';

interface LayoutProps {
  children: ReactNode;
}

export const Layout = ({ children }: LayoutProps) => {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin } = useUserRole();
  const isMobile = useIsMobile();

  const navItems = [
    { path: '/', label: 'Dashboard', icon: Home },
    { path: '/create', label: 'Tasks', icon: ClipboardList },
    { path: '/schedule', label: 'Schedule', icon: Calendar },
    { path: '/availability', label: 'Availability', icon: CalendarCheck },
    ...(isAdmin ? [{ path: '/users', label: 'Users', icon: Users }] : []),
    { path: '/messages', label: 'Messages', icon: MessageSquare },
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
          {navItems.map((item) => {
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
        </div>
      </nav>
    </div>
  );
};
