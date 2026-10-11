import { Sequelize } from 'sequelize-typescript';
import { DailyBoardSnapshot } from '../models/DailyBoardSnapshot';
import { Account } from '../models/Account';
import { Project } from '../models/Project';
import { TeamMember } from '../models/TeamMember';
import { AccountTeamMember } from '../models/AccountTeamMember';
import { ProjectWeeklyReport } from '../models/ProjectWeeklyReport';
import { AccountWeeklyReport } from '../models/AccountWeeklyReport';
import { MonthlyProjectReport } from '../models/MonthlyProjectReport';
import { MonthlyAccountReport } from '../models/MonthlyAccountReport';
import { Program } from '../models/Program';
import { ProgramDailyReport } from '../models/ProgramDailyReport';
import { ProgramWeeklyReport } from '../models/ProgramWeeklyReport';
import { ProgramMonthlyReport } from '../models/ProgramMonthlyReport';
import { PortfolioPresentation } from '../models/PortfolioPresentation';
import { User } from '../models/User';
import { UserPermission } from '../models/UserPermission';
import { Role } from '../models/Role';
import { UserRole } from '../models/UserRole';
import { Risk } from '../models/Risk';
import { RiskMitigationPlan } from '../models/RiskMitigationPlan';
import { RiskComment } from '../models/RiskComment';
import { ProjectActionItem } from '../models/ProjectActionItem';
import { ActionItemStatusHistory } from '../models/ActionItemStatusHistory';
import { ActionItemComment } from '../models/ActionItemComment';
import { AccountActionItem } from '../models/AccountActionItem';
import { ProgramActionItem } from '../models/ProgramActionItem';
import { PerfSprintSync } from '../models/PerfSprintSync';
import { PerfTicketFact } from '../models/PerfTicketFact';
import { PerfMemberScore } from '../models/PerfMemberScore';
import { PerfIdentityLink } from '../models/PerfIdentityLink';
import { ReviewCycleConfig } from '../models/ReviewCycleConfig';
import { ReviewCycle } from '../models/ReviewCycle';
import { ReviewCycleSource } from '../models/ReviewCycleSource';
import { ReviewCycleParticipant } from '../models/ReviewCycleParticipant';
import { ReviewMemberScore } from '../models/ReviewMemberScore';
import { ReviewStatusHistory } from '../models/ReviewStatusHistory';
import { CompetencyTemplate } from '../models/CompetencyTemplate';
import { CompetencyTemplateItem } from '../models/CompetencyTemplateItem';
import { ReviewProjectSettings } from '../models/ReviewProjectSettings';
import { LeadReview } from '../models/LeadReview';
import { LeadReviewRating } from '../models/LeadReviewRating';
import { NotificationEvent } from '../models/NotificationEvent';
import { NotificationTemplate } from '../models/NotificationTemplate';
import { NotificationRule } from '../models/NotificationRule';
import { NotificationPendingAggregate } from '../models/NotificationPendingAggregate';
import { NotificationLog } from '../models/NotificationLog';
import { ExcelImport } from '../models/ExcelImport';
import { ExcelWorkItem } from '../models/ExcelWorkItem';
import { ExcelTicketState } from '../models/ExcelTicketState';
import { ExcelStatusHistory } from '../models/ExcelStatusHistory';
import { ProjectSprint } from '../models/ProjectSprint';
import * as dotenv from 'dotenv';
import { TemplateMapping } from '../models/TemplateMapping';
import { UserSession } from '../models/UserSession';
import { UsageEvent } from '../models/UsageEvent';
import { ClaudeUsageDaily } from '../models/ClaudeUsageDaily';
import { UsageIngestToken } from '../models/UsageIngestToken';
import { IngestRateLimitSetting } from '../models/IngestRateLimitSetting';
import { CollectorVersionPolicy } from '../models/CollectorVersionPolicy';
import { UsageCollectorConsent } from '../models/UsageCollectorConsent';
import { ClaudeUsageCoaching } from '../models/ClaudeUsageCoaching';
import { FeaturePilot } from '../models/FeaturePilot';
import { PricingModel } from '../models/PricingModel';
import { AiCallUsage } from '../models/AiCallUsage';
import { MonitoredOrg } from '../models/MonitoredOrg';
import { ClaudeIngestAuditLog } from '../models/ClaudeIngestAuditLog';
import { RetroBoard } from '../models/RetroBoard';
import { RetroItem } from '../models/RetroItem';
import { RetroItemComment } from '../models/RetroItemComment';
import { RetroItemVote } from '../models/RetroItemVote';
import { RetroBoardParticipant } from '../models/RetroBoardParticipant';

dotenv.config();

const sequelize = new Sequelize({
    dialect: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    username: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'jira_daily_reports',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    timezone: '+00:00', // Enforce UTC
    models: [
        DailyBoardSnapshot,
        Project,
        Account,
        ProjectWeeklyReport,
        AccountWeeklyReport,
        MonthlyProjectReport,
        MonthlyAccountReport,
        Program,
        ProgramDailyReport,
        ProgramWeeklyReport,
        ProgramMonthlyReport,
        PortfolioPresentation,
        AccountTeamMember,
        TeamMember,
        User,
        UserPermission,
        Role,
        UserRole,
        Risk,
        RiskMitigationPlan,
        RiskComment,
        ProjectActionItem,
        ActionItemStatusHistory,
        ActionItemComment,
        AccountActionItem,
        ProgramActionItem,
        PerfSprintSync,
        PerfTicketFact,
        PerfMemberScore,
        PerfIdentityLink,
        ReviewCycleConfig,
        ReviewCycle,
        ReviewCycleSource,
        ReviewCycleParticipant,
        ReviewMemberScore,
        ReviewStatusHistory,
        CompetencyTemplate,
        CompetencyTemplateItem,
        ReviewProjectSettings,
        LeadReview,
        LeadReviewRating,
        NotificationEvent,
        NotificationTemplate,
        NotificationRule,
        NotificationPendingAggregate,
        NotificationLog,
        ExcelImport,
        ExcelWorkItem,
        ExcelTicketState,
        ExcelStatusHistory,
        ProjectSprint,
        TemplateMapping,
        UserSession,
        UsageEvent,
        ClaudeUsageDaily,
        UsageIngestToken,
        UsageCollectorConsent,
        ClaudeUsageCoaching,
        FeaturePilot,
        PricingModel,
        AiCallUsage,
        MonitoredOrg,
        IngestRateLimitSetting,
        CollectorVersionPolicy,
        ClaudeIngestAuditLog,
        RetroBoard,
        RetroItem,
        RetroItemComment,
        RetroItemVote,
        RetroBoardParticipant
    ],
    pool: {
        max: 10,
        min: 0,
        acquire: 30000,
        idle: 10000
    }
});

export default sequelize;
