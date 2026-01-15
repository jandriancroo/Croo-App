import { Layout } from '@/components/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Building2 } from 'lucide-react';

export default function MultiLocationDashboard() {
  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <Card className="max-w-md mx-auto">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Building2 className="h-16 w-16 text-muted-foreground mb-4" />
            <h1 className="text-2xl font-bold mb-2">Org Dashboard</h1>
            <p className="text-muted-foreground">
              Coming soon — we're rebuilding this page to match the main Dashboard exactly.
            </p>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
