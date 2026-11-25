-- Heart-rate stats for runs recorded live by FitPro: the lowest reading, the
-- heart-rate range the runner was aiming for, and the share of the run spent in it.
alter table runs
  add column min_hr double precision,
  add column hr_target_min double precision,
  add column hr_target_max double precision,
  add column hr_in_zone_pct double precision;
