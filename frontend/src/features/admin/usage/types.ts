export interface UsageSummary {
  /** Rolling active-user counts anchored on now(), independent of the filter window. */
  dau: number;
  wau: number;
  mau: number;
  windowActiveUsers: number;
  totalUsers: number;
  neverLoggedIn: number;
  totalSessions: number;
  totalLogins: number;
  avgSessionMinutes: number;
  totalFeatureEvents: number;
}

export interface UsageTrendPoint {
  date: string;
  activeUsers: number;
  sessions: number;
  events: number;
}

export interface UsageUserRow {
  id: number;
  name: string;
  userId: string;
  email: string | null;
  roleName: string;
  sessionCount: number;
  totalMinutes: number;
  avgSessionMinutes: number;
  /** Within the selected window. */
  lastLogin: string | null;
  lastSeen: string | null;
  /** All-time — null means the account has never been used. */
  lastLoginEver: string | null;
  eventCount: number;
  topFeatures: string;
}

export interface UsageFeatureRow {
  feature: string;
  eventCount: number;
  userCount: number;
}

export interface UsageWindow {
  from: string;
  to: string;
}
