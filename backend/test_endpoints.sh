#!/bin/bash
echo "Testing Team Member Addition..."
curl -v -X POST http://localhost:3000/api/team-members \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Test",
    "lastName": "User",
    "email": "test.user.new@example.com",
    "jiraLoginId": "test-jira-id-new",
    "partnerEmailId": "test.partner.new@example.com",
    "projectName": "LOSAI",
    "role": "QA"
  }'
echo "\n"

echo "Testing Report Generation..."
curl -v -X POST http://localhost:3000/api/report \
  -H "Content-Type: application/json" \
  -d '{
    "projectName": "LOSAI"
  }'
echo "\n"
