import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle } from "lucide-react";
import { differenceInDays } from "date-fns";
import { getTodayInPST, getDateInPSTOffset } from "@/utils/dateUtils";

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
      const todayPST = getTodayInPST();
      const thirtyDaysFromNowPST = getDateInPSTOffset(30);

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
        .lte("expiration_date", thirtyDaysFromNowPST)
        .gte("expiration_date", todayPST);

      if (error) throw error;

      setExpiringCerts((data as any) || []);
    } catch (error) {
      console.error("Error fetching expiring certifications:", error);
    }
  };

  if (expiringCerts.length === 0) return null;

  return (
    <div className="flex items-start gap-2 border border-destructive/50 bg-red-50/80 dark:bg-red-950/50 py-1.5 px-2.5 rounded-md">
      <AlertTriangle className="h-3.5 w-3.5 text-destructive flex-shrink-0 mt-0.5" />
      <div className="text-xs text-red-800 dark:text-red-200 space-y-0.5">
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
      </div>
    </div>
  );
}
