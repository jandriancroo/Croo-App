import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, Mail, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

// ============================================================================
// BRAND CONSTANTS (canonical — these should match every edge function)
// ============================================================================
const primaryColor = "#3a8c9b";
const accentColor = "#f58220";
const backgroundColor = "#f0ebe1";
const textColor = "#0f1215";
const systemFontStack =
  "'Manrope', -apple-system, BlinkMacSystemFont, 'SF Pro', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// ============================================================================
// SHARED PRIMITIVES — identical to the edge-function helpers
// ============================================================================
function wrapEmail(content: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet"></head><body style="margin:0;padding:0;background-color:${backgroundColor};font-family:${systemFontStack};"><table style="width:100%;border-collapse:collapse;"><tr><td style="padding:30px 20px;"><table style="width:100%;max-width:720px;margin:0 auto;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);">${content}</table></td></tr></table></body></html>`;
}

// UNIFIED HEADER — logo left, title centered, menubar style (LOCKED)
function getUnifiedHeader(title: string): string {
  const WHITE_LOGO = "https://lmodeiyrpwvgyqcvjkjr.supabase.co/storage/v1/object/public/email-assets/croo-logo-white.webp";
  return `<tr><td style="background:${primaryColor};border-radius:16px 16px 0 0;padding:18px 16px;position:relative;">
    <div style="position:absolute;left:16px;top:50%;transform:translateY(-50%);">
      <div style="width:36px;height:36px;background:#fff;border-radius:8px;text-align:center;line-height:36px;">
        <img src="${WHITE_LOGO}" alt="CrooHQ" style="height:24px;vertical-align:middle;" />
      </div>
    </div>
    <h1 style="color:#fff;font-size:18px;font-weight:500;margin:0;font-family:${systemFontStack};letter-spacing:-0.2px;text-align:center;padding:8px 0;">${title}</h1>
  </td></tr>`;
}

function getEmailFooter(): string {
  return `<tr><td style="background-color:#f0ebe1;padding:12px 24px;border-top:1px solid #e8e5df;border-radius:0 0 16px 16px;"><table role="presentation" style="width:100%;"><tr><td style="text-align:left;vertical-align:middle;"><div style="display:inline-flex;align-items:center;gap:6px;"><span style="color:#3a5f7d;font-size:12px;font-weight:400;">Powered by</span><img src="https://lmodeiyrpwvgyqcvjkjr.supabase.co/storage/v1/object/public/email-assets/croo-logo-transparent.webp" alt="CrooHQ" style="height:28px;" /></div></td><td style="text-align:right;vertical-align:middle;"><p style="color:#999;font-size:11px;margin:0;">&copy; 2026 Croo. All rights reserved.</p></td></tr></table></td></tr>`;
}

function getCTAButton(url: string, text: string): string {
  return `<div style="text-align:center;"><a href="${url}" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:600;">${text}</a></div>`;
}

// ============================================================================
// AUTH EMAIL TEMPLATES (from auth-email-hook)
// ============================================================================
function authPasswordReset(): string {
  const email = "john@example.com";
  return wrapEmail(`
    ${getUnifiedHeader("Reset Your Password")}
    <tr><td style="padding:28px 32px;">
      <p style="color:${textColor};font-size:15px;line-height:1.7;margin:0 0 20px;">We received a request to reset the password for your CrooHQ account (<strong>${email}</strong>).</p>
      <p style="color:${textColor};font-size:15px;line-height:1.7;margin:0 0 24px;">Click the button below to set a new password:</p>
      <div style="text-align:center;margin:28px 0;"><a href="#" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:14px 36px;border-radius:10px;font-weight:600;font-size:15px;">Reset Password</a></div>
      <p style="color:#999;font-size:12px;text-align:center;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
    </td></tr>
    ${getEmailFooter()}`);
}

function authEmailConfirmation(): string {
  const email = "jane@example.com";
  return wrapEmail(`
    ${getUnifiedHeader("Confirm Your Email")}
    <tr><td style="padding:28px 32px;">
      <p style="color:${textColor};font-size:15px;line-height:1.7;margin:0 0 24px;">Please confirm your email address (<strong>${email}</strong>) to complete your CrooHQ account setup:</p>
      <div style="text-align:center;margin:28px 0;"><a href="#" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:14px 36px;border-radius:10px;font-weight:600;font-size:15px;">Confirm Email</a></div>
      <p style="color:#999;font-size:12px;text-align:center;">This link expires in 24 hours.</p>
    </td></tr>
    ${getEmailFooter()}`);
}

function authMagicLink(): string {
  return wrapEmail(`
    ${getUnifiedHeader("Sign In to CrooHQ")}
    <tr><td style="padding:28px 32px;">
      <p style="color:${textColor};font-size:15px;line-height:1.7;margin:0 0 24px;">Click the button below to sign in to your CrooHQ account:</p>
      <div style="text-align:center;margin:28px 0;"><a href="#" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:14px 36px;border-radius:10px;font-weight:600;font-size:15px;">Sign In</a></div>
      <p style="color:#999;font-size:12px;text-align:center;">This link expires in 1 hour.</p>
    </td></tr>
    ${getEmailFooter()}`);
}

function authInvite(): string {
  return wrapEmail(`
    ${getUnifiedHeader("You're Invited!")}
    <tr><td style="padding:28px 32px;">
      <p style="color:${textColor};font-size:15px;line-height:1.7;margin:0 0 24px;">You've been invited to join CrooHQ. Click the button below to accept the invitation and set up your account:</p>
      <div style="text-align:center;margin:28px 0;"><a href="#" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:14px 36px;border-radius:10px;font-weight:600;font-size:15px;">Accept Invitation</a></div>
      <p style="color:#999;font-size:12px;text-align:center;">This link expires in 24 hours.</p>
    </td></tr>
    ${getEmailFooter()}`);
}

// ============================================================================
// RESEND/CUSTOM EMAIL TEMPLATES
// ============================================================================
function employeeInvite(): string {
  return wrapEmail(`
    ${getUnifiedHeader("Welcome to the Team!")}
    <tr><td style="padding:28px 32px;">
      <div style="text-align:center;margin-bottom:24px;font-size:48px;">🎉</div>
      <p style="color:${textColor};font-size:18px;margin:0 0 20px;">Hey Jane!</p>
      <p style="color:${textColor};font-size:15px;line-height:1.7;margin:0 0 24px;"><strong>Congratulations!</strong> You've been invited to join <strong style="color:${primaryColor};">Blaze Pizza</strong> at the <strong>Downtown</strong> location.</p>
      <div style="background:#fafaf8;border-radius:16px;padding:24px;margin-bottom:24px;">
        <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Next Steps</p>
        <p style="color:${textColor};font-size:14px;line-height:1.6;margin:0;">Click the button below to set your password and get started. Once you're in, your manager will add you to the schedule.</p>
      </div>
      <div style="text-align:center;margin:28px 0;">
        <a href="#" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:14px 36px;border-radius:10px;font-weight:600;font-size:15px;">Set Your Password</a>
      </div>
      <p style="color:#999;font-size:12px;text-align:center;">This link expires in 24 hours.</p>
    </td></tr>
    ${getEmailFooter()}`);
}

function resendInvite(): string {
  return wrapEmail(`
    ${getUnifiedHeader("Set Your Password")}
    <tr><td style="padding:28px 32px;">
      <p style="color:${textColor};font-size:18px;margin:0 0 20px;">Hey Jane!</p>
      <p style="color:${textColor};font-size:15px;line-height:1.7;margin:0 0 24px;">Your manager has re-sent your invite to <strong style="color:${primaryColor};">Blaze Pizza</strong>. Click below to set your password and get started.</p>
      <div style="text-align:center;margin:28px 0;"><a href="#" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:14px 36px;border-radius:10px;font-weight:600;font-size:15px;">Set Your Password</a></div>
      <p style="color:#999;font-size:12px;text-align:center;">This link expires in 24 hours.</p>
    </td></tr>
    ${getEmailFooter()}`);
}

function interviewInvite(): string {
  return wrapEmail(`
    ${getUnifiedHeader("Interview Invitation")}
    <tr><td style="padding:28px 32px;">
      <p style="color:${textColor};font-size:15px;margin:0 0 20px;">Hi Jane,</p>
      <p style="color:${textColor};font-size:15px;margin:0 0 24px;"><strong>John Manager</strong> would like to invite you for an interview at <strong>Blaze Pizza</strong>.</p>
      <div style="background:#fafaf8;border-radius:16px;padding:24px;margin:0 0 24px;text-align:center;">
        <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Interview Details</p>
        <p style="color:${textColor};font-size:20px;font-weight:700;margin:0 0 4px;">Wednesday, February 19, 2026</p>
        <p style="color:${primaryColor};font-size:24px;font-weight:700;margin:0 0 12px;">2:00 PM</p>
        <p style="color:#666;font-size:14px;margin:0;">Downtown Location</p>
      </div>
      <div style="text-align:center;margin:24px 0;">
        <a href="#" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:600;">Accept Interview</a>
      </div>
    </td></tr>
    ${getEmailFooter()}`);
}

function rejectionEmail(): string {
  return wrapEmail(`
    ${getUnifiedHeader("Application Update")}
    <tr><td style="padding:28px 32px;">
      <p style="color:${textColor};font-size:15px;line-height:1.7;margin:0 0 20px;">Dear Jane,</p>
      <div style="background:#fafaf8;border-radius:16px;padding:20px;border-left:4px solid ${primaryColor};margin-bottom:24px;">
        <p style="color:${textColor};font-size:14px;line-height:1.7;margin:0;">Thank you for taking the time to apply to Blaze Pizza. After careful consideration, we have decided to move forward with other candidates whose experience more closely matches our current needs.<br><br>We appreciate your interest in our team and encourage you to apply again in the future.<br><br>Best regards,<br>The Blaze Pizza Team</p>
      </div>
    </td></tr>
    ${getEmailFooter()}`);
}

function newApplicationNotification(): string {
  return wrapEmail(`
    ${getUnifiedHeader("New Job Application")}
    <tr><td style="padding:30px 40px;">
      <h2 style="color:${textColor};font-size:18px;font-weight:600;margin:0 0 20px;">Applicant Details</h2>
      <div style="background:${backgroundColor};border-radius:10px;padding:20px;margin-bottom:24px;">
        <table style="width:100%;">
          <tr><td style="padding:8px 0;border-bottom:1px solid #e8e5df;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Name</span><br/><strong style="color:${textColor};font-size:16px;">Jane Smith</strong></td></tr>
          <tr><td style="padding:8px 0;border-bottom:1px solid #e8e5df;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Email</span><br/><a href="#" style="color:${primaryColor};font-size:14px;text-decoration:none;">jane@example.com</a></td></tr>
          <tr><td style="padding:8px 0;border-bottom:1px solid #e8e5df;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Phone</span><br/><a href="#" style="color:${primaryColor};font-size:14px;text-decoration:none;">(555) 123-4567</a></td></tr>
          <tr><td style="padding:8px 0;border-bottom:1px solid #e8e5df;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Position</span><br/><strong style="color:${textColor};font-size:14px;">Crew Member</strong></td></tr>
          <tr><td style="padding:8px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Location</span><br/><strong style="color:${textColor};font-size:14px;">Downtown</strong></td></tr>
        </table>
      </div>
      ${getCTAButton("#", "Review Application")}
    </td></tr>
    ${getEmailFooter()}`);
}

function supportTicket(): string {
  return wrapEmail(`
    ${getUnifiedHeader("Support Ticket")}
    <tr><td style="padding:28px 32px;">
      <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Ticket Details</p>
      <div style="background:#fafaf8;border-radius:16px;padding:16px 20px;margin-bottom:16px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="vertical-align:top;width:33%;padding:4px 0;">
              <p style="color:#888;font-size:11px;font-weight:500;text-transform:uppercase;margin:0 0 2px;">Ticket</p>
              <p style="color:${primaryColor};font-size:16px;font-weight:700;margin:0;">#SUP-042</p>
            </td>
            <td style="vertical-align:top;width:33%;padding:4px 0;">
              <p style="color:#888;font-size:11px;font-weight:500;text-transform:uppercase;margin:0 0 2px;">Category</p>
              <p style="color:${textColor};font-size:14px;font-weight:600;margin:0;">UI Glitch</p>
            </td>
            <td style="vertical-align:top;width:33%;padding:4px 0;">
              <p style="color:#888;font-size:11px;font-weight:500;text-transform:uppercase;margin:0 0 2px;">From</p>
              <p style="color:${textColor};font-size:14px;font-weight:600;margin:0;">John Doe</p>
            </td>
          </tr>
        </table>
      </div>
      <div style="border-top:1px solid #e8e5df;margin-bottom:16px;"></div>
      <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Description</p>
      <div style="background:#fafaf8;border-radius:16px;padding:16px 20px;border-left:4px solid ${primaryColor};">
        <p style="color:${textColor};font-size:14px;line-height:1.6;margin:0;">The schedule page flickers when switching between weeks on mobile. Happens consistently on iPhone 15.</p>
      </div>
      <div style="margin-top:24px;">${getCTAButton("#", "View in Croo")}</div>
    </td></tr>
    ${getEmailFooter()}`);
}

function writeupNotification(): string {
  return wrapEmail(`
    ${getUnifiedHeader("Write-up Notification")}
    <tr><td style="padding:30px 40px;">
      <p style="color:${textColor};font-size:15px;margin:0 0 20px;">You have received an employee write-up from management.</p>
      <div style="background:${backgroundColor};border-radius:10px;padding:20px;margin-bottom:24px;border-left:4px solid #ef4444;">
        <table style="width:100%;">
          <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Reason</span><br/><strong style="color:#ef4444;font-size:15px;">Tardiness</strong></td></tr>
          <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Issued By</span><br/><strong style="color:${textColor};font-size:14px;">Sarah Manager</strong></td></tr>
          <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Location</span><br/><strong style="color:${textColor};font-size:14px;">Downtown</strong></td></tr>
          <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Date</span><br/><strong style="color:${textColor};font-size:14px;">Apr 1, 2026</strong></td></tr>
        </table>
      </div>
      <div style="background:#fafafa;border-radius:10px;padding:16px;margin-bottom:16px;border-left:4px solid ${primaryColor};">
        <p style="color:#666;font-size:12px;text-transform:uppercase;margin:0 0 8px;">Issue Description</p>
        <p style="color:${textColor};font-size:14px;line-height:1.5;margin:0;">Employee was 15 minutes late to scheduled shift without prior notification.</p>
      </div>
      <div style="background:${backgroundColor};border-radius:10px;padding:16px;margin-bottom:20px;border-left:4px solid ${primaryColor};">
        <p style="color:#666;font-size:12px;text-transform:uppercase;margin:0 0 8px;">Next Steps</p>
        <p style="color:${textColor};font-size:14px;line-height:1.5;margin:0;">Please set an alarm and arrive on time for all future shifts.</p>
      </div>
      <p style="color:#666;font-size:13px;margin:0 0 20px;">Open the Croo app to review the full details and acknowledge this write-up.</p>
      <div style="margin-top:24px;">${getCTAButton("#", "Open Croo")}</div>
    </td></tr>
    ${getEmailFooter()}`);
}

function weeklyScheduleEmployee(): string {
  const shifts = [
    { day: "Monday, Feb 10", time: "9:00 AM – 5:00 PM" },
    { day: "Tuesday, Feb 11", time: "9:00 AM – 5:00 PM" },
    { day: "Wednesday, Feb 12", time: "10:00 AM – 6:00 PM" },
    { day: "Thursday, Feb 13", time: null },
    { day: "Friday, Feb 14", time: "8:00 AM – 4:00 PM" },
    { day: "Saturday, Feb 15", time: null },
    { day: "Sunday, Feb 16", time: null },
  ];
  const shiftRows = shifts
    .map((s) => {
      if (!s.time)
        return `<tr><td style="padding:10px 16px;border-bottom:1px solid #eee;"><strong style="color:${textColor};font-size:14px;">${s.day}</strong><br/><span style="color:#ccc;font-size:13px;">OFF</span></td></tr>`;
      return `<tr><td style="padding:10px 16px;border-bottom:1px solid #eee;"><strong style="color:${textColor};font-size:14px;">${s.day}</strong><br/><span style="color:${primaryColor};font-size:14px;font-weight:600;">${s.time}</span></td></tr>`;
    })
    .join("");

  return wrapEmail(`
    ${getUnifiedHeader("Your Schedule")}
    <tr><td style="padding:28px 32px;">
      <p style="color:${textColor};font-size:15px;margin:0 0 20px;">Hey Sarah! Your schedule for the week has been published.</p>
      <div style="background:#fafaf8;border-radius:16px;padding:16px;margin-bottom:20px;">
        <table style="width:100%;">${shiftRows}</table>
      </div>
      <div style="text-align:center;margin-bottom:20px;">
        <span style="display:inline-block;background:${primaryColor};color:#fff;padding:8px 20px;border-radius:20px;font-size:14px;font-weight:600;">4 shifts • 30.0 hours</span>
      </div>
    </td></tr>
    ${getEmailFooter()}`);
}

function performanceReviewSigned(): string {
  return wrapEmail(`
    ${getUnifiedHeader("Performance Review")}
    <tr><td style="padding:30px 40px;">
      <p style="color:${textColor};font-size:15px;margin:0 0 20px;">Thank you for reviewing and acknowledging your performance review.</p>
      <div style="background:${backgroundColor};border-radius:10px;padding:20px;margin-bottom:24px;">
        <table style="width:100%;">
          <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Reviewed By</span><br/><strong style="color:${textColor};font-size:14px;">Sarah Manager</strong></td></tr>
          <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Location</span><br/><strong style="color:${textColor};font-size:14px;">Downtown</strong></td></tr>
          <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Signed Date</span><br/><strong style="color:${textColor};font-size:14px;">Apr 1, 2026</strong></td></tr>
          <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Average Rating</span><br/><strong style="color:${primaryColor};font-size:18px;">⭐ 8.5/10</strong></td></tr>
        </table>
      </div>
      <p style="color:#666;font-size:13px;margin:0 0 20px;">Your signed review is saved in your employee records. Open the Croo app to view it anytime.</p>
      <div style="margin-top:24px;">${getCTAButton("#", "Open Croo")}</div>
    </td></tr>
    ${getEmailFooter()}`);
}

// ============================================================================
// PULSE EMAILS (from support-email-service)
// ============================================================================
function dailyPulse(): string {
  return wrapEmail(`
    ${getUnifiedHeader("Daily Pulse")}
    <tr><td style="padding:24px;">
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <tr>
          <td style="vertical-align:top;width:50%;padding-right:20px;">
            <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Sales</p>
            <p style="margin:0;"><strong style="color:${textColor};font-size:28px;">$2,742</strong></p>
            <p style="color:#888;font-size:13px;margin:4px 0 0;">Target: $3,100 (<span style="color:#ef4444;font-weight:600;">-$358</span>)</p>
            <table style="margin-top:8px;"><tr>
              <td style="padding-right:16px;"><span style="display:inline-block;background:#fef3c7;color:#78350f;border:1px solid #fcd34d;border-radius:20px;padding:2px 8px;font-size:11px;font-weight:600;">LW -4.2%</span></td>
              <td><span style="display:inline-block;background:#dcfce7;color:#166534;border:1px solid #86efac;border-radius:20px;padding:2px 8px;font-size:11px;font-weight:600;">LY +8.1%</span></td>
            </tr></table>
          </td>
          <td style="vertical-align:top;width:50%;text-align:right;border-left:1px solid #e8e5df;padding-left:20px;">
            <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Labor</p>
            <p style="margin:0;"><strong style="color:#22c55e;font-size:28px;">24.8%</strong></p>
            <p style="color:#888;font-size:13px;margin:4px 0 0;">$680 &middot; 42.5h</p>
            <p style="color:#22c55e;font-size:13px;font-weight:600;margin:4px 0 0;">-$45 vs 26% goal</p>
          </td>
        </tr>
      </table>
      <div style="border-top:1px solid #e8e5df;margin-bottom:20px;"></div>
      <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Checklists 2/3</p>
      <div style="background:#fafaf8;border-radius:16px;padding:12px 16px;margin-bottom:8px;">
        <table style="width:100%;border-collapse:collapse;"><tr>
          <td><p style="margin:0;font-size:13px;color:${textColor};font-weight:700;">Opening Checklist</p></td>
          <td style="text-align:right;"><span style="color:#888;font-size:12px;">8:15 AM</span> <span style="color:#22c55e;font-size:12px;font-weight:700;">100%</span></td>
        </tr><tr><td><p style="margin:2px 0 0;font-size:11px;color:#888;">John M.</p></td><td style="text-align:right;"><span style="font-size:11px;color:#888;">12/12 items</span></td></tr></table>
        <div style="background:#e0f2f1;border-radius:6px;height:6px;width:100%;overflow:hidden;margin-top:8px;"><div style="background:${primaryColor};height:100%;width:100%;border-radius:6px;"></div></div>
      </div>
      <div style="background:#fafaf8;border-radius:16px;padding:12px 16px;margin-bottom:8px;">
        <table style="width:100%;border-collapse:collapse;"><tr>
          <td><p style="margin:0;font-size:13px;color:${textColor};font-weight:700;">Food Safety</p></td>
          <td style="text-align:right;"><span style="color:#ef4444;font-size:12px;font-weight:700;">0%</span></td>
        </tr><tr><td><p style="margin:2px 0 0;font-size:11px;color:#ef4444;">Not Completed</p></td><td style="text-align:right;"><span style="font-size:11px;color:#888;">0/6 items</span></td></tr></table>
        <div style="background:#e0f2f1;border-radius:6px;height:6px;width:100%;overflow:hidden;margin-top:8px;"><div style="background:${primaryColor};height:100%;width:0%;border-radius:6px;"></div></div>
      </div>
      <div style="border-top:1px solid #e8e5df;margin:20px 0;"></div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;"><tr>
        <td style="vertical-align:top;width:50%;padding-right:16px;">
          <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 10px;">Safe Count</p>
          <div style="margin-bottom:10px;"><span style="display:inline-block;background:#fef3c7;color:#78350f;border:1px solid #fcd34d;border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700;">☀︎ AM</span> <span style="color:#22c55e;font-weight:600;font-size:13px;">Completed</span><p style="margin:4px 0 0;font-size:12px;color:#888;">John M. &middot; 8:30 AM</p></div>
          <div><span style="display:inline-block;background:#312e81;color:#e0e7ff;border:1px solid #4338ca;border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700;">☽ PM</span> <span style="color:#22c55e;font-weight:600;font-size:13px;">Completed</span><p style="margin:4px 0 0;font-size:12px;color:#888;">Sarah K. &middot; 9:45 PM</p></div>
        </td>
        <td style="vertical-align:top;border-left:1px solid #e8e5df;padding-left:16px;">
          <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 10px;">Drawer Count</p>
          <p style="margin:0 0 2px;font-size:13px;color:${textColor};font-weight:600;">$482.35 / $500.00</p>
          <p style="margin:0 0 2px;font-size:12px;"><span style="color:#ef4444;font-weight:600;">Under $17.65</span></p>
          <p style="margin:0;font-size:11px;color:#888;">9:55 PM - Sarah K.</p>
        </td>
      </tr></table>
      <div style="border-top:1px solid #e8e5df;margin-bottom:20px;"></div>
      <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Logbook 2 entries</p>
      <div style="background:#fafaf8;border-radius:12px;padding:10px 14px;margin-bottom:6px;">
        <p style="margin:0;font-size:13px;color:${textColor};font-weight:600;">Equipment Issue</p>
        <p style="margin:2px 0 0;font-size:12px;color:#888;">Oven 2 temp running 15° low — called for service. John M. &middot; 2:30 PM</p>
      </div>
      <div style="background:#fafaf8;border-radius:12px;padding:10px 14px;margin-bottom:6px;">
        <p style="margin:0;font-size:13px;color:${textColor};font-weight:600;">Customer Complaint</p>
        <p style="margin:2px 0 0;font-size:12px;color:#888;">Guest received wrong order, remade and comped. Sarah K. &middot; 6:15 PM</p>
      </div>
    </td></tr>
    ${getEmailFooter()}`);
}

function weeklyPulse(): string {
  return wrapEmail(`
    ${getUnifiedHeader("Weekly Pulse")}
    <tr><td style="padding:24px;">
      <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Sales Summary</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;"><tr>
        <td style="vertical-align:top;width:50%;padding-right:20px;">
          <p style="margin:0;"><strong style="color:${textColor};font-size:28px;">$18,420</strong></p>
          <p style="color:#888;font-size:13px;margin:4px 0 0;">Weekly Target: $19,500</p>
          <p style="color:#ef4444;font-size:13px;font-weight:600;margin:4px 0 0;">-$1,080 vs goal</p>
        </td>
        <td style="vertical-align:top;width:50%;text-align:right;border-left:1px solid #e8e5df;padding-left:20px;">
          <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Avg Labor</p>
          <p style="margin:0;"><strong style="color:#22c55e;font-size:28px;">25.2%</strong></p>
          <p style="color:#888;font-size:13px;margin:4px 0 0;">$4,642 total labor</p>
        </td>
      </tr></table>
      <div style="border-top:1px solid #e8e5df;margin-bottom:20px;"></div>
      <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Daily Breakdown</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;">
        <tr style="border-bottom:2px solid #e8e5df;">
          <td style="padding:8px 0;font-weight:700;color:${textColor};">Day</td>
          <td style="padding:8px 0;text-align:right;font-weight:700;color:${textColor};">Sales</td>
          <td style="padding:8px 0;text-align:right;font-weight:700;color:${textColor};">Labor%</td>
          <td style="padding:8px 0;text-align:right;font-weight:700;color:${textColor};">vs Goal</td>
        </tr>
        ${["Mon,$2,180,23.1%,+$80", "Tue,$2,420,24.5%,+$120", "Wed,$2,850,22.8%,+$350", "Thu,$2,540,26.2%,-$60", "Fri,$3,210,25.8%,+$510", "Sat,$3,080,27.1%,-$120", "Sun,$2,140,25.4%,-$360"].map(row => {
          const [day, sales, labor, diff] = row.split(",");
          const isNeg = diff.startsWith("-");
          return `<tr style="border-bottom:1px solid #f0ebe1;">
            <td style="padding:8px 0;color:${textColor};">${day}</td>
            <td style="padding:8px 0;text-align:right;color:${textColor};font-weight:600;">${sales}</td>
            <td style="padding:8px 0;text-align:right;color:#888;">${labor}</td>
            <td style="padding:8px 0;text-align:right;color:${isNeg ? '#ef4444' : '#22c55e'};font-weight:600;">${diff}</td>
          </tr>`;
        }).join("")}
      </table>
      <div style="border-top:1px solid #e8e5df;margin-bottom:20px;"></div>
      <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Checklist Completion</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="border-bottom:1px solid #e8e5df;"><td style="padding:6px 0;color:${textColor};font-weight:600;">Opening</td><td style="padding:6px 0;text-align:right;color:#22c55e;font-weight:700;">7/7 days</td></tr>
        <tr style="border-bottom:1px solid #e8e5df;"><td style="padding:6px 0;color:${textColor};font-weight:600;">Closing</td><td style="padding:6px 0;text-align:right;color:#22c55e;font-weight:700;">7/7 days</td></tr>
        <tr style="border-bottom:1px solid #e8e5df;"><td style="padding:6px 0;color:${textColor};font-weight:600;">Food Safety</td><td style="padding:6px 0;text-align:right;color:#ef4444;font-weight:700;">4/7 days</td></tr>
      </table>
    </td></tr>
    ${getEmailFooter()}`);
}

// ============================================================================
// TEMPLATE REGISTRY
// ============================================================================
interface EmailTemplate {
  id: string;
  name: string;
  category: "auth" | "hiring" | "operations" | "notifications";
  source: string; // "auth-email-hook" | "user-service" | etc.
  html: string;
}

const ALL_TEMPLATES: EmailTemplate[] = [
  // Auth emails (from auth-email-hook — currently Supabase default sender)
  { id: "auth-reset", name: "Password Reset", category: "auth", source: "auth-email-hook", html: authPasswordReset() },
  { id: "auth-confirm", name: "Email Confirmation", category: "auth", source: "auth-email-hook", html: authEmailConfirmation() },
  { id: "auth-magic", name: "Magic Link", category: "auth", source: "auth-email-hook", html: authMagicLink() },
  { id: "auth-invite", name: "Supabase Invite", category: "auth", source: "auth-email-hook", html: authInvite() },

  // Hiring emails (via Resend)
  { id: "hire-invite", name: "Employee Invite", category: "hiring", source: "user-service → Resend", html: employeeInvite() },
  { id: "hire-resend", name: "Re-send Invite", category: "hiring", source: "user-service → Resend", html: resendInvite() },
  { id: "hire-interview", name: "Interview Invitation", category: "hiring", source: "hiring-email-service → Resend", html: interviewInvite() },
  { id: "hire-rejection", name: "Rejection Email", category: "hiring", source: "hiring-email-service → Resend", html: rejectionEmail() },
  { id: "hire-new-app", name: "New Application Alert", category: "hiring", source: "hiring-email-service → Resend", html: newApplicationNotification() },

  // Operations / Pulse emails
  { id: "ops-daily-pulse", name: "Daily Pulse", category: "operations", source: "support-email-service → Resend", html: dailyPulse() },
  { id: "ops-weekly-pulse", name: "Weekly Pulse", category: "operations", source: "support-email-service → Resend", html: weeklyPulse() },
  { id: "ops-schedule", name: "Weekly Schedule (Employee)", category: "operations", source: "send-weekly-schedule-email → Resend", html: weeklyScheduleEmployee() },
  { id: "ops-support", name: "Support Ticket", category: "operations", source: "support-email-service → Resend", html: supportTicket() },

  // Notification emails (via Resend)
  { id: "notif-writeup", name: "Write-up Notification", category: "notifications", source: "send-notification-email → Resend", html: writeupNotification() },
  { id: "notif-review", name: "Performance Review Signed", category: "notifications", source: "send-notification-email → Resend", html: performanceReviewSigned() },
];

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  auth: { label: "Auth (System)", color: "bg-red-100 text-red-700 border-red-200" },
  hiring: { label: "Hiring", color: "bg-blue-100 text-blue-700 border-blue-200" },
  operations: { label: "Operations", color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  notifications: { label: "Notifications", color: "bg-amber-100 text-amber-700 border-amber-200" },
};

// ============================================================================
// COMPONENT
// ============================================================================
export default function EmailPreview() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string>(ALL_TEMPLATES[0].id);
  const [filterCat, setFilterCat] = useState<string | null>(null);
  const [showLogoCompare, setShowLogoCompare] = useState(false);

  const filteredTemplates = filterCat
    ? ALL_TEMPLATES.filter((t) => t.category === filterCat)
    : ALL_TEMPLATES;

  const current = ALL_TEMPLATES.find((t) => t.id === selected) ?? ALL_TEMPLATES[0];

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-card">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Mail className="h-5 w-5 text-primary" />
        <h1 className="text-base font-medium">Email Template Preview</h1>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => setShowLogoCompare(!showLogoCompare)}>
          {showLogoCompare ? "Hide" : "Compare"} Logos
        </Button>
        <span className="text-xs text-muted-foreground">{ALL_TEMPLATES.length} templates</span>
      </div>

      {showLogoCompare && (
        <div className="border-b bg-muted/30 px-6 py-4">
          <p className="text-sm font-medium mb-3">Choose the logo for all emails:</p>
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Transparent (website)", src: "/croo-logo-transparent.webp", bg: "bg-white" },
              { label: "White (for dark headers)", src: "/croo-logo-white.webp", bg: "bg-[#0a7a8a]" },
              { label: "Standard colored", src: "/croo-logo.png", bg: "bg-white" },
              { label: "Current (old Vite hash)", src: "https://lmodeiyrpwvgyqcvjkjr.supabase.co/storage/v1/object/public/email-assets/croo-logo-white.webp", bg: "bg-white" },
            ].map((logo) => (
              <div key={logo.label} className="flex flex-col items-center gap-2">
                <div className={`${logo.bg} rounded-xl p-4 w-full flex items-center justify-center h-24 border`}>
                  <img src={logo.src} alt={logo.label} className="max-h-16 max-w-full object-contain" />
                </div>
                <span className="text-xs text-muted-foreground text-center">{logo.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-72 border-r flex flex-col bg-card">
          {/* Category filters */}
          <div className="flex flex-wrap gap-1.5 p-3 border-b">
            <button
              onClick={() => setFilterCat(null)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                filterCat === null ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:bg-muted"
              }`}
            >
              All
            </button>
            {Object.entries(CATEGORY_LABELS).map(([key, { label }]) => (
              <button
                key={key}
                onClick={() => setFilterCat(key === filterCat ? null : key)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  filterCat === key ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:bg-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {filteredTemplates.map((t) => {
                const cat = CATEGORY_LABELS[t.category];
                return (
                  <button
                    key={t.id}
                    onClick={() => setSelected(t.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors ${
                      selected === t.id
                        ? "bg-primary/10 border border-primary/30"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{t.name}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${cat.color}`}>
                        {cat.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground truncate">{t.source}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        {/* Preview area */}
        <div className="flex-1 flex flex-col">
          <div className="flex items-center gap-3 px-4 py-2 border-b bg-muted/30">
            <span className="text-sm font-medium">{current.name}</span>
            <Badge variant="outline" className="text-[10px]">
              {current.source}
            </Badge>
            <Badge variant="outline" className={`text-[10px] ${CATEGORY_LABELS[current.category].color}`}>
              {CATEGORY_LABELS[current.category].label}
            </Badge>
          </div>
          <div className="flex-1 bg-[#e5e5e5] overflow-auto flex justify-center p-6">
            <iframe
              key={current.id}
              srcDoc={current.html}
              title={current.name}
              className="w-full max-w-[800px] bg-transparent border-0 rounded-lg shadow-lg"
              style={{ minHeight: "700px" }}
              sandbox="allow-same-origin"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
