


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."benefit_cycle_status" AS ENUM (
    'unused',
    'partially_used',
    'fully_used',
    'expired'
);


ALTER TYPE "public"."benefit_cycle_status" OWNER TO "postgres";


CREATE TYPE "public"."card_network" AS ENUM (
    'visa',
    'mastercard',
    'amex',
    'discover'
);


ALTER TYPE "public"."card_network" OWNER TO "postgres";


CREATE TYPE "public"."member_role" AS ENUM (
    'owner',
    'editor',
    'viewer'
);


ALTER TYPE "public"."member_role" OWNER TO "postgres";


CREATE TYPE "public"."program_unit_type" AS ENUM (
    'points',
    'miles',
    'cash_back'
);


ALTER TYPE "public"."program_unit_type" OWNER TO "postgres";


CREATE TYPE "public"."reset_basis" AS ENUM (
    'calendar',
    'anniversary'
);


ALTER TYPE "public"."reset_basis" OWNER TO "postgres";


CREATE TYPE "public"."reset_frequency" AS ENUM (
    'monthly',
    'quarterly',
    'semiannual',
    'annual',
    'one_time'
);


ALTER TYPE "public"."reset_frequency" OWNER TO "postgres";


CREATE TYPE "public"."reward_unit" AS ENUM (
    'points',
    'miles',
    'cash_back'
);


ALTER TYPE "public"."reward_unit" OWNER TO "postgres";


CREATE TYPE "public"."transfer_partner_type" AS ENUM (
    'airline',
    'hotel'
);


ALTER TYPE "public"."transfer_partner_type" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_access_user_card"("p_user_card_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from user_cards uc
    join portfolio_members pm on pm.portfolio_id = uc.portfolio_id
    where uc.id = p_user_card_id
      and pm.profile_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."can_access_user_card"("p_user_card_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'display_name')
  on conflict (id) do nothing;
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_portfolio_member"("p_portfolio_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from portfolio_members pm
    where pm.portfolio_id = p_portfolio_id
      and pm.profile_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_portfolio_member"("p_portfolio_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."benefit_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text"
);


ALTER TABLE "public"."benefit_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."benefit_definitions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "card_product_id" "uuid" NOT NULL,
    "benefit_category_id" "uuid",
    "name" "text" NOT NULL,
    "value_per_period" numeric(10,2),
    "annual_value" numeric(10,2),
    "reset_frequency" "public"."reset_frequency" DEFAULT 'annual'::"public"."reset_frequency" NOT NULL,
    "reset_basis" "public"."reset_basis" DEFAULT 'calendar'::"public"."reset_basis" NOT NULL,
    "requires_enrollment" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."benefit_definitions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."benefit_redemptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "benefit_cycle_id" "uuid" NOT NULL,
    "user_card_id" "uuid" NOT NULL,
    "benefit_definition_id" "uuid" NOT NULL,
    "amount" numeric(10,2),
    "redeemed_on" "date" DEFAULT CURRENT_DATE NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."benefit_redemptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."card_issuers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL
);


ALTER TABLE "public"."card_issuers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."card_products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "issuer_id" "uuid" NOT NULL,
    "rewards_program_id" "uuid",
    "name" "text" NOT NULL,
    "network" "public"."card_network",
    "annual_fee" numeric(10,2) DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."card_products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."card_reward_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "card_product_id" "uuid" NOT NULL,
    "reward_category_id" "uuid" NOT NULL,
    "multiplier" numeric(6,2) DEFAULT 1 NOT NULL,
    "reward_unit" "public"."reward_unit" DEFAULT 'points'::"public"."reward_unit" NOT NULL,
    "days_of_week" integer[],
    "start_time" time without time zone,
    "end_time" time without time zone,
    "spend_cap" numeric(12,2),
    "conditions" "jsonb"
);


ALTER TABLE "public"."card_reward_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."portfolio_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "portfolio_id" "uuid" NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "role" "public"."member_role" DEFAULT 'viewer'::"public"."member_role" NOT NULL
);


ALTER TABLE "public"."portfolio_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."portfolios" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "type" "text",
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."portfolios" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "display_name" "text"
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."program_transfer_partners" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rewards_program_id" "uuid" NOT NULL,
    "transfer_partner_id" "uuid" NOT NULL,
    "transfer_ratio" numeric(6,3) DEFAULT 1.0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."program_transfer_partners" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reward_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "parent_id" "uuid"
);


ALTER TABLE "public"."reward_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rewards_programs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "unit_type" "public"."program_unit_type" DEFAULT 'points'::"public"."program_unit_type" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."rewards_programs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."spend_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_card_id" "uuid" NOT NULL,
    "signup_bonus_id" "uuid",
    "amount" numeric(12,2) NOT NULL,
    "spent_on" "date" DEFAULT CURRENT_DATE NOT NULL,
    "reward_category_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."spend_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transfer_partners" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "partner_type" "public"."transfer_partner_type" NOT NULL
);


ALTER TABLE "public"."transfer_partners" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_benefit_cycles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_card_id" "uuid" NOT NULL,
    "benefit_definition_id" "uuid" NOT NULL,
    "period_start" "date" NOT NULL,
    "period_end" "date" NOT NULL,
    "allotted_value" numeric(10,2),
    "status" "public"."benefit_cycle_status" DEFAULT 'unused'::"public"."benefit_cycle_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_benefit_cycles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_cards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "portfolio_id" "uuid" NOT NULL,
    "card_product_id" "uuid" NOT NULL,
    "nickname" "text",
    "last_four" "text",
    "opened_on" "date",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_cards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_signup_bonuses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_card_id" "uuid" NOT NULL,
    "required_spend" numeric(12,2) NOT NULL,
    "spend_deadline" "date",
    "bonus_value" numeric(12,2),
    "is_completed" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_signup_bonuses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wallet_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "portfolio_id" "uuid" NOT NULL,
    "rewards_program_id" "uuid" NOT NULL,
    "balance" numeric(14,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."wallet_accounts" OWNER TO "postgres";


ALTER TABLE ONLY "public"."benefit_categories"
    ADD CONSTRAINT "benefit_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."benefit_definitions"
    ADD CONSTRAINT "benefit_definitions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."benefit_redemptions"
    ADD CONSTRAINT "benefit_redemptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."card_issuers"
    ADD CONSTRAINT "card_issuers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."card_products"
    ADD CONSTRAINT "card_products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."card_reward_rules"
    ADD CONSTRAINT "card_reward_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."portfolio_members"
    ADD CONSTRAINT "portfolio_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."portfolio_members"
    ADD CONSTRAINT "portfolio_members_portfolio_id_profile_id_key" UNIQUE ("portfolio_id", "profile_id");



ALTER TABLE ONLY "public"."portfolios"
    ADD CONSTRAINT "portfolios_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."program_transfer_partners"
    ADD CONSTRAINT "program_transfer_partners_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."program_transfer_partners"
    ADD CONSTRAINT "program_transfer_partners_rewards_program_id_transfer_partn_key" UNIQUE ("rewards_program_id", "transfer_partner_id");



ALTER TABLE ONLY "public"."reward_categories"
    ADD CONSTRAINT "reward_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rewards_programs"
    ADD CONSTRAINT "rewards_programs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."spend_entries"
    ADD CONSTRAINT "spend_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transfer_partners"
    ADD CONSTRAINT "transfer_partners_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_benefit_cycles"
    ADD CONSTRAINT "user_benefit_cycles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_benefit_cycles"
    ADD CONSTRAINT "user_benefit_cycles_user_card_id_benefit_definition_id_peri_key" UNIQUE ("user_card_id", "benefit_definition_id", "period_start");



ALTER TABLE ONLY "public"."user_cards"
    ADD CONSTRAINT "user_cards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_signup_bonuses"
    ADD CONSTRAINT "user_signup_bonuses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wallet_accounts"
    ADD CONSTRAINT "wallet_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wallet_accounts"
    ADD CONSTRAINT "wallet_accounts_portfolio_id_rewards_program_id_key" UNIQUE ("portfolio_id", "rewards_program_id");



CREATE INDEX "idx_benefit_cycles_card" ON "public"."user_benefit_cycles" USING "btree" ("user_card_id");



CREATE INDEX "idx_benefit_cycles_definition" ON "public"."user_benefit_cycles" USING "btree" ("benefit_definition_id");



CREATE INDEX "idx_benefit_definitions_category" ON "public"."benefit_definitions" USING "btree" ("benefit_category_id");



CREATE INDEX "idx_benefit_definitions_product" ON "public"."benefit_definitions" USING "btree" ("card_product_id");



CREATE INDEX "idx_card_products_issuer" ON "public"."card_products" USING "btree" ("issuer_id");



CREATE INDEX "idx_card_products_program" ON "public"."card_products" USING "btree" ("rewards_program_id");



CREATE INDEX "idx_card_reward_rules_category" ON "public"."card_reward_rules" USING "btree" ("reward_category_id");



CREATE INDEX "idx_card_reward_rules_product" ON "public"."card_reward_rules" USING "btree" ("card_product_id");



CREATE INDEX "idx_portfolio_members_portfolio" ON "public"."portfolio_members" USING "btree" ("portfolio_id");



CREATE INDEX "idx_portfolio_members_profile" ON "public"."portfolio_members" USING "btree" ("profile_id");



CREATE INDEX "idx_portfolios_created_by" ON "public"."portfolios" USING "btree" ("created_by");



CREATE INDEX "idx_ptp_partner" ON "public"."program_transfer_partners" USING "btree" ("transfer_partner_id");



CREATE INDEX "idx_ptp_program" ON "public"."program_transfer_partners" USING "btree" ("rewards_program_id");



CREATE INDEX "idx_redemptions_card_def_date" ON "public"."benefit_redemptions" USING "btree" ("user_card_id", "benefit_definition_id", "redeemed_on");



CREATE INDEX "idx_redemptions_cycle" ON "public"."benefit_redemptions" USING "btree" ("benefit_cycle_id");



CREATE INDEX "idx_reward_categories_parent" ON "public"."reward_categories" USING "btree" ("parent_id");



CREATE INDEX "idx_signup_bonuses_card" ON "public"."user_signup_bonuses" USING "btree" ("user_card_id");



CREATE INDEX "idx_spend_entries_bonus" ON "public"."spend_entries" USING "btree" ("signup_bonus_id");



CREATE INDEX "idx_spend_entries_card" ON "public"."spend_entries" USING "btree" ("user_card_id");



CREATE INDEX "idx_spend_entries_card_date" ON "public"."spend_entries" USING "btree" ("user_card_id", "spent_on");



CREATE INDEX "idx_user_cards_portfolio" ON "public"."user_cards" USING "btree" ("portfolio_id");



CREATE INDEX "idx_user_cards_product" ON "public"."user_cards" USING "btree" ("card_product_id");



CREATE INDEX "idx_wallet_accounts_portfolio" ON "public"."wallet_accounts" USING "btree" ("portfolio_id");



CREATE OR REPLACE TRIGGER "trg_benefit_cycles_updated" BEFORE UPDATE ON "public"."user_benefit_cycles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_portfolios_updated" BEFORE UPDATE ON "public"."portfolios" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_redemptions_updated" BEFORE UPDATE ON "public"."benefit_redemptions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_rewards_programs_updated" BEFORE UPDATE ON "public"."rewards_programs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_signup_bonuses_updated" BEFORE UPDATE ON "public"."user_signup_bonuses" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_spend_entries_updated" BEFORE UPDATE ON "public"."spend_entries" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_user_cards_updated" BEFORE UPDATE ON "public"."user_cards" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_wallet_accounts_updated" BEFORE UPDATE ON "public"."wallet_accounts" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."benefit_definitions"
    ADD CONSTRAINT "benefit_definitions_benefit_category_id_fkey" FOREIGN KEY ("benefit_category_id") REFERENCES "public"."benefit_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."benefit_definitions"
    ADD CONSTRAINT "benefit_definitions_card_product_id_fkey" FOREIGN KEY ("card_product_id") REFERENCES "public"."card_products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."benefit_redemptions"
    ADD CONSTRAINT "benefit_redemptions_benefit_cycle_id_fkey" FOREIGN KEY ("benefit_cycle_id") REFERENCES "public"."user_benefit_cycles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."benefit_redemptions"
    ADD CONSTRAINT "benefit_redemptions_benefit_definition_id_fkey" FOREIGN KEY ("benefit_definition_id") REFERENCES "public"."benefit_definitions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."benefit_redemptions"
    ADD CONSTRAINT "benefit_redemptions_user_card_id_fkey" FOREIGN KEY ("user_card_id") REFERENCES "public"."user_cards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."card_products"
    ADD CONSTRAINT "card_products_issuer_id_fkey" FOREIGN KEY ("issuer_id") REFERENCES "public"."card_issuers"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."card_products"
    ADD CONSTRAINT "card_products_rewards_program_id_fkey" FOREIGN KEY ("rewards_program_id") REFERENCES "public"."rewards_programs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."card_reward_rules"
    ADD CONSTRAINT "card_reward_rules_card_product_id_fkey" FOREIGN KEY ("card_product_id") REFERENCES "public"."card_products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."card_reward_rules"
    ADD CONSTRAINT "card_reward_rules_reward_category_id_fkey" FOREIGN KEY ("reward_category_id") REFERENCES "public"."reward_categories"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."portfolio_members"
    ADD CONSTRAINT "portfolio_members_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."portfolio_members"
    ADD CONSTRAINT "portfolio_members_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."portfolios"
    ADD CONSTRAINT "portfolios_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."program_transfer_partners"
    ADD CONSTRAINT "program_transfer_partners_rewards_program_id_fkey" FOREIGN KEY ("rewards_program_id") REFERENCES "public"."rewards_programs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."program_transfer_partners"
    ADD CONSTRAINT "program_transfer_partners_transfer_partner_id_fkey" FOREIGN KEY ("transfer_partner_id") REFERENCES "public"."transfer_partners"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reward_categories"
    ADD CONSTRAINT "reward_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."reward_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."spend_entries"
    ADD CONSTRAINT "spend_entries_reward_category_id_fkey" FOREIGN KEY ("reward_category_id") REFERENCES "public"."reward_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."spend_entries"
    ADD CONSTRAINT "spend_entries_signup_bonus_id_fkey" FOREIGN KEY ("signup_bonus_id") REFERENCES "public"."user_signup_bonuses"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."spend_entries"
    ADD CONSTRAINT "spend_entries_user_card_id_fkey" FOREIGN KEY ("user_card_id") REFERENCES "public"."user_cards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_benefit_cycles"
    ADD CONSTRAINT "user_benefit_cycles_benefit_definition_id_fkey" FOREIGN KEY ("benefit_definition_id") REFERENCES "public"."benefit_definitions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_benefit_cycles"
    ADD CONSTRAINT "user_benefit_cycles_user_card_id_fkey" FOREIGN KEY ("user_card_id") REFERENCES "public"."user_cards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_cards"
    ADD CONSTRAINT "user_cards_card_product_id_fkey" FOREIGN KEY ("card_product_id") REFERENCES "public"."card_products"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."user_cards"
    ADD CONSTRAINT "user_cards_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_signup_bonuses"
    ADD CONSTRAINT "user_signup_bonuses_user_card_id_fkey" FOREIGN KEY ("user_card_id") REFERENCES "public"."user_cards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wallet_accounts"
    ADD CONSTRAINT "wallet_accounts_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wallet_accounts"
    ADD CONSTRAINT "wallet_accounts_rewards_program_id_fkey" FOREIGN KEY ("rewards_program_id") REFERENCES "public"."rewards_programs"("id") ON DELETE RESTRICT;



ALTER TABLE "public"."benefit_categories" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "benefit_cycles access" ON "public"."user_benefit_cycles" TO "authenticated" USING ("public"."can_access_user_card"("user_card_id")) WITH CHECK ("public"."can_access_user_card"("user_card_id"));



ALTER TABLE "public"."benefit_definitions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."benefit_redemptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."card_issuers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."card_products" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."card_reward_rules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "catalog read" ON "public"."benefit_categories" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "catalog read" ON "public"."benefit_definitions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "catalog read" ON "public"."card_issuers" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "catalog read" ON "public"."card_products" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "catalog read" ON "public"."card_reward_rules" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "catalog read" ON "public"."program_transfer_partners" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "catalog read" ON "public"."reward_categories" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "catalog read" ON "public"."rewards_programs" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "catalog read" ON "public"."transfer_partners" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "members read" ON "public"."portfolio_members" FOR SELECT TO "authenticated" USING ((("profile_id" = "auth"."uid"()) OR "public"."is_portfolio_member"("portfolio_id")));



CREATE POLICY "members write" ON "public"."portfolio_members" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."portfolios" "p"
  WHERE (("p"."id" = "portfolio_members"."portfolio_id") AND ("p"."created_by" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."portfolios" "p"
  WHERE (("p"."id" = "portfolio_members"."portfolio_id") AND ("p"."created_by" = "auth"."uid"())))));



CREATE POLICY "own profile read" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



CREATE POLICY "own profile update" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("id" = "auth"."uid"())) WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "portfolio creator delete" ON "public"."portfolios" FOR DELETE TO "authenticated" USING (("created_by" = "auth"."uid"()));



CREATE POLICY "portfolio creator update" ON "public"."portfolios" FOR UPDATE TO "authenticated" USING (("created_by" = "auth"."uid"())) WITH CHECK (("created_by" = "auth"."uid"()));



CREATE POLICY "portfolio insert" ON "public"."portfolios" FOR INSERT TO "authenticated" WITH CHECK (("created_by" = "auth"."uid"()));



CREATE POLICY "portfolio member read" ON "public"."portfolios" FOR SELECT TO "authenticated" USING (("public"."is_portfolio_member"("id") OR ("created_by" = "auth"."uid"())));



ALTER TABLE "public"."portfolio_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."portfolios" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."program_transfer_partners" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "redemptions access" ON "public"."benefit_redemptions" TO "authenticated" USING ("public"."can_access_user_card"("user_card_id")) WITH CHECK ("public"."can_access_user_card"("user_card_id"));



ALTER TABLE "public"."reward_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rewards_programs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "signup_bonuses access" ON "public"."user_signup_bonuses" TO "authenticated" USING ("public"."can_access_user_card"("user_card_id")) WITH CHECK ("public"."can_access_user_card"("user_card_id"));



ALTER TABLE "public"."spend_entries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "spend_entries access" ON "public"."spend_entries" TO "authenticated" USING ("public"."can_access_user_card"("user_card_id")) WITH CHECK ("public"."can_access_user_card"("user_card_id"));



ALTER TABLE "public"."transfer_partners" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_benefit_cycles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_cards" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_cards access" ON "public"."user_cards" TO "authenticated" USING ("public"."is_portfolio_member"("portfolio_id")) WITH CHECK ("public"."is_portfolio_member"("portfolio_id"));



ALTER TABLE "public"."user_signup_bonuses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "wallet access" ON "public"."wallet_accounts" TO "authenticated" USING ("public"."is_portfolio_member"("portfolio_id")) WITH CHECK ("public"."is_portfolio_member"("portfolio_id"));



ALTER TABLE "public"."wallet_accounts" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."can_access_user_card"("p_user_card_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_access_user_card"("p_user_card_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_access_user_card"("p_user_card_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_portfolio_member"("p_portfolio_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_portfolio_member"("p_portfolio_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_portfolio_member"("p_portfolio_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";


















GRANT ALL ON TABLE "public"."benefit_categories" TO "anon";
GRANT ALL ON TABLE "public"."benefit_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."benefit_categories" TO "service_role";



GRANT ALL ON TABLE "public"."benefit_definitions" TO "anon";
GRANT ALL ON TABLE "public"."benefit_definitions" TO "authenticated";
GRANT ALL ON TABLE "public"."benefit_definitions" TO "service_role";



GRANT ALL ON TABLE "public"."benefit_redemptions" TO "anon";
GRANT ALL ON TABLE "public"."benefit_redemptions" TO "authenticated";
GRANT ALL ON TABLE "public"."benefit_redemptions" TO "service_role";



GRANT ALL ON TABLE "public"."card_issuers" TO "anon";
GRANT ALL ON TABLE "public"."card_issuers" TO "authenticated";
GRANT ALL ON TABLE "public"."card_issuers" TO "service_role";



GRANT ALL ON TABLE "public"."card_products" TO "anon";
GRANT ALL ON TABLE "public"."card_products" TO "authenticated";
GRANT ALL ON TABLE "public"."card_products" TO "service_role";



GRANT ALL ON TABLE "public"."card_reward_rules" TO "anon";
GRANT ALL ON TABLE "public"."card_reward_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."card_reward_rules" TO "service_role";



GRANT ALL ON TABLE "public"."portfolio_members" TO "anon";
GRANT ALL ON TABLE "public"."portfolio_members" TO "authenticated";
GRANT ALL ON TABLE "public"."portfolio_members" TO "service_role";



GRANT ALL ON TABLE "public"."portfolios" TO "anon";
GRANT ALL ON TABLE "public"."portfolios" TO "authenticated";
GRANT ALL ON TABLE "public"."portfolios" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."program_transfer_partners" TO "anon";
GRANT ALL ON TABLE "public"."program_transfer_partners" TO "authenticated";
GRANT ALL ON TABLE "public"."program_transfer_partners" TO "service_role";



GRANT ALL ON TABLE "public"."reward_categories" TO "anon";
GRANT ALL ON TABLE "public"."reward_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."reward_categories" TO "service_role";



GRANT ALL ON TABLE "public"."rewards_programs" TO "anon";
GRANT ALL ON TABLE "public"."rewards_programs" TO "authenticated";
GRANT ALL ON TABLE "public"."rewards_programs" TO "service_role";



GRANT ALL ON TABLE "public"."spend_entries" TO "anon";
GRANT ALL ON TABLE "public"."spend_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."spend_entries" TO "service_role";



GRANT ALL ON TABLE "public"."transfer_partners" TO "anon";
GRANT ALL ON TABLE "public"."transfer_partners" TO "authenticated";
GRANT ALL ON TABLE "public"."transfer_partners" TO "service_role";



GRANT ALL ON TABLE "public"."user_benefit_cycles" TO "anon";
GRANT ALL ON TABLE "public"."user_benefit_cycles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_benefit_cycles" TO "service_role";



GRANT ALL ON TABLE "public"."user_cards" TO "anon";
GRANT ALL ON TABLE "public"."user_cards" TO "authenticated";
GRANT ALL ON TABLE "public"."user_cards" TO "service_role";



GRANT ALL ON TABLE "public"."user_signup_bonuses" TO "anon";
GRANT ALL ON TABLE "public"."user_signup_bonuses" TO "authenticated";
GRANT ALL ON TABLE "public"."user_signup_bonuses" TO "service_role";



GRANT ALL ON TABLE "public"."wallet_accounts" TO "anon";
GRANT ALL ON TABLE "public"."wallet_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."wallet_accounts" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


