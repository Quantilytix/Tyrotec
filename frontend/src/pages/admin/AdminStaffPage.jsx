import { useEffect, useState } from 'react';
import {
  getStaff,
  getStaffInvites,
  inviteStaff,
  revokeStaffInvite,
  changeStaffRole,
  changeStaffStatus,
  removeStaff,
  getPendingStaffAdmin,
  reviewStaffSignupAdmin,
} from '../../api/staff';
import { useAuth } from '../../context/AuthContext';
import { formatDate } from '../../utils/formatters';
import { ROLE_LABELS, isSuperAdmin } from '../../utils/roles';
import Button from '../../components/ui/Button';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import Card from '../../components/ui/Card';
import Modal from '../../components/ui/Modal';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import InviteStaffModal from '../../components/admin/InviteStaffModal';

const STATUS_STYLES = {
  approved: 'bg-good-50 text-good-500',
  pending: 'bg-amber-50 text-amber-600',
  suspended: 'bg-bad-50 text-bad-500',
  rejected: 'bg-slate-100 text-slate-500',
};

const INVITE_STATUS_STYLES = {
  open: 'bg-amber-50 text-amber-600',
  accepted: 'bg-good-50 text-good-500',
  expired: 'bg-slate-100 text-slate-500',
  revoked: 'bg-slate-100 text-slate-500',
};

function Pill({ label, className }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium capitalize ${className}`}>
      {label}
    </span>
  );
}

export default function AdminStaffPage() {
  const { user } = useAuth();
  const superAdmin = isSuperAdmin(user?.role);

  const [staff, setStaff] = useState([]);
  const [invites, setInvites] = useState([]);
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(null);

  const load = () =>
    Promise.all([getStaff(), getStaffInvites(), getPendingStaffAdmin()]).then(([s, i, p]) => {
      setStaff(s.data);
      setInvites(i.data);
      setPending(p.data);
    });

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  // Every action follows the same shape: mark the row busy, run it, reload,
  // and surface whatever the API refused with (last super admin, own account).
  const run = async (id, action, fallback) => {
    setError('');
    setBusyId(id);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err.response?.data?.error || fallback);
    } finally {
      setBusyId(null);
      setConfirmingRemove(null);
    }
  };

  const handleInvite = async (payload) => {
    const { data } = await inviteStaff(payload);
    await load();
    return data;
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">Staff</h1>
          <p className="mt-1 text-sm text-slate-500">
            Staff accounts are created by invitation only.
            {!superAdmin && ' Only a super admin can change roles or suspend an account.'}
          </p>
        </div>
        <Button onClick={() => setShowInvite(true)}>Invite staff member</Button>
      </div>

      {error && <p className="mt-4 rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-500">{error}</p>}

      {/* Accounts that asked for staff access before invitations existed. */}
      {pending.length > 0 && (
        <Card className="mt-6 overflow-hidden">
          <div className="border-b border-slate-100 bg-amber-50/60 px-4 py-3">
            <p className="text-sm font-medium text-ink">Pending requests</p>
            <p className="text-xs text-slate-500">Older self-signup requests awaiting a decision.</p>
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {pending.map((request) => (
                <tr key={request.id}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">{request.full_name || '—'}</p>
                    <p className="text-xs text-slate-400">{request.email}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{ROLE_LABELS[request.role] || request.role}</td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(request.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => run(request.id, () => reviewStaffSignupAdmin(request.id, 'approved'), 'Could not approve this request.')}
                      disabled={busyId === request.id}
                      className="text-xs font-medium text-teal-600 hover:underline disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => run(request.id, () => reviewStaffSignupAdmin(request.id, 'rejected'), 'Could not reject this request.')}
                      disabled={busyId === request.id}
                      className="ml-3 text-xs font-medium text-bad-500 hover:underline disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card className="mt-6 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Joined</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {staff.map((member) => {
              const isSelf = member.id === user?.id;
              return (
                <tr key={member.id}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">
                      {member.full_name || member.company_name || '—'}
                      {isSelf && <span className="ml-2 text-xs font-normal text-slate-400">(you)</span>}
                    </p>
                    <p className="text-xs text-slate-400">{member.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    {superAdmin && !isSelf ? (
                      <select
                        value={member.role}
                        onChange={(e) => run(member.id, () => changeStaffRole(member.id, e.target.value), 'Could not change this role.')}
                        disabled={busyId === member.id}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-xs outline-none focus:border-teal-500"
                      >
                        <option value="sales_rep">{ROLE_LABELS.sales_rep}</option>
                        <option value="admin">{ROLE_LABELS.admin}</option>
                        <option value="super_admin">{ROLE_LABELS.super_admin}</option>
                      </select>
                    ) : (
                      <span className="text-slate-600">{ROLE_LABELS[member.role] || member.role}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Pill label={member.status} className={STATUS_STYLES[member.status] || STATUS_STYLES.rejected} />
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(member.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    {superAdmin && !isSelf && (
                      <>
                        <button
                          onClick={() =>
                            run(
                              member.id,
                              () => changeStaffStatus(member.id, member.status === 'suspended' ? 'approved' : 'suspended'),
                              'Could not change this account.'
                            )
                          }
                          disabled={busyId === member.id}
                          className="text-xs font-medium text-teal-600 hover:underline disabled:opacity-50"
                        >
                          {member.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                        </button>
                        <button
                          onClick={() => setConfirmingRemove(member)}
                          disabled={busyId === member.id}
                          className="ml-3 text-xs font-medium text-bad-500 hover:underline disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <h2 className="mt-8 font-display text-base font-semibold text-ink">Invitations</h2>
      {invites.length === 0 ? (
        <div className="mt-3">
          <EmptyState title="No invitations yet" description="Invite someone to give them staff access." />
        </div>
      ) : (
        <Card className="mt-3 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Invited</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invites.map((invite) => (
                <tr key={invite.id}>
                  <td className="px-4 py-3">
                    <p className="text-ink">{invite.email}</p>
                    {invite.full_name && <p className="text-xs text-slate-400">{invite.full_name}</p>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{ROLE_LABELS[invite.role] || invite.role}</td>
                  <td className="px-4 py-3">
                    <Pill label={invite.status} className={INVITE_STATUS_STYLES[invite.status]} />
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(invite.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    {invite.status === 'open' && (
                      <button
                        onClick={() => run(invite.id, () => revokeStaffInvite(invite.id), 'Could not cancel this invitation.')}
                        disabled={busyId === invite.id}
                        className="text-xs font-medium text-bad-500 hover:underline disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {showInvite && (
        <Modal title="Invite a staff member" onClose={() => setShowInvite(false)}>
          <InviteStaffModal
            onInvite={handleInvite}
            canInviteSuperAdmin={superAdmin}
            onClose={() => setShowInvite(false)}
          />
        </Modal>
      )}

      {confirmingRemove && (
        <ConfirmDialog
          title="Remove this staff member?"
          message={`${confirmingRemove.email} will lose access immediately. Their past orders, payments and audit entries stay on record. This can't be undone — suspending them instead keeps the account.`}
          confirmLabel="Remove account"
          onConfirm={() => run(confirmingRemove.id, () => removeStaff(confirmingRemove.id), 'Could not remove this account.')}
          onCancel={() => setConfirmingRemove(null)}
          loading={busyId === confirmingRemove.id}
        />
      )}
    </div>
  );
}
