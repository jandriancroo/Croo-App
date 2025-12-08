import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ClipboardCheck, Plus, Trash2, ExternalLink, FileText, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { compressImage } from '@/utils/imageCompression';

interface FoodSafetyAudit {
  id: string;
  location_id: string;
  audit_url: string;
  audit_date: string;
  uploaded_by: string;
  notes: string | null;
  created_at: string;
  profiles?: {
    full_name: string;
  };
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

  useEffect(() => {
    if (locationId) {
      fetchAudits();
    }
  }, [locationId]);

  const fetchAudits = async () => {
    if (!locationId) return;
    
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("food_safety_audits")
        .select(`
          *,
          profiles!food_safety_audits_uploaded_by_fkey(full_name)
        `)
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

  const handleAuditUpload = async () => {
    if (!user || !auditFile || !auditDate || !locationId) {
      toast.error("Please fill in all fields");
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
                return (
                  <div key={audit.id} className="flex items-center gap-3 p-3 border rounded-md bg-muted/30">
                    <button 
                      onClick={() => {
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
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          Audit - {auditDateDisplay}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Uploaded by {audit.profiles?.full_name || "Unknown"}
                        {audit.notes && ` • ${audit.notes}`}
                      </p>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => {
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
                        onClick={() => handleAuditDelete(audit.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
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
