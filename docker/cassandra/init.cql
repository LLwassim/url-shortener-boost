-- Cassandra initialization script for URL Shortener Analytics
-- This script creates the keyspace and tables for analytics data

-- Create keyspace for URL analytics
CREATE KEYSPACE IF NOT EXISTS url_analytics
WITH replication = {
  'class': 'SimpleStrategy',
  'replication_factor': 1
}
AND durable_writes = true;

-- Use the keyspace
USE url_analytics;

-- Table for storing hit events by hour (time series data)
CREATE TABLE IF NOT EXISTS hits_by_hour (
    code text,
    date date,
    hour int,
    count counter,
    unique_visitors counter,
    PRIMARY KEY ((code), date, hour)
) WITH CLUSTERING ORDER BY (date DESC, hour DESC)
AND gc_grace_seconds = 86400
AND compaction = {
    'class': 'TimeWindowCompactionStrategy',
    'compaction_window_unit': 'HOURS',
    'compaction_window_size': 24
};

-- Table for storing hit events by minute (detailed analytics)
CREATE TABLE IF NOT EXISTS hits_by_minute (
    code text,
    date date,
    hour int,
    minute int,
    count counter,
    unique_visitors counter,
    PRIMARY KEY ((code), date, hour, minute)
) WITH CLUSTERING ORDER BY (date DESC, hour DESC, minute DESC)
AND gc_grace_seconds = 86400
AND compaction = {
    'class': 'TimeWindowCompactionStrategy',
    'compaction_window_unit': 'HOURS',
    'compaction_window_size': 1
}
AND default_time_to_live = 2592000; -- 30 days TTL for minute-level data

-- Table for referrer analytics
CREATE TABLE IF NOT EXISTS referrers (
    code text,
    referrer text,
    count counter,
    PRIMARY KEY (code, referrer)
) WITH gc_grace_seconds = 86400;

-- Table for geographic analytics
CREATE TABLE IF NOT EXISTS geographic (
    code text,
    country text,
    count counter,
    PRIMARY KEY (code, country)
) WITH gc_grace_seconds = 86400;

-- Table for device and browser analytics
CREATE TABLE IF NOT EXISTS devices (
    code text,
    device_type text,
    browser text,
    os text,
    count counter,
    PRIMARY KEY (code, device_type, browser, os)
) WITH gc_grace_seconds = 86400;

-- Table for storing first and last access times
CREATE TABLE IF NOT EXISTS access_times (
    code text PRIMARY KEY,
    first_accessed timestamp,
    last_accessed timestamp
) WITH gc_grace_seconds = 86400;

-- Table for unique visitor tracking using HyperLogLog approximation
CREATE TABLE IF NOT EXISTS unique_visitors (
    code text,
    date date,
    visitor_hash text,
    PRIMARY KEY ((code, date), visitor_hash)
) WITH gc_grace_seconds = 86400
AND default_time_to_live = 7776000; -- 90 days TTL

-- Table for daily aggregates (materialized view alternative)
CREATE TABLE IF NOT EXISTS daily_stats (
    code text,
    date date,
    total_hits bigint,
    unique_visitors bigint,
    top_referrer text,
    top_country text,
    PRIMARY KEY (code, date)
) WITH CLUSTERING ORDER BY (date DESC)
AND gc_grace_seconds = 86400;

-- Table for global statistics (across all URLs)
CREATE TABLE IF NOT EXISTS global_stats (
    date date PRIMARY KEY,
    total_urls bigint,
    total_hits bigint,
    unique_visitors bigint,
    new_urls bigint,
    active_urls bigint
) WITH gc_grace_seconds = 86400;

-- Table for storing raw hit events (for debugging/replay)
CREATE TABLE IF NOT EXISTS hit_events (
    code text,
    timestamp timestamp,
    id timeuuid,
    ip text,
    user_agent text,
    referrer text,
    country text,
    city text,
    device_type text,
    browser text,
    os text,
    PRIMARY KEY ((code), timestamp, id)
) WITH CLUSTERING ORDER BY (timestamp DESC, id DESC)
AND gc_grace_seconds = 86400
AND default_time_to_live = 604800; -- 7 days TTL for raw events

-- Table for URL metadata cache
CREATE TABLE IF NOT EXISTS url_metadata (
    code text PRIMARY KEY,
    original_url text,
    created_at timestamp,
    expires_at timestamp,
    custom_alias text,
    hit_count bigint,
    last_updated timestamp
) WITH gc_grace_seconds = 86400
AND default_time_to_live = 3600; -- 1 hour TTL for metadata cache

-- Create secondary indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_access_times_first ON access_times (first_accessed);
CREATE INDEX IF NOT EXISTS idx_access_times_last ON access_times (last_accessed);
CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats (date);

-- Insert sample data for testing (only if tables are empty)
BEGIN BATCH
  -- Sample hit data for demo purposes
  UPDATE hits_by_hour SET count = count + 50 WHERE code = 'demo1' AND date = '2024-01-01' AND hour = 12;
  UPDATE hits_by_hour SET count = count + 35 WHERE code = 'demo1' AND date = '2024-01-01' AND hour = 13;
  UPDATE hits_by_hour SET count = count + 42 WHERE code = 'demo1' AND date = '2024-01-01' AND hour = 14;
  
  -- Sample referrer data
  UPDATE referrers SET count = count + 25 WHERE code = 'demo1' AND referrer = 'https://google.com';
  UPDATE referrers SET count = count + 15 WHERE code = 'demo1' AND referrer = 'https://twitter.com';
  UPDATE referrers SET count = count + 10 WHERE code = 'demo1' AND referrer = 'direct';
  
  -- Sample geographic data
  UPDATE geographic SET count = count + 30 WHERE code = 'demo1' AND country = 'US';
  UPDATE geographic SET count = count + 15 WHERE code = 'demo1' AND country = 'UK';
  UPDATE geographic SET count = count + 8 WHERE code = 'demo1' AND country = 'DE';
  
  -- Sample device data
  UPDATE devices SET count = count + 35 WHERE code = 'demo1' AND device_type = 'desktop' AND browser = 'Chrome' AND os = 'Windows';
  UPDATE devices SET count = count + 20 WHERE code = 'demo1' AND device_type = 'mobile' AND browser = 'Safari' AND os = 'iOS';
  UPDATE devices SET count = count + 8 WHERE code = 'demo1' AND device_type = 'tablet' AND browser = 'Chrome' AND os = 'Android';
  
  -- Sample access times
  INSERT INTO access_times (code, first_accessed, last_accessed) VALUES ('demo1', '2024-01-01 10:30:00', '2024-01-01 16:45:00');
APPLY BATCH;

-- Create a simple UDF for calculating percentages (if UDFs are enabled)
-- CREATE OR REPLACE FUNCTION percentage(part bigint, total bigint)
-- CALLED ON NULL INPUT
-- RETURNS double
-- LANGUAGE java
-- AS 'return (total == 0) ? 0.0 : (part * 100.0) / total;';

-- Log successful initialization
-- Note: Cassandra doesn't have a direct equivalent to PostgreSQL's DO blocks
-- This would typically be logged by the application or in the Cassandra system logs