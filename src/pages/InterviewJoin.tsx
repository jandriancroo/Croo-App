import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

const CALENDAR_ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/interview-calendar`;

export default function InterviewJoin() {
  const [searchParams] = useSearchParams();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const applicationId = searchParams.get('a');
    const signature = searchParams.get('s');
    if (!applicationId || !signature) {
      setFailed(true);
      return;
    }

    const destination = new URL(CALENDAR_ENDPOINT);
    destination.searchParams.set('action', 'join');
    destination.searchParams.set('a', applicationId);
    destination.searchParams.set('s', signature);
    window.location.replace(destination.toString());
  }, [searchParams]);

  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <div className="text-center space-y-3">
        {failed ? (
          <p className="font-medium">This interview link is not valid.</p>
        ) : (
          <>
            <Loader2 className="mx-auto h-7 w-7 animate-spin text-primary" />
            <p className="font-medium">Opening your interview…</p>
          </>
        )}
      </div>
    </main>
  );
}