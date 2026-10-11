export type RetroBoardStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';

export interface RetroLane {
  key: string;
  name: string;
  order: number;
  color: string;
}

export interface RetroAuthor {
  id: number;
  firstName: string;
  lastName: string;
}

export interface RetroItemPermissions {
  canEdit: boolean;
  canDelete: boolean;
  canComment: boolean;
  canMove: boolean;
  canVote: boolean;
  canMarkTopPick: boolean;
  canConvert: boolean;
}

export interface RetroBoardPermissions {
  canEditSettings: boolean;
  canEditLanes: boolean;
  canAddItems: boolean;
  canChangeStatus: boolean;
  canMarkTopPicks: boolean;
  canConvert: boolean;
  canExportPdf: boolean;
  canDelete: boolean;
}

export interface RetroItem {
  id: number;
  boardId: number;
  laneKey: string;
  content: string;
  isAnonymous: boolean;
  /** Always null for anonymous items — the author is not stored at all. */
  author: RetroAuthor | null;
  sortOrder: number;
  topPickRank: number | null;
  voteCount: number;
  hasVoted: boolean;
  commentCount: number;
  converted: { type: 'ACTION_ITEM' | 'RISK'; refId: number; at: string | null } | null;
  createdAt: string;
  permissions: RetroItemPermissions;
}

export interface RetroComment {
  id: number;
  itemId: number;
  comment: string;
  isAnonymous: boolean;
  author: RetroAuthor | null;
  createdAt: string;
  editedAt: string | null;
  canEdit: boolean;
  canDelete: boolean;
}

export interface RetroBoard {
  id: number;
  projectId: number;
  projectName?: string;
  title: string;
  meetingDate: string;
  meetingTime: string;
  timezone: string;
  status: RetroBoardStatus;
  lanes: RetroLane[];
  shareToken: string;
  allowAnonymous: boolean;
  votingEnabled: boolean;
  votesPerUser: number;
  createdById: number;
  facilitatorName: string | null;
  completedAt: string | null;
  createdAt: string;
  isFacilitator: boolean;
  permissions: RetroBoardPermissions;
}

export interface RetroParticipant {
  userId: number;
  name: string;
  firstJoinedAt?: string;
  online?: boolean;
}

export interface RetroBoardDetail {
  board: RetroBoard;
  items: RetroItem[];
  participants: RetroParticipant[];
  myVotesUsed: number;
}

export interface RetroSummary extends RetroBoardDetail {
  comments: Record<number, Array<{
    id: number;
    comment: string;
    isAnonymous: boolean;
    author: string | null;
    createdAt: string;
  }>>;
  topPicks: RetroItem[];
  conversions: RetroItem[];
}

export const STATUS_COLORS: Record<RetroBoardStatus, string> = {
  DRAFT: '#9e9e9e',
  ACTIVE: '#4caf50',
  COMPLETED: '#1565c0',
  ARCHIVED: '#616161',
};

export const STATUS_LABELS: Record<RetroBoardStatus, string> = {
  DRAFT: 'Draft',
  ACTIVE: 'Live',
  COMPLETED: 'Completed',
  ARCHIVED: 'Archived',
};

// --- Continuity between retros ----------------------------------------------

export type RetroOutcome = 'DONE' | 'STILL_OPEN' | 'DROPPED';

export const OUTCOME_LABELS: Record<RetroOutcome, string> = {
  DONE: 'Done',
  STILL_OPEN: 'Still open',
  DROPPED: 'Dropped',
};

export const OUTCOME_COLORS: Record<RetroOutcome, string> = {
  DONE: '#2e7d32',
  STILL_OPEN: '#ed6c02',
  DROPPED: '#757575',
};

export interface LinkedWorkStatus {
  type: 'ACTION_ITEM' | 'RISK';
  refId: number;
  /** Null when the linked record was deleted — shown as "no longer available". */
  status: string | null;
  title: string | null;
}

export interface CarriedPoint {
  id: number;
  content: string;
  topPickRank: number | null;
  laneKey: string;
  isAnonymous: boolean;
  outcome: RetroOutcome | null;
  outcomeNote: string | null;
  outcomeAt: string | null;
  outcomeBy: string | null;
  linked: LinkedWorkStatus | null;
  canSetOutcome: boolean;
}

export interface CarryForward {
  previousBoard: {
    id: number;
    title: string;
    meetingDate: string;
    facilitatorName: string | null;
  } | null;
  points: CarriedPoint[];
}

export interface AgreedOccurrence {
  itemId: number;
  boardId: number;
  boardTitle: string;
  meetingDate: string;
  content: string;
  topPickRank: number | null;
  outcome: RetroOutcome | null;
  convertedType: 'ACTION_ITEM' | 'RISK' | null;
  convertedRefId: number | null;
}

export interface AgreedTheme {
  label: string;
  occurrences: AgreedOccurrence[];
  strength: 'EXACT_REPEAT' | 'LIKELY_REPEAT' | 'DISTINCT';
  isRepeat: boolean;
  /** Agreed more than once and still nobody has done anything about it. */
  unresolvedRepeat: boolean;
}

export interface AgreedPointsHistory {
  themes: AgreedTheme[];
  totalPoints: number;
}
