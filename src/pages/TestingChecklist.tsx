import { Button } from '@/components/ui/button';
import { Printer, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const ChecklistSection = ({ title, items }: { title: string; items: string[] }) => (
  <div className="mb-6">
    <h3 className="text-lg font-semibold mb-2 border-b pb-1">{title}</h3>
    <div className="space-y-1">
      {items.map((item, i) => (
        <label key={i} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 p-1 rounded">
          <input type="checkbox" className="w-4 h-4 print:w-3 print:h-3" />
          <span>{item}</span>
        </label>
      ))}
    </div>
  </div>
);

export default function TestingChecklist() {
  const navigate = useNavigate();

  const employeeFeatures = {
    "Punch Clock": [
      "Clock in with PIN",
      "Clock out",
      "Take break",
      "Punch in when NOT scheduled (see warning)",
    ],
    "My Wallet": [
      "View current pay period hours",
      "View Croo Cash balance",
    ],
    "Schedule": [
      "View your published shifts",
      "See pending time-off on schedule",
    ],
    "Availability": [
      "Submit time-off request",
      "View request status",
    ],
    "Tasks/Checklists": [
      "Complete a daily checklist",
      "Upload photo with temperature validation",
      "See collaborative completions (who did what)",
    ],
    "Messages": [
      "Send DM to coworker",
      "View announcement",
      "Add reaction to message",
      "Send GIF",
    ],
    "Profile": [
      "Update profile photo",
      "Change your PIN",
      "View/update birthday",
    ],
  };

  const adminFeatures = {
    "Dashboard": [
      "View sales overview (if QuBeyond connected)",
      "See incomplete checklist alerts",
      "See certification expiring alerts",
      "Complete daily task cards",
    ],
    "Schedule - Shifts": [
      "Add shift to employee",
      "Edit existing shift",
      "Delete shift",
      "Copy schedule to future week",
      "GO LIVE (publish schedule)",
      "Verify employees receive push notification",
    ],
    "Schedule - Events": [
      "Create recurring event",
      "Create daily task event",
      "Assign event to multiple days",
      "Create color-coded category",
    ],
    "Schedule - Templates": [
      "Create shift template",
      "Apply template to schedule",
    ],
    "User Management": [
      "Invite new user",
      "Copy invite link manually",
      "Edit user profile",
      "Set hourly wage (with future effective date)",
      "Toggle 'Appears on Schedule'",
      "Bulk deactivate users",
      "Bulk wage update",
    ],
    "Certifications": [
      "Upload certificate for employee",
      "Verify AI auto-extracts expiration date",
      "Approve pending certification",
    ],
    "Location Audits": [
      "Upload food safety audit",
      "Verify AI extracts audit date",
    ],
    "Availability Admin": [
      "Approve time-off request",
      "Deny request with reason",
      "View YTD hours used per employee",
    ],
    "Payroll Review": [
      "Review time punches",
      "Approve/reject punches",
      "Edit punch times",
      "Close pay period",
    ],
    "LogBook": [
      "Submit Safe Count (AM/PM)",
      "Submit Drawer Count",
      "Verify deposit calculation",
      "Create custom log category",
      "Search past entries",
    ],
    "Tasks Admin": [
      "Create new checklist template",
      "Add photo item with temp validation",
      "Create dynamic checklist",
      "Assign items to specific days",
      "Set due-by time",
      "View completion history/leaderboard",
    ],
    "Messages Admin": [
      "Create group chat",
      "Send announcement",
      "View announcement read stats",
    ],
    "Hiring": [
      "Create application template",
      "View applicants",
      "See Croo AI Match badge",
      "Start chat with applicant",
      "Schedule interview",
      "Hire applicant (auto-create account)",
    ],
    "Settings": [
      "Configure location hours (per day)",
      "Set blackout dates",
      "Configure role notification permissions",
      "Upload organization logo",
      "Set safe target / drawer bank amounts",
    ],
    "Multi-Location": [
      "Switch locations",
      "Verify data changes per location",
    ],
  };

  const pushNotifications = [
    "Schedule published → 'New schedule available'",
    "Shift added/changed → Specific change notification",
    "Safe Count submitted → Managers notified",
    "Drawer Count submitted → Managers notified with variance",
    "Checklist overdue → After due_by_time passes",
    "Certification expiring → 30 days before expiration",
    "New chat message → Real-time notification",
    "Announcement sent → All employees notified",
  ];

  return (
    <div className="min-h-screen bg-background p-4 print:p-2 print:bg-white">
      <div className="max-w-4xl mx-auto">
        {/* Header - hidden when printing */}
        <div className="flex items-center justify-between mb-6 print:hidden">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Testing Checklist</h1>
          <Button onClick={() => window.print()} className="gap-2">
            <Printer className="h-4 w-4" />
            Print
          </Button>
        </div>

        {/* Print header */}
        <div className="hidden print:block text-center mb-4">
          <h1 className="text-xl font-bold">CROO APP TESTING CHECKLIST</h1>
          <p className="text-sm text-muted-foreground">Date: _______________</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 print:gap-2 print:grid-cols-2">
          {/* Employee Features */}
          <div className="border rounded-lg p-4 print:p-2 print:border-black">
            <h2 className="text-xl font-bold mb-4 print:text-base print:mb-2 bg-muted/50 -mx-4 -mt-4 p-3 print:p-1 print:-mx-2 print:-mt-2 rounded-t-lg print:bg-gray-200">
              👤 EMPLOYEE FEATURES
            </h2>
            {Object.entries(employeeFeatures).map(([section, items]) => (
              <ChecklistSection key={section} title={section} items={items} />
            ))}
          </div>

          {/* Admin Features */}
          <div className="border rounded-lg p-4 print:p-2 print:border-black">
            <h2 className="text-xl font-bold mb-4 print:text-base print:mb-2 bg-muted/50 -mx-4 -mt-4 p-3 print:p-1 print:-mx-2 print:-mt-2 rounded-t-lg print:bg-gray-200">
              🔐 ADMIN FEATURES
            </h2>
            {Object.entries(adminFeatures).map(([section, items]) => (
              <ChecklistSection key={section} title={section} items={items} />
            ))}
          </div>
        </div>

        {/* Push Notifications */}
        <div className="border rounded-lg p-4 print:p-2 print:border-black mt-6 print:mt-2">
          <h2 className="text-xl font-bold mb-4 print:text-base print:mb-2 bg-muted/50 -mx-4 -mt-4 p-3 print:p-1 print:-mx-2 print:-mt-2 rounded-t-lg print:bg-gray-200">
            🔔 PUSH NOTIFICATIONS
          </h2>
          <ChecklistSection title="Verify These Triggers" items={pushNotifications} />
        </div>

        {/* Notes section */}
        <div className="border rounded-lg p-4 print:p-2 print:border-black mt-6 print:mt-2">
          <h2 className="text-xl font-bold mb-4 print:text-base print:mb-2">📝 NOTES</h2>
          <div className="h-32 print:h-24 border border-dashed rounded" />
        </div>
      </div>
    </div>
  );
}
