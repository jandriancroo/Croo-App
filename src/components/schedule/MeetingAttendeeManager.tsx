import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Users, UserPlus, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

interface Employee {
  id: string;
  full_name: string;
  avatar_url: string | null;
  role?: string;
}

interface MeetingAttendeeManagerProps {
  eventId: string;
  eventName: string;
  locationId: string;
  disabled?: boolean;
}

export function MeetingAttendeeManager({
  eventId,
  eventName,
  locationId,
  disabled = false,
}: MeetingAttendeeManagerProps) {
  const [open, setOpen] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendeeIds, setAttendeeIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      fetchEmployeesAndAttendees();
    }
  }, [open, eventId, locationId]);

  const fetchEmployeesAndAttendees = async () => {
    setLoading(true);
    try {
      // Fetch all active employees at this location
      const { data: locationAssignments, error: locError } = await supabase
        .from("user_locations")
        .select("user_id")
        .eq("location_id", locationId);

      if (locError) throw locError;

      const userIds = (locationAssignments || []).map((a: { user_id: string }) => a.user_id);

      if (userIds.length === 0) {
        setEmployees([]);
        setAttendeeIds(new Set());
        return;
      }

      // Fetch profile details
      const { data: profiles, error: profileError } = await supabase
        .from("profiles")
        .select("id, full_name, profile_photo_url")
        .in("id", userIds)
        .eq("is_active", true)
        .order("full_name");

      if (profileError) throw profileError;

      // Fetch roles
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("user_id", userIds);

      const roleMap = new Map((roles || []).map((r: { user_id: string; role: string }) => [r.user_id, r.role]));

      const employeesWithRoles: Employee[] = (profiles || []).map((p: { id: string; full_name: string; profile_photo_url: string | null }) => ({
        id: p.id,
        full_name: p.full_name,
        avatar_url: p.profile_photo_url,
        role: roleMap.get(p.id) || "team_member",
      }));

      // Sort: managers first, then alphabetically
      employeesWithRoles.sort((a, b) => {
        const roleOrder: Record<string, number> = {
          super_admin: 0,
          org_admin: 1,
          admin: 2,
          manager: 3,
          team_member: 4,
        };
        const aOrder = roleOrder[a.role] ?? 5;
        const bOrder = roleOrder[b.role] ?? 5;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return (a.full_name || "").localeCompare(b.full_name || "");
      });

      setEmployees(employeesWithRoles);

      // Fetch current attendees
      const { data: attendees, error: attendeesError } = await supabase
        .from("event_attendees")
        .select("user_id")
        .eq("event_id", eventId);

      if (attendeesError) throw attendeesError;

      setAttendeeIds(new Set(attendees?.map((a) => a.user_id) || []));
    } catch (error) {
      console.error("Error fetching employees:", error);
      toast.error("Failed to load employees");
    } finally {
      setLoading(false);
    }
  };

  const toggleAttendee = (userId: string) => {
    setAttendeeIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const selectAll = () => {
    setAttendeeIds(new Set(employees.map((e) => e.id)));
  };

  const selectNone = () => {
    setAttendeeIds(new Set());
  };

  const selectByRole = (targetRoles: string[]) => {
    const matching = employees.filter((e) => targetRoles.includes(e.role || ""));
    setAttendeeIds(new Set(matching.map((e) => e.id)));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Delete existing attendees
      const { error: deleteError } = await supabase
        .from("event_attendees")
        .delete()
        .eq("event_id", eventId);

      if (deleteError) throw deleteError;

      // Insert new attendees
      if (attendeeIds.size > 0) {
        const { data: userData } = await supabase.auth.getUser();
        const inserts = Array.from(attendeeIds).map((userId) => ({
          event_id: eventId,
          user_id: userId,
          created_by: userData?.user?.id || null,
        }));

        const { error: insertError } = await supabase
          .from("event_attendees")
          .insert(inserts);

        if (insertError) throw insertError;
      }

      toast.success(`${attendeeIds.size} attendees saved`);
      setOpen(false);
    } catch (error) {
      console.error("Error saving attendees:", error);
      toast.error("Failed to save attendees");
    } finally {
      setSaving(false);
    }
  };

  const getRoleLabel = (role?: string) => {
    const labels: Record<string, string> = {
      super_admin: "Super Admin",
      org_admin: "Org Admin",
      admin: "Admin",
      manager: "Manager",
      team_member: "Team Member",
    };
    return labels[role || ""] || "Team Member";
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          className="gap-2"
        >
          <Users className="h-4 w-4" />
          Attendees
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="h-[80vh]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            {eventName} Attendees
          </SheetTitle>
        </SheetHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {/* Quick select buttons */}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={selectAll}>
                Select All
              </Button>
              <Button variant="outline" size="sm" onClick={selectNone}>
                Select None
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => selectByRole(["admin", "manager", "org_admin", "super_admin"])}
              >
                Managers Only
              </Button>
            </div>

            <p className="text-sm text-muted-foreground">
              {attendeeIds.size} of {employees.length} selected — these employees can punch in during the meeting time
            </p>

            <ScrollArea className="h-[50vh] pr-4">
              <div className="space-y-2">
                {employees.map((employee) => (
                  <div
                    key={employee.id}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer"
                    onClick={() => toggleAttendee(employee.id)}
                  >
                    <Checkbox
                      checked={attendeeIds.has(employee.id)}
                      onCheckedChange={() => toggleAttendee(employee.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={employee.avatar_url || undefined} />
                      <AvatarFallback className="text-xs">
                        {getInitials(employee.full_name || "?")}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {employee.full_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {getRoleLabel(employee.role)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <div className="flex gap-2 pt-4 border-t">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                Save Attendees
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
