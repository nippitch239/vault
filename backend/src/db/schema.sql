-- =============================================================================
-- SecureVault Cloud — Production Relational Database Schema (PostgreSQL 15+)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL,
    username VARCHAR(64) NOT NULL,
    full_name VARCHAR(128) NOT NULL,
    auth_hash VARCHAR(255) NOT NULL,
    auth_salt VARCHAR(128) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_secret VARCHAR(255) DEFAULT NULL,
    mfa_type VARCHAR(32) DEFAULT 'totp' CHECK (mfa_type IN ('totp', 'sms')),
    public_key TEXT DEFAULT NULL,
    encrypted_private_key JSONB DEFAULT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'pending')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    CONSTRAINT uq_users_email UNIQUE (email),
    CONSTRAINT uq_users_username UNIQUE (username)
);

-- 2. VAULTS TABLE
CREATE TABLE IF NOT EXISTS vaults (
    vault_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    name VARCHAR(128) NOT NULL,
    description TEXT DEFAULT NULL,
    is_shared BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_vaults_user FOREIGN KEY (user_id) 
        REFERENCES users (user_id) ON DELETE CASCADE
);

-- 3. VAULT ITEMS TABLE
CREATE TABLE IF NOT EXISTS vault_items (
    item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vault_id UUID NOT NULL,
    user_id UUID NOT NULL,
    item_type VARCHAR(64) NOT NULL DEFAULT 'login' 
        CHECK (item_type IN ('login', 'secure_note', 'credit_card', 'server', 'identity')),
    encrypted_data JSONB NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_vault_items_vault FOREIGN KEY (vault_id) 
        REFERENCES vaults (vault_id) ON DELETE CASCADE,
    CONSTRAINT fk_vault_items_user FOREIGN KEY (user_id) 
        REFERENCES users (user_id) ON DELETE CASCADE
);

-- 4. PASSWORD HISTORY TABLE
CREATE TABLE IF NOT EXISTS password_history (
    history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL,
    version INTEGER NOT NULL,
    encrypted_data JSONB NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    changed_by_user_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_password_history_item FOREIGN KEY (item_id) 
        REFERENCES vault_items (item_id) ON DELETE CASCADE,
    CONSTRAINT fk_password_history_user FOREIGN KEY (changed_by_user_id) 
        REFERENCES users (user_id) ON DELETE CASCADE,
    CONSTRAINT uq_item_version UNIQUE (item_id, version)
);

-- 5. SHARE PERMISSIONS TABLE
CREATE TABLE IF NOT EXISTS share_permissions (
    share_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL,
    shared_by_user_id UUID NOT NULL,
    shared_with_user_id UUID NOT NULL,
    permission_level VARCHAR(32) NOT NULL DEFAULT 'read' 
        CHECK (permission_level IN ('read', 'modify')),
    encrypted_key_for_recipient JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_share_item FOREIGN KEY (item_id) 
        REFERENCES vault_items (item_id) ON DELETE CASCADE,
    CONSTRAINT fk_share_by_user FOREIGN KEY (shared_by_user_id) 
        REFERENCES users (user_id) ON DELETE CASCADE,
    CONSTRAINT fk_share_with_user FOREIGN KEY (shared_with_user_id) 
        REFERENCES users (user_id) ON DELETE CASCADE,
    CONSTRAINT uq_share_item_recipient UNIQUE (item_id, shared_with_user_id)
);

-- 6. ACTIVITY LOGS TABLE (User-facing Activity Audit)
CREATE TABLE IF NOT EXISTS activity_logs (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    action_type VARCHAR(64) NOT NULL,
    target_item_id UUID DEFAULT NULL,
    ip_address VARCHAR(45) NOT NULL,
    user_agent TEXT DEFAULT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'SUCCESS',
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_activity_user FOREIGN KEY (user_id) 
        REFERENCES users (user_id) ON DELETE CASCADE,
    CONSTRAINT fk_activity_item FOREIGN KEY (target_item_id) 
        REFERENCES vault_items (item_id) ON DELETE SET NULL
);

-- 7. AUDIT LOGS TABLE (System & Admin Security Events)
CREATE TABLE IF NOT EXISTS audit_logs (
    audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID DEFAULT NULL,
    actor_role VARCHAR(32) NOT NULL DEFAULT 'system',
    event_action VARCHAR(64) NOT NULL,
    event_severity VARCHAR(32) NOT NULL DEFAULT 'INFO' 
        CHECK (event_severity IN ('INFO', 'WARNING', 'CRITICAL')),
    target_resource VARCHAR(64) NOT NULL,
    target_resource_id UUID DEFAULT NULL,
    ip_address VARCHAR(45) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'SUCCESS' 
        CHECK (status IN ('SUCCESS', 'FAILURE', 'DENIED')),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) 
        REFERENCES users (user_id) ON DELETE SET NULL
);

-- =============================================================================
-- INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);

CREATE INDEX IF NOT EXISTS idx_vaults_user_id ON vaults (user_id);
CREATE INDEX IF NOT EXISTS idx_vault_items_vault_id ON vault_items (vault_id);
CREATE INDEX IF NOT EXISTS idx_vault_items_user_id ON vault_items (user_id);
CREATE INDEX IF NOT EXISTS idx_vault_items_updated_at ON vault_items (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_vault_items_metadata ON vault_items USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_vault_items_encrypted ON vault_items USING GIN (encrypted_data);

CREATE INDEX IF NOT EXISTS idx_password_history_item ON password_history (item_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_share_recipient ON share_permissions (shared_with_user_id);
CREATE INDEX IF NOT EXISTS idx_share_item ON share_permissions (item_id);

CREATE INDEX IF NOT EXISTS idx_activity_logs_user_date ON activity_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_severity ON audit_logs (event_severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_details ON audit_logs USING GIN (details);

-- =============================================================================
-- 8. GROUPS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS groups (
    group_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT DEFAULT NULL,
    created_by UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_groups_created_by FOREIGN KEY (created_by) 
        REFERENCES users (user_id) ON DELETE CASCADE
);

-- =============================================================================
-- 9. GROUP MEMBERS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS group_members (
    group_member_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL,
    user_id UUID NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'manager', 'admin')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_group_members_group FOREIGN KEY (group_id) 
        REFERENCES groups (group_id) ON DELETE CASCADE,
    CONSTRAINT fk_group_members_user FOREIGN KEY (user_id) 
        REFERENCES users (user_id) ON DELETE CASCADE,
    CONSTRAINT uq_group_members_group_user UNIQUE (group_id, user_id)
);

-- =============================================================================
-- 10. COLLECTIONS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS collections (
    collection_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT DEFAULT NULL,
    created_by UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_collections_created_by FOREIGN KEY (created_by) 
        REFERENCES users (user_id) ON DELETE CASCADE
);

-- =============================================================================
-- 11. COLLECTION ACCESS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS collection_access (
    access_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    collection_id UUID NOT NULL,
    target_type VARCHAR(20) NOT NULL CHECK (target_type IN ('user', 'group')),
    target_id UUID NOT NULL,
    permission VARCHAR(20) NOT NULL DEFAULT 'read' CHECK (permission IN ('read', 'write', 'admin')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_collection_access_collection FOREIGN KEY (collection_id) 
        REFERENCES collections (collection_id) ON DELETE CASCADE,
    CONSTRAINT uq_collection_access_target UNIQUE (collection_id, target_type, target_id)
);

-- =============================================================================
-- 12. COLLECTION ITEMS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS collection_items (
    collection_item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    collection_id UUID NOT NULL,
    item_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_collection_items_collection FOREIGN KEY (collection_id) 
        REFERENCES collections (collection_id) ON DELETE CASCADE,
    CONSTRAINT fk_collection_items_item FOREIGN KEY (item_id) 
        REFERENCES vault_items (item_id) ON DELETE CASCADE,
    CONSTRAINT uq_collection_items_collection_item UNIQUE (collection_id, item_id)
);

-- =============================================================================
-- 13. COLLECTION KEYS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS collection_keys (
    key_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    collection_id UUID NOT NULL,
    user_id UUID NOT NULL,
    encrypted_key_for_recipient JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_collection_keys_collection FOREIGN KEY (collection_id) 
        REFERENCES collections (collection_id) ON DELETE CASCADE,
    CONSTRAINT fk_collection_keys_user FOREIGN KEY (user_id) 
        REFERENCES users (user_id) ON DELETE CASCADE,
    CONSTRAINT uq_collection_keys_collection_user UNIQUE (collection_id, user_id)
);

-- =============================================================================
-- INDEXES FOR COLLECTIONS & GROUPS
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_groups_created_by ON groups (created_by);
CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON group_members (group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON group_members (user_id);

CREATE INDEX IF NOT EXISTS idx_collections_created_by ON collections (created_by);
CREATE INDEX IF NOT EXISTS idx_collection_access_collection_id ON collection_access (collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_access_target ON collection_access (target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_collection_items_collection_id ON collection_items (collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_items_item_id ON collection_items (item_id);

CREATE INDEX IF NOT EXISTS idx_collection_keys_collection_id ON collection_keys (collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_keys_user_id ON collection_keys (user_id);
