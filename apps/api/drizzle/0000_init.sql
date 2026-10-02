CREATE TABLE "archives" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"fiscal_year_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"storage_key" text,
	"sha256" text,
	"size" integer,
	"manifest" jsonb,
	"error" text,
	"sealed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"project_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"operation_function" text NOT NULL,
	"contribution" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" uuid,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"prev_hash" text,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "biblio_refs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"ref_type" text NOT NULL,
	"title" text NOT NULL,
	"authors" text DEFAULT '' NOT NULL,
	"published_on" date NOT NULL,
	"doi" text,
	"url" text,
	"patent_number" text,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"section_id" uuid NOT NULL,
	"parent_id" uuid,
	"author_user_id" uuid NOT NULL,
	"anchor_text" text,
	"body" text NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_by" uuid
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"siren" text NOT NULL,
	"name" text NOT NULL,
	"naf_code" text,
	"sector" text,
	"headcount_total" integer,
	"headcount_rd" integer,
	"rd_organization" text,
	"hours_per_day" numeric(4, 2) DEFAULT 7 NOT NULL,
	"annual_hours_cap" integer DEFAULT 1607 NOT NULL,
	"unlinked_threshold" integer DEFAULT 20 NOT NULL,
	"referent_name" text,
	"referent_role" text,
	"referent_phone" text,
	"referent_email" text,
	"group_id" uuid,
	"import_mapping" jsonb,
	"trial_ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "companies_siren_unique" UNIQUE("siren")
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"kind" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "fiscal_years" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"label" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"expert_validation_name" text,
	"expert_validated_at" timestamp with time zone,
	"expert_validated_by" uuid,
	"expert_comment" text,
	"source_fiscal_year_id" uuid,
	"sealed_at" timestamp with time zone,
	"sealed_by" uuid,
	CONSTRAINT "fiscal_years_dates_ck" CHECK ("fiscal_years"."start_date" < "fiscal_years"."end_date"),
	CONSTRAINT "fiscal_years_status_ck" CHECK ("fiscal_years"."status" in ('draft','in_review','expert_validated','sealed'))
);
--> statement-breakpoint
CREATE TABLE "frascati_answers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"project_id" uuid NOT NULL,
	"criterion" text NOT NULL,
	"argument" text DEFAULT '' NOT NULL,
	"self_assessment" text NOT NULL,
	"cited_lock_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"cited_note_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'reader' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_members_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"join_code_hash" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "groups_join_code_hash_unique" UNIQUE("join_code_hash")
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"fiscal_year_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"headers" text[] DEFAULT '{}'::text[] NOT NULL,
	"rows" jsonb,
	"mapping" jsonb,
	"unit" text DEFAULT 'hours' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"errors" jsonb,
	"committed_rows" integer,
	"committed_at" timestamp with time zone,
	"source_sha256" text
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"access_expires_at" date,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "lock_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"lock_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"data" jsonb NOT NULL,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"statement" text NOT NULL,
	"sota_gap" text NOT NULL,
	"identified_on" date NOT NULL,
	"outcome" text DEFAULT 'en_cours' NOT NULL,
	"to_update" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"source_lock_id" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"access_expires_at" date,
	CONSTRAINT "memberships_role_ck" CHECK ("memberships"."role" in ('admin','redacteur','contributeur','expert'))
);
--> statement-breakpoint
CREATE TABLE "note_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"note_id" uuid NOT NULL,
	"url" text NOT NULL,
	"label" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"ref_no" integer NOT NULL,
	"topic_id" uuid NOT NULL,
	"author_person_id" uuid NOT NULL,
	"note_date" date NOT NULL,
	"hypothesis" text NOT NULL,
	"work_done" text NOT NULL,
	"result" text NOT NULL,
	"result_kind" text NOT NULL,
	"conclusion" text DEFAULT '' NOT NULL,
	"next_step" text DEFAULT '' NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "operations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"project_id" uuid NOT NULL,
	"lineage_id" uuid NOT NULL,
	"title" text NOT NULL,
	"title_locked" boolean DEFAULT false NOT NULL,
	"start_date" date,
	"end_date" date,
	"type" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text,
	"user_id" uuid,
	"job_title" text,
	"degree" text,
	"degree_institution" text,
	"degree_date" date,
	"status" text NOT NULL,
	"entry_date" date,
	"exit_date" date,
	"thesis_date" date,
	"cdi_date" date,
	"is_support_function" boolean DEFAULT false NOT NULL,
	"monthly_salary_enc" text,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"fiscal_year_id" uuid NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"objectives" text DEFAULT '' NOT NULL,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"verdict" text,
	"verdict_justification" text,
	"verdict_expert_name" text,
	"verdict_date" date,
	"verdict_by" uuid,
	"source_project_id" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "projects_verdict_ck" CHECK ("projects"."verdict" is null or "projects"."verdict" in ('eligible_cir','piste_cii','non_eligible'))
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"hour" integer DEFAULT 17 NOT NULL,
	"weekdays" integer[] DEFAULT '{1,2,3,4,5}'::int[] NOT NULL,
	"last_sent_on" date
);
--> statement-breakpoint
CREATE TABLE "rescrits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"type" text NOT NULL,
	"decision_date" date,
	"decision" text NOT NULL,
	"years" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "section_notes" (
	"company_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"note_id" uuid NOT NULL,
	CONSTRAINT "section_notes_section_id_note_id_pk" PRIMARY KEY("section_id","note_id")
);
--> statement-breakpoint
CREATE TABLE "section_refs" (
	"company_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"ref_id" uuid NOT NULL,
	CONSTRAINT "section_refs_section_id_ref_id_pk" PRIMARY KEY("section_id","ref_id")
);
--> statement-breakpoint
CREATE TABLE "section_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"content_text" text NOT NULL,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"fiscal_year_id" uuid NOT NULL,
	"project_id" uuid,
	"operation_id" uuid,
	"rubrique" text NOT NULL,
	"content" jsonb DEFAULT '{"type":"doc","content":[]}'::jsonb NOT NULL,
	"content_text" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"author_id" uuid,
	"validated_by" uuid,
	"validated_at" timestamp with time zone,
	"to_update" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"active_company_id" uuid,
	"mfa_verified" boolean DEFAULT false NOT NULL,
	"csrf_token" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"status" text DEFAULT 'none' NOT NULL,
	"current_period_end" timestamp with time zone,
	"past_due_since" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"fiscal_year_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"operation_id" uuid,
	"entry_date" date NOT NULL,
	"granularity" text DEFAULT 'day' NOT NULL,
	"hours" numeric(6, 2) NOT NULL,
	"note_id" uuid,
	"source" text DEFAULT 'manual' NOT NULL,
	"import_id" uuid,
	CONSTRAINT "time_entries_hours_ck" CHECK ("time_entries"."hours" > 0),
	CONSTRAINT "time_entries_granularity_ck" CHECK ("time_entries"."granularity" in ('day','month'))
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"lock_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"hypothesis" text NOT NULL,
	"approach" text DEFAULT '' NOT NULL,
	"owner_person_id" uuid,
	"status" text DEFAULT 'ouvert' NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"password_hash" text,
	"mfa_secret_enc" text,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"mfa_recovery_hashes" text[] DEFAULT '{}'::text[] NOT NULL,
	"google_sub" text,
	"microsoft_sub" text,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_google_sub_unique" UNIQUE("google_sub"),
	CONSTRAINT "users_microsoft_sub_unique" UNIQUE("microsoft_sub")
);
--> statement-breakpoint
ALTER TABLE "archives" ADD CONSTRAINT "archives_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archives" ADD CONSTRAINT "archives_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biblio_refs" ADD CONSTRAINT "biblio_refs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_years" ADD CONSTRAINT "fiscal_years_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frascati_answers" ADD CONSTRAINT "frascati_answers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frascati_answers" ADD CONSTRAINT "frascati_answers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lock_versions" ADD CONSTRAINT "lock_versions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lock_versions" ADD CONSTRAINT "lock_versions_lock_id_locks_id_fk" FOREIGN KEY ("lock_id") REFERENCES "public"."locks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locks" ADD CONSTRAINT "locks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locks" ADD CONSTRAINT "locks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_links" ADD CONSTRAINT "note_links_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_links" ADD CONSTRAINT "note_links_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_author_person_id_people_id_fk" FOREIGN KEY ("author_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rescrits" ADD CONSTRAINT "rescrits_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_notes" ADD CONSTRAINT "section_notes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_notes" ADD CONSTRAINT "section_notes_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_notes" ADD CONSTRAINT "section_notes_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_refs" ADD CONSTRAINT "section_refs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_refs" ADD CONSTRAINT "section_refs_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_refs" ADD CONSTRAINT "section_refs_ref_id_biblio_refs_id_fk" FOREIGN KEY ("ref_id") REFERENCES "public"."biblio_refs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_versions" ADD CONSTRAINT "section_versions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_versions" ADD CONSTRAINT "section_versions_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_lock_id_locks_id_fk" FOREIGN KEY ("lock_id") REFERENCES "public"."locks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_owner_person_id_people_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_project_person_uq" ON "assignments" USING btree ("project_id","person_id");--> statement-breakpoint
CREATE INDEX "audit_company_idx" ON "audit_log" USING btree ("company_id","id");--> statement-breakpoint
CREATE INDEX "comments_section_idx" ON "comments" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "files_owner_idx" ON "files" USING btree ("company_id","kind","owner_id");--> statement-breakpoint
CREATE INDEX "fiscal_years_company_idx" ON "fiscal_years" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "frascati_project_criterion_uq" ON "frascati_answers" USING btree ("project_id","criterion");--> statement-breakpoint
CREATE INDEX "invitations_company_idx" ON "invitations" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "locks_project_number_uq" ON "locks" USING btree ("project_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_company_user_uq" ON "memberships" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notes_company_ref_uq" ON "notes" USING btree ("company_id","ref_no");--> statement-breakpoint
CREATE INDEX "notes_topic_date_idx" ON "notes" USING btree ("topic_id","note_date");--> statement-breakpoint
CREATE INDEX "people_company_idx" ON "people" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_fy_code_uq" ON "projects" USING btree ("fiscal_year_id","code") WHERE "projects"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "section_versions_uq" ON "section_versions" USING btree ("section_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "sections_fy_project_rubrique_uq" ON "sections" USING btree ("fiscal_year_id",coalesce("project_id", '00000000-0000-0000-0000-000000000000'::uuid),"rubrique");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "time_entries_person_date_idx" ON "time_entries" USING btree ("company_id","person_id","entry_date");--> statement-breakpoint
CREATE INDEX "time_entries_project_idx" ON "time_entries" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "time_entries_note_idx" ON "time_entries" USING btree ("note_id");--> statement-breakpoint
CREATE UNIQUE INDEX "topics_lock_number_uq" ON "topics" USING btree ("lock_id","number");