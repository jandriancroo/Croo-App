import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ImageCropDialog } from '@/components/ImageCropDialog';
import { EmployeeProfileDialog } from '@/components/users/EmployeeProfileDialog';
import { BulkActionsBar } from '@/components/users/BulkActionsBar';
import { BulkWageUpdateDialog } from '@/components/users/BulkWageUpdateDialog';
import { I9RequestDialog } from '@/components/users/I9RequestDialog';
import { Loader2, Camera, Copy, Trash2 } from 'lucide-react';
import { type AppRole } from '@/hooks/useUserRole';

interface UserManagementDialogsProps {
  data: ReturnType<typeof import('@/hooks/useUserManagementData').useUserManagementData>;
}

export const UserManagementDialogs = ({ data }: UserManagementDialogsProps) => {
  return (
    <>
      {/* Invite Dialog */}
      <Dialog open={data.inviteDialogOpen} onOpenChange={data.setInviteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite New User</DialogTitle>
            <DialogDescription>Send an invitation to a new user to join the platform</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Profile Photo (Optional)</Label>
              <div className="flex flex-col items-center gap-4">
                <Avatar className="h-20 w-20">
                  <AvatarImage src={data.inviteProfilePhoto || undefined} />
                  <AvatarFallback><Camera className="h-6 w-6 text-muted-foreground" /></AvatarFallback>
                </Avatar>
                <input ref={data.photoInputRef} type="file" accept="image/*" onChange={data.handlePhotoUpload} className="hidden" />
                <Button type="button" variant="outline" onClick={() => data.photoInputRef.current?.click()} disabled={data.uploadingPhoto} size="sm">
                  <Camera className="mr-2 h-4 w-4" />
                  {data.inviteProfilePhoto ? 'Change Photo' : 'Add Photo'}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input id="invite-email" type="email" value={data.inviteEmail} onChange={(e) => data.setInviteEmail(e.target.value)} placeholder="user@example.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-name">Full Name</Label>
              <Input id="invite-name" value={data.inviteFullName} onChange={(e) => data.setInviteFullName(e.target.value)} placeholder="John Doe" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-role">Role</Label>
              <Select value={data.inviteRole} onValueChange={(value: AppRole) => data.setInviteRole(value)}>
                <SelectTrigger id="invite-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="team_member">Team Member</SelectItem>
                  <SelectItem value="shift_manager">Shift Manager</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="org_admin">Org Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => data.setInviteDialogOpen(false)}>Cancel</Button>
            <Button className="flex-1" onClick={data.handleInviteUser} disabled={data.inviting}>
              {data.inviting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Inviting...</> : 'Send Invitation'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Employee Profile Dialog */}
      <EmployeeProfileDialog
        open={data.isProfileDialogOpen}
        onOpenChange={data.setIsProfileDialogOpen}
        user={data.viewingUser}
        availableLocations={data.availableLocations}
        currentLocationId={data.currentLocation?.id}
        onUserUpdated={data.fetchUsers}
        onResetPassword={data.handleResetPassword}
        onSetTempPassword={(u) => { data.setTempPasswordUser(u); data.setTempPassword(''); data.setIsTempPasswordDialogOpen(true); }}
        onOpenWageDialog={(u) => { data.setEditingWageUser(u); data.setNewWage(u.hourly_wage?.toString() || '15.00'); data.setIsWageDialogOpen(true); }}
        onOpenWageHistory={(userId) => { data.setViewingWageHistory(userId); data.setIsWageHistoryDialogOpen(true); }}
        onResendInvite={data.handleOpenResendDialog}
      />

      {/* Resend Invite Dialog */}
      <Dialog open={data.isResendDialogOpen} onOpenChange={data.setIsResendDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-invite User</DialogTitle>
            <DialogDescription>Send a new invitation to this user. You can optionally change their email address.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="resend-email">Email Address</Label>
              <Input id="resend-email" type="email" value={data.newEmail} onChange={(e) => data.setNewEmail(e.target.value)} placeholder="user@example.com" />
              <p className="text-xs text-muted-foreground">
                {data.newEmail !== data.resendUser?.email ? "A new invitation will be sent to this email address" : "The invitation will be resent to the current email"}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => data.setIsResendDialogOpen(false)}>Cancel</Button>
            <Button onClick={data.handleResendInvite}>Send Invitation</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Password Reset Dialog */}
      <Dialog open={data.isResetPasswordDialogOpen} onOpenChange={data.setIsResetPasswordDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Password Reset Link for {data.resetPasswordUserName}</DialogTitle>
            <DialogDescription>Share this link with the user so they can reset their password. The link expires after use.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="flex-1 p-3 bg-muted rounded-md border font-mono text-xs break-all">{data.resetPasswordLink}</div>
              <Button variant="outline" size="icon" onClick={data.copyResetLink}><Copy className="h-4 w-4" /></Button>
            </div>
            <p className="text-sm text-muted-foreground">Send this link to the user via your preferred method. They can use it to set a new password.</p>
          </div>
          <DialogFooter><Button onClick={() => data.setIsResetPasswordDialogOpen(false)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite Link Dialog */}
      <Dialog open={data.isInviteLinkDialogOpen} onOpenChange={data.setIsInviteLinkDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>User Invited Successfully</DialogTitle>
            <DialogDescription>Share this link with the new team member so they can set up their password and access the app.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="flex-1 p-3 bg-muted rounded-md border font-mono text-xs break-all">{data.inviteResetLink}</div>
              <Button variant="outline" size="icon" onClick={data.copyInviteLink}><Copy className="h-4 w-4" /></Button>
            </div>
            <p className="text-sm text-muted-foreground">Send this link via text, email, or any method you prefer. The link allows them to set their password.</p>
          </div>
          <DialogFooter><Button onClick={() => data.setIsInviteLinkDialogOpen(false)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Wage Dialog */}
      <Dialog open={data.isWageDialogOpen} onOpenChange={data.setIsWageDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Hourly Wage</DialogTitle>
            <DialogDescription>Set a new hourly wage with an effective date for {data.editingWageUser?.full_name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="wage-input">Hourly Wage ($)</Label>
              <Input id="wage-input" type="number" step="0.01" min="0" value={data.newWage} onChange={(e) => data.setNewWage(e.target.value)} placeholder="15.00" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wage-date">Effective Date</Label>
              <Input id="wage-date" type="date" value={data.wageEffectiveDate} onChange={(e) => data.setWageEffectiveDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wage-notes">Internal Notes (Optional)</Label>
              <Textarea id="wage-notes" placeholder="Reason for wage change (admin/manager only)..." value={data.wageNotes} onChange={(e) => data.setWageNotes(e.target.value)} className="min-h-[80px]" />
              <p className="text-xs text-muted-foreground">Only visible to admins and managers</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { data.setIsWageDialogOpen(false); data.setEditingWageUser(null); data.setNewWage(''); data.setWageNotes(''); }}>Cancel</Button>
            <Button onClick={data.handleUpdateWage}>Save Wage</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Wage History Dialog */}
      <Dialog open={data.isWageHistoryDialogOpen} onOpenChange={(open) => { data.setIsWageHistoryDialogOpen(open); if (!open) { data.setViewingWageHistory(null); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Wage History</DialogTitle>
            <DialogDescription>View all wage changes for this employee</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {data.wageHistory.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No wage history found</p>
            ) : (
              <div className="space-y-3">
                {data.wageHistory.map((entry: any) => (
                  <div key={entry.id} className="p-3 border rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-semibold">${parseFloat(entry.hourly_wage).toFixed(2)}</span>
                          <span className="text-sm text-muted-foreground">/hour</span>
                        </div>
                        <p className="text-sm text-muted-foreground">Effective: {new Date(entry.effective_date).toLocaleDateString()}</p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => data.handleDeleteWageHistory(entry.id)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                    {entry.notes && (
                      <div className="pt-2 border-t">
                        <p className="text-xs text-muted-foreground mb-1">Internal Notes:</p>
                        <p className="text-sm">{entry.notes}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter><Button onClick={() => data.setIsWageHistoryDialogOpen(false)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Image Crop Dialog */}
      <ImageCropDialog open={data.cropDialogOpen} onOpenChange={data.setCropDialogOpen} imageSrc={data.tempImageSrc} onCropComplete={data.handleCropComplete} />

      {/* Bulk Actions Bar - Admin only */}
      {data.isAdmin && (
        <BulkActionsBar
          selectedCount={data.selectedUsers.size}
          onDeactivate={() => data.setIsBulkDeactivateOpen(true)}
          onWageUpdate={() => data.setIsBulkWageOpen(true)}
          onRequestI9={() => data.setIsBulkI9Open(true)}
          onForceUpdate={data.handleBulkForceUpdate}
          onClearSelection={() => { data.setSelectedUsers(new Set()); data.setBulkMode(false); }}
          isUpdating={data.bulkUpdating}
        />
      )}

      {/* Bulk Deactivate Confirmation */}
      <AlertDialog open={data.isBulkDeactivateOpen} onOpenChange={data.setIsBulkDeactivateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bulk Deactivate Users</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to deactivate {data.selectedUsers.size} user(s)? They will no longer be able to access the system.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={data.handleBulkDeactivate} disabled={data.bulkUpdating}>{data.bulkUpdating ? 'Deactivating...' : 'Deactivate'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Wage Update Dialog */}
      <BulkWageUpdateDialog open={data.isBulkWageOpen} onOpenChange={data.setIsBulkWageOpen} selectedCount={data.selectedUsers.size} onConfirm={data.handleBulkWageUpdate} updating={data.bulkUpdating} />

      {/* Set Temporary Password Dialog */}
      <Dialog open={data.isTempPasswordDialogOpen} onOpenChange={(open) => { data.setIsTempPasswordDialogOpen(open); if (!open) { data.setTempPassword(''); data.setTempPasswordUser(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Temporary Password</DialogTitle>
            <DialogDescription>Set a temporary password for {data.tempPasswordUser?.full_name || data.tempPasswordUser?.email}. They can change it after logging in.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="temp-password">Temporary Password</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => data.setTempPassword(generateTempPassword())}
                >
                  Generate
                </Button>
              </div>
              <Input id="temp-password" type="text" value={data.tempPassword} onChange={(e) => data.setTempPassword(e.target.value)} placeholder="Enter temporary password" minLength={PASSWORD_MIN_LENGTH} />
              <ul className="space-y-1 pt-1">
                {checkPassword(data.tempPassword).rules.map((rule) => (
                  <li
                    key={rule.label}
                    className={`text-xs flex items-center gap-1.5 ${rule.met ? 'text-emerald-600' : 'text-muted-foreground'}`}
                  >
                    <span aria-hidden="true">{rule.met ? '✓' : '•'}</span>
                    {rule.label}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">Share this password with the employee so they can log in.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => data.setIsTempPasswordDialogOpen(false)}>Cancel</Button>
            <Button onClick={data.handleSetTempPassword} disabled={data.settingTempPassword || !checkPassword(data.tempPassword).valid}>
              {data.settingTempPassword ? 'Setting...' : 'Set Password'}
            </Button>

          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk I9 Request */}
      <I9RequestDialog
        open={data.isBulkI9Open}
        onOpenChange={data.setIsBulkI9Open}
        employees={Array.from(data.selectedUsers).map(id => {
          const u = data.users.find((usr: any) => usr.id === id);
          return { id, full_name: u?.full_name || u?.email || 'Unknown' };
        })}
      />
    </>
  );
};
