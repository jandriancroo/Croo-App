import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useUserRole } from "@/hooks/useUserRole";
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
import { Upload, CheckCircle, XCircle, Clock, ExternalLink, Trash2, Edit } from "lucide-react";
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

export default function Certifications() {
  const { user } = useAuth();
  const { isAdmin } = useUserRole();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [certifications, setCertifications] = useState<Certification[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedType, setSelectedType] = useState<CertificationType>("food_handlers");
  const [expirationDate, setExpirationDate] = useState("");
  const [uploading, setUploading] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedCertification, setSelectedCertification] = useState<Certification | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");

  useEffect(() => {
    fetchData();
  }, [user, isAdmin]);

  const fetchData = async () => {
    if (!user) return;

    try {
      setLoading(true);

      // Fetch active profiles
      const { data: profilesData, error: profilesError } = await supabase
        .from("profiles")
        .select("id, full_name, profile_photo_url, is_active")
        .eq("is_active", true)
        .order("full_name");

      if (profilesError) throw profilesError;
      setProfiles(profilesData || []);

      // Fetch certifications
      let query = supabase
        .from("certifications")
        .select(`
          *,
          profiles!certifications_user_id_fkey(full_name, profile_photo_url)
        `)
        .order("created_at", { ascending: false });

      if (!isAdmin) {
        query = query.eq("user_id", user.id);
      }

      const { data: certsData, error: certsError } = await query;

      if (certsError) throw certsError;
      setCertifications((certsData as any) || []);
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

      if (uploadError) throw uploadError;

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

      if (insertError) throw insertError;

      toast.success(isAdmin ? "Certificate uploaded and approved!" : "Certificate uploaded successfully! Awaiting admin approval.");
      setUploadDialogOpen(false);
      setSelectedFile(null);
      setExpirationDate("");
      setSelectedEmployeeId("");
      fetchData();
    } catch (error: any) {
      console.error("Error uploading certificate:", error);
      toast.error("Failed to upload certificate");
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
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Certifications</h1>
            <p className="text-muted-foreground">
              Track food handlers cards and ServSafe certifications
            </p>
          </div>
          <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Upload className="w-4 h-4 mr-2" />
                Upload Certificate
              </Button>
            </DialogTrigger>
            <DialogContent onOpenAutoFocus={(e) => {
              // Set current user as default if admin
              if (isAdmin && user?.id && !selectedEmployeeId) {
                setSelectedEmployeeId(user.id);
              }
            }}>
              <DialogHeader>
                <DialogTitle>Upload Certificate</DialogTitle>
                <DialogDescription>
                  {isAdmin ? "Upload a certification for an employee." : "Upload your certification document. It will be reviewed by an admin."}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                {isAdmin && (
                  <div>
                    <Label>Employee</Label>
                    <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select employee" />
                      </SelectTrigger>
                      <SelectContent>
                        {profiles.map((profile) => (
                          <SelectItem key={profile.id} value={profile.id}>
                            {profile.full_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
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
                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  />
                </div>
                <div>
                  <Label>Expiration Date</Label>
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
        </div>

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
                      <CardDescription className="text-xs">
                        {employeeCerts.length} cert{employeeCerts.length !== 1 ? 's' : ''}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 px-4 pb-3">
                  {employeeCerts.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      No certifications
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {employeeCerts.map((cert) => (
                        <div key={cert.id} className="flex items-center gap-2 p-2 border rounded-md bg-muted/30">
                          <div 
                            className="w-10 h-10 flex-shrink-0 border rounded overflow-hidden bg-muted cursor-pointer hover:opacity-80"
                            onClick={() => window.open(cert.certificate_url, "_blank")}
                          >
                            <img 
                              src={cert.certificate_url} 
                              alt={getCertTypeName(cert.certification_type as CertificationType)}
                              className="w-full h-full object-cover"
                            />
                          </div>
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
                              onClick={() => window.open(cert.certificate_url, "_blank")}
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
                      ))}
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
      </div>

      <EditCertificationDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        certification={selectedCertification}
        onSuccess={fetchData}
      />
    </Layout>
  );
}
