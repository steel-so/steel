-- Remove ServiceDesk remote access (S4): sessions, endpoints, settings and the provider enum.
DROP TABLE IF EXISTS "sd_remote_sessions";
DROP TABLE IF EXISTS "sd_remote_endpoints";
DROP TABLE IF EXISTS "sd_remote_settings";
DROP TYPE IF EXISTS "SdRemoteProvider";
