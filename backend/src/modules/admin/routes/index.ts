import path from 'path';
import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../../../middleware/authMiddleware';
import { handleUploadErrors } from '../../../common/uploadMiddleware';
import { adminOrSuperuserMiddleware, superuserMiddleware, adminGetAllUsers } from '../../users/controllers/userController';
import { adminTestJiraConnection } from '../../jira/jiraTestController';
import {
  adminGetAccounts,
  adminCreateAccount,
  adminUpdateAccount,
  adminDeleteAccount,
} from '../controllers/adminAccountController';
import {
  adminGetProjects,
  adminGetProject,
  adminCreateProject,
  adminUpdateProject,
  adminDeleteProject,
  adminGetProjectMembers,
  adminAddProjectMember,
  adminUpdateProjectMemberRole,
  adminRemoveProjectMember,
  saveProjectMappingTemplate,
  getProjectMappingTemplateDetails,
  adminGetAccountProjects,
  adminGetProjectPersonFields,
  adminAddAndUpdateProjectMembers,
} from '../controllers/adminProjectController';
import {
  adminGetTeamMembers,
  adminCreateTeamMember,
  adminUpdateTeamMember,
  adminDeleteTeamMember,
  adminGetAccountTeamMembers,
} from '../controllers/adminTeamMemberController';
import { usageAnalyticsController } from '../controllers/usageAnalyticsController';

const router = Router();

/*
 * Saving a mapping may carry the sample workbook it was built from, so the file is retained and the
 * mapping stays editable later without re-uploading. Mirrors the limits in datasource/routes.ts.
 */
const SAMPLE_EXTENSIONS = ['.xlsx', '.xls', '.csv'];

const uploadSample = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (SAMPLE_EXTENSIONS.includes(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
      return;
    }

    cb(new Error('Only .xlsx, .xls and .csv files are supported'));
  },
});

router.use(authenticate);
router.use(adminOrSuperuserMiddleware);

// Accounts
router.get('/accounts', adminGetAccounts);
router.post('/accounts', adminCreateAccount);
router.put('/accounts/:id', adminUpdateAccount);
router.delete('/accounts/:id', adminDeleteAccount);
router.get('/accounts/:id/projects', adminGetAccountProjects);
router.get('/accounts/:id/team-members', adminGetAccountTeamMembers);

// Projects
router.get('/projects', adminGetProjects);
router.get('/projects/:id', adminGetProject);
router.post('/projects', adminCreateProject);
router.put('/projects/:id', adminUpdateProject);
router.delete('/projects/:id', adminDeleteProject);
router.post('/projects/:id/template', handleUploadErrors(uploadSample.single('file')), saveProjectMappingTemplate);
router.get('/projects/:id/template', getProjectMappingTemplateDetails);

// Person-type Jira fields on the project's board, with how often each is populated —
// backs the owner-field picker so an admin chooses on coverage, not on field name.
router.get('/projects/:id/person-fields', adminGetProjectPersonFields);

// Project ↔ Team member assignment
router.get('/projects/:id/members', adminGetProjectMembers);
router.post('/projects/:id/members', adminAddProjectMember);
router.post('/account/:accountId/members/:teamMemberId/projects', adminAddAndUpdateProjectMembers);
router.put('/projects/:id/members/:memberId', adminUpdateProjectMemberRole);
router.delete('/projects/:id/members/:memberId', adminRemoveProjectMember);

// Team Members
router.get('/team-members', adminGetTeamMembers);
router.post('/team-members', adminCreateTeamMember);
router.put('/team-members/:id', adminUpdateTeamMember);
router.delete('/team-members/:id', adminDeleteTeamMember);

// Jira connectivity test
router.post('/test-jira', adminTestJiraConnection);

// Flat, unpaginated user list (e.g. Performance Review's reviewer-assignment fallback picker)
router.get('/users', adminGetAllUsers);

// Usage & adoption analytics (superuser only, via the router-wide guards above)
router.get('/usage/summary', superuserMiddleware, (req, res) => usageAnalyticsController.getSummary(req, res));
router.get('/usage/trend', superuserMiddleware, (req, res) => usageAnalyticsController.getTrend(req, res));
router.get('/usage/users', superuserMiddleware, (req, res) => usageAnalyticsController.getUsers(req, res));
router.get('/usage/features', superuserMiddleware, (req, res) => usageAnalyticsController.getFeatures(req, res));

export const adminRoutes = router;
