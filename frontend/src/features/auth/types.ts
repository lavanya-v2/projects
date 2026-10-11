export interface Project {
  id: number;
  name: string;
  code: string;
  jiraBoardId: number;
  workMode?: string;
  isKanbanProject?: boolean;
  piiRedactionEnabled?: boolean;
  isSharedTeam?: boolean;
  estimationType?: 'story_points' | 'hours';
  reportingFrequency?: 'daily' | 'weekly' | 'sprint';
  hoursSource?: 'time_tracking' | 'custom_field' | null;
  hoursFieldName?: string | null;
  defaultDailyCapacityHours?: number | null;
  isActive: boolean;
  inactiveSince?: string | null;
  accountId?: number;
  programId?: number | null;
  dataSourceType?: 'jira' | 'azure_devops' | 'excel' | 'custom-excel';
  // Which coding assistant (if any) this project's team uses. 'none' (the
  // default) means show nothing Claude-related for this project.
  devAssistantAiTool?: 'claude' | 'copilot' | 'openai' | 'cursor' | 'none';
  account?: {
    id: number;
    name: string;
  };
}
