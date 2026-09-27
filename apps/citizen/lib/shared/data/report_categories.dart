import 'package:flutter/material.dart';
import '../../core/constants/app_colors.dart';

/// Visual identity for a civic-issue category.
///
/// Used by the Report screen (selectable tiles) and by report cards (the icon
/// box that stands in when a report has no photo).
class ReportCategoryVisual {
  const ReportCategoryVisual({
    required this.id,
    required this.title,
    required this.icon,
    required this.accent,
    required this.accentLight,
  });

  /// The **database slug**, not a display name — `POTHOLE`, not `pothole`.
  ///
  /// It is matched against `ReportCategory.slug`, which comes straight from the
  /// `report_categories` table. These were previously camelCase (`waterLeak`),
  /// which meant `reportCategoryById` never matched a single real category and
  /// every report in the app rendered as "Other" — silently, because the
  /// fallback is a perfectly valid-looking category.
  final String id;

  final String title;
  final IconData icon;
  final Color accent;
  final Color accentLight;
}

/// Mirrors the rows seeded by
/// `supabase/migrations/20260927120001_create_report_categories.sql`.
const List<ReportCategoryVisual> kReportCategories = [
  ReportCategoryVisual(
    id: 'POTHOLE',
    title: 'Pothole',
    icon: Icons.image_outlined,
    accent: AppColors.primary,
    accentLight: AppColors.primaryLight,
  ),
  ReportCategoryVisual(
    id: 'FLOODING',
    title: 'Flooding',
    icon: Icons.umbrella_outlined,
    accent: AppColors.primary,
    accentLight: AppColors.primaryLight,
  ),
  ReportCategoryVisual(
    id: 'STREETLIGHT',
    title: 'Streetlight',
    icon: Icons.wb_sunny_outlined,
    accent: AppColors.primary,
    accentLight: AppColors.primaryLight,
  ),
  ReportCategoryVisual(
    id: 'WASTE',
    title: 'Waste',
    icon: Icons.delete_outline_rounded,
    accent: AppColors.primary,
    accentLight: AppColors.primaryLight,
  ),
  ReportCategoryVisual(
    id: 'WATER_LEAK',
    title: 'Water Leak',
    icon: Icons.water_drop_outlined,
    accent: AppColors.primary,
    accentLight: AppColors.primaryLight,
  ),
  ReportCategoryVisual(
    id: 'OTHER',
    title: 'Other',
    icon: Icons.error_outline_rounded,
    accent: AppColors.primary,
    accentLight: AppColors.primaryLight,
  ),
];

/// The slug a category falls back to when this build does not recognise it.
const String kOtherCategorySlug = 'OTHER';

/// Resolves a database slug to its visuals, falling back to "Other".
///
/// The match is case-insensitive so a future migration that switches the column
/// to lowercase does not quietly reintroduce the every-category-is-Other bug
/// this function's callers used to have.
ReportCategoryVisual reportCategoryById(String? slug) {
  final wanted = slug?.toUpperCase();

  for (final category in kReportCategories) {
    if (category.id == wanted) return category;
  }

  return kReportCategories.firstWhere((c) => c.id == kOtherCategorySlug);
}
