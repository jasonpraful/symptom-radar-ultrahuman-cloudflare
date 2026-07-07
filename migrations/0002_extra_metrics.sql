-- Additional metrics the live Ultrahuman Partner API exposes that the original
-- port never captured: VO2 max (was extracted as null), weekly activity, daily
-- movement count, morning alertness, and the metabolic/glucose suite (populated
-- only for users with the Ultrahuman M1 CGM — nullable, harmless when absent).
ALTER TABLE daily_snapshots ADD COLUMN weekly_active_minutes REAL;
ALTER TABLE daily_snapshots ADD COLUMN movements REAL;
ALTER TABLE daily_snapshots ADD COLUMN morning_alertness REAL;
ALTER TABLE daily_snapshots ADD COLUMN avg_glucose REAL;
ALTER TABLE daily_snapshots ADD COLUMN glucose_variability REAL;
ALTER TABLE daily_snapshots ADD COLUMN metabolic_score REAL;
ALTER TABLE daily_snapshots ADD COLUMN hba1c REAL;
ALTER TABLE daily_snapshots ADD COLUMN time_in_target REAL;
