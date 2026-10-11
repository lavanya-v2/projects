import { Request, Response } from 'express';
import { JiraService } from './services/jiraService';

export async function adminTestJiraConnection(req: Request, res: Response) {
  try {
    const { jiraBaseUrl, jiraEmail, jiraApiToken, jiraBoardId } = req.body;
    if (!jiraBaseUrl || !jiraEmail || !jiraApiToken || !jiraBoardId) {
      return res
        .status(400)
        .json({ success: false, message: 'jiraBaseUrl, jiraEmail, jiraApiToken, jiraBoardId are required' });
    }
    const jira = new JiraService(jiraBaseUrl, jiraEmail, jiraApiToken);
    const board = await jira.getBoardConfiguration(Number(jiraBoardId));
    return res.json({
      success: true,
      boardName: board.name,
      boardType: board.type,
    });
  } catch (e) {
    const err = e as { response?: { status?: number }; status?: number; message?: string };
    const status = err.response?.status;
    const message =
      status === 401 || status === 403
        ? 'Authentication failed — check your email and API token'
        : status === 404
          ? 'Board not found — check the Board ID'
          : `Jira connection failed: ${err.message}`;
    return res.status(400).json({ success: false, message });
  }
}
