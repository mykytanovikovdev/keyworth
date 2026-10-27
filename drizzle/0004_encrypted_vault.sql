CREATE TABLE "api_rate_limits" (
	"user_id" text NOT NULL,
	"bucket" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "api_rate_limits_user_id_bucket_pk" PRIMARY KEY("user_id","bucket")
);
--> statement-breakpoint
CREATE TABLE "device_unlocks" (
	"session_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"iv" "bytea" NOT NULL,
	"wrapped_key" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_unlock_token_hash_length" CHECK (octet_length("device_unlocks"."token_hash") = 32),
	CONSTRAINT "device_unlock_iv_length" CHECK (octet_length("device_unlocks"."iv") = 12),
	CONSTRAINT "device_unlock_wrapped_key_length" CHECK (octet_length("device_unlocks"."wrapped_key") = 48)
);
--> statement-breakpoint
CREATE TABLE "user_key_slots" (
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"kdf" jsonb,
	"salt" "bytea" NOT NULL,
	"iv" "bytea" NOT NULL,
	"wrapped_key" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_key_slots_user_id_kind_pk" PRIMARY KEY("user_id","kind"),
	CONSTRAINT "key_slot_kind" CHECK ("user_key_slots"."kind" in ('passphrase', 'recovery')),
	CONSTRAINT "key_slot_kdf_on_passphrase_only" CHECK (("user_key_slots"."kind" = 'passphrase') = ("user_key_slots"."kdf" is not null)),
	CONSTRAINT "key_slot_salt_length" CHECK (octet_length("user_key_slots"."salt") = 16),
	CONSTRAINT "key_slot_iv_length" CHECK (octet_length("user_key_slots"."iv") = 12),
	CONSTRAINT "key_slot_wrapped_key_length" CHECK (octet_length("user_key_slots"."wrapped_key") = 48)
);
--> statement-breakpoint
CREATE TABLE "vault_records" (
	"user_id" text NOT NULL,
	"id" uuid NOT NULL,
	"kind" text NOT NULL,
	"revision" integer NOT NULL,
	"envelope_version" smallint NOT NULL,
	"iv" "bytea" NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vault_records_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "vault_record_kind" CHECK ("vault_records"."kind" in ('settings', 'transaction', 'conversation', 'message', 'alert')),
	CONSTRAINT "vault_record_revision" CHECK ("vault_records"."revision" >= 1),
	CONSTRAINT "vault_record_iv_length" CHECK (octet_length("vault_records"."iv") = 12)
);
--> statement-breakpoint
ALTER TABLE "api_rate_limits" ADD CONSTRAINT "api_rate_limits_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_unlocks" ADD CONSTRAINT "device_unlocks_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_unlocks" ADD CONSTRAINT "device_unlocks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_key_slots" ADD CONSTRAINT "user_key_slots_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_records" ADD CONSTRAINT "vault_records_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vault_records_user_kind" ON "vault_records" USING btree ("user_id","kind");