import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { Loader2, ChevronRight, ChevronDown } from "lucide-react";
import { EmployeePreferencesDialog } from "./EmployeePreferencesDialog";

interface Employee {
  id: string;
  full_name: string;
  profile_photo_url: string | null;
  min_weekly_hours: number | null;
  max_weekly_hours: number | null;
  weekly_availability: WeeklyAvailability | null;
}

export interface DayAvailability {
  available: boolean;
  start?: string; // e.g., "10:00"
  end?: string;   // e.g., "15:00"
}

export interface WeeklyAvailability {
  monday: DayAvailability;
  tuesday: DayAvailability;
  wednesday: DayAvailability;
  thursday: DayAvailability;
  friday: DayAvailability;
  saturday: DayAvailability;
  sunday: DayAvailability;
}

const DEFAULT_AVAILABILITY: WeeklyAvailability = {
  monday: { available: true },
  tuesday: { available: true },
  wednesday: { available: true },
  thursday: { available: true },
  friday: { available: true },
  saturday: { available: true },
  sunday: { available: true },
};

export function SchedulingPreferencesSection() {
  const { currentLocation } = useAppLocation();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<string>("lastName");
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

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
          .select("id, full_name, profile_photo_url, min_weekly_hours, max_weekly_hours, weekly_availability")
          .eq("is_active", true)
          .in("id", locationUserIds);

        if (profilesError) throw profilesError;
        
        // Parse weekly_availability from JSON
        const parsedEmployees = (profiles || []).map(p => ({
          ...p,
          weekly_availability: p.weekly_availability as unknown as WeeklyAvailability | null
        }));
        
        setEmployees(parsedEmployees);
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

  const handleEmployeeClick = (employee: Employee) => {
    setSelectedEmployee(employee);
    setDialogOpen(true);
  };

  const handleSave = async (
    employeeId: string,
    minHours: number | null,
    maxHours: number | null,
    availability: WeeklyAvailability
  ) => {
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          min_weekly_hours: minHours,
          max_weekly_hours: maxHours,
          weekly_availability: JSON.parse(JSON.stringify(availability)),
        })
        .eq("id", employeeId);

      if (error) throw error;
      
      toast.success("Preferences saved");
      setDialogOpen(false);
      fetchEmployees();
    } catch (error: any) {
      console.error("Error saving preferences:", error);
      toast.error("Failed to save preferences");
    }
  };

  const sortedEmployees = [...employees].sort((a, b) => {
    if (sortBy === "lastName") {
      const aLast = a.full_name.split(" ").slice(-1)[0] || "";
      const bLast = b.full_name.split(" ").slice(-1)[0] || "";
      return aLast.localeCompare(bLast);
    } else {
      const aFirst = a.full_name.split(" ")[0] || "";
      const bFirst = b.full_name.split(" ")[0] || "";
      return aFirst.localeCompare(bFirst);
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
    <>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <Card className="p-6">
          <CollapsibleTrigger className="w-full">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ChevronDown 
                  className={`h-5 w-5 text-muted-foreground transition-transform ${
                    isOpen ? "" : "-rotate-90"
                  }`} 
                />
                <h2 className="text-xl font-semibold">Scheduling Preferences</h2>
                <span className="text-sm text-muted-foreground">({employees.length})</span>
              </div>
            </div>
          </CollapsibleTrigger>
          
          <CollapsibleContent>
            <div className="flex items-center justify-end mt-4 mb-3">
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lastName">Last Name</SelectItem>
                  <SelectItem value="firstName">First Name</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-1">
              {sortedEmployees.map((employee) => (
                <button
                  key={employee.id}
                  onClick={() => handleEmployeeClick(employee)}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2.5 border rounded-lg text-sm hover:bg-muted/50 transition-colors text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar className="h-8 w-8 flex-shrink-0">
                      <AvatarImage src={employee.profile_photo_url || undefined} />
                      <AvatarFallback className="text-xs">
                        {getInitials(employee.full_name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="font-medium truncate">{employee.full_name}</span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                </button>
              ))}
            </div>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <EmployeePreferencesDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        employee={selectedEmployee}
        onSave={handleSave}
      />
    </>
  );
}
