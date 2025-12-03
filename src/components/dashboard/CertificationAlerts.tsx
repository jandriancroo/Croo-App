import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { differenceInDays, format } from "date-fns";

interface ExpiringCertification {
  id: string;
  certification_type: string;
  expiration_date: string;
  user_id: string;
  profiles: {
    full_name: string;
  };
}

export function CertificationAlerts() {
  const [expiringCerts, setExpiringCerts] = useState<ExpiringCertification[]>([]);

  useEffect(() => {
    fetchExpiringCertifications();
  }, []);

  const fetchExpiringCertifications = async () => {
    try {
      // Get date 30 days from now
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

      const { data, error } = await supabase
        .from("certifications")
        .select(`
          id,
          certification_type,
          expiration_date,
          user_id,
          profiles!certifications_user_id_fkey(full_name)
        `)
        .eq("status", "approved")
        .lte("expiration_date", thirtyDaysFromNow.toISOString().split("T")[0])
        .gte("expiration_date", new Date().toISOString().split("T")[0]);

      if (error) throw error;

      setExpiringCerts((data as any) || []);
    } catch (error) {
      console.error("Error fetching expiring certifications:", error);
    }
  };

  if (expiringCerts.length === 0) return null;

  return (
    <Alert variant="destructive" className="py-2">
      <AlertTriangle className="h-3.5 w-3.5" />
      <AlertDescription className="text-xs space-y-0.5">
        {expiringCerts.map((cert) => {
          const daysUntilExpiry = differenceInDays(
            new Date(cert.expiration_date),
            new Date()
          );
          const certTypeName =
            cert.certification_type === "food_handlers"
              ? "Food Handlers"
              : "ServSafe";

          return (
            <div key={cert.id}>
              <strong>{cert.profiles.full_name}</strong> • {certTypeName} • {daysUntilExpiry}d
            </div>
          );
        })}
      </AlertDescription>
    </Alert>
  );
}
