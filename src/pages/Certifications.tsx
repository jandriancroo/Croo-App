import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useUserRole } from "@/hooks/useUserRole";
import { useLocation } from "@/hooks/useLocation";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Upload, CheckCircle, XCircle, Clock, ExternalLink, Trash2, Edit, FileText, Plus, Loader2, ClipboardCheck } from "lucide-react";
import { format } from "date-fns";
import { EditCertificationDialog } from "@/components/users/EditCertificationDialog";
import { compressImage } from "@/utils/imageCompression";

type CertificationType = "food_handlers" | "servsafe";

interface Certification {
  id: string;
  user_id: string;
  certification_type: CertificationType;
  certificate_url: string;
  expiration_date: string;
  status: "pending" | "approved" | "rejected";
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  profiles: {
    full_name: string;
    profile_photo_url: string | null;
  };
}

interface Profile {
  id: string;
  full_name: string;
  profile_photo_url: string | null;
  is_active: boolean;
}

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

export default function Certifications() {
  const { user } = useAuth();
  const { isAdmin } = useUserRole();
  const { currentLocation } = useLocation();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [certifications, setCertifications] = useState<Certification[]>([]);
  const [audits, setAudits] = useState<FoodSafetyAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [auditUploadDialogOpen, setAuditUploadDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [auditFile, setAuditFile] = useState<File | null>(null);
  const [selectedType, setSelectedType] = useState<CertificationType>("food_handlers");
  const [expirationDate, setExpirationDate] = useState("");
  const [auditDate, setAuditDate] = useState("");
  const [auditNotes, setAuditNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const [auditUploading, setAuditUploading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [auditScanning, setAuditScanning] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedCertification, setSelectedCertification] = useState<Certification | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
    });
  };

  const handleScanCertificate = async (file: File) => {
    // Support images and PDFs
    const isImage = file.type.startsWith('image/');
    const isPdf = file.type === 'application/pdf';
    
    if (!isImage && !isPdf) {
      return;
    }

    setScanning(true);
    try {
      const base64 = await fileToBase64(file);
      
      const { data, error } = await supabase.functions.invoke('extract-certification-date', {
        body: { imageBase64: base64 }
      });

      if (error) throw error;

      if (data?.success && data?.expiration_date) {
        setExpirationDate(data.expiration_date);
        
        // Also update cert type if detected
        if (data.certificate_type === 'food_handlers' || data.certificate_type === 'servsafe') {
          setSelectedType(data.certificate_type);
        }
        
        toast.success(`Expiration date detected: ${data.expiration_date}`, {
          description: `Confidence: ${data.confidence}`
        });
      } else {
        toast.info("Could not detect expiration date", {
          description: "Please enter it manually"
        });
      }
    } catch (error: any) {
      console.error("Scan error:", error);
      toast.error("Failed to scan certificate", {
        description: error.message || "Please enter date manually"
      });
    } finally {
      setScanning(false);
    }
  };

  const handleScanAudit = async (file: File) => {
    const isImage = file.type.startsWith('image/');
    const isPdf = file.type === 'application/pdf';
    
    if (!isImage && !isPdf) {
      return;
    }

    setAuditScanning(true);
    try {
      const base64 = await fileToBase64(file);
      
      const { data, error } = await supabase.functions.invoke('extract-audit-date', {
        body: { imageBase64: base64 }
      });

      if (error) throw error;

      if (data?.success && data?.audit_date) {
        setAuditDate(data.audit_date);
        toast.success(`Audit date detected: ${data.audit_date}`, {
          description: `Confidence: ${data.confidence}`
        });
      } else {
        toast.info("Could not detect audit date", {
          description: "Please enter it manually"
        });
      }
    } catch (error: any) {
      console.error("Audit scan error:", error);
      toast.error("Failed to scan audit document", {
        description: error.message || "Please enter date manually"
      });
    } finally {
      setAuditScanning(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setSelectedFile(file);
    
    // Auto-scan if it's an image or PDF
    if (file && (file.type.startsWith('image/') || file.type === 'application/pdf')) {
      handleScanCertificate(file);
    }
  };

  const handleAuditFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setAuditFile(file);
    
    if (file && (file.type.startsWith('image/') || file.type === 'application/pdf')) {
      handleScanAudit(file);
    }
  };

  useEffect(() => {
    fetchData();
  }, [user, isAdmin, currentLocation?.id]);

  const fetchData = async () => {
    if (!user || !currentLocation?.id) return;

    try {
      setLoading(true);

      // Fetch user IDs for the current location
      const { data: locationUsers, error: locationUsersError } = await supabase
        .from("user_locations")
        .select("user_id")
        .eq("location_id", currentLocation.id);

      if (locationUsersError) throw locationUsersError;

      const locationUserIds = locationUsers?.map(lu => lu.user_id) || [];

      // Fetch active profiles for this location
      const { data: profilesData, error: profilesError } = await supabase
        .from("profiles")
        .select("id, full_name, profile_photo_url, is_active")
        .eq("is_active", true)
        .in("id", locationUserIds)
        .order("full_name");

      if (profilesError) throw profilesError;
      setProfiles(profilesData || []);

      // Fetch certifications for users at this location
      let query = supabase
        .from("certifications")
        .select(`
          *,
          profiles!certifications_user_id_fkey(full_name, profile_photo_url)
        `)
        .in("user_id", locationUserIds)
        .order("created_at", { ascending: false });

      if (!isAdmin) {
        query = query.eq("user_id", user.id);
      }

      const { data: certsData, error: certsError } = await query;

      if (certsError) throw certsError;
      setCertifications((certsData as any) || []);

      // Fetch food safety audits for this location
      const { data: auditsData, error: auditsError } = await supabase
        .from("food_safety_audits")
        .select(`
          *,
          profiles!food_safety_audits_uploaded_by_fkey(full_name)
        `)
        .eq("location_id", currentLocation.id)
        .order("audit_date", { ascending: false });

      if (auditsError) throw auditsError;
      setAudits((auditsData as any) || []);
    } catch (error: any) {
      console.error("Error fetching data:", error);
      toast.error("Failed to load certifications");
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async () => {
    if (!user || !selectedFile || !expirationDate) {
      toast.error("Please fill in all fields");
      return;
    }

    // If admin and no employee selected, show error
    if (isAdmin && !selectedEmployeeId) {
      toast.error("Please select an employee");
      return;
    }

    // Use selected employee ID for admin, or current user for non-admin
    const targetUserId = isAdmin ? selectedEmployeeId : user.id;

    try {
      setUploading(true);

      // Compress images to reduce memory usage on mobile
      let fileToUpload: File | Blob = selectedFile;
      let fileName = `${targetUserId}/${Date.now()}.${selectedFile.name.split(".").pop()}`;
      
      if (selectedFile.type.startsWith('image/')) {
        fileToUpload = await compressImage(selectedFile, 1200, 1200, 0.8);
        fileName = `${targetUserId}/${Date.now()}.jpg`;
      }

      const { error: uploadError } = await supabase.storage
        .from("certificates")
        .upload(fileName, fileToUpload);

      if (uploadError) {
        console.error("Storage upload error:", uploadError);
        toast.error(`File upload failed: ${uploadError.message}`);
        return;
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from("certificates")
        .getPublicUrl(fileName);

      // Create certification record
      const { error: insertError } = await supabase
        .from("certifications")
        .insert({
          user_id: targetUserId,
          certification_type: selectedType,
          certificate_url: publicUrl,
          expiration_date: expirationDate,
          status: isAdmin ? "approved" : "pending",
          ...(isAdmin && { approved_by: user.id, approved_at: new Date().toISOString() })
        });

      if (insertError) {
        console.error("Database insert error:", insertError);
        toast.error(`Database error: ${insertError.message}`);
        return;
      }

      toast.success(isAdmin ? "Certificate uploaded and approved!" : "Certificate uploaded successfully! Awaiting admin approval.");
      setUploadDialogOpen(false);
      setSelectedFile(null);
      setExpirationDate("");
      setSelectedEmployeeId("");
      fetchData();
    } catch (error: any) {
      console.error("Error uploading certificate:", error);
      toast.error(`Upload failed: ${error.message || "Unknown error"}`);
    } finally {
      setUploading(false);
    }
  };

  const handleApprove = async (certId: string) => {
    try {
      const { error } = await supabase
        .from("certifications")
        .update({
          status: "approved",
          approved_by: user?.id,
          approved_at: new Date().toISOString(),
        })
        .eq("id", certId);

      if (error) throw error;

      toast.success("Certificate approved");
      fetchData();
    } catch (error: any) {
      console.error("Error approving certificate:", error);
      toast.error("Failed to approve certificate");
    }
  };

  const handleReject = async (certId: string) => {
    try {
      const { error } = await supabase
        .from("certifications")
        .update({
          status: "rejected",
          approved_by: user?.id,
          approved_at: new Date().toISOString(),
        })
        .eq("id", certId);

      if (error) throw error;

      toast.success("Certificate rejected");
      fetchData();
    } catch (error: any) {
      console.error("Error rejecting certificate:", error);
      toast.error("Failed to reject certificate");
    }
  };

  const handleDelete = async (certId: string) => {
    if (!confirm("Are you sure you want to delete this certificate?")) return;

    try {
      const { error } = await supabase
        .from("certifications")
        .delete()
        .eq("id", certId);

      if (error) throw error;

      toast.success("Certificate deleted");
      fetchData();
    } catch (error: any) {
      console.error("Error deleting certificate:", error);
      toast.error("Failed to delete certificate");
    }
  };

  const handleAuditUpload = async () => {
    if (!user || !auditFile || !auditDate || !currentLocation?.id) {
      toast.error("Please fill in all fields");
      return;
    }

    try {
      setAuditUploading(true);

      let fileToUpload: File | Blob = auditFile;
      let fileName = `${currentLocation.id}/${Date.now()}.${auditFile.name.split(".").pop()}`;
      
      if (auditFile.type.startsWith('image/')) {
        fileToUpload = await compressImage(auditFile, 1200, 1200, 0.8);
        fileName = `${currentLocation.id}/${Date.now()}.jpg`;
      }

      const { error: uploadError } = await supabase.storage
        .from("food-safety-audits")
        .upload(fileName, fileToUpload);

      if (uploadError) {
        console.error("Storage upload error:", uploadError);
        toast.error(`File upload failed: ${uploadError.message}`);
        return;
      }

      const { data: { publicUrl } } = supabase.storage
        .from("food-safety-audits")
        .getPublicUrl(fileName);

      const { error: insertError } = await supabase
        .from("food_safety_audits")
        .insert({
          location_id: currentLocation.id,
          audit_url: publicUrl,
          audit_date: auditDate,
          uploaded_by: user.id,
          notes: auditNotes || null
        });

      if (insertError) {
        console.error("Database insert error:", insertError);
        toast.error(`Database error: ${insertError.message}`);
        return;
      }

      toast.success("Food safety audit uploaded successfully!");
      setAuditUploadDialogOpen(false);
      setAuditFile(null);
      setAuditDate("");
      setAuditNotes("");
      fetchData();
    } catch (error: any) {
      console.error("Error uploading audit:", error);
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
      fetchData();
    } catch (error: any) {
      console.error("Error deleting audit:", error);
      toast.error("Failed to delete audit");
    }
  };

  const getCertsByEmployee = (userId: string) => {
    return certifications.filter((cert) => cert.user_id === userId);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "approved":
        return <Badge className="bg-green-500"><CheckCircle className="w-3 h-3 mr-1" />Approved</Badge>;
      case "rejected":
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Rejected</Badge>;
      default:
        return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
    }
  };

  const getCertTypeName = (type: CertificationType) => {
    return type === "food_handlers" ? "Food Handlers Card" : "ServSafe Certification";
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <p>Loading...</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Certifications</h1>
          <p className="text-muted-foreground">
            Track food handlers cards and ServSafe certifications
          </p>
        </div>

        {/* Upload Dialog - triggered from individual cards */}
        <Dialog open={uploadDialogOpen} onOpenChange={(open) => {
          setUploadDialogOpen(open);
          if (!open) {
            setSelectedFile(null);
            setExpirationDate("");
          }
        }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Upload Certificate</DialogTitle>
              <DialogDescription>
                {selectedEmployeeId && profiles.find(p => p.id === selectedEmployeeId)?.full_name 
                  ? `Upload a certification for ${profiles.find(p => p.id === selectedEmployeeId)?.full_name}.`
                  : "Upload your certification document."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Certification Type</Label>
                <Select value={selectedType} onValueChange={(value: CertificationType) => setSelectedType(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="food_handlers">Food Handlers Card</SelectItem>
                    <SelectItem value="servsafe">ServSafe Certification</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Certificate File</Label>
                <Input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={handleFileChange}
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label>Expiration Date</Label>
                  {scanning && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Scanning...
                    </span>
                  )}
                </div>
                <Input
                  type="date"
                  value={expirationDate}
                  onChange={(e) => setExpirationDate(e.target.value)}
                />
              </div>
              <Button onClick={handleUpload} disabled={uploading} className="w-full">
                {uploading ? "Uploading..." : "Upload"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

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
                Upload a food safety audit document for {currentLocation?.name}.
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

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {profiles.map((profile) => {
            const employeeCerts = getCertsByEmployee(profile.id);

            return (
              <Card key={profile.id} className="overflow-hidden">
                <CardHeader className="py-3 px-4">
                  <div className="flex items-center gap-2">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={profile.profile_photo_url || ""} />
                      <AvatarFallback className="text-xs">{profile.full_name?.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <CardTitle className="text-sm truncate">{profile.full_name}</CardTitle>
                    </div>
                    {(isAdmin || profile.id === user?.id) && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 flex-shrink-0"
                        onClick={() => {
                          setSelectedEmployeeId(profile.id);
                          setUploadDialogOpen(true);
                        }}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-0 px-4 pb-3">
                  {employeeCerts.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      No certifications
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {employeeCerts.map((cert) => {
                        const isPdf = cert.certificate_url?.toLowerCase().endsWith('.pdf');
                        return (
                        <div key={cert.id} className="flex items-center gap-2 p-2 border rounded-md bg-muted/30">
                          <a 
                            href={cert.certificate_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-10 h-10 flex-shrink-0 border rounded overflow-hidden bg-muted cursor-pointer hover:opacity-80 flex items-center justify-center"
                          >
                            {isPdf ? (
                              <FileText className="w-5 h-5 text-muted-foreground" />
                            ) : (
                              <img 
                                src={cert.certificate_url} 
                                alt={getCertTypeName(cert.certification_type as CertificationType)}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                  e.currentTarget.parentElement?.classList.add('pdf-fallback');
                                }}
                              />
                            )}
                          </a>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-medium truncate">
                                {cert.certification_type === "food_handlers" ? "Food Handler" : "ServSafe"}
                              </span>
                              {cert.status === "approved" ? (
                                <CheckCircle className="w-3 h-3 text-green-500 flex-shrink-0" />
                              ) : cert.status === "rejected" ? (
                                <XCircle className="w-3 h-3 text-red-500 flex-shrink-0" />
                              ) : (
                                <Clock className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Exp: {format(new Date(cert.expiration_date), "MM/dd/yy")}
                            </p>
                          </div>
                          <div className="flex gap-1 flex-shrink-0">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6"
                              onClick={() => {
                                setPreviewUrl(cert.certificate_url);
                                setPreviewOpen(true);
                              }}
                            >
                              <ExternalLink className="w-3 h-3" />
                            </Button>
                            {isAdmin && (
                              <>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6"
                                  onClick={() => {
                                    setSelectedCertification(cert);
                                    setEditDialogOpen(true);
                                  }}
                                >
                                  <Edit className="w-3 h-3" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6 text-destructive"
                                  onClick={() => handleDelete(cert.id)}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      )})}
                      {isAdmin && employeeCerts.some(c => c.status === "pending") && (
                        <div className="flex gap-1 pt-1">
                          {employeeCerts.filter(c => c.status === "pending").map(cert => (
                            <div key={cert.id} className="flex gap-1">
                              <Button size="sm" className="h-6 text-xs" onClick={() => handleApprove(cert.id)}>
                                Approve
                              </Button>
                              <Button size="sm" variant="destructive" className="h-6 text-xs" onClick={() => handleReject(cert.id)}>
                                Reject
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Food Safety Audits Section - at bottom */}
        {isAdmin && (
          <Card>
            <CardHeader className="py-3 px-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ClipboardCheck className="h-5 w-5 text-primary" />
                  <div>
                    <CardTitle className="text-base">Food Safety Audits</CardTitle>
                    <CardDescription className="text-xs">Location-level audit documents for {currentLocation?.name}</CardDescription>
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
                    // Parse date without timezone shift by appending time
                    const auditDateDisplay = audit.audit_date ? format(new Date(audit.audit_date + 'T12:00:00'), "MMM d, yyyy") : 'Unknown';
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
        )}
      </div>

      <EditCertificationDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        certification={selectedCertification}
        onSuccess={fetchData}
      />

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
    </Layout>
  );
}
