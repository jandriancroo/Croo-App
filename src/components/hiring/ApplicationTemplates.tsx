import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, GripVertical, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';

interface CustomQuestion {
  id?: string;
  question: string;
  question_type: 'text' | 'textarea' | 'select' | 'checkbox' | 'radio';
  options?: string[];
  is_required: boolean;
  display_order: number;
}

interface ApplicationTemplatesProps {
  organizationId: string;
}

export function ApplicationTemplates({ organizationId }: ApplicationTemplatesProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [editingTemplate, setEditingTemplate] = useState<string | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  
  // Form state
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [customQuestions, setCustomQuestions] = useState<CustomQuestion[]>([]);

  // Fetch templates
  const { data: templates, isLoading } = useQuery({
    queryKey: ['application-templates', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_application_templates')
        .select(`
          *,
          questions:job_application_template_questions(*)
        `)
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
      if (!templateName.trim()) throw new Error('Name is required');

      // Upsert template
      const templateData = {
        organization_id: organizationId,
        name: templateName.trim(),
        description: templateDescription.trim() || null,
        is_active: isActive,
        created_by: user?.id,
      };

      let templateId = editingTemplate;

      if (editingTemplate) {
        const { error } = await supabase
          .from('job_application_templates')
          .update(templateData)
          .eq('id', editingTemplate);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('job_application_templates')
          .insert(templateData)
          .select()
          .single();
        if (error) throw error;
        templateId = data.id;
      }

      // Handle custom questions
      if (templateId) {
        // Delete existing questions if editing
        if (editingTemplate) {
          await supabase
            .from('job_application_template_questions')
            .delete()
            .eq('template_id', templateId);
        }

        // Insert new questions
        if (customQuestions.length > 0) {
          const questionsToInsert = customQuestions.map((q, i) => ({
            template_id: templateId,
            question: q.question,
            question_type: q.question_type,
            options: q.options && q.options.length > 0 ? q.options : null,
            is_required: q.is_required,
            display_order: i,
          }));

          const { error: qError } = await supabase
            .from('job_application_template_questions')
            .insert(questionsToInsert);
          if (qError) throw qError;
        }
      }

      return templateId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['application-templates'] });
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
        .from('job_application_templates')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['application-templates'] });
      toast.success('Template deleted');
    },
    onError: () => {
      toast.error('Failed to delete template');
    },
  });

  const openNewDialog = () => {
    setEditingTemplate(null);
    setTemplateName('');
    setTemplateDescription('');
    setIsActive(true);
    setCustomQuestions([]);
    setShowNewDialog(true);
  };

  const openEditDialog = (template: any) => {
    setEditingTemplate(template.id);
    setTemplateName(template.name);
    setTemplateDescription(template.description || '');
    setIsActive(template.is_active);
    setCustomQuestions(
      (template.questions || []).map((q: any) => ({
        id: q.id,
        question: q.question,
        question_type: q.question_type,
        options: q.options || [],
        is_required: q.is_required,
        display_order: q.display_order,
      }))
    );
    setShowNewDialog(true);
  };

  const closeDialog = () => {
    setShowNewDialog(false);
    setEditingTemplate(null);
  };

  const addQuestion = () => {
    setCustomQuestions(prev => [
      ...prev,
      {
        question: '',
        question_type: 'text',
        is_required: false,
        display_order: prev.length,
      },
    ]);
  };

  const updateQuestion = (index: number, field: keyof CustomQuestion, value: any) => {
    setCustomQuestions(prev => prev.map((q, i) => i === index ? { ...q, [field]: value } : q));
  };

  const removeQuestion = (index: number) => {
    setCustomQuestions(prev => prev.filter((_, i) => i !== index));
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
          Create application templates for different positions
        </p>
        <Button onClick={openNewDialog}>
          <Plus className="h-4 w-4 mr-2" />
          New Template
        </Button>
      </div>

      {templates?.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <h3 className="text-lg font-medium mb-2">No Templates Yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first application template to start accepting applications
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
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      {template.name}
                      {!template.is_active && (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </CardTitle>
                    {template.description && (
                      <CardDescription className="mt-1">
                        {template.description}
                      </CardDescription>
                    )}
                  </div>
                  <div className="flex gap-1">
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
                <p className="text-sm text-muted-foreground">
                  {template.questions?.length || 0} custom questions
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit/Create Dialog */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingTemplate ? 'Edit Template' : 'New Application Template'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 py-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Template Name *</Label>
                <Input
                  id="name"
                  value={templateName}
                  onChange={e => setTemplateName(e.target.value)}
                  placeholder="e.g., Team Member, Shift Manager"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={templateDescription}
                  onChange={e => setTemplateDescription(e.target.value)}
                  placeholder="Brief description of the position"
                  rows={2}
                />
              </div>

              <div className="flex items-center gap-3">
                <Switch
                  id="active"
                  checked={isActive}
                  onCheckedChange={setIsActive}
                />
                <Label htmlFor="active">Active (visible to applicants)</Label>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium">Custom Questions</h3>
                  <p className="text-sm text-muted-foreground">
                    Add additional questions beyond the standard fields
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={addQuestion}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              </div>

              {customQuestions.map((q, index) => (
                <Card key={index} className="p-4">
                  <div className="space-y-3">
                    <div className="flex items-start gap-2">
                      <GripVertical className="h-5 w-5 text-muted-foreground mt-2 cursor-move" />
                      <div className="flex-1 space-y-3">
                        <Input
                          placeholder="Question"
                          value={q.question}
                          onChange={e => updateQuestion(index, 'question', e.target.value)}
                        />
                        <div className="flex gap-3 flex-wrap">
                          <Select 
                            value={q.question_type} 
                            onValueChange={val => updateQuestion(index, 'question_type', val)}
                          >
                            <SelectTrigger className="w-[140px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="text">Short Text</SelectItem>
                              <SelectItem value="textarea">Long Text</SelectItem>
                              <SelectItem value="select">Dropdown</SelectItem>
                              <SelectItem value="radio">Multiple Choice</SelectItem>
                              <SelectItem value="checkbox">Checkboxes</SelectItem>
                            </SelectContent>
                          </Select>
                          <div className="flex items-center gap-2">
                            <Switch
                              id={`required-${index}`}
                              checked={q.is_required}
                              onCheckedChange={checked => updateQuestion(index, 'is_required', checked)}
                            />
                            <Label htmlFor={`required-${index}`} className="text-sm">Required</Label>
                          </div>
                        </div>
                        {['select', 'radio', 'checkbox'].includes(q.question_type) && (
                          <Input
                            placeholder="Options (comma separated)"
                            value={(q.options || []).join(', ')}
                            onChange={e => updateQuestion(index, 'options', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                          />
                        )}
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => removeQuestion(index)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingTemplate ? 'Save Changes' : 'Create Template'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
