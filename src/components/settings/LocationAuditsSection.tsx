import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ClipboardCheck, Plus, Trash2, ExternalLink, FileText, Loader2, ChevronDown, ChevronRight, AlertTriangle, AlertCircle, Info, Sparkles, X, Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { compressImage } from '@/utils/imageCompression';
import { Badge } from '@/components/ui/badge';
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
      
      const { data, error } = await supabase.functions.invoke('extract-audit-date', {
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

  const extractAuditSummary = async (audit: FoodSafetyAudit) => {
    setExtractingIds(prev => new Set([...prev, audit.id]));
    try {
      // For PDFs, we need to fetch and convert to base64
      const response = await fetch(audit.audit_url);
      const blob = await response.blob();
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
      });

      const { data, error } = await supabase.functions.invoke('extract-audit-summary', {
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
      }
    } catch (error: any) {
      console.error('Extract summary error:', error);
    } finally {
      setExtractingIds(prev => {
        const next = new Set(prev);
        next.delete(audit.id);
        return next;
      });
    }
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
    if (!confirm("Are you sure you want to delete this audit?")) return;

    try {
      const { error } = await supabase
        .from("food_safety_audits")
        .delete()
        .eq("id", auditId);

      if (error) throw error;

      toast.success("Audit deleted");
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
    const isCorrected = correctedArray.includes(index);
    const correctionKey = `${priority}_${index}`;
    const correction = audit.item_corrections?.[correctionKey];
    
    return (
      <li 
        className={cn(
          "text-xs flex flex-col gap-0.5 py-1.5 px-2 rounded-md transition-colors cursor-pointer",
          isCorrected 
            ? "bg-green-500/20 text-green-700 dark:text-green-400" 
            : "hover:bg-muted/50"
        )}
        onClick={() => toggleItemCorrected(audit.id, priority, index)}
      >
        <div className="flex items-start gap-2">
          <button 
            className={cn(
              "flex-shrink-0 mt-0.5 w-4 h-4 rounded-full flex items-center justify-center transition-colors",
              isCorrected 
                ? "bg-green-500 text-white" 
                : "bg-muted-foreground/20 text-muted-foreground hover:bg-muted-foreground/30"
            )}
          >
            {isCorrected ? (
              <Check className="w-3 h-3" />
            ) : (
              <X className="w-3 h-3" />
            )}
          </button>
          <span className={cn(isCorrected && "line-through opacity-70")}>{item}</span>
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
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Loading audits...
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="py-3 px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-primary" />
              <div>
                <CardTitle className="text-base">Food Safety Audits</CardTitle>
                <CardDescription className="text-xs">
                  Location-level audit documents{locationName ? ` for ${locationName}` : ''}
                </CardDescription>
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
        </CardHeader>
        <CardContent className="pt-0 px-4 pb-3">
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
                      <div className="flex items-center gap-3 p-3">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewUrl(audit.audit_url);
                            setPreviewOpen(true);
                          }}
                          className="w-12 h-12 flex-shrink-0 border rounded overflow-hidden bg-muted cursor-pointer hover:opacity-80 flex items-center justify-center"
                        >
                          {isPdf ? (
                            <FileText className="w-6 h-6 text-muted-foreground" />
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
                            <span className="text-sm font-medium">
                              Audit - {auditDateDisplay}
                            </span>
                            {audit.visit_score && (
                              <Badge variant="secondary" className="text-xs">
                                Score: {audit.visit_score}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {audit.manager_name ? `Manager: ${audit.manager_name}` : null}
                            {audit.manager_name && audit.notes && ' • '}
                            {audit.notes}
                          </p>
                        </div>
                        <div className="flex gap-1 flex-shrink-0 items-center">
                          {!hasData && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1"
                              onClick={(e) => {
                                e.stopPropagation();
                                extractAuditSummary(audit);
                              }}
                              disabled={isExtracting}
                            >
                              {isExtracting ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Sparkles className="w-3 h-3" />
                              )}
                              {isExtracting ? 'Croo AI Scanning...' : 'Croo AI Scan'}
                            </Button>
                          )}
                          {hasData && (
                            <CollapsibleTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                              >
                                {isExpanded ? (
                                  <ChevronDown className="w-4 h-4" />
                                ) : (
                                  <ChevronRight className="w-4 h-4" />
                                )}
                              </Button>
                            </CollapsibleTrigger>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPreviewUrl(audit.audit_url);
                              setPreviewOpen(true);
                            }}
                          >
                            <ExternalLink className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAuditDelete(audit.id);
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
        </CardContent>
      </Card>

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
    </>
  );
}
