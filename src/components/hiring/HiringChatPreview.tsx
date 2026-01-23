import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MessageCircle, ExternalLink, Copy, Check, Calendar, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

interface Message {
  id: string;
  sender_type: 'staff' | 'applicant';
  content: string;
  created_at: string;
}

interface HiringChatPreviewProps {
  applicationId: string;
  applicantName: string;
  interviewDate?: string | null;
  interviewTime?: string | null;
  interviewStatus?: string | null;
}

export function HiringChatPreview({ 
  applicationId, 
  applicantName,
  interviewDate,
  interviewTime,
  interviewStatus 
}: HiringChatPreviewProps) {
  const navigate = useNavigate();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [recentMessages, setRecentMessages] = useState<Message[]>([]);
  const [messageCount, setMessageCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchConversationPreview();
  }, [applicationId]);

  const fetchConversationPreview = async () => {
    try {
      // Get conversation
      const { data: conv } = await supabase
        .from('hiring_conversations')
        .select('id, access_token')
        .eq('application_id', applicationId)
        .maybeSingle();

      if (conv) {
        setAccessToken(conv.access_token);

        // Get message count and recent messages
        const [countResult, messagesResult] = await Promise.all([
          supabase
            .from('hiring_messages')
            .select('id', { count: 'exact', head: true })
            .eq('conversation_id', conv.id),
          supabase
            .from('hiring_messages')
            .select('id, sender_type, content, created_at')
            .eq('conversation_id', conv.id)
            .order('created_at', { ascending: false })
            .limit(3)
        ]);

        setMessageCount(countResult.count || 0);
        setRecentMessages((messagesResult.data || []).reverse() as Message[]);
      }
    } catch (err) {
      console.error('Error fetching chat preview:', err);
    } finally {
      setLoading(false);
    }
  };

  const copyApplicantLink = () => {
    if (!accessToken) return;
    const link = `${window.location.origin}/hiring-chat/${accessToken}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    toast.success('Link copied! Share with the applicant');
    setTimeout(() => setCopied(false), 2000);
  };

  const openChat = () => {
    if (accessToken) {
      // Navigate to hiring chat page
      navigate(`/hiring-chat/${accessToken}?staff=true`);
    }
  };

  const getInterviewStatusBadge = () => {
    if (!interviewDate || !interviewStatus) return null;
    
    const statusColors: Record<string, string> = {
      pending: 'bg-amber-500/20 text-amber-700 dark:text-amber-300',
      accepted: 'bg-green-500/20 text-green-700 dark:text-green-300',
      declined: 'bg-red-500/20 text-red-700 dark:text-red-300',
      cancelled: 'bg-muted text-muted-foreground',
    };

    return (
      <Badge className={statusColors[interviewStatus] || 'bg-muted'}>
        {interviewStatus === 'pending' ? 'Invite Sent' : interviewStatus}
      </Badge>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageCircle className="h-4 w-4" />
            Applicant Chat
          </CardTitle>
          <div className="flex gap-1">
            {accessToken && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={copyApplicantLink}
                  className="h-8 px-2"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={openChat}
                  className="h-8 px-2"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Interview Info */}
        {interviewDate && (
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Interview Scheduled</span>
              </div>
              {getInterviewStatusBadge()}
            </div>
            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
              <span>{format(new Date(interviewDate + 'T00:00:00'), 'EEEE, MMMM d, yyyy')}</span>
              {interviewTime && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {interviewTime}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Recent Messages Preview */}
        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-2">Loading...</p>
        ) : messageCount === 0 ? (
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground mb-2">No messages yet</p>
            {accessToken && (
              <Button variant="outline" size="sm" onClick={copyApplicantLink}>
                <Copy className="h-3.5 w-3.5 mr-2" />
                Copy Chat Link
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {recentMessages.map((msg) => {
                // Skip interview invite messages in preview
                if (msg.content.startsWith('INTERVIEW_INVITE:')) {
                  return null;
                }
                
                return (
                  <div
                    key={msg.id}
                    className={`text-sm p-2 rounded-lg ${
                      msg.sender_type === 'staff'
                        ? 'bg-primary/10 ml-4'
                        : 'bg-muted mr-4'
                    }`}
                  >
                    <p className="line-clamp-2">{msg.content}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {msg.sender_type === 'staff' ? 'You' : applicantName} • {format(new Date(msg.created_at), 'MMM d, h:mm a')}
                    </p>
                  </div>
                );
              })}
            </div>
            
            {messageCount > 3 && (
              <Button 
                variant="link" 
                size="sm" 
                onClick={openChat}
                className="w-full text-xs"
              >
                View all {messageCount} messages →
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
