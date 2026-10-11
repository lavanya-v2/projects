import { DailyBoardSnapshot } from '../../models/DailyBoardSnapshot';
import { Op } from 'sequelize';
import { logger } from './logger';

/**
 * Analyzes blocked ticket history across daily reports to calculate accurate durations
 */
export class BlockedTicketAnalyzer {
    /**
     * Calculate how long each blocked ticket has been blocked
     * @param projectId Project ID
     * @param endDate End date of analysis window (inclusive)
     * @param lookbackDays How many days to look back (default: 30)
     */
    async analyzeBlockedDuration(
        projectId: number,
        endDate: string,
        lookbackDays: number = 30
    ): Promise<Map<string, BlockedTicketInfo>> {
        try {
            // Calculate start date for lookback
            const endDateObj = new Date(endDate);
            const startDateObj = new Date(endDateObj);
            startDateObj.setDate(startDateObj.getDate() - lookbackDays);
            const startDate = this.formatDate(startDateObj);

            logger.debug(`Analyzing blocked tickets from ${startDate} to ${endDate}`, 'BlockedTicketAnalyzer');

            // Fetch all daily reports in the lookback window
            const snapshots = await DailyBoardSnapshot.findAll({
                where: {
                    projectId,
                    date: {
                        [Op.between]: [startDate, endDate]
                    }
                },
                order: [['date', 'ASC']]
            });

            const ticketHistory = new Map<string, BlockedTicketInfo>();

            // Process each snapshot
            for (const snapshot of snapshots) {
                const blockedTickets = this.parseBlockedTickets(snapshot.blockedTickets);
                const currentDate = snapshot.date;

                // Track currently blocked tickets
                const currentlyBlockedKeys = new Set(blockedTickets.map(t => t.key));

                // Check each blocked ticket
                for (const ticket of blockedTickets) {
                    if (!ticketHistory.has(ticket.key)) {
                        // First time seeing this ticket blocked
                        ticketHistory.set(ticket.key, {
                            key: ticket.key,
                            summary: ticket.summary || '',
                            firstBlockedDate: currentDate,
                            lastBlockedDate: currentDate,
                            consecutiveDaysBlocked: 1,
                            totalDaysBlocked: 1,
                            currentlyBlocked: true,
                            blockedPeriods: [{
                                startDate: currentDate,
                                endDate: currentDate
                            }]
                        });
                    } else {
                        // Ticket was blocked before
                        const info = ticketHistory.get(ticket.key)!;
                        info.lastBlockedDate = currentDate;
                        info.currentlyBlocked = true;

                        // Check if this is consecutive
                        const prevDate = new Date(info.blockedPeriods[info.blockedPeriods.length - 1].endDate);
                        const currDate = new Date(currentDate);
                        const daysDiff = Math.floor((currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));

                        if (daysDiff === 1) {
                            // Consecutive day
                            info.consecutiveDaysBlocked++;
                            info.blockedPeriods[info.blockedPeriods.length - 1].endDate = currentDate;
                        } else if (daysDiff > 1) {
                            // Gap in blocking - start new period
                            info.consecutiveDaysBlocked = 1;
                            info.blockedPeriods.push({
                                startDate: currentDate,
                                endDate: currentDate
                            });
                        }
                        info.totalDaysBlocked++;
                    }
                }

                // Mark tickets that are no longer blocked
                for (const [key, info] of ticketHistory) {
                    if (!currentlyBlockedKeys.has(key)) {
                        info.currentlyBlocked = false;
                    }
                }
            }

            return ticketHistory;
        } catch (error) {
            logger.error('Error analyzing blocked tickets', error instanceof Error ? error : String(error), 'BlockedTicketAnalyzer');
            return new Map();
        }
    }

    /**
     * Get blocked tickets that are currently blocked as of endDate
     */
    async getCurrentlyBlockedTickets(
        projectId: number,
        endDate: string,
        lookbackDays: number = 30
    ): Promise<BlockedTicketInfo[]> {
        const allTickets = await this.analyzeBlockedDuration(projectId, endDate, lookbackDays);
        return Array.from(allTickets.values()).filter(t => t.currentlyBlocked);
    }

    /**
     * Format blocked ticket info for display in reports
     */
    formatBlockedTicketSummary(tickets: BlockedTicketInfo[]): string {
        if (tickets.length === 0) return 'None';

        const lines: string[] = [];
        for (const ticket of tickets) {
            const duration = this.formatDuration(ticket.consecutiveDaysBlocked);
            lines.push(`${ticket.key}: Blocked for ${duration} (since ${ticket.firstBlockedDate})`);
        }
        return lines.join('\n');
    }

    /**
     * Format duration in human-readable form
     */
    private formatDuration(days: number): string {
        if (days === 1) return '1 day';
        if (days < 7) return `${days} days`;

        const weeks = Math.floor(days / 7);
        const remainingDays = days % 7;

        if (weeks === 1 && remainingDays === 0) return '1 week';
        if (weeks === 1) return `1 week, ${remainingDays} day${remainingDays > 1 ? 's' : ''}`;
        if (remainingDays === 0) return `${weeks} weeks`;
        return `${weeks} week${weeks > 1 ? 's' : ''}, ${remainingDays} day${remainingDays > 1 ? 's' : ''}`;
    }

    /**
     * Parse blocked tickets from various formats
     */
    private parseBlockedTickets(blockedTickets: any): Array<{ key: string; summary?: string }> {
        if (!blockedTickets) return [];

        try {
            let tickets = blockedTickets;
            if (typeof blockedTickets === 'string') {
                tickets = JSON.parse(blockedTickets);
            }

            if (Array.isArray(tickets)) {
                return tickets.map(t => ({
                    key: t.key || '',
                    summary: t.summary || ''
                }));
            }
        } catch (e) {
            logger.warn(`Failed to parse blocked tickets: ${String(e)}`, 'BlockedTicketAnalyzer');
        }

        return [];
    }

    private formatDate(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
}

export interface BlockedTicketInfo {
    key: string;
    summary: string;
    firstBlockedDate: string;
    lastBlockedDate: string;
    consecutiveDaysBlocked: number;
    totalDaysBlocked: number;
    currentlyBlocked: boolean;
    blockedPeriods: Array<{
        startDate: string;
        endDate: string;
    }>;
}

export const blockedTicketAnalyzer = new BlockedTicketAnalyzer();
