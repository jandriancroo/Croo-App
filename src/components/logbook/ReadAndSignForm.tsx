import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Calendar, Users, Paperclip, X, FileText, Image as ImageIcon, Upload, Hammer } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { toISOStringInTimezone, getDateInTimezone, DEFAULT_TIMEZONE } from "@/utils/timezoneUtils";

interface Attachment {
  url: string;
  name: string;
  type: string;
  size: number;
}
interface DocumentItem {
  id: string;
  content: string;
  children: DocumentItem[];
}

interface ReadAndSignFormProps {
  locationId: string;
  employees: { id: string; full_name: string; profile_photo_url?: string }[];
  onSuccess: () => void;
  onCancel: () => void;
}

type DocumentMode = "build" | "upload";

export function ReadAndSignForm({ locationId, employees, onSuccess, onCancel }: ReadAndSignFormProps) {
  const { user } = useAuth();
  const [mode, setMode] = useState<DocumentMode>("build");
  const [title, setTitle] = useState("");
  const [items, setItems] = useState<DocumentItem[]>([{ id: crypto.randomUUID(), content: "", children: [] }]);
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scheduleDate, setScheduleDate] = useState<Date | undefined>(undefined);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const uploadFileInputRef = useRef<HTMLInputElement>(null);
  const buildFileInputRef = useRef<HTMLInputElement>(null);
  const [scheduleHour, setScheduleHour] = useState<string>("09");
  const [scheduleMinute, setScheduleMinute] = useState<string>("00");
  const [scheduleAmPm, setScheduleAmPm] = useState<"AM" | "PM">("AM");

  // Fetch employee roles
  const { data: employeeRoles = {} } = useQuery({
    queryKey: ["employee-roles", employees.map(e => e.id)],
    queryFn: async () => {
      const employeeIds = employees.map(e => e.id);
      if (employeeIds.length === 0) return {};
      
      const { data, error } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("user_id", employeeIds);
      
      if (error) throw error;
      
      // Create a map of user_id -> roles[]
      const roleMap: Record<string, string[]> = {};
      data?.forEach(row => {
        if (!roleMap[row.user_id]) {
          roleMap[row.user_id] = [];
        }
        roleMap[row.user_id].push(row.role);
      });
      return roleMap;
    },
    enabled: employees.length > 0,
  });

  // Get employees by role
  const getEmployeesByRole = (roleId: string) => {
    return employees.filter(emp => {
      const roles = employeeRoles[emp.id] || [];
      return roles.includes(roleId);
    });
  };

  const roles = [
    { id: "admin", label: "Admins", count: getEmployeesByRole("admin").length },
    { id: "manager", label: "Managers", count: getEmployeesByRole("manager").length },
    { id: "shift_manager", label: "Shift Managers", count: getEmployeesByRole("shift_manager").length },
    { id: "shift_manager_in_training", label: "Shift Managers in Training", count: getEmployeesByRole("shift_manager_in_training").length },
    { id: "team_member", label: "Team Members", count: getEmployeesByRole("team_member").length },
  ];

  const addItem = () => {
    setItems([...items, { id: crypto.randomUUID(), content: "", children: [] }]);
  };

  const addSubItem = (parentId: string) => {
    setItems(items.map(item => {
      if (item.id === parentId) {
        return {
          ...item,
          children: [...item.children, { id: crypto.randomUUID(), content: "", children: [] }]
        };
      }
      return item;
    }));
  };

  const updateItem = (id: string, content: string, parentId?: string) => {
    if (parentId) {
      setItems(items.map(item => {
        if (item.id === parentId) {
          return {
            ...item,
            children: item.children.map(child => 
              child.id === id ? { ...child, content } : child
            )
          };
        }
        return item;
      }));
    } else {
      setItems(items.map(item => item.id === id ? { ...item, content } : item));
    }
  };

  const removeItem = (id: string, parentId?: string) => {
    if (parentId) {
      setItems(items.map(item => {
        if (item.id === parentId) {
          return {
            ...item,
            children: item.children.filter(child => child.id !== id)
          };
        }
        return item;
      }));
    } else {
      if (items.length > 1) {
        setItems(items.filter(item => item.id !== id));
      }
    }
  };

  const handleSelectAll = (checked: boolean) => {
    setSelectAll(checked);
    if (checked) {
      setSelectedEmployees(employees.map(e => e.id));
    } else {
      setSelectedEmployees([]);
    }
  };

  const toggleEmployee = (employeeId: string) => {
    if (selectedEmployees.includes(employeeId)) {
      setSelectedEmployees(selectedEmployees.filter(id => id !== employeeId));
      setSelectAll(false);
    } else {
      const newSelected = [...selectedEmployees, employeeId];
      setSelectedEmployees(newSelected);
      if (newSelected.length === employees.length) {
        setSelectAll(true);
      }
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploadingFile(true);
    try {
      for (const file of Array.from(files)) {
        // Check file size (max 10MB)
        if (file.size > 10 * 1024 * 1024) {
          toast.error(`File "${file.name}" is too large (max 10MB)`);
          continue;
        }

        // Upload to storage
        const fileName = `read-and-sign-attachments/${locationId}/${Date.now()}-${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from("logbook-attachments")
          .upload(fileName, file);

        if (uploadError) {
          console.error("Upload error:", uploadError);
          toast.error(`Failed to upload "${file.name}"`);
          continue;
        }

        const { data: { publicUrl } } = supabase.storage
          .from("logbook-attachments")
          .getPublicUrl(fileName);

        setAttachments(prev => [...prev, {
          url: publicUrl,
          name: file.name,
          type: file.type,
          size: file.size,
        }]);
      }
      toast.success("File(s) uploaded");
    } catch (error: any) {
      console.error("Error uploading file:", error);
      toast.error("Failed to upload file");
    } finally {
      setUploadingFile(false);
      if (uploadFileInputRef.current) {
        uploadFileInputRef.current.value = "";
      }
      if (buildFileInputRef.current) {
        buildFileInputRef.current.value = "";
      }
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const getFileIcon = (type: string) => {
    if (type.startsWith("image/")) return <ImageIcon className="h-4 w-4" />;
    return <FileText className="h-4 w-4" />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error("Please enter a title");
      return;
    }

    const validItems = items.filter(item => item.content.trim());
    
    // Validation depends on mode
    if (mode === "build") {
      if (validItems.length === 0) {
        toast.error("Please add at least one item");
        return;
      }
    } else {
      // Upload mode - require at least one attachment
      if (attachments.length === 0) {
        toast.error("Please upload at least one document");
        return;
      }
    }

    if (selectedEmployees.length === 0) {
      toast.error("Please select at least one employee");
      return;
    }

    setSaving(true);
    try {
      // Always use numbered list style
      const dbListStyle = 'number';

      // Calculate scheduled_at timestamp if date is set
      // Use location timezone (America/Los_Angeles) to avoid timezone drift
      let scheduledAt: string | null = null;
      if (scheduleDate) {
        // Get the date string in location timezone
        const dateStr = getDateInTimezone(scheduleDate, DEFAULT_TIMEZONE);
        // Convert hour to 24-hour format
        let hour = parseInt(scheduleHour, 10);
        if (scheduleAmPm === "PM" && hour !== 12) hour += 12;
        if (scheduleAmPm === "AM" && hour === 12) hour = 0;
        const timeStr = `${hour.toString().padStart(2, '0')}:${scheduleMinute}`;
        // Create ISO string anchored to location timezone
        scheduledAt = toISOStringInTimezone(dateStr, timeStr, DEFAULT_TIMEZONE);
      }

      // Create document
      const { data: doc, error: docError } = await supabase
        .from("read_and_sign_documents")
        .insert({
          title: title.trim(),
          list_style: dbListStyle,
          location_id: locationId,
          created_by: user?.id,
          scheduled_at: scheduledAt,
          attachments: attachments.length > 0 ? JSON.parse(JSON.stringify(attachments)) : null,
        } as any)
        .select()
        .single();

      if (docError) throw docError;

      // First insert parent items
      const parentItems = validItems.filter(item => item.content.trim()).map((item, idx) => ({
        document_id: doc.id,
        parent_id: null,
        content: item.content,
        order_index: idx,
      }));

      const { data: insertedParents, error: parentError } = await supabase
        .from("read_and_sign_items")
        .insert(parentItems)
        .select();

      if (parentError) throw parentError;

      // Now insert children with parent_id
      const childItems: { document_id: string; parent_id: string; content: string; order_index: number }[] = [];
      validItems.forEach((item, parentIdx) => {
        const parentDbRow = insertedParents?.find((_, idx) => idx === parentIdx);
        if (parentDbRow) {
          item.children.filter(c => c.content.trim()).forEach((child, childIdx) => {
            childItems.push({
              document_id: doc.id,
              parent_id: parentDbRow.id,
              content: child.content,
              order_index: childIdx,
            });
          });
        }
      });

      if (childItems.length > 0) {
        const { error: childError } = await supabase
          .from("read_and_sign_items")
          .insert(childItems);

        if (childError) throw childError;
      }

      // Create assignments for selected employees
      const assignments = selectedEmployees.map(employeeId => ({
        document_id: doc.id,
        employee_id: employeeId,
      }));

      const { error: assignError } = await supabase
        .from("read_and_sign_assignments")
        .insert(assignments);

      if (assignError) throw assignError;

      toast.success(`Document sent to ${selectedEmployees.length} employee(s)`);
      onSuccess();
    } catch (error: any) {
      console.error("Error creating read & sign document:", error);
      toast.error(error.message || "Failed to create document");
    } finally {
      setSaving(false);
    }
  };

  const toggleRole = (roleId: string) => {
    const employeesWithRole = getEmployeesByRole(roleId);
    const employeeIds = employeesWithRole.map(e => e.id);
    
    if (selectedRoles.includes(roleId)) {
      // Deselecting role - remove employees that only have this role selected
      setSelectedRoles(selectedRoles.filter(id => id !== roleId));
      
      // Remove employees unless they're covered by another selected role
      const remainingRoles = selectedRoles.filter(id => id !== roleId);
      const stillCoveredEmployees = new Set<string>();
      remainingRoles.forEach(role => {
        getEmployeesByRole(role).forEach(emp => stillCoveredEmployees.add(emp.id));
      });
      
      setSelectedEmployees(prev => prev.filter(id => 
        stillCoveredEmployees.has(id) || !employeeIds.includes(id)
      ));
    } else {
      // Selecting role - add all employees with this role
      setSelectedRoles([...selectedRoles, roleId]);
      setSelectedEmployees(prev => {
        const newSelection = new Set([...prev, ...employeeIds]);
        return Array.from(newSelection);
      });
    }
    
    // Update selectAll state
    const allEmployeeIds = new Set(employees.map(e => e.id));
    const newSelected = selectedRoles.includes(roleId)
      ? selectedEmployees.filter(id => !employeeIds.includes(id) || employeeIds.some(eId => selectedRoles.filter(r => r !== roleId).some(r => getEmployeesByRole(r).map(e => e.id).includes(eId))))
      : [...new Set([...selectedEmployees, ...employeeIds])];
    setSelectAll(newSelected.length === employees.length);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 overflow-y-auto pr-3 pb-4">
        <div className="space-y-6">
        {/* Mode Selector */}
        <div className="flex gap-2 p-1 bg-muted rounded-lg">
          <button
            type="button"
            onClick={() => setMode("build")}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
              mode === "build"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Hammer className="h-4 w-4" />
            Build
          </button>
          <button
            type="button"
            onClick={() => setMode("upload")}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
              mode === "upload"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Upload className="h-4 w-4" />
            Upload
          </button>
        </div>

        {/* Title */}
        <div className="space-y-2">
          <Label>Document Title</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., New Cleaning Procedures"
          />
        </div>

        {/* Build Mode - Items */}
        {mode === "build" && (
          <div className="space-y-4">
            <Label>Document Items</Label>
            {items.map((item, index) => (
              <div key={item.id} className="space-y-2 bg-muted/30 rounded-lg p-3">
                {/* Item header with number and delete */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Item {index + 1}</span>
                  {items.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeItem(item.id)}
                      className="text-destructive hover:text-destructive h-8 w-8 p-0"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                
                {/* Main text area - auto-expanding */}
                <Textarea
                  value={item.content}
                  onChange={(e) => {
                    updateItem(item.id, e.target.value);
                    // Auto-expand textarea
                    e.target.style.height = 'auto';
                    e.target.style.height = e.target.scrollHeight + 'px';
                  }}
                  placeholder="Enter item text..."
                  className="w-full min-h-[80px] resize-none overflow-hidden"
                  style={{ height: 'auto' }}
                  onFocus={(e) => {
                    e.target.style.height = 'auto';
                    e.target.style.height = e.target.scrollHeight + 'px';
                  }}
                />

                {/* Sub-items */}
                {item.children.length > 0 && (
                  <div className="space-y-2 border-l-2 border-primary/30 pl-3 ml-2">
                    {item.children.map((child, childIndex) => (
                      <div key={child.id} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">
                            {String.fromCharCode(97 + childIndex)}.
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeItem(child.id, item.id)}
                            className="text-destructive hover:text-destructive h-6 w-6 p-0"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                        <Textarea
                          value={child.content}
                          onChange={(e) => {
                            updateItem(child.id, e.target.value, item.id);
                            e.target.style.height = 'auto';
                            e.target.style.height = e.target.scrollHeight + 'px';
                          }}
                          placeholder="Sub-item text..."
                          className="w-full min-h-[60px] resize-none overflow-hidden text-sm"
                          onFocus={(e) => {
                            e.target.style.height = 'auto';
                            e.target.style.height = e.target.scrollHeight + 'px';
                          }}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* Add sub-item button */}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => addSubItem(item.id)}
                  className="text-xs text-muted-foreground h-8"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add sub-item
                </Button>
              </div>
            ))}
            
            {/* Add new item button */}
            <Button type="button" variant="outline" onClick={addItem} className="w-full">
              <Plus className="h-4 w-4 mr-2" />
              Add Item
            </Button>
          </div>
        )}

        {/* Upload Mode - File Upload for Document */}
        {mode === "upload" && (
          <div className="space-y-3">
            <Label>Upload Document</Label>
            <p className="text-xs text-muted-foreground">
              Upload a PDF or document file. Employees will need to view/download and sign to acknowledge.
            </p>
            {attachments.length === 0 ? (
              <div 
                className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => uploadFileInputRef.current?.click()}
              >
                <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                <p className="text-sm font-medium">Click to upload document</p>
                <p className="text-xs text-muted-foreground mt-1">PDF, DOC, DOCX, or images (max 10MB)</p>
              </div>
            ) : (
              <div className="space-y-2">
                {attachments.map((attachment, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg"
                  >
                    {getFileIcon(attachment.type)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{attachment.name}</p>
                      <p className="text-xs text-muted-foreground">{formatFileSize(attachment.size)}</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeAttachment(index)}
                      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => uploadFileInputRef.current?.click()}
                  disabled={uploadingFile}
                >
                  {uploadingFile ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4 mr-2" />
                  )}
                  Add another file
                </Button>
              </div>
            )}
            {/* Hidden file input for Upload mode */}
            <input
              ref={uploadFileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp"
              multiple
              onChange={handleFileUpload}
            />
          </div>
        )}

        {/* Attachments Section - Only show in Build mode */}
        {mode === "build" && (
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <Paperclip className="h-4 w-4" />
              Attachments (optional)
            </Label>
            <p className="text-xs text-muted-foreground">
              Attach PDFs, images, or other files that employees must view before signing.
            </p>
            
            {/* Hidden file input for Build mode */}
            <input
              ref={buildFileInputRef}
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp"
              onChange={handleFileUpload}
              className="hidden"
            />
            
            {/* Upload button */}
            <Button
              type="button"
              variant="outline"
              onClick={() => buildFileInputRef.current?.click()}
              disabled={uploadingFile}
              className="w-full"
            >
              {uploadingFile ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Attachment
                </>
              )}
            </Button>
            
            {/* Attachment list */}
            {attachments.length > 0 && (
              <div className="space-y-2">
                {attachments.map((attachment, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg"
                  >
                    {getFileIcon(attachment.type)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{attachment.name}</p>
                      <p className="text-xs text-muted-foreground">{formatFileSize(attachment.size)}</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeAttachment(index)}
                      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Schedule Date & Time (optional) */}
        <div className="space-y-3">
          <Label className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Schedule (optional)
          </Label>
          <p className="text-xs text-muted-foreground">
            Set a future date and time for this document to appear. Leave empty to send immediately.
          </p>
          
          {/* Date Selector */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start text-left font-normal">
                  {scheduleDate 
                    ? format(scheduleDate, "EEEE, MMMM d, yyyy")
                    : "Send immediately"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <CalendarPicker
                  mode="single"
                  selected={scheduleDate}
                  onSelect={setScheduleDate}
                  disabled={(date) => date < new Date()}
                  initialFocus
                />
                {scheduleDate && (
                  <div className="p-2 border-t">
                    <Button variant="ghost" size="sm" onClick={() => setScheduleDate(undefined)} className="w-full">
                      Clear - Send Immediately
                    </Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          </div>

          {/* Time Selector - only show if date is selected */}
          {scheduleDate && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Time</Label>
              <div className="flex items-center gap-2">
                <Select value={scheduleHour} onValueChange={setScheduleHour}>
                  <SelectTrigger className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((h) => (
                      <SelectItem key={h} value={h}>{h}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-muted-foreground">:</span>
                <Select value={scheduleMinute} onValueChange={setScheduleMinute}>
                  <SelectTrigger className="w-[80px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["00", "15", "30", "45"].map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={scheduleAmPm} onValueChange={(v) => setScheduleAmPm(v as "AM" | "PM")}>
                  <SelectTrigger className="w-[80px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AM">AM</SelectItem>
                    <SelectItem value="PM">PM</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>

        {/* Role Selection */}
        <div className="space-y-3">
          <Label className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Assign by Role
          </Label>
          <div className="grid grid-cols-2 gap-2">
            {roles.filter(role => role.count > 0).map((role) => (
              <div 
                key={role.id} 
                className={`flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors ${
                  selectedRoles.includes(role.id) ? 'bg-primary/10 border-primary' : 'hover:bg-muted'
                }`}
                onClick={() => toggleRole(role.id)}
              >
                <Checkbox
                  id={`role-${role.id}`}
                  checked={selectedRoles.includes(role.id)}
                  onCheckedChange={() => toggleRole(role.id)}
                />
                <label htmlFor={`role-${role.id}`} className="text-sm cursor-pointer flex-1">
                  {role.label}
                  <span className="text-muted-foreground ml-1">({role.count})</span>
                </label>
              </div>
            ))}
          </div>
          {roles.every(role => role.count === 0) && (
            <p className="text-sm text-muted-foreground">No role data available</p>
          )}
        </div>

        {/* Employee Selection */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Or Select Individual Employees</Label>
            <div className="flex items-center gap-2">
              <Checkbox
                id="select-all"
                checked={selectAll}
                onCheckedChange={handleSelectAll}
              />
              <label htmlFor="select-all" className="text-sm text-muted-foreground cursor-pointer">
                Select All ({employees.length})
              </label>
            </div>
          </div>
          {employees.length > 0 ? (
            <div className="grid grid-cols-1 gap-2 max-h-[200px] overflow-y-auto border rounded-lg p-3">
              {employees.map((employee) => (
                <div key={employee.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`emp-${employee.id}`}
                    checked={selectedEmployees.includes(employee.id)}
                    onCheckedChange={() => toggleEmployee(employee.id)}
                  />
                  <label
                    htmlFor={`emp-${employee.id}`}
                    className="text-sm cursor-pointer truncate"
                  >
                    {employee.full_name || "Unknown"}
                  </label>
                </div>
              ))}
            </div>
          ) : (
            <div className="border rounded-lg p-4 text-center text-muted-foreground text-sm">
              No employees found at this location
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {selectedEmployees.length} employee(s) selected
            {selectedRoles.length > 0 && ` + ${selectedRoles.length} role(s)`}
          </p>
        </div>
        </div>
      </div>

      {/* Actions - pinned at bottom */}
      <div className="flex-shrink-0 flex gap-2 pt-4 pb-safe bg-background border-t">
        <Button variant="outline" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={saving} className="flex-1">
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Sending...
            </>
          ) : scheduleDate ? (
            `Schedule for ${format(scheduleDate, "MMM d")} ${scheduleHour}:${scheduleMinute} ${scheduleAmPm}`
          ) : (
            "Send to Employees"
          )}
        </Button>
      </div>
    </div>
  );
}
