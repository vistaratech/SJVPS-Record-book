/**
 * Firebase-based Auth, User Management, Activity Logs & Download Requests.
 * Replaces ALL serverApi.ts functions — no backend server needed.
 *
 * Firestore collections:
 *   app_users           — user accounts with hashed passwords, roles, permissions
 *   app_activity         — activity/audit log entries
 *   app_download_requests — download approval requests
 */

import { db } from './firebase';
import {
  collection, doc, getDocs, getDoc, setDoc, deleteDoc,
  query, where, updateDoc,
} from 'firebase/firestore';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

/** SHA-256 hash using browser-native Web Crypto API */
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + '__sjvps_salt_2024__');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Collections ─────────────────────────────────────────────────────────────

const usersCol = () => collection(db, 'app_users');
const userDoc = (id: string) => doc(db, 'app_users', id);
const activityCol = () => collection(db, 'app_activity');
const dlRequestsCol = () => collection(db, 'app_download_requests');
const dlRequestDoc = (id: string) => doc(db, 'app_download_requests', id);

// ─── User Types ──────────────────────────────────────────────────────────────

export interface AppUser {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: 'superadmin' | 'admin' | 'sheet_admin' | 'user';
  status: 'active' | 'inactive';
  createdAt: string;
  lastLogin?: string;
  permissions: {
    canView: boolean;
    canEdit: boolean;
    canDownload: boolean;
    isAdmin: boolean;
    canCreateSheets?: boolean;
    viewRestrictions?: Record<string, number[]> | null;
    editRestrictions?: Record<string, number[]> | null;
    downloadRestrictions?: Record<string, number[]> | null;
    createRestrictions?: Record<string, boolean> | null;
    rowViewRestrictions?: Record<string, { start?: number; end?: number }> | null;
    rowEditRestrictions?: Record<string, { start?: number; end?: number }> | null;
    rowDownloadRestrictions?: Record<string, { start?: number; end?: number }> | null;
    fullSheetAccess?: boolean;
  };
}

function userWithoutPassword(u: AppUser) {
  const { passwordHash, ...safe } = u;
  return safe;
}

// ─── Bootstrap: Ensure default admin exists ──────────────────────────────────

let bootstrapped = false;

export async function ensureDefaultAdmin(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;

  // Check if any superadmin exists
  const q = query(usersCol(), where('role', '==', 'superadmin'));
  const snap = await getDocs(q);
  
  if (snap.size > 0) {
    // Cleanup: Remove any duplicate users with the same email as the superadmin
    const superadminEmail = snap.docs[0].data().email;
    const dupeQuery = query(usersCol(), where('email', '==', superadminEmail));
    const dupeSnap = await getDocs(dupeQuery);
    if (dupeSnap.size > 1) {
      const superadminId = snap.docs[0].id;
      for (const doc of dupeSnap.docs) {
        if (doc.id !== superadminId) {
          await deleteDoc(userDoc(doc.id));
          console.log(`🧹 Removed duplicate user: ${doc.id} (${doc.data().role})`);
        }
      }
    }
    return;
  }

  const id = generateId();
  const hash = await hashPassword('admin123');
  const admin: AppUser = {
    id,
    name: 'Admin',
    email: 'admin@sjvps.com',
    passwordHash: hash,
    role: 'superadmin',
    status: 'active',
    createdAt: new Date().toISOString(),
    permissions: {
      canView: true,
      canEdit: true,
      canDownload: true,
      isAdmin: true,
      canCreateSheets: true,
    },
  };
  await setDoc(userDoc(id), admin);
  console.log('🔑 Default admin created: admin@sjvps.com / admin123');
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export async function firebaseLogin(email: string, password: string) {
  await ensureDefaultAdmin();

  const q = query(usersCol(), where('email', '==', email.toLowerCase().trim()));
  const snap = await getDocs(q);
  if (snap.empty) throw new Error('Invalid email or password');

  const userData = snap.docs[0].data() as AppUser;

  if (userData.status === 'inactive') {
    throw new Error('Account is deactivated. Contact your administrator.');
  }

  const hash = await hashPassword(password);
  if (hash !== userData.passwordHash) {
    throw new Error('Invalid email or password');
  }

  // Record login time
  await updateDoc(userDoc(userData.id), { lastLogin: new Date().toISOString() });
  await logActivity(userData.id, userData.name, 'login', `User logged in: ${userData.email}`);

  // Generate a simple token (user ID + timestamp + random)
  const token = btoa(JSON.stringify({
    id: userData.id,
    email: userData.email,
    role: userData.role,
    ts: Date.now(),
  }));

  return {
    token,
    user: userWithoutPassword(userData),
  };
}

export async function firebaseAdminLogin(email: string, password: string) {
  const result = await firebaseLogin(email, password);

  if (result.user.role !== 'admin' && result.user.role !== 'superadmin') {
    throw new Error('You do not have admin access');
  }

  await logActivity(result.user.id, result.user.name, 'admin_login', `Admin logged in: ${result.user.email}`);

  return result;
}

export async function firebaseGetMe(token: string) {
  try {
    const decoded = JSON.parse(atob(token));
    const snap = await getDoc(userDoc(decoded.id));
    if (!snap.exists()) throw new Error('User not found');
    const userData = snap.data() as AppUser;
    return { user: userWithoutPassword(userData) };
  } catch {
    throw new Error('Invalid token');
  }
}

export async function firebaseLogout(_token: string) {
  // With Firebase, we just clear the local token (done client-side)
  // Optionally log
  try {
    const decoded = JSON.parse(atob(_token));
    await logActivity(decoded.id, decoded.email, 'logout', `User logged out: ${decoded.email}`);
  } catch { }
}

export async function firebaseChangePassword(token: string, currentPassword: string, newPassword: string) {
  const decoded = JSON.parse(atob(token));
  const snap = await getDoc(userDoc(decoded.id));
  if (!snap.exists()) throw new Error('User not found');

  const userData = snap.data() as AppUser;
  const currentHash = await hashPassword(currentPassword);
  if (currentHash !== userData.passwordHash) throw new Error('Current password is incorrect');

  if (newPassword.length < 6) throw new Error('Password must be at least 6 characters');

  const newHash = await hashPassword(newPassword);
  await updateDoc(userDoc(decoded.id), { passwordHash: newHash });
  await logActivity(decoded.id, userData.name, 'change_password', 'User changed their password');

  return { message: 'Password changed successfully' };
}

// ─── User Management (admin) ─────────────────────────────────────────────────

export async function firebaseGetUsers() {
  await ensureDefaultAdmin();
  const snap = await getDocs(usersCol());
  const users = snap.docs.map(d => {
    const u = d.data() as AppUser;
    return userWithoutPassword(u);
  });
  return { users };
}

export async function firebaseCreateUser(data: {
  name: string; email: string; password: string; role?: string;
}) {
  const email = data.email.toLowerCase().trim();

  // Check duplicate
  const q = query(usersCol(), where('email', '==', email));
  const existing = await getDocs(q);
  if (!existing.empty) throw new Error('Email already exists');

  if (data.password.length < 6) throw new Error('Password must be at least 6 characters');

  const id = generateId();
  const hash = await hashPassword(data.password);
  const role = (data.role || 'user') as AppUser['role'];

  const newUser: AppUser = {
    id,
    name: data.name.trim(),
    email,
    passwordHash: hash,
    role,
    status: 'active',
    createdAt: new Date().toISOString(),
    permissions: {
      canView: true,
      canEdit: true,
      canDownload: role === 'admin' || role === 'superadmin', // sheet_admin cannot download
      isAdmin: role === 'admin' || role === 'superadmin',
      fullSheetAccess: role === 'admin' || role === 'superadmin' || role === 'sheet_admin',
    },
  };

  await setDoc(userDoc(id), newUser);
  await logActivity(id, data.name, 'create_user', `Created user: ${email} (${role})`);

  return { user: userWithoutPassword(newUser), message: 'User created' };
}

export async function firebaseUpdateUser(id: string, data: Record<string, unknown>) {
  const snap = await getDoc(userDoc(id));
  if (!snap.exists()) throw new Error('User not found');

  // Don't allow updating passwordHash through this method
  const { passwordHash, id: _id, ...safe } = data as any;
  await updateDoc(userDoc(id), safe);

  const updated = (await getDoc(userDoc(id))).data() as AppUser;
  await logActivity(id, updated.name, 'update_user', `Updated user: ${updated.email}`);

  return { user: userWithoutPassword(updated), message: 'User updated' };
}

export async function firebaseUpdatePermissions(id: string, permissions: Record<string, unknown>) {
  const snap = await getDoc(userDoc(id));
  if (!snap.exists()) throw new Error('User not found');

  await updateDoc(userDoc(id), { permissions });

  const updated = (await getDoc(userDoc(id))).data() as AppUser;
  await logActivity(id, updated.name, 'update_permissions', `Updated permissions for: ${updated.email}`);

  return { user: userWithoutPassword(updated), message: 'Permissions updated' };
}

export async function firebaseAdminChangePassword(id: string, newPassword: string) {
  if (newPassword.length < 6) throw new Error('Password must be at least 6 characters');

  const snap = await getDoc(userDoc(id));
  if (!snap.exists()) throw new Error('User not found');

  const hash = await hashPassword(newPassword);
  await updateDoc(userDoc(id), { passwordHash: hash });

  const userData = snap.data() as AppUser;
  await logActivity(id, userData.name, 'admin_change_password', `Admin reset password for: ${userData.email}`);

  return { message: 'Password changed' };
}

export async function firebaseDeleteUser(id: string) {
  const snap = await getDoc(userDoc(id));
  if (!snap.exists()) throw new Error('User not found');

  const userData = snap.data() as AppUser;
  await deleteDoc(userDoc(id));
  await logActivity(id, userData.name, 'delete_user', `Deleted user: ${userData.email}`);

  return { message: 'User deleted' };
}

export async function firebaseUpdateUserStatus(id: string, status: 'active' | 'inactive') {
  const snap = await getDoc(userDoc(id));
  if (!snap.exists()) throw new Error('User not found');

  await updateDoc(userDoc(id), { status });

  const userData = snap.data() as AppUser;
  await logActivity(id, userData.name, 'change_status', `Changed status of ${userData.email} to ${status}`);

  return { message: `User ${status === 'active' ? 'activated' : 'deactivated'}` };
}

// ─── Activity Logs ───────────────────────────────────────────────────────────

export async function logActivity(userId: string, userName: string, action: string, details: string) {
  const id = generateId();
  await setDoc(doc(db, 'app_activity', id), {
    id,
    userId,
    userName,
    action,
    details,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Log a workspace action (cell edit, row add, column change, download, etc.)
 * This is a fire-and-forget call — errors are silently swallowed.
 */
export function firebaseLogWorkspaceAction(
  userId: string, userName: string, action: string, details: string
) {
  logActivity(userId, userName, action, details).catch(() => {});
}


export async function firebaseGetActivity(limitCount = 200) {
  // Fetch all, sort client-side to avoid needing a Firestore composite index
  const snap = await getDocs(activityCol());
  const activities = snap.docs
    .map(d => d.data())
    .sort((a: any, b: any) => (b.timestamp || '').localeCompare(a.timestamp || ''))
    .slice(0, limitCount);
  return { activities };
}

export async function firebaseGetUserActivity(userId: string) {
  const q = query(activityCol(), where('userId', '==', userId));
  const snap = await getDocs(q);
  const activities = snap.docs
    .map(d => d.data())
    .sort((a: any, b: any) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  return { activities };
}

// ─── Download Requests ───────────────────────────────────────────────────────

export async function firebaseCreateDownloadRequest(
  userId: string,
  userName: string,
  data: { registerName: string; description: string; scope?: object }
) {
  const id = generateId();
  const request = {
    id,
    userId,
    userName,
    registerName: data.registerName,
    description: data.description,
    scope: data.scope || {},
    status: 'pending',
    createdAt: new Date().toISOString(),
    adminResponse: '',
    respondedAt: '',
  };
  await setDoc(dlRequestDoc(id), request);
  await logActivity(userId, userName, 'download_request', `Download request for: ${data.registerName}`);
  return { request, message: 'Request submitted' };
}

export async function firebaseGetMyDownloadRequests(userId: string) {
  const q = query(dlRequestsCol(), where('userId', '==', userId));
  const snap = await getDocs(q);
  const requests = snap.docs
    .map(d => d.data())
    .sort((a: any, b: any) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return { requests };
}

export async function firebaseGetAllDownloadRequests() {
  const snap = await getDocs(dlRequestsCol());
  const requests = snap.docs
    .map(d => d.data())
    .sort((a: any, b: any) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return { requests };
}

export async function firebaseGetPendingDownloadRequests() {
  const q = query(dlRequestsCol(), where('status', '==', 'pending'));
  const snap = await getDocs(q);
  return { requests: snap.docs.map(d => d.data()) };
}

export async function firebaseRespondDownloadRequest(
  requestId: string,
  status: 'approved' | 'rejected',
  adminResponse: string,
  adminName: string = 'Admin'
) {
  const snap = await getDoc(dlRequestDoc(requestId));
  if (!snap.exists()) throw new Error('Request not found');

  await updateDoc(dlRequestDoc(requestId), {
    status,
    adminResponse,
    respondedAt: new Date().toISOString(),
  });

  const req = snap.data();
  await logActivity(
    req.userId,
    adminName,
    'respond_download_request',
    `${status === 'approved' ? 'Approved' : 'Rejected'} download request for: ${req.registerName}`
  );

  // Create notification for the requesting user
  await firebaseCreateNotification(req.userId, {
    title: status === 'approved' ? '✅ Download Approved' : '❌ Download Rejected',
    message: status === 'approved'
      ? `Your download request for "${req.registerName}" has been approved by ${adminName}. You can now download the data.`
      : `Your download request for "${req.registerName}" has been rejected by ${adminName}.${adminResponse ? ` Reason: ${adminResponse}` : ''}`,
    type: status === 'approved' ? 'download_approved' : 'download_rejected',
    meta: { requestId, registerName: req.registerName, adminResponse },
  });

  return { message: `Request ${status}` };
}

// ─── Notifications (Firestore-persisted) ─────────────────────────────────────

const notificationsCol = () => collection(db, 'app_notifications');
const notificationDoc = (id: string) => doc(db, 'app_notifications', id);

export async function firebaseCreateNotification(
  userId: string,
  data: { title: string; message: string; type: string; meta?: Record<string, any> }
) {
  const id = generateId();
  await setDoc(notificationDoc(id), {
    id,
    userId,
    title: data.title,
    message: data.message,
    type: data.type,
    meta: data.meta || {},
    isRead: false,
    createdAt: new Date().toISOString(),
  });
  return { id };
}

export async function firebaseGetMyNotifications(userId: string) {
  const q = query(notificationsCol(), where('userId', '==', userId));
  const snap = await getDocs(q);
  const notifications = snap.docs
    .map(d => d.data())
    .sort((a: any, b: any) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return { notifications };
}

export async function firebaseMarkNotificationRead(notifId: string) {
  await updateDoc(notificationDoc(notifId), { isRead: true });
}

export async function firebaseMarkAllNotificationsRead(userId: string) {
  const q = query(notificationsCol(), where('userId', '==', userId));
  const snap = await getDocs(q);
  const batch: Promise<void>[] = [];
  snap.docs.forEach(d => {
    if (!d.data().isRead) {
      batch.push(updateDoc(notificationDoc(d.data().id), { isRead: true }));
    }
  });
  await Promise.all(batch);
}

