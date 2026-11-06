CREATE INDEX "bug_links_bug_position_idx" ON "bug_links" USING btree ("bug_id","position");--> statement-breakpoint
CREATE INDEX "bugs_run_idx" ON "bugs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "bugs_test_case_idx" ON "bugs" USING btree ("test_case_id");