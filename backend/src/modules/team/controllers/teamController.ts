import { Request, Response } from 'express';
import { TeamMember } from '../../../models/TeamMember';
import { Account } from '../../../models/Account';
import { Project } from '../../../models/Project';
import { AccountTeamMember } from '../../../models/AccountTeamMember';

export class TeamController {

    // Add a new team member and associate with a project
    async addTeamMember(req: Request, res: Response) {
        try {
            const {
                firstName,
                lastName,
                email,
                jiraLoginId,
                partnerEmailId,
                projectName,
                role
            } = req.body;

            // 1. Find the Account (assuming CCMH for now)
            const account = await Account.findOne({ where: { code: 'CCMH' } });
            if (!account) {
                return res.status(404).json({ error: 'Default Account CCMH not found' });
            }

            // 2. Find Project
            const project = await Project.findOne({ where: { code: projectName } });
            if (!project) {
                return res.status(404).json({ error: `Project ${projectName} not found` });
            }

            // 3. Find or Create Team Member
            const [member, created] = await TeamMember.findOrCreate({
                where: { email },
                defaults: {
                    firstName,
                    lastName,
                    jiraLoginId, // Jira Account ID is critical for filtering
                    partnerEmailId
                }
            });

            // 4. Create Association
            await AccountTeamMember.findOrCreate({
                where: {
                    accountId: account.id,
                    teamMemberId: member.id,
                    projectId: project.id
                },
                defaults: {
                    role: role || 'Developer'
                }
            });

            return res.status(201).json({
                message: `Team member ${created ? 'created' : 'fetched'} and assigned to ${projectName}`,
                member
            });

        } catch (error: any) {
            console.error('Error adding team member:', error);
            return res.status(500).json({ error: 'Failed to add team member', details: error.message });
        }
    }
    async getProjectMembers(req: Request, res: Response): Promise<void> {
        try {
            const projectId = parseInt(req.query.projectId as string);
            if (isNaN(projectId)) {
                res.status(400).json({ error: 'projectId query param is required' });
                return;
            }

            // Get the project's accountId so we can also include account-level members
            // (those with projectId = NULL but same accountId)
            const project = await Project.findByPk(projectId);
            if (!project) {
                res.status(404).json({ error: 'Project not found' });
                return;
            }

            const { Op } = await import('sequelize');
            const associations = await AccountTeamMember.findAll({
                where: {
                    accountId: project.accountId,
                    [Op.or]: [
                        { projectId },
                        { projectId: null },
                    ],
                },
                include: [{ model: TeamMember }],
            });

            // Deduplicate by teamMemberId (a member may appear at both account and project level)
            const seen = new Set<number>();
            const members = associations
                .map(a => (a as any).teamMember)
                .filter(m => {
                    if (!m || seen.has(m.id)) return false;
                    seen.add(m.id);
                    return true;
                });

            res.json({ success: true, data: members });
        } catch (error: any) {
            res.status(500).json({ error: 'Failed to fetch team members', details: error.message });
        }
    }
}

export const teamController = new TeamController();
