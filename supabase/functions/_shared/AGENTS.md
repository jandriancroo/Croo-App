# Shared function rules
- Brand-tied system emails build their header only with _shared/emailHeader.ts (resolveEmailLogo + renderEmailHeader); Availability Insights is built only by _shared/availabilityInsights.ts. Why: one logo order and one builder, no copied markup.
- Batch jobs skip switched-off locations via locations.is_active or locationLive.ts (fail-open); Org-off cascades into locations.is_active through set_organization_active. Why: active stores never lose work if the check fails.
