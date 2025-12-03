import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { RoleManagementSection } from '@/components/settings/RoleManagementSection';
import { NotificationsDashboard } from '@/components/settings/NotificationsDashboard';

export default function RoleManagement() {
  const navigate = useNavigate();

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/settings')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Role Management</h1>
            <p className="text-muted-foreground">Configure permissions and notifications for each role</p>
          </div>
        </div>

        <div className="grid gap-6">
          <RoleManagementSection />
          <NotificationsDashboard />
        </div>
      </div>
    </Layout>
  );
}
