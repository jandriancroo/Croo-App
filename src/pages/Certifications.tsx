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
import { Upload, CheckCircle, XCircle, Clock, ExternalLink, Trash2 } from "lucide-react";
import { format } from "date-fns";

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

    try {
      setUploading(true);

      // Upload file to storage
      const fileExt = selectedFile.name.split(".").pop();
      const fileName = `${user.id}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("certificates")
        .upload(fileName, selectedFile);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from("certificates")
        .getPublicUrl(fileName);

      // Create certification record
      const { error: insertError } = await supabase
        .from("certifications")
        .insert({
          user_id: user.id,
          certification_type: selectedType,
          certificate_url: publicUrl,
          expiration_date: expirationDate,
          status: "pending",
        });

      if (insertError) throw insertError;

      toast.success("Certificate uploaded successfully! Awaiting admin approval.");
      setUploadDialogOpen(false);
      setSelectedFile(null);
      setExpirationDate("");
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
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Upload Certificate</DialogTitle>
                <DialogDescription>
                  Upload your certification document. It will be reviewed by an admin.
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

        <div className="space-y-4">
          {profiles.map((profile) => {
            const employeeCerts = getCertsByEmployee(profile.id);
            const foodHandlers = employeeCerts.find((c) => c.certification_type === "food_handlers");
            const servSafe = employeeCerts.find((c) => c.certification_type === "servsafe");

            return (
              <Card key={profile.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Avatar>
                        <AvatarImage src={profile.profile_photo_url || ""} />
                        <AvatarFallback>{profile.full_name?.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <div>
                        <CardTitle className="text-lg">{profile.full_name}</CardTitle>
                        <CardDescription>Employee Certifications</CardDescription>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* Food Handlers Card */}
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <h4 className="font-semibold">Food Handlers Card</h4>
                          {foodHandlers ? (
                            <div className="mt-2 space-y-2">
                              <div className="flex items-center gap-2">
                                {getStatusBadge(foodHandlers.status)}
                                <span className="text-sm text-muted-foreground">
                                  Expires: {format(new Date(foodHandlers.expiration_date), "MMM d, yyyy")}
                                </span>
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => window.open(foodHandlers.certificate_url, "_blank")}
                                >
                                  <ExternalLink className="w-3 h-3 mr-1" />
                                  View
                                </Button>
                                {isAdmin && (
                                  <>
                                    {foodHandlers.status === "pending" && (
                                      <>
                                        <Button
                                          size="sm"
                                          onClick={() => handleApprove(foodHandlers.id)}
                                        >
                                          Approve
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="destructive"
                                          onClick={() => handleReject(foodHandlers.id)}
                                        >
                                          Reject
                                        </Button>
                                      </>
                                    )}
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => handleDelete(foodHandlers.id)}
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </Button>
                                  </>
                                )}
                              </div>
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground mt-1">Not uploaded</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* ServSafe Certification */}
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <h4 className="font-semibold">ServSafe Certification</h4>
                          {servSafe ? (
                            <div className="mt-2 space-y-2">
                              <div className="flex items-center gap-2">
                                {getStatusBadge(servSafe.status)}
                                <span className="text-sm text-muted-foreground">
                                  Expires: {format(new Date(servSafe.expiration_date), "MMM d, yyyy")}
                                </span>
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => window.open(servSafe.certificate_url, "_blank")}
                                >
                                  <ExternalLink className="w-3 h-3 mr-1" />
                                  View
                                </Button>
                                {isAdmin && (
                                  <>
                                    {servSafe.status === "pending" && (
                                      <>
                                        <Button
                                          size="sm"
                                          onClick={() => handleApprove(servSafe.id)}
                                        >
                                          Approve
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="destructive"
                                          onClick={() => handleReject(servSafe.id)}
                                        >
                                          Reject
                                        </Button>
                                      </>
                                    )}
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => handleDelete(servSafe.id)}
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </Button>
                                  </>
                                )}
                              </div>
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground mt-1">Not uploaded</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </Layout>
  );
}
