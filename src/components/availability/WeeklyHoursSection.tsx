import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { Loader2 } from "lucide-react";

interface EmployeeHours {
  id: string;
  full_name: string;
  profile_photo_url: string | null;
  min_weekly_hours: number | null;
  max_weekly_hours: number | null;
}

export function WeeklyHoursSection() {
  const { currentLocation } = useAppLocation();
  const [employees, setEmployees] = useState<EmployeeHours[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<string>("lastName");
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    if (currentLocation) {
      fetchEmployees();
    }
  }, [currentLocation]);

  const fetchEmployees = async () => {
    if (!currentLocation) return;
    
    try {
      setLoading(true);
      
      // Get user IDs at this location
      const { data: userLocations, error: userLocError } = await supabase
        .from("user_locations")
        .select("user_id")
        .eq("location_id", currentLocation.id);
      
      if (userLocError) throw userLocError;
      
      const locationUserIds = (userLocations || []).map(ul => ul.user_id);
      
      if (locationUserIds.length > 0) {
        const { data: profiles, error: profilesError } = await supabase
          .from("profiles")
          .select("id, full_name, profile_photo_url, min_weekly_hours, max_weekly_hours")
          .eq("is_active", true)
          .in("id", locationUserIds);

        if (profilesError) throw profilesError;
        setEmployees(profiles || []);
      } else {
        setEmployees([]);
      }
    } catch (error: any) {
      console.error("Error fetching employees:", error);
      toast.error("Failed to load employees");
    } finally {
      setLoading(false);
    }
  };

  const handleHoursChange = async (
    employeeId: string,
    field: "min_weekly_hours" | "max_weekly_hours",
    value: string
  ) => {
    const numValue = value === "" ? null : parseFloat(value);
    
    // Validate the value
    if (numValue !== null && (isNaN(numValue) || numValue < 0 || numValue > 168)) {
      return;
    }

    // Update local state immediately for responsiveness
    setEmployees(prev => 
      prev.map(emp => 
        emp.id === employeeId 
          ? { ...emp, [field]: numValue }
          : emp
      )
    );

    // Debounce the save - we'll save on blur instead
  };

  const handleBlur = async (
    employeeId: string,
    field: "min_weekly_hours" | "max_weekly_hours"
  ) => {
    const employee = employees.find(e => e.id === employeeId);
    if (!employee) return;

    setSavingId(employeeId);
    
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ [field]: employee[field] })
        .eq("id", employeeId);

      if (error) throw error;
    } catch (error: any) {
      console.error("Error updating hours:", error);
      toast.error("Failed to save hours");
      // Refetch to reset to server state
      fetchEmployees();
    } finally {
      setSavingId(null);
    }
  };

  const sortedEmployees = [...employees].sort((a, b) => {
    if (sortBy === "lastName") {
      const aLast = a.full_name.split(" ").slice(-1)[0] || "";
      const bLast = b.full_name.split(" ").slice(-1)[0] || "";
      return aLast.localeCompare(bLast);
    } else if (sortBy === "firstName") {
      const aFirst = a.full_name.split(" ")[0] || "";
      const bFirst = b.full_name.split(" ")[0] || "";
      return aFirst.localeCompare(bFirst);
    } else if (sortBy === "mostHours") {
      return (b.max_weekly_hours || 0) - (a.max_weekly_hours || 0);
    } else {
      return (a.max_weekly_hours || 0) - (b.max_weekly_hours || 0);
    }
  });

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  if (loading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </Card>
    );
  }

  if (employees.length === 0) {
    return null;
  }

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Weekly Hours</h2>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="lastName">Last Name</SelectItem>
            <SelectItem value="firstName">First Name</SelectItem>
            <SelectItem value="mostHours">Most Hours</SelectItem>
            <SelectItem value="leastHours">Least Hours</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      {/* Header */}
      <div className="grid grid-cols-[1fr,80px,80px] gap-2 px-3 py-2 text-xs text-muted-foreground font-medium border-b mb-2">
        <span>Employee</span>
        <span className="text-center">Min</span>
        <span className="text-center">Max</span>
      </div>
      
      <div className="space-y-1">
        {sortedEmployees.map((employee) => (
          <div
            key={employee.id}
            className="grid grid-cols-[1fr,80px,80px] gap-2 items-center px-3 py-2 border rounded-lg text-sm"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Avatar className="h-7 w-7 flex-shrink-0">
                <AvatarImage src={employee.profile_photo_url || undefined} />
                <AvatarFallback className="text-xs">
                  {getInitials(employee.full_name)}
                </AvatarFallback>
              </Avatar>
              <span className="font-medium truncate">{employee.full_name}</span>
              {savingId === employee.id && (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground flex-shrink-0" />
              )}
            </div>
            <Input
              type="number"
              min={0}
              max={168}
              step={1}
              placeholder="—"
              value={employee.min_weekly_hours ?? ""}
              onChange={(e) => handleHoursChange(employee.id, "min_weekly_hours", e.target.value)}
              onBlur={() => handleBlur(employee.id, "min_weekly_hours")}
              className="h-8 text-center text-sm px-2"
            />
            <Input
              type="number"
              min={0}
              max={168}
              step={1}
              placeholder="—"
              value={employee.max_weekly_hours ?? ""}
              onChange={(e) => handleHoursChange(employee.id, "max_weekly_hours", e.target.value)}
              onBlur={() => handleBlur(employee.id, "max_weekly_hours")}
              className="h-8 text-center text-sm px-2"
            />
          </div>
        ))}
      </div>
    </Card>
  );
}
