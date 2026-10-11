import { Request, Response } from 'express';
import { Account } from '../../../models/Account';
import { UserPermission } from '../../../models/UserPermission';

interface AuthRequest extends Request {
    user?: any;
}

export class AccountController {
    async getAllAccounts(req: AuthRequest, res: Response) {
        try {
            const userId = req.user?.id;
            const userRole = req.user?.role;

            if (userRole === 'SUPERUSER') {
                const accounts = await Account.findAll({
                    attributes: ['id', 'name', 'code', 'weekStartDay'],
                    order: [['name', 'ASC']]
                });
                return res.json({
                    success: true,
                    data: accounts.map(acc => ({
                        ...acc.toJSON(),
                        hasFullAccess: true
                    }))
                });
            }

            // Regular users - filter by permissions
            const permissions = await UserPermission.findAll({ where: { userId } });

            // Maps accountId to whether they have FULL access (empty projectIds array OR possessing all IDs)
            const accountAccessMap = new Map<number, boolean>();

            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { Project } = require('../../../models/Project');

            for (const p of permissions) {
                if (p.accountId !== null) {
                    // Program-scoped rows (programId set) confer access only to projects in that program,
                    // not account-wide. Their projectIds is empty by design and must NOT be read as full access.
                    if (p.programId) {
                        if (!accountAccessMap.has(p.accountId)) {
                            accountAccessMap.set(p.accountId, false);
                        }
                        continue;
                    }

                    let isFullAccess = (!p.projectIds || p.projectIds.length === 0);

                    if (!isFullAccess && p.projectIds) {
                        const totalProjectsCount = await Project.count({ where: { accountId: p.accountId } });
                        if (p.projectIds.length >= totalProjectsCount) {
                            isFullAccess = true;
                        }
                    }

                    // If they have multiple perm records for the same account, any full access counts
                    if (isFullAccess || !accountAccessMap.has(p.accountId)) {
                        accountAccessMap.set(p.accountId, isFullAccess);
                    } else if (isFullAccess) {
                        accountAccessMap.set(p.accountId, true);
                    }
                }
            }

            if (accountAccessMap.size === 0) {
                return res.json({ success: true, data: [] });
            }

            const accounts = await Account.findAll({
                where: {
                    id: Array.from(accountAccessMap.keys())
                },
                attributes: ['id', 'name', 'code', 'weekStartDay'],
                order: [['name', 'ASC']]
            });

            const enrichedAccounts = accounts.map(acc => ({
                ...acc.toJSON(),
                hasFullAccess: accountAccessMap.get(acc.id) || false
            }));

            return res.json({
                success: true,
                data: enrichedAccounts
            });
        } catch (error: any) {
            console.error('Error fetching accounts:', error);
            return res.status(500).json({
                success: false,
                message: 'An error occurred'
            });
        }
    }
}

export const accountController = new AccountController();
