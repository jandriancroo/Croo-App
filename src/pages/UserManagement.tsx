import { Layout } from '@/components/Layout';
import { PageTitle } from '@/components/PageTitle';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogTrigger } from '@/components/ui/dialog';
import { Loader2, UserPlus, FlaskConical, RefreshCw, Globe } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUserManagementData } from '@/hooks/useUserManagementData';
import { UserManagementTable } from '@/components/users/UserManagementTable';
import { UserManagementDialogs } from '@/components/users/UserManagementDialogs';

export default function UserManagement() {
  const data = useUserManagementData();
  const navigate = useNavigate();

  if (data.roleLoading || !data.canAccessPage) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-4">
        <div>
          <PageTitle color="cyan">User Management</PageTitle>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <CardDescription>Manage user roles and permissions</CardDescription>
              {data.isAdmin && (
                <div className="flex items-center gap-2">
                  {data.currentLocation?.name?.toLowerCase() === 'hemet' && (
                    <Button variant="outline" className="gap-2" onClick={data.handleCreateTestEmployee} disabled={data.creatingTestUser}>
                      {data.creatingTestUser ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
                      <span className="hidden sm:inline">Add Test Employee</span>
                    </Button>
                  )}
                  {data.isSuperAdmin && (
                    <Button variant="outline" className="gap-2" onClick={data.handleUniversalUpdate} disabled={data.updatingOutdated}>
                      {data.updatingOutdated ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
                      <span className="hidden sm:inline">Universal Update</span>
                      <span className="sm:hidden">Update</span>
                    </Button>
                  )}
                  {data.outdatedUsers.length > 0 && !data.isSuperAdmin && (
                    <Button variant="outline" className="gap-2" onClick={data.handleUpdateAllOutdated} disabled={data.updatingOutdated}>
                      {data.updatingOutdated ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      <span className="hidden sm:inline">Update {data.outdatedUsers.length} Outdated</span>
                      <span className="sm:hidden">{data.outdatedUsers.length}</span>
                    </Button>
                  )}
                  <Dialog open={data.inviteDialogOpen} onOpenChange={data.setInviteDialogOpen}>
                    <DialogTrigger asChild>
                      <Button className="gap-2 flex-1 md:flex-none">
                        <UserPlus className="h-4 w-4" />
                        <span className="hidden sm:inline">Invite User</span>
                        <span className="sm:hidden">Invite</span>
                      </Button>
                    </DialogTrigger>
                  </Dialog>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="px-2 sm:px-6">
            <UserManagementTable
              users={data.users}
              loading={data.loading}
              activeTab={data.activeTab}
              setActiveTab={data.setActiveTab}
              bulkMode={data.bulkMode}
              setBulkMode={data.setBulkMode}
              selectedUsers={data.selectedUsers}
              setSelectedUsers={data.setSelectedUsers}
              toggleUserSelection={data.toggleUserSelection}
              toggleSelectAll={data.toggleSelectAll}
              isAdmin={data.isAdmin}
              isSuperAdmin={data.isSuperAdmin}
              currentVersion={data.currentVersion}
              onViewUser={(u) => { data.setViewingUser(u); data.setIsProfileDialogOpen(true); }}
            />
          </CardContent>
        </Card>

        {/* Certifications Section */}
        <div className="border-t pt-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Certifications</h2>
              <p className="text-sm text-muted-foreground">Track food handler cards and ServSafe certifications</p>
            </div>
            <Button onClick={() => navigate('/certifications')} variant="outline">Manage Certifications</Button>
          </div>
        </div>

        <UserManagementDialogs data={data} />
      </div>
    </Layout>
  );
}
