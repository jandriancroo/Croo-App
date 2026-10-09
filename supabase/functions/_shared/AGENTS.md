# Shared function rules
- Brand-tied system emails build their header only with _shared/emailHeader.ts (resolveEmailLogo + renderEmailHeader); Availability Insights is built only by _shared/availabilityInsights.ts. Why: one logo order and one builder, no copied markup.
