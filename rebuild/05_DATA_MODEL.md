# Data Model

작성일: 2026-03-01

## 1. 엔티티 개요
- `job`
- `job_input_file`
- `job_result`
- `job_attempt`
- `audit_log`

## 2. 스키마(초안)

### job
- `id` (uuid, pk)
- `status` (enum: queued/running/succeeded/failed/cancelled)
- `requested_by` (string)
- `style_mode` (enum)
- `tone_mode` (enum)
- `created_at` (timestamp)
- `started_at` (timestamp, nullable)
- `finished_at` (timestamp, nullable)
- `error_code` (string, nullable)

### job_input_file
- `id` (uuid, pk)
- `job_id` (fk)
- `file_name` (string)
- `mime_type` (string)
- `size_bytes` (int)
- `storage_uri` (string)

### job_result
- `job_id` (pk/fk)
- `html_uri` (string)
- `analysis_json` (jsonb)
- `meta_json` (jsonb)
- `slide_count` (int)
- `fallback_used` (boolean)
- `why_fallback` (string, nullable)

### job_attempt
- `id` (uuid, pk)
- `job_id` (fk)
- `stage` (enum: extract/analyze/render/repair)
- `provider` (string)
- `model` (string)
- `duration_ms` (int)
- `ok` (boolean)
- `reason_code` (string, nullable)

### audit_log
- `id` (uuid, pk)
- `request_id` (string)
- `actor` (string)
- `action` (string)
- `resource_type` (string)
- `resource_id` (string)
- `created_at` (timestamp)

## 3. 상태 전이
- `queued -> running -> succeeded`
- `queued -> running -> failed`
- `queued -> cancelled`

## 4. 인덱스 권장
- `job(status, created_at desc)`
- `job(requested_by, created_at desc)`
- `job_attempt(job_id, stage)`

