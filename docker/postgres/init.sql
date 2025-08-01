-- PostgreSQL initialization script for URL Shortener
-- This script sets up the database schema, indexes, and initial configuration

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- Create main URLs table
CREATE TABLE IF NOT EXISTS urls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(16) UNIQUE NOT NULL,
    original TEXT NOT NULL,
    normalized TEXT NOT NULL,
    hit_count BIGINT DEFAULT 0,
    custom_alias VARCHAR(50),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    creator_ip INET,
    creator_user_agent TEXT,
    metadata JSONB
);

-- Create indexes for performance
CREATE UNIQUE INDEX IF NOT EXISTS idx_urls_code ON urls(code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_urls_normalized ON urls(normalized);
CREATE INDEX IF NOT EXISTS idx_urls_created_at ON urls(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_urls_expires_at ON urls(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_urls_hit_count ON urls(hit_count DESC);

-- Create GIN index for full-text search
CREATE INDEX IF NOT EXISTS idx_urls_original_gin ON urls USING gin(original gin_trgm_ops);

-- Create partial indexes for common queries
CREATE INDEX IF NOT EXISTS idx_urls_active ON urls(created_at DESC) 
    WHERE expires_at IS NULL OR expires_at > NOW();
CREATE INDEX IF NOT EXISTS idx_urls_expired ON urls(expires_at) 
    WHERE expires_at IS NOT NULL AND expires_at <= NOW();

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_urls_updated_at 
    BEFORE UPDATE ON urls 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Create function for URL statistics
CREATE OR REPLACE FUNCTION get_url_stats()
RETURNS TABLE(
    total_urls BIGINT,
    active_urls BIGINT,
    expired_urls BIGINT,
    total_hits BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*) as total_urls,
        COUNT(*) FILTER (WHERE expires_at IS NULL OR expires_at > NOW()) as active_urls,
        COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at <= NOW()) as expired_urls,
        COALESCE(SUM(hit_count), 0) as total_hits
    FROM urls;
END;
$$ LANGUAGE plpgsql;

-- Create materialized view for analytics
CREATE MATERIALIZED VIEW IF NOT EXISTS url_stats_daily AS
SELECT 
    DATE(created_at) as date,
    COUNT(*) as urls_created,
    SUM(hit_count) as total_hits,
    COUNT(*) FILTER (WHERE custom_alias IS NOT NULL) as custom_aliases,
    COUNT(*) FILTER (WHERE expires_at IS NOT NULL) as with_expiration
FROM urls 
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Create index on materialized view
CREATE UNIQUE INDEX IF NOT EXISTS idx_url_stats_daily_date ON url_stats_daily(date);

-- Create function to refresh materialized view
CREATE OR REPLACE FUNCTION refresh_url_stats_daily()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY url_stats_daily;
END;
$$ LANGUAGE plpgsql;

-- Insert sample data for testing (only in development)
DO $$
BEGIN
    IF current_setting('server_version_num')::int >= 120000 THEN
        -- Only insert if we're in development and table is empty
        IF (SELECT COUNT(*) FROM urls) = 0 AND 
           current_setting('application_name', true) LIKE '%development%' THEN
            
            INSERT INTO urls (code, original, normalized, hit_count, created_at) VALUES
            ('demo1', 'https://example.com/demo-1', 'https://example.com/demo-1', 42, NOW() - INTERVAL '1 day'),
            ('demo2', 'https://github.com/nestjs/nest', 'https://github.com/nestjs/nest', 156, NOW() - INTERVAL '2 days'),
            ('demo3', 'https://www.postgresql.org/', 'https://www.postgresql.org', 89, NOW() - INTERVAL '3 days');
            
        END IF;
    END IF;
END $$;

-- Set up row-level security (optional, for multi-tenant scenarios)
-- ALTER TABLE urls ENABLE ROW LEVEL SECURITY;

-- Create policy for read access (example)
-- CREATE POLICY urls_read_policy ON urls FOR SELECT USING (true);

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON urls TO postgres;
GRANT USAGE ON SCHEMA public TO postgres;
GRANT SELECT ON url_stats_daily TO postgres;

-- Log successful initialization
DO $$
BEGIN
    RAISE NOTICE 'URL Shortener database initialized successfully';
    RAISE NOTICE 'Created tables: urls';
    RAISE NOTICE 'Created indexes: % indexes', (
        SELECT COUNT(*) FROM pg_indexes WHERE tablename = 'urls'
    );
    RAISE NOTICE 'Created functions: update_updated_at_column, get_url_stats, refresh_url_stats_daily';
    RAISE NOTICE 'Created materialized view: url_stats_daily';
END $$;