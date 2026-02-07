import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';
import { CheckCircle2, Calendar, Users, Clock, MessageSquare, BarChart3 } from 'lucide-react';
import crooLogo from '@/assets/croo-logo.webp';
import featureSchedule from '@/assets/feature-schedule.jpg';
import featureTasks from '@/assets/feature-tasks.jpg';
import featureTimeclock from '@/assets/feature-timeclock.jpg';

const Index = () => {
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  useEffect(() => {
    if (isMobile) {
      navigate('/auth');
    }
  }, [isMobile, navigate]);

  const features = [
    {
      icon: Calendar,
      title: 'Smart Scheduling',
      description: 'Create and publish schedules in minutes. Track labor costs in real-time and optimize your team\'s hours.'
    },
    {
      icon: Clock,
      title: 'Time Tracking',
      description: 'Tablet-friendly punch clock with PIN access. Automatic break tracking and overtime alerts.'
    },
    {
      icon: CheckCircle2,
      title: 'Task Management',
      description: 'Digital checklists and daily logs. Track completion rates and ensure nothing falls through the cracks.'
    },
    {
      icon: Users,
      title: 'Team Management',
      description: 'Employee profiles, certifications, and availability. Multi-location support for growing businesses.'
    },
    {
      icon: MessageSquare,
      title: 'Team Communication',
      description: 'Built-in messaging, announcements, and shift marketplace. Keep everyone connected and informed.'
    },
    {
      icon: BarChart3,
      title: 'Payroll & Analytics',
      description: 'Streamlined payroll review with labor law compliance. Track metrics that matter to your bottom line.'
    }
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        {/* Faded background pattern */}
        <div className="absolute inset-0 opacity-5 bg-gradient-to-br from-primary/20 to-accent/20"></div>
        
        {/* Header */}
        <header className="container mx-auto px-6 py-6 flex justify-between items-center relative z-10">
          <img src={crooLogo} alt="Croo" width={100} height={48} className="h-12" />
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => navigate('/auth')} className="font-medium">
              Log In
            </Button>
            <Button onClick={() => navigate('/auth?signup=true')} className="font-medium">
              Sign Up Free
            </Button>
          </div>
        </header>

        {/* Hero Content */}
        <div className="container mx-auto px-6 py-20 text-center relative z-10">
          <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold mb-6 text-foreground">
            Food Service Made Smart
          </h1>
          <p className="text-xl md:text-2xl text-muted-foreground mb-8 max-w-3xl mx-auto">
            All-in-one platform for restaurant scheduling, time tracking, task management, and team communication.
          </p>
          <div className="flex gap-4 justify-center">
            <Button size="lg" onClick={() => navigate('/auth?signup=true')} className="text-lg px-8">
              Start Free Trial
            </Button>
            <Button size="lg" variant="outline" onClick={() => navigate('/auth')} className="text-lg px-8">
              Log In
            </Button>
          </div>
          <p className="text-sm text-muted-foreground mt-4">
            No credit card required • Free 14-day trial
          </p>
        </div>
      </div>

      {/* Feature Showcase with Images */}
      <div className="container mx-auto px-6 py-20">
        {/* Schedule Feature */}
        <div className="mb-32 relative">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div className="order-2 md:order-1">
              <Calendar className="w-12 h-12 text-primary mb-4" />
              <h2 className="text-3xl md:text-4xl font-bold mb-4">Smart Scheduling</h2>
              <p className="text-lg text-muted-foreground mb-6">
                Create and publish schedules in minutes. Track labor costs in real-time and optimize your team's hours with intelligent scheduling tools.
              </p>
              <ul className="space-y-3">
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-primary mt-1 flex-shrink-0" />
                  <span>Drag-and-drop shift management</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-primary mt-1 flex-shrink-0" />
                  <span>Real-time labor cost tracking</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-primary mt-1 flex-shrink-0" />
                  <span>Shift marketplace for team flexibility</span>
                </li>
              </ul>
            </div>
            <div className="order-1 md:order-2 relative">
              <img 
                src={featureSchedule} 
                alt="Schedule Feature" 
                width={600}
                height={400}
                loading="lazy"
                className="rounded-lg shadow-2xl border border-border w-full"
              />
            </div>
          </div>
        </div>

        {/* Task Management Feature */}
        <div className="mb-32 relative">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div className="relative">
              <img 
                src={featureTasks} 
                alt="Task Management" 
                width={600}
                height={400}
                loading="lazy"
                className="rounded-lg shadow-2xl border border-border w-full"
              />
            </div>
            <div>
              <CheckCircle2 className="w-12 h-12 text-primary mb-4" />
              <h2 className="text-3xl md:text-4xl font-bold mb-4">Task Management</h2>
              <p className="text-lg text-muted-foreground mb-6">
                Digital checklists and daily logs ensure nothing falls through the cracks. Track completion rates and maintain accountability.
              </p>
              <ul className="space-y-3">
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-primary mt-1 flex-shrink-0" />
                  <span>Customizable daily checklists</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-primary mt-1 flex-shrink-0" />
                  <span>Photo documentation & attachments</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-primary mt-1 flex-shrink-0" />
                  <span>Completion history & analytics</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Time Clock Feature */}
        <div className="mb-20 relative">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div className="order-2 md:order-1">
              <Clock className="w-12 h-12 text-primary mb-4" />
              <h2 className="text-3xl md:text-4xl font-bold mb-4">Time Tracking</h2>
              <p className="text-lg text-muted-foreground mb-6">
                Tablet-friendly punch clock with PIN access. Automatic break tracking and overtime alerts keep your labor compliant.
              </p>
              <ul className="space-y-3">
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-primary mt-1 flex-shrink-0" />
                  <span>Simple PIN-based clock in/out</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-primary mt-1 flex-shrink-0" />
                  <span>Automatic break compliance</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-primary mt-1 flex-shrink-0" />
                  <span>Payroll-ready reports</span>
                </li>
              </ul>
            </div>
            <div className="order-1 md:order-2 relative">
              <img 
                src={featureTimeclock} 
                alt="Time Clock" 
                width={600}
                height={400}
                loading="lazy"
                className="rounded-lg shadow-2xl border border-border w-full"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Additional Features Grid */}
      <div className="container mx-auto px-6 py-20">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Everything You Need</h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Comprehensive tools to manage every aspect of your restaurant operations.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          <div className="p-6 rounded-lg border border-border bg-card hover:shadow-lg transition-shadow">
            <Users className="w-12 h-12 text-primary mb-4" />
            <h3 className="text-xl font-semibold mb-3">Team Management</h3>
            <p className="text-muted-foreground">Employee profiles, certifications, and multi-location support.</p>
          </div>
          <div className="p-6 rounded-lg border border-border bg-card hover:shadow-lg transition-shadow">
            <MessageSquare className="w-12 h-12 text-primary mb-4" />
            <h3 className="text-xl font-semibold mb-3">Communication</h3>
            <p className="text-muted-foreground">Built-in messaging, announcements, and team chat.</p>
          </div>
          <div className="p-6 rounded-lg border border-border bg-card hover:shadow-lg transition-shadow">
            <BarChart3 className="w-12 h-12 text-primary mb-4" />
            <h3 className="text-xl font-semibold mb-3">Analytics</h3>
            <p className="text-muted-foreground">Track metrics, labor costs, and performance insights.</p>
          </div>
        </div>
      </div>

      {/* CTA Section */}
      <div className="bg-primary/5 border-y border-border">
        <div className="container mx-auto px-6 py-16 text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Ready to Transform Your Operations?</h2>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Join restaurants that trust Croo to streamline their operations and empower their teams.
          </p>
          <Button size="lg" onClick={() => navigate('/auth?signup=true')} className="text-lg px-8">
            Get Started Free
          </Button>
        </div>
      </div>

      {/* Footer */}
      <footer className="container mx-auto px-6 py-8 text-center text-muted-foreground">
        <p>© 2025 CrooHQ. All rights reserved.</p>
      </footer>
    </div>
  );
};

export default Index;
