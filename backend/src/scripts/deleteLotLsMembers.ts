
import sequelize from '../config/connection';
import { Account } from '../models/Account';
import { Project } from '../models/Project';
import { TeamMember } from '../models/TeamMember';
import { AccountTeamMember } from '../models/AccountTeamMember';
import { Op } from 'sequelize';

async function deleteLotLsMembers() {
    try {
        await sequelize.authenticate();
        console.log('Connected to DB.');

        // 1. Find Account 'CCMH'
        const account = await Account.findOne({ where: { name: 'CCMH' } });
        if (!account) {
            console.warn('Account CCMH not found.');
            return;
        }
        console.log(`Found Account: ${account.name} (ID: ${account.id})`);

        // 2. Find Projects 'LOT' and 'LS'
        const projects = await Project.findAll({
            where: {
                code: { [Op.in]: ['LOT', 'LS'] },
                accountId: account.id
            }
        });

        if (projects.length === 0) {
            console.warn('Projects LOT and LS not found under CCMH.');
            return;
        }

        const projectIds = projects.map(p => p.id);
        console.log(`Found Projects: ${projects.map(p => p.code).join(', ')} (IDs: ${projectIds.join(', ')})`);

        // 3. Find Team Members associated with these projects
        // We find the associations first
        const accountTeamMembers = await AccountTeamMember.findAll({
            where: {
                accountId: account.id,
                projectId: { [Op.in]: projectIds }
            }
        });

        if (accountTeamMembers.length === 0) {
            console.log('No team members found for these projects.');
            return;
        }

        const teamMemberIds = Array.from(new Set(accountTeamMembers.map((atm: any) => atm.teamMemberId)));
        console.log(`Found ${teamMemberIds.length} team members associated with these projects.`);

        // 4. Delete associations
        await AccountTeamMember.destroy({
            where: {
                accountId: account.id,
                projectId: { [Op.in]: projectIds }
            }
        });
        console.log('Deleted project associations.');

        // 5. Delete orphaned TeamMembers
        // Find members who no longer have any associations
        let deletedCount = 0;
        for (const memberId of teamMemberIds) {
            const remainingAssociations = await AccountTeamMember.count({
                where: { teamMemberId: memberId }
            });

            if (remainingAssociations === 0) {
                await TeamMember.destroy({ where: { id: memberId } });
                console.log(`Deleted orphaned TeamMember ID: ${memberId}`);
                deletedCount++;
            } else {
                console.log(`TeamMember ID: ${memberId} has other associations, skipping delete.`);
            }
        }

        console.log(`Process complete. Deleted ${deletedCount} team members.`);

    } catch (error) {
        console.error('Error deleting members:', error);
    } finally {
        process.exit(0);
    }
}

deleteLotLsMembers();
