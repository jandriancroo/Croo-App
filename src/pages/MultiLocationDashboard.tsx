import { Layout } from '@/components/Layout';
import { useSearchParams } from 'react-router-dom';
import { useLocation as useAppLocation } from '@/hooks/useLocation';

export default function MultiLocationDashboard() {
  const { organizationId: contextOrgId } = useAppLocation();
  const [searchParams] = useSearchParams();
  
  // Prefer org from URL param, fallback to context org
  const urlOrgId = searchParams.get('org');
  const organizationId = urlOrgId || contextOrgId;

  return (
    <Layout>
      <div className="p-4 md:p-6 space-y-6">
        <h1 className="text-2xl font-bold">Org Dashboard</h1>
        {/* Blank slate — rebuild piece by piece */}
      </div>
    </Layout>
  );
}
