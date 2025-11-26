import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';
import { CheckCircle2, Calendar, Users, Clock, MessageSquare, BarChart3 } from 'lucide-react';
import crooLogo from '@/assets/croo-logo.png';

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
        {/* Header */}
        <header className="container mx-auto px-6 py-6 flex justify-between items-center">
          <img src={crooLogo} alt="Croo" className="h-12" />
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
        <div className="container mx-auto px-6 py-20 text-center">
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

      {/* Features Section */}
      <div className="container mx-auto px-6 py-20">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Everything You Need to Run Your Restaurant</h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Save time, reduce costs, and keep your team organized with our comprehensive management platform.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature, index) => (
            <div key={index} className="p-6 rounded-lg border border-border bg-card hover:shadow-lg transition-shadow">
              <feature.icon className="w-12 h-12 text-primary mb-4" />
              <h3 className="text-xl font-semibold mb-3">{feature.title}</h3>
              <p className="text-muted-foreground">{feature.description}</p>
            </div>
          ))}
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
