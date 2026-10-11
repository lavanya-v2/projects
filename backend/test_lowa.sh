#!/bin/bash
curl -v -X POST http://localhost:3000/api/report \
  -H "Content-Type: application/json" \
  -d '{
    "projectName": "LOWA",
    "date": "2026-02-03"
  }'
