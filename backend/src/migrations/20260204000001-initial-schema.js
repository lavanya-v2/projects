'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        // 1. Accounts
        await queryInterface.createTable('accounts', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER
            },
            code: {
                type: Sequelize.STRING(50),
                allowNull: false,
                unique: true
            },
            name: {
                type: Sequelize.STRING(255),
                allowNull: false
            },
            description: {
                type: Sequelize.TEXT
            },
            created_at: {
                allowNull: false,
                type: Sequelize.DATE,
                defaultValue: Sequelize.fn('NOW')
            },
            updated_at: {
                allowNull: false,
                type: Sequelize.DATE,
                defaultValue: Sequelize.fn('NOW')
            }
        });

        // 2. Projects
        await queryInterface.createTable('projects', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER
            },
            account_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: {
                    model: 'accounts',
                    key: 'id'
                },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            code: {
                type: Sequelize.STRING(50),
                allowNull: false,
                unique: true
            },
            name: {
                type: Sequelize.STRING(255),
                allowNull: false
            },
            jira_board_id: {
                type: Sequelize.INTEGER,
                field: 'jira_board_id'
            },
            jira_name: {
                type: Sequelize.STRING(255),
                field: 'jira_name'
            },
            jira_base_url: {
                type: Sequelize.STRING(255),
                field: 'jira_base_url'
            },
            created_at: {
                allowNull: false,
                type: Sequelize.DATE,
                defaultValue: Sequelize.fn('NOW')
            },
            updated_at: {
                allowNull: false,
                type: Sequelize.DATE,
                defaultValue: Sequelize.fn('NOW')
            }
        });

        // 3. Team Members
        await queryInterface.createTable('team_members', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER
            },
            first_name: {
                type: Sequelize.STRING(255),
                allowNull: false,
                field: 'first_name'
            },
            last_name: {
                type: Sequelize.STRING(255),
                allowNull: false,
                field: 'last_name'
            },
            email: {
                type: Sequelize.STRING(255),
                allowNull: false,
                unique: true
            },
            jira_login_id: {
                type: Sequelize.STRING(255),
                field: 'jira_login_id'
            },
            partner_email_id: {
                type: Sequelize.STRING(255),
                field: 'partner_email_id'
            },
            created_at: {
                allowNull: false,
                type: Sequelize.DATE,
                defaultValue: Sequelize.fn('NOW')
            },
            updated_at: {
                allowNull: false,
                type: Sequelize.DATE,
                defaultValue: Sequelize.fn('NOW')
            }
        });

        // 4. Account Team Members (Join Table)
        await queryInterface.createTable('account_team_members', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER
            },
            account_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: {
                    model: 'accounts',
                    key: 'id'
                },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            team_member_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: {
                    model: 'team_members',
                    key: 'id'
                },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            project_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: {
                    model: 'projects',
                    key: 'id'
                },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL'
            },
            role: {
                type: Sequelize.STRING(50)
            },
            created_at: {
                allowNull: false,
                type: Sequelize.DATE,
                defaultValue: Sequelize.fn('NOW')
            },
            updated_at: {
                allowNull: false,
                type: Sequelize.DATE,
                defaultValue: Sequelize.fn('NOW')
            }
        });

        // 5. Daily Board Snapshots
        await queryInterface.createTable('daily_board_snapshots', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER
            },
            date: {
                type: Sequelize.DATEONLY,
                allowNull: false
            },
            board_id: {
                type: Sequelize.INTEGER,
                allowNull: false
            },
            project_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: {
                    model: 'projects',
                    key: 'id'
                },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL'
            },
            account_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: {
                    model: 'accounts',
                    key: 'id'
                },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL'
            },
            board_name: {
                type: Sequelize.STRING(255)
            },
            project_name: {
                type: Sequelize.STRING(255)
            },
            total_tickets: {
                type: Sequelize.INTEGER
            },
            status_counts: {
                type: Sequelize.JSONB
            },
            blocked_tickets: {
                type: Sequelize.JSONB
            },
            work_summary: {
                type: Sequelize.TEXT
            },
            considered_jira_ids: {
                type: Sequelize.JSONB,
                defaultValue: []
            },
            overall_health: {
                type: Sequelize.STRING(255)
            },
            ticket_keys: {
                type: Sequelize.JSONB
            },
            executive_summary: {
                type: Sequelize.TEXT
            },
            executive_risks: {
                type: Sequelize.TEXT
            },
            executive_plan: {
                type: Sequelize.TEXT
            },
            created_at: {
                allowNull: false,
                type: Sequelize.DATE,
                defaultValue: Sequelize.fn('NOW')
            }
        });

        // Indexes (Optional but good practice)
        await queryInterface.addIndex('daily_board_snapshots', ['date', 'board_id'], {
            unique: true // Changed to enforce uniqueness for ON CONFLICT
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.dropTable('daily_board_snapshots');
        await queryInterface.dropTable('account_team_members');
        await queryInterface.dropTable('team_members');
        await queryInterface.dropTable('projects');
        await queryInterface.dropTable('accounts');
    }
};
