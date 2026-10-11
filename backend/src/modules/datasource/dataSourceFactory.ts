import { LaneConfig } from '../../common/laneDefaults';
import { AzureDevOpsAdapter, AzureDevOpsAdapterProject } from './azureDevOpsAdapter';
import { ExcelAdapter, ExcelAdapterProject, ExcelImportSource } from './excelAdapter';
import { IDataSourceAdapter } from './IDataSourceAdapter';
import { JiraAdapter, JiraAdapterProject } from './jiraAdapter';
import { DataSourceType } from './types';

export interface MultiSourceProject {
    id: number;
    name: string;
    dataSourceType?: DataSourceType;

    jiraBoardId?: number;
    jiraBaseUrl?: string;
    jiraEmail?: string;
    jiraApiToken?: string;
    jiraLaneConfig?: LaneConfig | null;

    azureOrgUrl?: string;
    azureProject?: string;
    azureTeam?: string;
    azurePat?: string;

    laneConfig?: LaneConfig | null;
}

export interface ExcelLoader {
    (projectId: number): Promise<ExcelImportSource | null>;
}

export interface FactoryDeps {
    excelLoader?: ExcelLoader;
}

export function forProject(
    project: MultiSourceProject,
    deps: FactoryDeps = {},
): IDataSourceAdapter {
    const type: DataSourceType = project.dataSourceType ?? 'jira';

    if (type === 'jira') {
        if (!project.jiraBoardId || !project.jiraBaseUrl) {
            throw new Error(`Project ${project.id} is marked jira but missing jiraBoardId/jiraBaseUrl`);
        }
        const jp: JiraAdapterProject = {
            id: project.id,
            name: project.name,
            jiraBoardId: project.jiraBoardId,
            jiraBaseUrl: project.jiraBaseUrl,
            jiraEmail: project.jiraEmail,
            jiraApiToken: project.jiraApiToken,
            jiraLaneConfig: project.jiraLaneConfig ?? project.laneConfig ?? undefined,
        };
        return new JiraAdapter(jp);
    }

    if (type === 'azure_devops') {
        if (!project.azureOrgUrl || !project.azureProject || !project.azurePat) {
            throw new Error(
                `Project ${project.id} is marked azure_devops but missing azureOrgUrl/azureProject/azurePat`,
            );
        }
        const ap: AzureDevOpsAdapterProject = {
            id: project.id,
            name: project.name,
            azureOrgUrl: project.azureOrgUrl,
            azureProject: project.azureProject,
            azureTeam: project.azureTeam,
            azurePat: project.azurePat,
            laneConfig: project.laneConfig ?? project.jiraLaneConfig ?? undefined,
        };
        return new AzureDevOpsAdapter(ap);
    }

    if (type === 'excel') {
        const loader = deps.excelLoader;
        if (!loader) {
            throw new Error('Excel data source requires excelLoader dependency');
        }
        const ep: ExcelAdapterProject = {
            id: project.id,
            name: project.name,
            laneConfig: project.laneConfig ?? project.jiraLaneConfig ?? undefined,
        };
        return new ExcelAdapter(ep, () => loader(project.id));
    }

    throw new Error(`Unknown data source type: ${type}`);
}

export const dataSourceFactory = { forProject };
