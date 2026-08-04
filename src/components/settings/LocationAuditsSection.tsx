import { useState, useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ClipboardCheck, Plus, Trash2, ExternalLink, FileText, Loader2, ChevronDown, ChevronRight, AlertTriangle, AlertCircle, Info, Sparkles, X, Check, Send } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { compressImage } from '@/utils/imageCompression';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

interface ItemCorrection {
  completed_by_name: string;
  completed_at: string;
}

interface FoodSafetyAudit {
  id: string;
  location_id: string;
  audit_url: string;
  audit_date: string;
  uploaded_by: string;
  notes: string | null;
  created_at: string;
  visit_score: string | null;
  manager_name: string | null;
  first_priority_items: string[] | null;
  second_priority_items: string[] | null;
  third_priority_items: string[] | null;
  first_priority_corrected: number[] | null;
  second_priority_corrected: number[] | null;
  third_priority_corrected: number[] | null;
  item_corrections: Record<string, ItemCorrection> | null;
  summary_extracted_at: string | null;
}

interface ManagerProfile {
  id: string;
  full_name: string | null;
  profile_photo_url: string | null;
}

interface SendTaskData {
  auditId: string;
  priority: 'first' | 'second' | 'third';
  itemIndex: number;
  itemText: string;
}

interface LocationAuditsSectionProps {
  locationId: string | undefined;
  locationName?: string;
}

export function LocationAuditsSection({ locationId, locationName }: LocationAuditsSectionProps) {
  const { user } = useAuth();
  const [audits, setAudits] = useState<FoodSafetyAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [auditUploadDialogOpen, setAuditUploadDialogOpen] = useState(false);
  const [auditFile, setAuditFile] = useState<File | null>(null);
  const [auditDate, setAuditDate] = useState("");
  const [auditNotes, setAuditNotes] = useState("");
  const [auditUploading, setAuditUploading] = useState(false);
  const [auditScanning, setAuditScanning] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [expandedAudits, setExpandedAudits] = useState<Set<string>>(new Set());
  const [extractingIds, setExtractingIds] = useState<Set<string>>(new Set());
  const [userName, setUserName] = useState<string>("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [auditToDelete, setAuditToDelete] = useState<string | null>(null);
  
  // Send task dialog state
  const [sendTaskDialogOpen, setSendTaskDialogOpen] = useState(false);
  const [sendTaskData, setSendTaskData] = useState<SendTaskData | null>(null);
  const [managers, setManagers] = useState<ManagerProfile[]>([]);
  const [selectedManagers, setSelectedManagers] = useState<Set<string>>(new Set());
  const [sendingTask, setSendingTask] = useState(false);
  
  // Track which audit items have active tasks assigned
  const [assignedItems, setAssignedItems] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (locationId) {
      fetchAudits();
    }
  }, [locationId]);

  // Fetch current user's name
  useEffect(() => {
    const fetchUserName = async () => {
      if (!user) return;
      const { data } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .single();
      if (data?.full_name) {
        const firstName = data.full_name.split(' ')[0];
        setUserName(firstName);
      }
    };
    fetchUserName();
  }, [user]);

  // Fetch managers at location for task assignment
  const fetchManagers = async () => {
    if (!locationId) return;
    
    try {
      // Get users with manager+ roles at this location
      const { data: userLocations } = await supabase
        .from('user_locations')
        .select('user_id')
        .eq('location_id', locationId);
      
      if (!userLocations) return;
      
      const userIds = userLocations.map(ul => ul.user_id);
      
      // Get users with manager+ roles
      const { data: managerRoles } = await supabase
        .from('user_roles')
        .select('user_id')
        .in('user_id', userIds)
        .in('role', ['admin', 'general_manager', 'shift_manager', 'shift_manager_in_training', 'manager']);
      
      if (!managerRoles) return;
      
      const managerIds = managerRoles.map(r => r.user_id);
      
      // Get profiles
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, profile_photo_url')
        .in('id', managerIds)
        .eq('is_active', true);
      
      setManagers(profiles || []);
    } catch (error) {
      console.error('Error fetching managers:', error);
    }
  };

  // Auto-scan unscanned audits
  useEffect(() => {
    const unscannedAudits = audits.filter(a => !a.summary_extracted_at && !extractingIds.has(a.id));
    if (unscannedAudits.length > 0) {
      // Scan one at a time to avoid rate limits
      extractAuditSummary(unscannedAudits[0]);
    }
  }, [audits]);

  const fetchAudits = async () => {
    if (!locationId) return;
    
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("food_safety_audits")
        .select("*")
        .eq("location_id", locationId)
        .order("audit_date", { ascending: false });

      if (error) throw error;
      setAudits((data as any) || []);
      
      // Fetch assigned items for all audits
      if (data && data.length > 0) {
        const auditIds = data.map(a => a.id);
        const { data: tasks } = await supabase
          .from('temporary_tasks')
          .select('audit_id, audit_priority_level, audit_item_index')
          .in('audit_id', auditIds)
          .is('completed_at', null)
          .eq('is_active', true);
        
        if (tasks) {
          const assigned = new Set(
            tasks.map(t => `${t.audit_id}_${t.audit_priority_level}_${t.audit_item_index}`)
          );
          setAssignedItems(assigned);
        }
      }
    } catch (error: any) {
      console.error("Error fetching audits:", error);
      toast.error("Failed to load audits");
    } finally {
      setLoading(false);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
    });
  };

  const handleScanAudit = async (file: File) => {
    const isImage = file.type.startsWith('image/');
    const isPdf = file.type === 'application/pdf';
    
    if (!isImage && !isPdf) return;

    setAuditScanning(true);
    try {
      const base64 = await fileToBase64(file);
      
      const { data, error } = await supabase.functions.invoke('ai-extraction-service?action=extract-audit-date', {
        body: { imageBase64: base64 }
      });

      if (error) throw error;

      if (data?.success && data?.audit_date) {
        setAuditDate(data.audit_date);
        toast.success(`Audit date detected: ${data.audit_date}`);
      } else {
        toast.info("Could not detect audit date", {
          description: "Please enter it manually"
        });
      }
    } catch (error: any) {
      console.error("Audit scan error:", error);
    } finally {
      setAuditScanning(false);
    }
  };

  const handleAuditFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setAuditFile(file);
    
    if (file && (file.type.startsWith('image/') || file.type === 'application/pdf')) {
      handleScanAudit(file);
    }
  };

  const extractAuditSummary = async (audit: FoodSafetyAudit, showToast = false) => {
    setExtractingIds(prev => new Set([...prev, audit.id]));
    try {
      // For PDFs and images, we need to fetch and convert to base64
      const response = await fetch(audit.audit_url);
      if (!response.ok) {
        throw new Error(`Failed to fetch document: ${response.status}`);
      }
      const blob = await response.blob();
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read file'));
      });

      const { data, error } = await supabase.functions.invoke('ai-extraction-service?action=extract-audit-summary', {
        body: { imageBase64: base64 }
      });

      if (error) throw error;

      if (data?.success) {
        // Update the audit in database
        const { error: updateError } = await supabase
          .from('food_safety_audits')
          .update({
            manager_name: data.manager_name,
            visit_score: data.visit_score,
            first_priority_items: data.first_priority_items,
            second_priority_items: data.second_priority_items,
            third_priority_items: data.third_priority_items,
            summary_extracted_at: new Date().toISOString()
          })
          .eq('id', audit.id);

        if (updateError) throw updateError;

        // Update local state immediately
        setAudits(prev => prev.map(a => 
          a.id === audit.id 
            ? { 
                ...a, 
                manager_name: data.manager_name,
                visit_score: data.visit_score,
                first_priority_items: data.first_priority_items,
                second_priority_items: data.second_priority_items,
                third_priority_items: data.third_priority_items,
                summary_extracted_at: new Date().toISOString()
              } 
            : a
        ));
        
        // Auto-expand the audit after extraction
        setExpandedAudits(prev => new Set([...prev, audit.id]));
        
        if (showToast) {
          toast.success('Audit scanned successfully');
        }
      } else {
        if (showToast) {
          toast.error('Could not extract audit data');
        }
      }
    } catch (error: any) {
      console.error('Extract summary error:', error);
      if (showToast) {
        toast.error(`Scan failed: ${error.message || 'Unknown error'}`);
      }
    } finally {
      setExtractingIds(prev => {
        const next = new Set(prev);
        next.delete(audit.id);
        return next;
      });
    }
  };

  const handleManualRescan = (audit: FoodSafetyAudit) => {
    extractAuditSummary(audit, true);
  };

  const handleAuditUpload = async () => {
    if (!user || !auditFile || !auditDate || !locationId) {
      toast.error("Please fill in all fields");
      return;
    }

    // Check for duplicate audit date
    const existingAudit = audits.find(a => a.audit_date === auditDate);
    if (existingAudit) {
      toast.error("An audit for this date already exists");
      return;
    }

    try {
      setAuditUploading(true);

      let fileToUpload: File | Blob = auditFile;
      let fileName = `${locationId}/${Date.now()}.${auditFile.name.split(".").pop()}`;
      
      if (auditFile.type.startsWith('image/')) {
        fileToUpload = await compressImage(auditFile, 1200, 1200, 0.8);
        fileName = `${locationId}/${Date.now()}.jpg`;
      }

      const { error: uploadError } = await supabase.storage
        .from("food-safety-audits")
        .upload(fileName, fileToUpload);

      if (uploadError) {
        toast.error(`File upload failed: ${uploadError.message}`);
        return;
      }

      const { data: { publicUrl } } = supabase.storage
        .from("food-safety-audits")
        .getPublicUrl(fileName);

      const { error: insertError } = await supabase
        .from("food_safety_audits")
        .insert({
          location_id: locationId,
          audit_url: publicUrl,
          audit_date: auditDate,
          uploaded_by: user.id,
          notes: auditNotes || null
        });

      if (insertError) {
        toast.error(`Database error: ${insertError.message}`);
        return;
      }

      toast.success("Food safety audit uploaded successfully!");
      setAuditUploadDialogOpen(false);
      setAuditFile(null);
      setAuditDate("");
      setAuditNotes("");
      fetchAudits();
    } catch (error: any) {
      toast.error(`Upload failed: ${error.message || "Unknown error"}`);
    } finally {
      setAuditUploading(false);
    }
  };

  const handleAuditDelete = async (auditId: string) => {
    try {
      const { error } = await supabase
        .from("food_safety_audits")
        .delete()
        .eq("id", auditId);

      if (error) throw error;

      toast.success("Audit deleted");
      setDeleteConfirmOpen(false);
      setAuditToDelete(null);
      fetchAudits();
    } catch (error: any) {
      toast.error("Failed to delete audit");
    }
  };

  const toggleExpanded = (auditId: string) => {
    setExpandedAudits(prev => {
      const next = new Set(prev);
      if (next.has(auditId)) {
        next.delete(auditId);
      } else {
        next.add(auditId);
      }
      return next;
    });
  };

  const hasSummary = (audit: FoodSafetyAudit) => {
    return audit.summary_extracted_at || 
           audit.visit_score || 
           (audit.first_priority_items && audit.first_priority_items.length > 0) ||
           (audit.second_priority_items && audit.second_priority_items.length > 0) ||
           (audit.third_priority_items && audit.third_priority_items.length > 0);
  };

  const toggleItemCorrected = async (
    auditId: string, 
    priority: 'first' | 'second' | 'third', 
    itemIndex: number
  ) => {
    const audit = audits.find(a => a.id === auditId);
    if (!audit) return;

    const columnName = `${priority}_priority_corrected` as const;
    const currentCorrected = audit[columnName] || [];
    const correctionKey = `${priority}_${itemIndex}`;
    const currentCorrections = audit.item_corrections || {};
    
    let newCorrected: number[];
    let newCorrections: Record<string, ItemCorrection>;
    
    if (currentCorrected.includes(itemIndex)) {
      // Uncorrecting - remove from both
      newCorrected = currentCorrected.filter(i => i !== itemIndex);
      newCorrections = { ...currentCorrections };
      delete newCorrections[correctionKey];
    } else {
      // Correcting - add to both with tracking info
      newCorrected = [...currentCorrected, itemIndex];
      newCorrections = {
        ...currentCorrections,
        [correctionKey]: {
          completed_by_name: userName || 'Unknown',
          completed_at: new Date().toISOString()
        }
      };
    }

    // Optimistic update
    setAudits(prev => prev.map(a => 
      a.id === auditId ? { ...a, [columnName]: newCorrected, item_corrections: newCorrections } : a
    ));

    const { error } = await supabase
      .from('food_safety_audits')
      .update({ [columnName]: newCorrected, item_corrections: newCorrections as any })
      .eq('id', auditId);

    if (error) {
      // Revert on error
      setAudits(prev => prev.map(a => 
        a.id === auditId ? { ...a, [columnName]: currentCorrected, item_corrections: currentCorrections } : a
      ));
      toast.error('Failed to update item');
    }
  };

  const openSendTaskDialog = (
    auditId: string,
    priority: 'first' | 'second' | 'third',
    itemIndex: number,
    itemText: string
  ) => {
    setSendTaskData({ auditId, priority, itemIndex, itemText });
    setSelectedManagers(new Set());
    fetchManagers();
    setSendTaskDialogOpen(true);
  };

  const handleSendTask = async () => {
    if (!sendTaskData || !user || !locationId || selectedManagers.size === 0) {
      toast.error('Please select at least one manager');
      return;
    }

    setSendingTask(true);
    try {
      // Create the temporary task
      const { data: task, error: taskError } = await supabase
        .from('temporary_tasks')
        .insert({
          location_id: locationId,
          created_by: user.id,
          title: `Audit Fix: ${sendTaskData.itemText.substring(0, 50)}${sendTaskData.itemText.length > 50 ? '...' : ''}`,
          description: sendTaskData.itemText,
          icon_name: 'ClipboardCheck',
          audit_id: sendTaskData.auditId,
          audit_item_index: sendTaskData.itemIndex,
          audit_priority_level: sendTaskData.priority,
          is_active: true
        })
        .select()
        .single();

      if (taskError) throw taskError;

      // Create assignments for each selected manager
      const assignments = Array.from(selectedManagers).map(managerId => ({
        task_id: task.id,
        user_id: managerId
      }));

      const { error: assignError } = await supabase
        .from('temporary_task_assignments')
        .insert(assignments);

      if (assignError) throw assignError;

      toast.success(`Task sent to ${selectedManagers.size} manager${selectedManagers.size > 1 ? 's' : ''}`);
      
      // Add to assigned items set
      setAssignedItems(prev => new Set([...prev, `${sendTaskData.auditId}_${sendTaskData.priority}_${sendTaskData.itemIndex}`]));
      
      setSendTaskDialogOpen(false);
      setSendTaskData(null);
      setSelectedManagers(new Set());
    } catch (error: any) {
      console.error('Error sending task:', error);
      toast.error('Failed to send task');
    } finally {
      setSendingTask(false);
    }
  };

  const toggleManagerSelection = (managerId: string) => {
    setSelectedManagers(prev => {
      const next = new Set(prev);
      if (next.has(managerId)) {
        next.delete(managerId);
      } else {
        next.add(managerId);
      }
      return next;
    });
  };

  const PriorityItem = ({ 
    audit, 
    priority, 
    item, 
    index 
  }: { 
    audit: FoodSafetyAudit; 
    priority: 'first' | 'second' | 'third'; 
    item: string; 
    index: number;
  }) => {
    const correctedArray = audit[`${priority}_priority_corrected`] || [];
    const correctionKey = `${priority}_${index}`;
    const correction = audit.item_corrections?.[correctionKey];
    // Check both the array and item_corrections (trigger updates item_corrections)
    const isCorrected = correctedArray.includes(index) || !!correction;
    const isAssigned = assignedItems.has(`${audit.id}_${priority}_${index}`);
    
    return (
      <li 
        className={cn(
          "text-xs flex flex-col gap-0.5 py-1.5 px-2 rounded-md transition-colors",
          isCorrected 
            ? "bg-green-500/20 text-green-700 dark:text-green-400" 
            : isAssigned
              ? "bg-amber-500/10"
              : "hover:bg-muted/50"
        )}
      >
        <div className="flex items-start gap-2">
          <button 
            className={cn(
              "flex-shrink-0 mt-0.5 w-4 h-4 rounded-full flex items-center justify-center transition-colors cursor-pointer",
              isCorrected 
                ? "bg-green-500 text-white" 
                : "bg-muted-foreground/20 text-muted-foreground hover:bg-muted-foreground/30"
            )}
            onClick={() => toggleItemCorrected(audit.id, priority, index)}
          >
            {isCorrected ? (
              <Check className="w-3 h-3" />
            ) : (
              <X className="w-3 h-3" />
            )}
          </button>
          <span 
            className={cn("flex-1 cursor-pointer", isCorrected && "line-through opacity-70")}
            onClick={() => toggleItemCorrected(audit.id, priority, index)}
          >
            {item}
          </span>
          {!isCorrected && (
            isAssigned ? (
              <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600 dark:text-amber-400">
                Assigned
              </span>
            ) : (
              <button
                className="flex-shrink-0 p-1 rounded hover:bg-primary/20 text-primary transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  openSendTaskDialog(audit.id, priority, index, item);
                }}
                title="Send as task"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            )
          )}
        </div>
        {isCorrected && correction && (
          <div className="ml-6 text-[10px] text-green-600 dark:text-green-500 italic">
            Completed by {correction.completed_by_name} • {format(new Date(correction.completed_at), "MMM d, yyyy")}
          </div>
        )}
      </li>
    );
  };

  if (loading) {
    return (
      <div className="py-8 text-center text-muted-foreground text-sm">
        Loading audits...
      </div>
    );
  }

  return (
    <>
      <div className="py-3 px-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-medium">Food Safety Audits</p>
              <p className="text-xs text-muted-foreground">
                Location-level audit documents{locationName ? ` for ${locationName}` : ''}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => setAuditUploadDialogOpen(true)}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Audit
          </Button>
        </div>
      </div>
      <div className="pt-0 px-0 pb-1">
          {audits.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No audits uploaded yet
            </p>
          ) : (
            <div className="space-y-2">
              {audits.map((audit) => {
                const isPdf = audit.audit_url?.toLowerCase().endsWith('.pdf');
                const auditDateDisplay = audit.audit_date 
                  ? format(new Date(audit.audit_date + 'T12:00:00'), "MMM d, yyyy") 
                  : 'Unknown';
                const isExpanded = expandedAudits.has(audit.id);
                const hasData = hasSummary(audit);
                const isExtracting = extractingIds.has(audit.id);

                return (
                  <Collapsible key={audit.id} open={isExpanded} onOpenChange={() => toggleExpanded(audit.id)}>
                    <div className="border rounded-md bg-muted/30 overflow-hidden">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-3">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setPreviewUrl(audit.audit_url);
                              setPreviewOpen(true);
                            }}
                            className="w-10 h-10 sm:w-12 sm:h-12 flex-shrink-0 border rounded overflow-hidden bg-muted cursor-pointer hover:opacity-80 flex items-center justify-center"
                          >
                            {isPdf ? (
                              <FileText className="w-5 h-5 sm:w-6 sm:h-6 text-muted-foreground" />
                            ) : (
                              <img 
                                src={audit.audit_url} 
                                alt="Food Safety Audit"
                                className="w-full h-full object-cover"
                              />
                            )}
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium whitespace-nowrap">
                                {auditDateDisplay}
                              </span>
                              {audit.visit_score && (
                                <Badge variant="secondary" className="text-xs">
                                  {audit.visit_score}
                                </Badge>
                              )}
                            </div>
                            {audit.manager_name && (
                              <p className="text-xs text-muted-foreground truncate">
                                {audit.manager_name}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-1 flex-shrink-0 items-center justify-end">
                          {!hasData && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleManualRescan(audit);
                              }}
                              disabled={isExtracting}
                            >
                              {isExtracting ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Sparkles className="w-3 h-3" />
                              )}
                              <span className="hidden sm:inline">{isExtracting ? 'Scanning...' : 'Scan'}</span>
                            </Button>
                          )}
                          {hasData && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs gap-1 px-2"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleManualRescan(audit);
                              }}
                              disabled={isExtracting}
                            >
                              {isExtracting ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Sparkles className="w-3 h-3" />
                              )}
                            </Button>
                          )}
                          {hasData && (
                            <CollapsibleTrigger asChild>
                              <Button
                                size="icon"
                                variant="default"
                                className="h-7 w-7 sm:h-8 sm:w-8 bg-primary hover:bg-primary/80"
                              >
                                {isExpanded ? (
                                  <ChevronDown className="w-4 h-4 sm:w-5 sm:h-5 text-primary-foreground" />
                                ) : (
                                  <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 text-primary-foreground" />
                                )}
                              </Button>
                            </CollapsibleTrigger>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              setAuditToDelete(audit.id);
                              setDeleteConfirmOpen(true);
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                      
                      <CollapsibleContent>
                        <div className="px-3 pb-3 pt-3 space-y-3 border-t bg-background/50">
                          {audit.first_priority_items && audit.first_priority_items.length > 0 && (
                            <div>
                              <div className="flex items-center gap-1.5 mb-1.5">
                                <AlertTriangle className="w-4 h-4 text-destructive" />
                                <span className="text-xs font-medium text-destructive">First Priority ({audit.first_priority_items.length})</span>
                              </div>
                              <ul className="space-y-0.5">
                                {audit.first_priority_items.map((item, idx) => (
                                  <PriorityItem key={idx} audit={audit} priority="first" item={item} index={idx} />
                                ))}
                              </ul>
                            </div>
                          )}
                          
                          {audit.second_priority_items && audit.second_priority_items.length > 0 && (
                            <div>
                              <div className="flex items-center gap-1.5 mb-1.5">
                                <AlertCircle className="w-4 h-4 text-amber-500" />
                                <span className="text-xs font-medium text-amber-500">Second Priority ({audit.second_priority_items.length})</span>
                              </div>
                              <ul className="space-y-0.5">
                                {audit.second_priority_items.map((item, idx) => (
                                  <PriorityItem key={idx} audit={audit} priority="second" item={item} index={idx} />
                                ))}
                              </ul>
                            </div>
                          )}
                          
                          {audit.third_priority_items && audit.third_priority_items.length > 0 && (
                            <div>
                              <div className="flex items-center gap-1.5 mb-1.5">
                                <Info className="w-4 h-4 text-blue-500" />
                                <span className="text-xs font-medium text-blue-500">Third Priority ({audit.third_priority_items.length})</span>
                              </div>
                              <ul className="space-y-0.5">
                                {audit.third_priority_items.map((item, idx) => (
                                  <PriorityItem key={idx} audit={audit} priority="third" item={item} index={idx} />
                                ))}
                              </ul>
                            </div>
                          )}

                          {hasData && !audit.visit_score && 
                           (!audit.first_priority_items || audit.first_priority_items.length === 0) &&
                           (!audit.second_priority_items || audit.second_priority_items.length === 0) &&
                           (!audit.third_priority_items || audit.third_priority_items.length === 0) && (
                            <p className="text-xs text-muted-foreground pt-2">No priority items found in this audit.</p>
                          )}
                          
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1 mt-2"
                            onClick={() => extractAuditSummary(audit)}
                            disabled={isExtracting}
                          >
                            {isExtracting ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Sparkles className="w-3 h-3" />
                            )}
                            Re-scan with Croo AI
                          </Button>
                        </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                );
              })}
            </div>
          )}
      </div>

      {/* Audit Upload Dialog */}
      <Dialog open={auditUploadDialogOpen} onOpenChange={(open) => {
        setAuditUploadDialogOpen(open);
        if (!open) {
          setAuditFile(null);
          setAuditDate("");
          setAuditNotes("");
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload Food Safety Audit</DialogTitle>
            <DialogDescription>
              Upload a food safety audit document{locationName ? ` for ${locationName}` : ''}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Audit File</Label>
              <Input
                type="file"
                accept="image/*,.pdf"
                onChange={handleAuditFileChange}
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label>Audit Date (look for "Start" date)</Label>
                {auditScanning && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Scanning...
                  </span>
                )}
              </div>
              <Input
                type="date"
                value={auditDate}
                onChange={(e) => setAuditDate(e.target.value)}
              />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Input
                type="text"
                value={auditNotes}
                onChange={(e) => setAuditNotes(e.target.value)}
                placeholder="e.g., Annual inspection"
              />
            </div>
            <Button onClick={handleAuditUpload} disabled={auditUploading} className="w-full">
              {auditUploading ? "Uploading..." : "Upload Audit"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl h-[80vh] p-0 flex flex-col">
          <DialogHeader className="p-4 pb-2 flex-shrink-0">
            <div className="flex items-center justify-between">
              <DialogTitle>Document Preview</DialogTitle>
              {previewUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                  className="mr-8"
                >
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Open in New Tab
                  </a>
                </Button>
              )}
            </div>
          </DialogHeader>
          {previewUrl && (
            <div className="flex-1 w-full min-h-0 px-4 pb-4">
              {previewUrl.toLowerCase().endsWith('.pdf') ? (
                <object
                  data={previewUrl}
                  type="application/pdf"
                  className="w-full h-full rounded-md border"
                >
                  <div className="w-full h-full flex flex-col items-center justify-center gap-4 bg-muted rounded-md border">
                    <p className="text-muted-foreground text-center">
                      Unable to display PDF in browser.
                    </p>
                    <Button asChild>
                      <a
                        href={previewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open PDF in New Tab
                      </a>
                    </Button>
                  </div>
                </object>
              ) : (
                <img
                  src={previewUrl}
                  alt="Document Preview"
                  className="w-full h-full object-contain rounded-md"
                />
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Audit</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this audit? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setAuditToDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => auditToDelete && handleAuditDelete(auditToDelete)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Send Task Dialog */}
      <Dialog open={sendTaskDialogOpen} onOpenChange={(open) => {
        setSendTaskDialogOpen(open);
        if (!open) {
          setSendTaskData(null);
          setSelectedManagers(new Set());
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send as Task</DialogTitle>
            <DialogDescription>
              Select managers to assign this audit item as a task. When completed, the item will be automatically marked as corrected.
            </DialogDescription>
          </DialogHeader>
          
          {sendTaskData && (
            <div className="space-y-4">
              <div className="p-3 bg-muted rounded-md">
                <p className="text-sm font-medium mb-1">Task Item:</p>
                <p className="text-sm text-muted-foreground">{sendTaskData.itemText}</p>
              </div>

              <div>
                <Label className="text-sm font-medium mb-2 block">Assign to Managers</Label>
                {managers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Loading managers...</p>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {managers.map(manager => (
                      <div
                        key={manager.id}
                        className={cn(
                          "flex items-center gap-3 p-2 rounded-md cursor-pointer transition-colors",
                          selectedManagers.has(manager.id)
                            ? "bg-primary/10 border border-primary/30"
                            : "hover:bg-muted"
                        )}
                        onClick={() => toggleManagerSelection(manager.id)}
                      >
                        <Checkbox
                          checked={selectedManagers.has(manager.id)}
                          onCheckedChange={() => toggleManagerSelection(manager.id)}
                        />
                        {manager.profile_photo_url ? (
                          <img
                            src={manager.profile_photo_url}
                            alt={manager.full_name || 'Manager'}
                            className="w-8 h-8 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground text-xs font-medium">
                            {manager.full_name?.charAt(0) || '?'}
                          </div>
                        )}
                        <span className="text-sm">{manager.full_name || 'Unknown'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-2 justify-end pt-2">
                <Button
                  variant="outline"
                  onClick={() => setSendTaskDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSendTask}
                  disabled={sendingTask || selectedManagers.size === 0}
                >
                  {sendingTask ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4 mr-2" />
                      Send Task ({selectedManagers.size})
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
