import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { Project } from './Project';

@Table({
  tableName: 'template_mappings',
  timestamps: true,
})
export class TemplateMapping extends Model {
  @Column({
    primaryKey: true,
    autoIncrement: true,
    type: DataType.INTEGER,
  })
  id!: number;

  @Column({
    type: DataType.STRING,
    allowNull: true,
    defaultValue: null,
    field: 'external_id',
  })
  externalId?: string | null;

  @Column({
    type: DataType.STRING,
    allowNull: true,
    defaultValue: null,
    field: 'title',
  })
  title!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
    defaultValue: null,
    field: 'type',
  })
  type!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
    defaultValue: null,
    field: 'status',
  })
  status!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
    defaultValue: null,
    field: 'sprint_name',
  })
  sprintName!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
    defaultValue: null,
    field: 'assignee_email',
  })
  assigneeEmail!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
    defaultValue: null,
    field: 'created_date',
  })
  createdDate!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
    defaultValue: null,
    field: 'last_updated',
  })
  lastUpdated!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
    defaultValue: null,
    field: 'sprint_start_date',
  })
  sprintStartDate!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
    defaultValue: null,
    field: 'sprint_end_date',
  })
  sprintEndDate!: string;

  @Column({
    type: DataType.BOOLEAN,
    defaultValue: true,
    field: 'active',
  })
  active!: boolean;

  @Column({
    type: DataType.DATE,
    defaultValue: DataType.NOW,
    field: 'created_at',
  })
  createdAt!: Date;

  @Column({
    type: DataType.DATE,
    defaultValue: DataType.NOW,
    field: 'updated_at',
  })
  updatedAt!: Date;

  @Column({
    type: DataType.STRING,
    allowNull: true,
    defaultValue: null,
    field: 'story_points',
  })
  storyPoints!: string;

  /*
   * Fields the importer reads but that had no column here, so they could never be mapped. Parent is
   * the consequential one: it is what identifies an Epic/Feature as a container rather than a
   * countable work item.
   */
  @Column({
    type: DataType.STRING,
    allowNull: true,
    defaultValue: null,
    field: 'priority',
  })
  priority!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
    defaultValue: null,
    field: 'status_changed_on',
  })
  statusChangedOn!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
    defaultValue: null,
    field: 'done_date',
  })
  doneDate!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
    defaultValue: null,
    field: 'parent_ext_id',
  })
  parentExtId!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
    defaultValue: null,
    field: 'labels',
  })
  labels!: string;

  /*
   * The sample workbook this mapping was built from, retained so the mapping stays editable.
   * `sourceHeaders` is the header row as read at the time: without it the editor has no column list
   * to offer and the user has to re-upload the file just to change one field.
   */
  @Column({
    type: DataType.STRING(1024),
    allowNull: true,
    defaultValue: null,
    field: 'storage_path',
  })
  storagePath?: string | null;

  @Column({
    type: DataType.STRING(512),
    allowNull: true,
    defaultValue: null,
    field: 'original_filename',
  })
  originalFilename?: string | null;

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
    defaultValue: null,
    field: 'file_size',
  })
  fileSize?: number | null;

  @Column({
    type: DataType.STRING(64),
    allowNull: true,
    defaultValue: null,
    field: 'checksum',
  })
  checksum?: string | null;

  @Column({
    type: DataType.STRING(128),
    allowNull: true,
    defaultValue: null,
    field: 'mime_type',
  })
  mimeType?: string | null;

  @Column({
    type: DataType.JSONB,
    allowNull: true,
    defaultValue: null,
    field: 'source_headers',
  })
  sourceHeaders?: string[] | null;

  /** 1-based, per project. Shown against imports so an older parse is identifiable. */
  @Column({
    type: DataType.INTEGER,
    allowNull: true,
    defaultValue: null,
    field: 'version',
  })
  version?: number | null;

  /** Set when a newer mapping replaced this one. Null on the active mapping. */
  @Column({
    type: DataType.DATE,
    allowNull: true,
    defaultValue: null,
    field: 'superseded_at',
  })
  supersededAt?: Date | null;

  @ForeignKey(() => Project)
  @Column({
    type: DataType.INTEGER,
    allowNull: true,
    field: 'project_id',
  })
  projectId!: number;

  @BelongsTo(() => Project)
  project!: Project;
}
