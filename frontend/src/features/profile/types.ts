export interface ProfileAccountAssignment {
  id: number;
  name: string;
  code: string;
  projects: Array<{ id: number; name: string; code: string }>;
}

export interface ProfileProgramAssignment {
  id: number;
  name: string;
  projects: Array<{ id: number; name: string; code: string }>;
}


export interface ProfileData {
  id: number;
  userId: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  role: string;
  roleName: string;
  accounts: ProfileAccountAssignment[];
  programs: ProfileProgramAssignment[];
}

export interface UpdateProfilePayload {
  firstName?: string;
  lastName?: string;
  password?: string;
}
