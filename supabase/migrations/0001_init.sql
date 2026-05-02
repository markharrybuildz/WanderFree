-- ─────────────────────────────────────────────────────────────────────────────
--  WanderFree initial schema
--  ----------------------------------------------------------------------------
--  Catalog tables (issuers, network_tiers, cards, benefits) are populated by
--  the Python extraction pipeline using the service role key.
--
--  Per-user tables (user_cards, user_benefits) are written by the mobile app
--  through Supabase Auth + RLS, so each user can only ever read or write their
--  own rows.
--
--  The mobile app reads the user_visible_benefits view, which UNIONs the
--  card-specific benefits the user is entitled to with the network-tier
--  benefits inherited from any card they hold at that tier.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Catalog: issuers ────────────────────────────────────────────────────────

CREATE TABLE issuers (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,        -- "Chase", "American Express", ...
    slug        TEXT NOT NULL UNIQUE,        -- "chase", "amex"
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE issuers IS
  'Card-issuing banks. Populated once, rarely changes.';


-- ── Catalog: network tiers (Visa Infinite, World Elite Mastercard, etc.) ────

CREATE TABLE network_tiers (
    id          SERIAL PRIMARY KEY,
    network     TEXT NOT NULL                 -- 'visa', 'mastercard', 'amex', 'discover'
                CHECK (network IN ('visa', 'mastercard', 'amex', 'discover')),
    tier_name   TEXT NOT NULL,                -- "Infinite", "World Elite", "Platinum"
    slug        TEXT NOT NULL UNIQUE,         -- "visa-infinite", "world-elite-mastercard"
    UNIQUE (network, tier_name)
);

COMMENT ON TABLE network_tiers IS
  'Card network programs whose benefits a card inherits at that tier '
  '(e.g. Visa Infinite cards all share the Visa Infinite benefits guide).';


-- ── Catalog: cards ──────────────────────────────────────────────────────────

CREATE TABLE cards (
    id                SERIAL PRIMARY KEY,
    issuer_id         INT NOT NULL REFERENCES issuers(id),
    network_tier_id   INT REFERENCES network_tiers(id),    -- nullable: not every card has one
    name              TEXT NOT NULL,                       -- "Chase Sapphire Reserve"
    slug              TEXT NOT NULL UNIQUE,                -- "chase-sapphire-reserve"
    annual_fee_cents  INT,
    is_business       BOOLEAN NOT NULL DEFAULT false,
    is_active         BOOLEAN NOT NULL DEFAULT true,       -- false = product retired
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cards_issuer    ON cards(issuer_id);
CREATE INDEX idx_cards_network   ON cards(network_tier_id) WHERE network_tier_id IS NOT NULL;
CREATE INDEX idx_cards_is_active ON cards(is_active) WHERE is_active;

COMMENT ON TABLE cards IS
  'The 25 cards in v1. New cards added via cards.yaml + a re-run of the pipeline.';


-- ── Catalog: benefits (unified card + network-tier table) ───────────────────
--
-- A single benefits table with either card_id OR network_tier_id set, never
-- both, never neither. This keeps the read path simple (one table to query)
-- and lets user_benefits reference any benefit by id without polymorphic FKs.
--
-- benefit_signature is the dedup key used by the pipeline's UPSERT — see
-- pipeline/src/extract/schema.py::benefit_signature for how it's computed.

CREATE TABLE benefits (
    id                       BIGSERIAL PRIMARY KEY,

    -- Parent: exactly one of these must be set.
    card_id                  INT REFERENCES cards(id),
    network_tier_id          INT REFERENCES network_tiers(id),
    CHECK ((card_id IS NULL) <> (network_tier_id IS NULL)),

    -- Dedup key (mirrors the Pydantic-side benefit_signature)
    benefit_signature        TEXT NOT NULL,

    -- ── Categorization ──────────────────────────────────────────────────────
    category                 TEXT NOT NULL,
    subcategory              TEXT,

    -- ── Reward shape ────────────────────────────────────────────────────────
    reward_type              TEXT NOT NULL,
    reward_value             NUMERIC,
    reward_value_unit        TEXT,

    -- ── Caps and spend ──────────────────────────────────────────────────────
    cap_amount_cents         BIGINT,
    cap_period               TEXT,
    min_spend_cents          BIGINT,
    min_spend_period_months  INT,

    -- ── Time / recurrence ───────────────────────────────────────────────────
    recurrence               TEXT NOT NULL,
    recurrence_split         BOOLEAN NOT NULL DEFAULT false,
    valid_from               DATE,
    valid_to                 DATE,                 -- NULL = active; set to mark deprecated

    -- ── Activation / eligibility ────────────────────────────────────────────
    requires_activation      BOOLEAN NOT NULL DEFAULT false,
    activation_method        TEXT,
    eligible_merchants       TEXT[],

    -- ── Provenance ──────────────────────────────────────────────────────────
    source_quote             TEXT NOT NULL,
    source_url               TEXT,
    source_section           TEXT,

    -- ── Pipeline metadata ───────────────────────────────────────────────────
    extraction_confidence    TEXT NOT NULL
                             CHECK (extraction_confidence IN ('high', 'medium', 'low')),
    notes                    TEXT,
    extracted_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    extraction_run_id        UUID,                 -- groups all benefits from one cron run

    -- Dedup constraints — one signature per (parent). These are partial unique
    -- indexes because each row only has ONE of card_id / network_tier_id.
    CONSTRAINT benefits_card_sig_unique
        UNIQUE (card_id, benefit_signature),
    CONSTRAINT benefits_network_sig_unique
        UNIQUE (network_tier_id, benefit_signature)
);

CREATE INDEX idx_benefits_card        ON benefits(card_id) WHERE card_id IS NOT NULL;
CREATE INDEX idx_benefits_network     ON benefits(network_tier_id) WHERE network_tier_id IS NOT NULL;
CREATE INDEX idx_benefits_category    ON benefits(category);
CREATE INDEX idx_benefits_active      ON benefits(valid_to) WHERE valid_to IS NULL;

COMMENT ON TABLE benefits IS
  'All extracted benefits. Either card-specific (card_id set) or network-tier '
  '(network_tier_id set), never both. UPSERT dedup key is benefit_signature.';


-- ── Per-user state: user_cards ──────────────────────────────────────────────

CREATE TABLE user_cards (
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    card_id     INT  NOT NULL REFERENCES cards(id),
    opened_on   DATE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, card_id)
);

CREATE INDEX idx_user_cards_user ON user_cards(user_id);

COMMENT ON TABLE user_cards IS
  'Which cards each user has added. Drives which benefits show up in their app.';


-- ── Per-user state: user_benefits ───────────────────────────────────────────

CREATE TABLE user_benefits (
    user_id      UUID   NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    benefit_id   BIGINT NOT NULL REFERENCES benefits(id) ON DELETE CASCADE,
    completed    BOOLEAN NOT NULL DEFAULT false,
    completed_at TIMESTAMPTZ,
    notes        TEXT,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, benefit_id)
);

CREATE INDEX idx_user_benefits_user ON user_benefits(user_id);

COMMENT ON TABLE user_benefits IS
  'Per-user completion state for individual benefits. The mobile app writes '
  'here when a user toggles "completed" on a benefit card.';


-- ─────────────────────────────────────────────────────────────────────────────
--  Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Catalog tables: any authenticated user can read, no one can write through
--   the API (only the service role used by the pipeline can write).
-- Per-user tables: each user can only read/write their own rows.

ALTER TABLE issuers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE network_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE cards         ENABLE ROW LEVEL SECURITY;
ALTER TABLE benefits      ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_cards    ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_benefits ENABLE ROW LEVEL SECURITY;

-- Catalog: read-only to authenticated users
CREATE POLICY "issuers_select_authenticated"        ON issuers
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "network_tiers_select_authenticated"  ON network_tiers
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "cards_select_authenticated"          ON cards
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "benefits_select_authenticated"       ON benefits
    FOR SELECT TO authenticated USING (true);

-- Per-user: own rows only, full CRUD
CREATE POLICY "user_cards_own_rows" ON user_cards
    FOR ALL TO authenticated
    USING      (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_benefits_own_rows" ON user_benefits
    FOR ALL TO authenticated
    USING      (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());


-- ─────────────────────────────────────────────────────────────────────────────
--  user_visible_benefits view
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The single view the mobile app SELECTs from. UNIONs:
--   1. Card-specific benefits for cards the user has added
--   2. Network-tier benefits inherited from any card the user has at that tier
--
-- security_invoker = true is critical here — without it the view runs with
-- the definer's privileges and would bypass user_cards' RLS, leaking other
-- users' card holdings. Postgres 15+.

CREATE VIEW user_visible_benefits
WITH (security_invoker = true)
AS
WITH user_tiers AS (
    SELECT DISTINCT
        uc.user_id,
        c.network_tier_id
    FROM user_cards uc
    JOIN cards c ON c.id = uc.card_id
    WHERE c.network_tier_id IS NOT NULL
)
-- Card-specific benefits the user is entitled to
SELECT
    b.id                       AS benefit_id,
    'card'::TEXT               AS source,
    b.card_id,
    b.network_tier_id,
    c.name                     AS card_name,
    i.name                     AS issuer_name,
    b.category,
    b.subcategory,
    b.reward_type,
    b.reward_value,
    b.reward_value_unit,
    b.cap_amount_cents,
    b.cap_period,
    b.min_spend_cents,
    b.min_spend_period_months,
    b.recurrence,
    b.recurrence_split,
    b.valid_from,
    b.valid_to,
    b.requires_activation,
    b.activation_method,
    b.eligible_merchants,
    b.source_quote,
    b.source_url,
    b.source_section,
    b.extraction_confidence,
    b.notes,
    COALESCE(ub.completed, false) AS completed,
    ub.completed_at
FROM benefits b
JOIN cards      c  ON c.id = b.card_id
JOIN issuers    i  ON i.id = c.issuer_id
JOIN user_cards uc ON uc.card_id = c.id AND uc.user_id = auth.uid()
LEFT JOIN user_benefits ub
       ON ub.benefit_id = b.id AND ub.user_id = auth.uid()
WHERE b.card_id IS NOT NULL
  AND c.is_active
  AND (b.valid_to IS NULL OR b.valid_to > now())

UNION ALL

-- Network-tier benefits inherited via any card the user holds at that tier
SELECT
    b.id                       AS benefit_id,
    'network'::TEXT            AS source,
    NULL::INT                  AS card_id,
    b.network_tier_id,
    NULL::TEXT                 AS card_name,    -- network benefit applies to all cards at this tier
    NULL::TEXT                 AS issuer_name,
    b.category,
    b.subcategory,
    b.reward_type,
    b.reward_value,
    b.reward_value_unit,
    b.cap_amount_cents,
    b.cap_period,
    b.min_spend_cents,
    b.min_spend_period_months,
    b.recurrence,
    b.recurrence_split,
    b.valid_from,
    b.valid_to,
    b.requires_activation,
    b.activation_method,
    b.eligible_merchants,
    b.source_quote,
    b.source_url,
    b.source_section,
    b.extraction_confidence,
    b.notes,
    COALESCE(ub.completed, false) AS completed,
    ub.completed_at
FROM benefits b
JOIN user_tiers ut ON ut.network_tier_id = b.network_tier_id
LEFT JOIN user_benefits ub
       ON ub.benefit_id = b.id AND ub.user_id = ut.user_id
WHERE b.network_tier_id IS NOT NULL
  AND (b.valid_to IS NULL OR b.valid_to > now());

COMMENT ON VIEW user_visible_benefits IS
  'The single view the mobile app reads. UNIONs card-specific + inherited '
  'network-tier benefits, scoped to the calling user via security_invoker.';
