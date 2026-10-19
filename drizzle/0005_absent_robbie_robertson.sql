CREATE TABLE "bridge_transfers" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"network" text NOT NULL,
	"status" text NOT NULL,
	"stellar_address" text NOT NULL,
	"evm_address" text,
	"source_chain_id" integer NOT NULL,
	"source_domain" integer NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"max_fee" numeric(78, 0) NOT NULL,
	"fee_executed" numeric(78, 0),
	"min_finality_threshold" integer NOT NULL,
	"finality_threshold_executed" integer,
	"change_trust_tx_hash" text,
	"approval_tx_hash" text,
	"burn_tx_hash" text,
	"mint_tx_hash" text,
	"iris_event_nonce" text,
	"message" text,
	"attestation" text,
	"minted_amount" numeric(78, 0),
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bridge_transfers_burn" ON "bridge_transfers" USING btree ("source_domain","burn_tx_hash","stellar_address");--> statement-breakpoint
CREATE INDEX "bridge_transfers_owner" ON "bridge_transfers" USING btree ("stellar_address","created_at");