import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Loader2, Mail } from 'lucide-react';
import { useAuth } from '@/lib/auth';

interface RejectionEmailTemplatesProps {
  organizationId: string;
}

export function RejectionEmailTemplates({ organizationId }: RejectionEmailTemplatesProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [editingTemplate, setEditingTemplate] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  
  // Form state
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [isActive, setIsActive] = useState(true);

  // Fetch templates
  const { data: templates, isLoading } = useQuery({
    queryKey: ['rejection-email-templates', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rejection_email_templates')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
  });

  // Create/Update template
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error('Name is required');
      if (!subject.trim()) throw new Error('Subject is required');
      if (!body.trim()) throw new Error('Body is required');

      const templateData = {
        organization_id: organizationId,
        name: name.trim(),
        subject: subject.trim(),
        body: body.trim(),
        is_active: isActive,
        created_by: user?.id,
      };

      if (editingTemplate) {
        const { error } = await supabase
          .from('rejection_email_templates')
          .update(templateData)
          .eq('id', editingTemplate);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('rejection_email_templates')
          .insert(templateData);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rejection-email-templates'] });
      toast.success(editingTemplate ? 'Template updated' : 'Template created');
      closeDialog();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to save template');
    },
  });

  // Delete template
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('rejection_email_templates')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rejection-email-templates'] });
      toast.success('Template deleted');
    },
    onError: () => {
      toast.error('Failed to delete template');
    },
  });

  // Toggle active status
  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase
        .from('rejection_email_templates')
        .update({ is_active: isActive })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rejection-email-templates'] });
    },
    onError: () => {
      toast.error('Failed to update template');
    },
  });

  const openNewDialog = () => {
    setEditingTemplate(null);
    setName('');
    setSubject('Thank you for your application');
    setBody(`Dear {{first_name}},

Thank you for taking the time to apply to {{organization}}. After careful consideration, we have decided to move forward with other candidates whose experience more closely matches our current needs.

We appreciate your interest in our team and encourage you to apply again in the future.

Best regards,
The {{organization}} Team`);
    setIsActive(true);
    setShowDialog(true);
  };

  const openEditDialog = (template: any) => {
    setEditingTemplate(template.id);
    setName(template.name);
    setSubject(template.subject);
    setBody(template.body);
    setIsActive(template.is_active);
    setShowDialog(true);
  };

  const closeDialog = () => {
    setShowDialog(false);
    setEditingTemplate(null);
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          Create email templates for applicant rejections
        </p>
        <Button onClick={openNewDialog}>
          <Plus className="h-4 w-4 mr-2" />
          New Template
        </Button>
      </div>

      {templates?.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Mail className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Email Templates Yet</h3>
            <p className="text-muted-foreground mb-4">
              Create rejection email templates to send professional responses to applicants
            </p>
            <Button onClick={openNewDialog}>
              <Plus className="h-4 w-4 mr-2" />
              Create Template
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {templates?.map(template => (
            <Card key={template.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Mail className="h-4 w-4 shrink-0" />
                      <span className="truncate">{template.name}</span>
                      {!template.is_active && (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="mt-1 line-clamp-1">
                      Subject: {template.subject}
                    </CardDescription>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="icon" onClick={() => openEditDialog(template)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        if (confirm('Delete this template?')) {
                          deleteMutation.mutate(template.id);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {template.body.substring(0, 100)}...
                  </p>
                  <Switch
                    checked={template.is_active}
                    onCheckedChange={(checked) => 
                      toggleActiveMutation.mutate({ id: template.id, isActive: checked })
                    }
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit/Create Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingTemplate ? 'Edit Rejection Template' : 'New Rejection Template'}
            </DialogTitle>
            <DialogDescription>
              Use placeholders: {"{{name}}"}, {"{{first_name}}"}, {"{{organization}}"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Template Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g., Standard Rejection, Position Filled"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="subject">Email Subject *</Label>
              <Input
                id="subject"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="e.g., Thank you for your application"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="body">Email Body *</Label>
              <Textarea
                id="body"
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder="Write your rejection email here..."
                rows={10}
                className="font-mono text-sm"
              />
            </div>

            <div className="flex items-center gap-3">
              <Switch
                id="active"
                checked={isActive}
                onCheckedChange={setIsActive}
              />
              <Label htmlFor="active">Active (available for use)</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button 
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingTemplate ? 'Save Changes' : 'Create Template'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
